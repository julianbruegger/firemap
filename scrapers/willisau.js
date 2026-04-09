'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const BASE = 'https://feuerwehr-willisau.ch';
const SOURCE = 'willisau';
const SOURCE_NAME = 'Feuerwehr Willisau';
// All calls are on the 2020 page (no year-specific URLs)
const YEARS = [2020];

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

async function scrapeYear(year) {
  const url = `${BASE}/einsaetze/einsaetze/${year}/`;
  console.log(`[willisau] Scraping ${url}...`);

  let html;
  try { html = await fetchPage(url); }
  catch (err) { console.error(`[willisau] Failed ${url}: ${err.message}`); return []; }

  const $ = cheerio.load(html);
  const incidents = [];

  // Structure: div-based entries
  // Date as text "8. März 2026", title "Einsatz-Nr. 26-06", category text, link to detail
  // We look for links to news-detail pages and extract context from parent container

  // Each entry is an <a href="/einsaetze/einsaetze/news-detail/..."> wrapping the full card.
  // Date lives in <time datetime="YYYY-MM-DD">, type in <div class="teaser-text"><p>.
  $('a[href*="news-detail"]').each((idx, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const detailUrl = href.startsWith('http') ? href : BASE + href;

    // Date: use the datetime attribute directly (already ISO)
    const date = $el.find('time').attr('datetime') || null;
    if (!date) return;

    // Type: paragraph inside .teaser-text, fallback to any <p>
    const typeRaw = $el.find('.teaser-text p').first().text().trim()
      || $el.find('p').first().text().trim();

    if (!typeRaw || typeRaw.length < 3) return;

    incidents.push({
      id: `${SOURCE}-${year}-${idx}`,
      source: SOURCE,
      sourceName: SOURCE_NAME,
      canton: 'LU',
      date,
      time: null,
      typeRaw,
      type: normalizeType(typeRaw),
      location: '',
      description: '',
      url: detailUrl,
    });
  });

  console.log(`[willisau] Year ${year}: ${incidents.length} incidents`);
  return incidents;
}

async function scrape() {
  const results = [];
  for (const year of YEARS) results.push(...(await scrapeYear(year)));
  return results;
}

module.exports = { scrape };
