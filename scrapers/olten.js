'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const BASE = 'https://www.feuerwehr-olten.ch';
const LIST_URL = `${BASE}/einsaetze`;
const SOURCE = 'olten';
const SOURCE_NAME = 'Feuerwehr Olten';

// Concurrency limiter for detail page fetches
const CONCURRENCY = 3;
const DETAIL_DELAY_MS = 300;

async function fetchPage(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 FireAlerts-Aggregator/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8',
        },
      });
      return res.data;
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/**
 * Parse the embedded JSON data from the list page's data-entities attribute.
 * Returns array of { title, href, date, dateSortable }.
 */
function parseListData(html) {
  const m = html.match(/data-entities="([^"]+)"/);
  if (!m) return [];

  const decoded = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const obj = JSON.parse(decoded);
  if (!obj.data) return [];

  return obj.data.map(item => {
    const hrefMatch = item.name.match(/href="([^"]+)"/);
    const titleMatch = item.name.match(/>([^<]+)</);
    const href = hrefMatch ? hrefMatch[1] : null;
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Convert /_rte/information/XXXXX to /einsaetze/XXXXX
    const detailPath = href ? href.replace(/\/_rte\/information\//, '/einsaetze/') : null;

    return {
      title,
      href: detailPath,
      date: item['datum-sort'] || item.datum,
      dateSortable: item['datum-sort'] || '',
    };
  });
}

/**
 * Parse a date string like "03.01.2023" or ISO "2023-01-03 00:00:00" into YYYY-MM-DD.
 */
function parseDate(raw) {
  if (!raw) return null;
  // ISO format from datum-sort
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD.MM.YYYY
  const dmy = raw.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return null;
}

/**
 * Parse time from datum-sort "2023-01-03 19:50:00" or from description text.
 */
function parseTime(raw) {
  if (!raw) return null;
  const m = raw.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * Extract the type from the title "Olten: Automatischer Brandalarm" → "Automatischer Brandalarm"
 */
function extractType(title) {
  const m = title.match(/^Olten:\s*(.+)$/i);
  return m ? m[1].trim() : title;
}

/**
 * Extract location from the description text.
 * Common patterns:
 *   "an der Industriestrasse"
 *   "an den Altmattweg"
 *   "an die Aarburgerstrasse"
 *   "an der Höhenstrasse Ost"
 *   "an der Solothurnerstrasse in Olten"
 *   "An der Boningerstrasse ist ein Baum..."
 */
function extractLocation(text) {
  if (!text) return '';

  const STREET_SUFFIX = '(?:[Ss]trasse|[Gg]asse|[Ww]eg|[Pp]latz|[Aa]llee|[Rr]ing|[Rr]ain|[Hh]alde|[Mm]att|[Ff]eld|[Hh]of|[Pp]ark|[Mm]atte|[Ww]eid|[Gg]raben)';

  // Match street names that may be hyphenated or multi-word:
  //   "Louis-Giroud-Strasse", "Von Roll-Strasse", "Martin-Disteli-Strasse",
  //   "Swisscom Gasse", "Höhenstrasse Ost", "Industriestrasse"
  const STREET_NAME = `(?:[A-ZÄÖÜ][a-zäöüéèêà]*[-\\s])*(?:[A-ZÄÖÜ])?[a-zäöüéèêà]*${STREET_SUFFIX}[a-z]*`;

  // "an der/den/die/dem <StreetName>" with optional direction suffix or house number
  const preposition = new RegExp(
    `\\ban\\s+(?:der|den|die|dem|das)\\s+(${STREET_NAME})(?:\\s+(?:Ost|West|Nord|Süd))?(?:\\s+\\d+)?`,
    'u'
  );

  const m = text.match(preposition);
  if (m) return m[1].trim();

  // Fallback: any capitalized word(s) ending in a street suffix
  const fallback = new RegExp(`\\b(${STREET_NAME})\\b`, 'u');
  const fm = text.match(fallback);
  if (fm) return fm[1].trim();

  return '';
}

/**
 * Fetch detail page and extract description text + structured fields.
 */
async function fetchDetail(href) {
  if (!href) return { description: '', location: '', time: null };

  try {
    const html = await fetchPage(BASE + href);
    const $ = cheerio.load(html);

    const text = $('.icms-wysiwyg').text().trim();
    const location = extractLocation(text);

    // Try to get time from Einsatzdauer field: "3. Jan. 2023, 19.50 Uhr - 21.20 Uhr"
    let time = null;
    $('dl.row dt').each(function () {
      if ($(this).text().trim() === 'Einsatzdauer') {
        const val = $(this).next('dd').text().trim();
        const tm = val.match(/(\d{1,2})\.(\d{2})\s*Uhr/);
        if (tm) time = `${String(tm[1]).padStart(2, '0')}:${tm[2]}`;
      }
    });

    return { description: text, location, time };
  } catch {
    return { description: '', location: '', time: null };
  }
}

/**
 * Process items in batches with concurrency limit.
 */
async function processBatched(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + concurrency < items.length) {
      await new Promise(r => setTimeout(r, DETAIL_DELAY_MS));
    }
  }
  return results;
}

async function scrape() {
  console.log(`[olten] Scraping ${LIST_URL}...`);

  let html;
  try { html = await fetchPage(LIST_URL); }
  catch (err) { console.error(`[olten] Failed: ${err.message}`); return []; }

  const items = parseListData(html);
  console.log(`[olten] Found ${items.length} entries on list page`);

  if (!items.length) return [];

  // Fetch detail pages for all items
  console.log(`[olten] Fetching detail pages (concurrency=${CONCURRENCY})...`);
  const details = await processBatched(items, async (item) => {
    const detail = await fetchDetail(item.href);
    return { ...item, ...detail };
  }, CONCURRENCY);

  const incidents = details.map((item, idx) => {
    const typeRaw = extractType(item.title);
    const date = parseDate(item.date);
    // Prefer time from detail page, fall back to datum-sort time
    const time = item.time || parseTime(item.dateSortable);

    return {
      id: `${SOURCE}-${idx}`,
      source: SOURCE,
      sourceName: SOURCE_NAME,
      canton: 'SO',
      date,
      time,
      typeRaw,
      type: normalizeType(typeRaw),
      location: item.location || '',
      description: item.description || '',
      url: item.href ? BASE + item.href : LIST_URL,
    };
  });

  console.log(`[olten] ${incidents.length} incidents (${incidents.filter(i => i.location).length} with location)`);
  return incidents;
}

module.exports = { scrape };
