'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const BASE = 'https://www.fwedi.ch';
const SOURCE = 'fwedi';
const SOURCE_NAME = 'Feuerwehr EDI (Ebikon)';
// Year URL pattern: /news/einsatzstatistik for current year, /news/einsatzstatistik/YYYY for past years
// 2025 uses slug "2024-kopie" — try standard and fall back
const YEAR_URLS = [
  { year: 2026, url: `${BASE}/news/einsatzstatistik` },
  { year: 2025, url: `${BASE}/news/einsatzstatistik/2025`, fallback: `${BASE}/news/einsatzstatistik/2024-kopie` },
  { year: 2024, url: `${BASE}/news/einsatzstatistik/2024` },
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
  // Format: "Fr, 27.03.2026 - 22:16" → extract date
  const m = raw.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseTime(raw) {
  // Extract time from "Fr, 27.03.2026 - 22:16"
  const m = raw.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

async function scrapeYear(cfg) {
  console.log(`[fwedi] Scraping year ${cfg.year}: ${cfg.url}...`);

  let html;
  try {
    html = await fetchPage(cfg.url);
  } catch {
    if (cfg.fallback) {
      try { html = await fetchPage(cfg.fallback); }
      catch (err) { console.error(`[fwedi] Failed year ${cfg.year}: ${err.message}`); return []; }
    } else {
      console.error(`[fwedi] Failed year ${cfg.year}`); return [];
    }
  }

  const $ = cheerio.load(html);
  const incidents = [];

  // Structure: table with rows containing NR | Datum-Zeit | Ereignis | Total AdF | Links
  // Each row: <tr><td>16</td><td>Fr, 27.03.2026 - 22:16</td><td>Gasgeruch...</td><td>9</td>...</tr>
  $('table tr').each((idx, el) => {
    const tds = $(el).find('td');
    if (tds.length < 3) return;

    const dateTimeRaw = tds.eq(1).text().trim();
    const date = parseDate(dateTimeRaw);
    if (!date) return;
    const time = parseTime(dateTimeRaw);

    // Column 2: Ereignis — may include type + location separated by comma
    const ereignis = tds.eq(2).text().trim();
    const commaIdx = ereignis.indexOf(',');
    const typeRaw = commaIdx > 0 ? ereignis.substring(0, commaIdx).trim() : ereignis;
    const location = commaIdx > 0 ? ereignis.substring(commaIdx + 1).trim() : '';

    if (!typeRaw) return;

    incidents.push({
      id: `${SOURCE}-${cfg.year}-${idx}`,
      source: SOURCE,
      sourceName: SOURCE_NAME,
      canton: 'LU',
      date,
      time,
      typeRaw,
      type: normalizeType(typeRaw),
      location,
      description: '',
      url: cfg.url,
    });
  });

  console.log(`[fwedi] Year ${cfg.year}: ${incidents.length} incidents`);
  return incidents;
}

async function scrape() {
  const results = [];
  for (const cfg of YEAR_URLS) results.push(...(await scrapeYear(cfg)));
  return results;
}

module.exports = { scrape };
