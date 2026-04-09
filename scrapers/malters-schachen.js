'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const BASE = 'https://www.feuerwehr-malters-schachen.ch';
const SOURCE = 'malters-schachen';
const SOURCE_NAME = 'Feuerwehr Malters-Schachen';
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

async function fetchPage(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 FireAlerts-Aggregator/1.0' },
      });
      return res.data;
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

function parseDate(raw) {
  // Format: "04.12.2025 - 15:34" or "26.03.2026 / 17:47"
  const m = raw.match(/(\d{2})\.(\d{2})\.(\d{4})\s*[-\/]\s*(\d{2}):(\d{2})/);
  if (!m) return { date: null, time: null };
  return {
    date: `${m[3]}-${m[2]}-${m[1]}`,
    time: `${m[4]}:${m[5]}`,
  };
}

async function scrapeYear(year) {
  const url = `${BASE}/einsaetze/${year}`;
  console.log(`[malters-schachen] Scraping ${url}...`);

  let html;
  try {
    html = await fetchPage(url);
  } catch (err) {
    console.error(`[malters-schachen] Failed ${url}: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const incidents = [];

  // Actual structure (confirmed from live HTML):
  //   <div class="einsatz">
  //     <div class="einsatzdatum">04.12.2025 - 15:34</div>
  //     <div class="einsatztitel"><a href="...">Autobrand</a></div>   ← link optional
  //     <div class="einsatzbeschreibung"><p>Im Einsatz: 21 AdF</p></div>
  //   </div>

  $('div.einsatz').each((idx, el) => {
    const $el = $(el);

    const dateRaw = $el.find('.einsatzdatum').text().trim();
    const { date, time } = parseDate(dateRaw);

    const $titelEl = $el.find('.einsatztitel');
    const $link = $titelEl.find('a');
    const typeRaw = ($link.length ? $link : $titelEl).text().trim();
    const href = $link.attr('href') || '';
    const url = href ? (href.startsWith('http') ? href : BASE + href) : `${BASE}/einsaetze/${year}`;

    const descText = $el.find('.einsatzbeschreibung').text().trim();
    const personnelMatch = descText.match(/Im Einsatz:\s*(\d+)\s*AdF/i);
    const description = personnelMatch ? `Im Einsatz: ${personnelMatch[1]} AdF` : descText;

    if (!typeRaw) return;

    incidents.push({
      id: `${SOURCE}-${year}-${idx}`,
      source: SOURCE,
      sourceName: SOURCE_NAME,
      canton: 'LU',
      date,
      time,
      typeRaw,
      type: normalizeType(typeRaw),
      location: '',
      description,
      url,
    });
  });

  console.log(`[malters-schachen] Year ${year}: ${incidents.length} incidents`);
  return incidents;
}

async function scrape() {
  const results = [];
  for (const year of YEARS) {
    results.push(...(await scrapeYear(year)));
  }
  return results;
}

module.exports = { scrape };
