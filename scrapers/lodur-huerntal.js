'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const BASE = 'https://lodur-lu.ch/huerntal';
const SOURCE = 'lodur-huerntal';
const SOURCE_NAME = 'Feuerwehr Hürntal';
const YEARS = [2024, 2025, 2026];

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
  // Format: " 03.01.2024 "
  const m = raw.trim().match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function scrapeYear(year) {
  const listUrl = `${BASE}/index.php?modul=6&year=${year}`;
  console.log(`[lodur-huerntal] Scraping ${listUrl}...`);

  let html;
  try {
    html = await fetchPage(listUrl);
  } catch (err) {
    console.error(`[lodur-huerntal] Failed ${listUrl}: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const incidents = [];
  const seen = new Set(); // deduplicate by event_id

  // Actual structure (confirmed from live HTML):
  // Each incident is its own <table> with one <tr> and two <td>:
  //   <td> <a href="...act_event_id=NN&year=YYYY"> DD.MM.YYYY </a> </td>
  //   <td> <a href="...act_event_id=NN&year=YYYY"> NN) TYPE, STREET, CITY </a> </td>
  //
  // Both cells link to the same URL with the same act_event_id.
  // We use the second cell for type+location, first cell for date.

  $('a[href*="act_event_id"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';

    const idMatch = href.match(/act_event_id=(\d+)/);
    if (!idMatch) return;
    const eventId = idMatch[1];

    // Skip if we already processed this event (first link = date, second = description)
    if (seen.has(eventId)) return;
    seen.add(eventId);

    // The date is in a sibling link in the same <tr> — but since both links have
    // the same event_id, the date link comes first in DOM order.
    // We can get it from the parent <tr>.
    const $row = $el.closest('tr');
    const $allLinks = $row.find('a[href*="act_event_id"]');

    let dateRaw = '';
    let descRaw = '';

    if ($allLinks.length >= 2) {
      dateRaw = $allLinks.eq(0).text();
      descRaw = $allLinks.eq(1).text();
    } else {
      // Only one link visible — could be date or desc
      const txt = $el.text().trim();
      if (/^\d{2}\.\d{2}\.\d{4}$/.test(txt)) {
        dateRaw = txt;
      } else {
        descRaw = txt;
      }
    }

    const date = parseDate(dateRaw);
    const url = href.startsWith('http') ? href : `${BASE}/${href}`;

    // descRaw: " NN) TYPE, STREET, CITY  "
    // Strip the incident number prefix "NN) "
    const typeLocMatch = descRaw.trim().match(/\d+\)\s*(.+)/);
    let typeRaw = '';
    let location = '';
    if (typeLocMatch) {
      const parts = typeLocMatch[1].split(',').map(s => s.trim());
      typeRaw = parts[0] || '';
      location = parts.slice(1).join(', ');
    } else {
      typeRaw = descRaw.trim();
    }

    if (!typeRaw) return; // skip truly empty entries

    incidents.push({
      id: `${SOURCE}-${year}-${eventId}`,
      source: SOURCE,
      sourceName: SOURCE_NAME,
      date,
      time: null, // only in detail page
      typeRaw,
      type: normalizeType(typeRaw),
      location,
      description: '',
      url,
    });
  });

  console.log(`[lodur-huerntal] Year ${year}: ${incidents.length} incidents`);
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
