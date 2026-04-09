'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const BASE = 'https://feuerwehr-rothenburg.ch';
const SOURCE = 'rothenburg';
const SOURCE_NAME = 'Feuerwehr Rothenburg';
const YEARS = [
  { year: 2024, url: `${BASE}/einsaetze/einsaetze-2024/` },
  { year: 2025, url: `${BASE}/einsaetze/einsaetze-2025/` },
  { year: 2026, url: `${BASE}/einsaetze/einsaetze-2026/` },
];

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
  // Format: "21.03.2026"
  const m = raw.trim().match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function scrapeYear(yearCfg) {
  const { year, url } = yearCfg;
  console.log(`[rothenburg] Scraping ${url}...`);

  let html;
  try { html = await fetchPage(url); }
  catch (err) { console.error(`[rothenburg] Failed ${url}: ${err.message}`); return []; }

  const $ = cheerio.load(html);
  const incidents = [];

  // Structure: <table class="einsatzverwaltung-reportlist">
  //   <tr class="report">
  //     <td>21.03.2026</td>          -- date
  //     <td>08:12</td>               -- time
  //     <td>Stationsstrasse</td>     -- location
  //     <td><strong>Ölspur</strong><br/>description</td>
  //     <td>Kdo, 3 AdF</td>          -- personnel
  //     <td>...</td>                 -- vehicles
  //   </tr>

  $('table.einsatzverwaltung-reportlist tr.report').each((idx, el) => {
    const tds = $(el).find('td');
    if (tds.length < 5) return;

    // TD0 = combined summary (skip), TD1=date, TD2=time, TD3=location, TD4=type+desc
    const date = parseDate(tds.eq(1).text());
    const time = tds.eq(2).text().trim() || null;
    const location = tds.eq(3).text().trim();

    const $td4 = tds.eq(4);
    const typeRaw = $td4.find('strong').first().text().trim()
      || $td4.text().split('\n')[0].trim();
    const description = $td4.text().replace(typeRaw, '').trim();

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
      location,
      description,
      url,
    });
  });

  console.log(`[rothenburg] Year ${year}: ${incidents.length} incidents`);
  return incidents;
}

async function scrape() {
  const results = [];
  for (const cfg of YEARS) results.push(...(await scrapeYear(cfg)));
  return results;
}

module.exports = { scrape };
