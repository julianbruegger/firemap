'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const BASE = 'https://www.frsursee.ch';
const SOURCE = 'sursee';
const SOURCE_NAME = 'Feuerwehr Sursee';
const URL = `${BASE}/einsaetze`;

const MONTHS = {
  januar: '01', februar: '02', märz: '03', april: '04',
  mai: '05', juni: '06', juli: '07', august: '08',
  september: '09', oktober: '10', november: '11', dezember: '12',
  january: '01', february: '02', march: '03', june: '06',
  july: '07', october: '10', november: '11', december: '12',
};

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
  // "6. März 2026" or "6 . March 2026"
  const m = raw.match(/(\d{1,2})\s*\.?\s*(\S+)\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${String(m[1]).padStart(2, '0')}`;
}

function parseTime(raw) {
  const m = raw.match(/(\d{1,2}):(\d{2})/);
  return m ? `${String(m[1]).padStart(2, '0')}:${m[2]}` : null;
}

async function scrape() {
  console.log(`[sursee] Scraping ${URL}...`);

  let html;
  try { html = await fetchPage(URL); }
  catch (err) { console.error(`[sursee] Failed: ${err.message}`); return []; }

  const $ = cheerio.load(html);
  const incidents = [];

  // Try multiple container selectors — pick whichever yields results
  const selectors = [
    '[class*="einsatz"]',
    '[class*="incident"]',
    '[class*="entry"]',
    'article',
    '.news-item',
    '.list-item',
    'tr',
  ];

  let containers = [];
  for (const sel of selectors) {
    const found = $(sel).toArray();
    if (found.length > 2) { containers = found; break; }
  }

  containers.forEach((el, idx) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();

    // Look for a date pattern like "6. März 2026" or "06.03.2026"
    let date = null;
    let time = null;

    // Named month format: "6. März 2026"
    const namedDate = text.match(/(\d{1,2})\s*\.?\s*([A-Za-zä-ü]+)\s+(20\d{2})/i);
    if (namedDate) {
      date = parseDate(namedDate[0]);
    }

    // Numeric format: "06.03.2026"
    if (!date) {
      const numDate = text.match(/(\d{2})\.(\d{2})\.(20\d{2})/);
      if (numDate) date = `${numDate[3]}-${numDate[2]}-${numDate[1]}`;
    }

    if (!date) return;

    // Extract time
    const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*(?:Uhr)?/);
    if (timeMatch) time = parseTime(timeMatch[0]);

    // Extract type: longest meaningful word/phrase that isn't date/time/location boilerplate
    const lines = $(el).text().split(/[\n\r\/]/).map(l => l.trim()).filter(Boolean);
    const typeRaw = lines.find(l =>
      l.length > 3 &&
      !l.match(/^\d{1,2}[\s.]+[A-Za-z]/) && // not a date line
      !l.match(/^\d{2}\.\d{2}\.20\d{2}/) &&  // not numeric date
      !l.match(/\d{1,2}:\d{2}/) &&            // not a time line
      !l.match(/Formation|Dauer|AlStu|Pikett|Alarmierung/i)
    ) || '';

    if (!typeRaw || typeRaw.length < 3) return;

    // Location: look for "Sursee" or street keywords
    const locationLine = lines.find(l =>
      (l.includes('Sursee') || /strasse|gasse|weg|platz|allee/i.test(l)) &&
      l !== typeRaw
    ) || '';

    incidents.push({
      id: `${SOURCE}-${idx}`,
      source: SOURCE,
      sourceName: SOURCE_NAME,
      canton: 'LU',
      date,
      time,
      typeRaw,
      type: normalizeType(typeRaw),
      location: locationLine,
      description: '',
      url: URL,
    });
  });

  // Deduplicate by date+typeRaw
  const seen = new Set();
  const deduped = incidents.filter(c => {
    const key = `${c.date}-${c.typeRaw}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[sursee] ${deduped.length} incidents`);
  return deduped;
}

module.exports = { scrape };
