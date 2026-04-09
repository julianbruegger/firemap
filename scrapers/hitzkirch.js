'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const SOURCE = 'hitzkirch';
const SOURCE_NAME = 'Feuerwehr Hitzkirch Plus';
const YEARS = [2024, 2025, 2026];
const BASE_URL = 'https://www.feuerwehr-hitzkirchplus.ch/?page_id=870';

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
  const m = raw.trim().match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function scrape() {
  console.log(`[hitzkirch] Scraping ${BASE_URL}...`);

  let html;
  try { html = await fetchPage(BASE_URL); }
  catch (err) { console.error(`[hitzkirch] Failed: ${err.message}`); return []; }

  const $ = cheerio.load(html);
  const incidents = [];
  const cutoff = `${Math.min(...YEARS)}-01-01`;

  // Structure: <table id="tablepress-13"> (DataTables — all data rendered server-side)
  // Columns: #, Datum, Uhrzeit, Description/Location, Alarmstufe, Kategorie
  $('table#tablepress-13 tbody tr, table.tablepress tbody tr').each((idx, el) => {
    const tds = $(el).find('td');
    if (tds.length < 4) return;

    const dateRaw = tds.eq(1).text().trim();
    const date = parseDate(dateRaw);
    if (!date || date < cutoff) return;

    const time = tds.eq(2).text().trim() || null;

    // Column 3: full description + location (e.g. "Verkehrsunfall, Luzernerstrasse, Gelfingen")
    const col3 = tds.eq(3).text().trim();
    // Split at first comma — first part is type, rest is location
    const commaIdx = col3.indexOf(',');
    const typeRaw = commaIdx > 0 ? col3.substring(0, commaIdx).trim() : col3;
    const location = commaIdx > 0 ? col3.substring(commaIdx + 1).trim() : '';

    // Column 5 (if present): Kategorie
    const kategorie = tds.length > 5 ? tds.eq(5).text().trim() : '';
    // Use kategorie as additional context for normalization if typeRaw is generic
    const typeForNorm = typeRaw || kategorie;

    if (!typeForNorm) return;

    incidents.push({
      id: `${SOURCE}-${date}-${idx}`,
      source: SOURCE,
      sourceName: SOURCE_NAME,
      canton: 'LU',
      date,
      time,
      typeRaw: typeForNorm,
      type: normalizeType(typeForNorm),
      location,
      description: kategorie !== typeRaw ? kategorie : '',
      url: BASE_URL,
    });
  });

  console.log(`[hitzkirch] ${incidents.length} incidents`);
  return incidents;
}

module.exports = { scrape };
