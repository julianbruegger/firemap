'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const BASE = 'https://www.feuerwehr-kriens.ch';
const SOURCE = 'kriens';
const SOURCE_NAME = 'Feuerwehr Kriens';
const YEARS = [
  { year: 2024, url: `${BASE}/ueber-uns/aktuell/einsaetze-2024.page/2192` },
  { year: 2025, url: `${BASE}/ueber-uns/aktuell/einsaetze-2025.page/2397` },
  { year: 2026, url: `${BASE}/ueber-uns/aktuell/einsaetze-2026.page/2505` },
];

async function fetchPage(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
      });
      return res.data;
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

function parseDate(raw) {
  const m = raw.trim().match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseTime(raw) {
  // Format: "Dienstag 21:26" or "21:26"
  const m = raw.trim().match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

async function scrapeYear(yearCfg) {
  const { year, url } = yearCfg;
  console.log(`[kriens] Scraping ${url}...`);

  let html;
  try { html = await fetchPage(url); }
  catch (err) { console.error(`[kriens] Failed ${url}: ${err.message}`); return []; }

  const $ = cheerio.load(html);
  const incidents = [];

  // Structure: one table per month, each row is a single incident:
  // <tr><td>DD.MM.YYYY</td><td>Type<br>Location</td><td>Day<br>HH:MM</td><td>Formation<br>Detail</td></tr>
  // The type/location, time, and formation columns use <br> to separate two lines.
  const rows = $('table tbody tr').toArray();
  let incidentIdx = 0;
  for (const row of rows) {
    const tds = $(row).find('td');
    if (tds.length < 3) continue;

    const dateRaw = tds.eq(0).text().trim();
    const date = parseDate(dateRaw);
    if (!date) continue; // skip header rows

    // Column 1: "Bezeichnung des Einsatzes / Ort" — type + location split by <br>
    const col1Html = tds.eq(1).html() || '';
    const col1Parts = col1Html.split(/<br\s*\/?>/i).map(s => cheerio.load(s).text().replace(/\s+/g, ' ').trim());
    const typeRaw = col1Parts[0] || '';
    const location = col1Parts[1] || '';

    // Column 2: "Tag / Alarmzeit" — e.g. "Samstag<br>20:13"
    const col2 = tds.eq(2).text().replace(/\s+/g, ' ').trim();
    const time = parseTime(col2);

    // Column 3 (optional): Formation/Alarmstufe — e.g. "A1<br>Brandmeldeanlage"
    const description = tds.length > 3 ? tds.eq(3).text().replace(/\s+/g, ' ').trim() : '';

    if (!typeRaw) continue;

    incidents.push({
      id: `${SOURCE}-${year}-${incidentIdx}`,
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

    incidentIdx++;
  }

  console.log(`[kriens] Year ${year}: ${incidents.length} incidents`);
  return incidents;
}

async function scrape() {
  const results = [];
  for (const cfg of YEARS) results.push(...(await scrapeYear(cfg)));
  return results;
}

module.exports = { scrape };
