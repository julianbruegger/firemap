'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const URL = 'https://fwos.ch/';
const SOURCE = 'fwos';
const SOURCE_NAME = 'Feuerwehr Oberer Sempachersee';

async function fetchPage(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
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
  console.log(`[fwos] Scraping ${URL}...`);

  let html;
  try { html = await fetchPage(URL); }
  catch (err) { console.error(`[fwos] Failed: ${err.message}`); return []; }

  const $ = cheerio.load(html);
  const incidents = [];

  // Each incident is a block with data-aid="MENU_ITEM_DDMMYYYY"
  // Structure:
  //   h4[data-aid*="_TITLE"]        → date "18.03.2026"
  //   div[data-aid*="_PRICE"]       → time "13:17"
  //   div[data-aid*="_DESC"]        → <strong>Type</strong> + <p>Location</p>
  $('[data-aid^="MENU_ITEM_"]').filter((_, el) => /MENU_ITEM_\d+$/.test($(el).attr('data-aid') || '')).each((idx, el) => {
    const $el = $(el);

    const dateRaw = $el.find('[data-aid*="_TITLE"]').first().text().trim();
    const date = parseDate(dateRaw);
    if (!date) return;

    const time = $el.find('[data-aid*="_PRICE"]').first().text().trim() || null;

    const $desc = $el.find('[data-aid*="_DESC"]').first();
    const typeRaw = $desc.find('strong').first().text().trim();
    // Location is in a <p> that doesn't contain <strong>
    let location = '';
    $desc.find('p').each((_, p) => {
      if (!$(p).find('strong').length) {
        const txt = $(p).text().trim();
        if (txt) { location = txt; return false; }
      }
    });

    if (!typeRaw) return;

    incidents.push({
      id: `${SOURCE}-${date}-${idx}`,
      source: SOURCE,
      sourceName: SOURCE_NAME,
      canton: 'LU',
      date,
      time,
      typeRaw,
      type: normalizeType(typeRaw),
      location,
      description: '',
      url: URL,
    });
  });

  console.log(`[fwos] ${incidents.length} incidents`);
  return incidents;
}

module.exports = { scrape };
