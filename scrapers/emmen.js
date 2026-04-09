'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const BASE = 'https://www.feuerwehr-emmen.ch';
const SOURCE = 'emmen';
const SOURCE_NAME = 'Feuerwehr Emmen';

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
  // Format: "Fr, 03.04.2026 | 15:19 Uhr" → split on |
  const parts = raw.split('|');
  if (parts.length < 2) return { date: null, time: null };

  const datePart = parts[0].trim(); // "Fr, 03.04.2026"
  const timePart = parts[1].trim(); // "15:19 Uhr"

  // Extract date: DD.MM.YYYY
  const dateM = datePart.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  // Extract time: HH:MM
  const timeM = timePart.match(/(\d{2}):(\d{2})/);

  return {
    date: dateM ? `${dateM[3]}-${dateM[2]}-${dateM[1]}` : null,
    time: timeM ? `${timeM[1]}:${timeM[2]}` : null,
  };
}

async function scrape() {
  const mainUrl = `${BASE}/einsaetze.html`;
  console.log(`[emmen] Scraping ${mainUrl}...`);

  let html;
  try {
    html = await fetchPage(mainUrl);
  } catch (err) {
    console.error(`[emmen] Failed ${mainUrl}: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const incidents = [];

  // Structure:
  //   <a href="/einsaetze/[slug]-[id].html">
  //     <h6>Fr, 03.04.2026 | 15:19 Uhr</h6>
  //     <h3>Brand mittel</h3>
  //     <p>Emmen</p>                  ← location
  //     <p>Brandbekämpfung</p>        ← category (description)
  //   </a>

  $('div.fs-load-more-item').each((idx, el) => {
    const $el = $(el);
    const $link = $el.find('a').first();
    const href = $link.attr('href') || '';

    const dateTimeRaw = $link.find('h6').text().trim();
    const { date, time } = parseDate(dateTimeRaw);

    const typeRaw = $link.find('h3').text().trim();

    // First <p> is location, second is category/description
    const $ps = $link.find('p');
    const location = $ps.eq(0).text().trim();
    const description = $ps.eq(1).text().trim();

    if (!typeRaw) return;

    const url = href ? (href.startsWith('http') ? href : BASE + href) : BASE;

    incidents.push({
      id: `${SOURCE}-${idx}`,
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

  console.log(`[emmen] ${incidents.length} incidents scraped`);
  return incidents;
}

module.exports = { scrape };
