'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const BASE = 'https://www.fwluzern.ch';
const SOURCE = 'fwluzern';
const SOURCE_NAME = 'Feuerwehr Stadt Luzern';
const YEARS = [2024, 2025, 2026];
const BATCH_SIZE = 5;
const RETRY = 2;
const DELAY_MS = 500;

async function fetchPage(url) {
  for (let attempt = 0; attempt <= RETRY; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 FireAlerts-Aggregator/1.0' },
      });
      return res.data;
    } catch (err) {
      if (attempt === RETRY) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

function parseDate(raw) {
  // Format: "02.04.2026 / 04:34"
  const m = raw.match(/(\d{2})\.(\d{2})\.(\d{4})\s*[\/\-]\s*(\d{2}):(\d{2})/);
  if (!m) return { date: null, time: null };
  return {
    date: `${m[3]}-${m[2]}-${m[1]}`,
    time: `${m[4]}:${m[5]}`,
  };
}

function parsePage(html, year, pageNum) {
  const $ = cheerio.load(html);
  const incidents = [];

  // Actual structure (confirmed from live HTML):
  //   <table class="table table-striped operations">
  //     <tbody>
  //       <tr>
  //         <td> DD.MM.YYYY / HH:MM<br> Location</td>
  //         <td>
  //           <span class="operation-title-plain" data-operation-url="https://...">
  //             <strong> Type </strong>
  //           </span>
  //           <br> Description text
  //         </td>
  //         <td class="d-none d-md-table-cell"> Units </td>
  //       </tr>
  //     </tbody>
  //   </table>

  $('table.operations tbody tr, table.operations tr').each((idx, el) => {
    const $el = $(el);
    const cells = $el.find('td');
    if (cells.length < 2) return;

    // Cell 0: date/time + location (separated by <br>)
    const $cell0 = cells.eq(0);
    const cell0Html = $cell0.html() || '';
    const cell0Parts = cell0Html.split(/<br\s*\/?>/i);
    const dateRaw = cheerio.load(cell0Parts[0] || '').text().trim();
    const location = cheerio.load(cell0Parts[1] || '').text().trim();
    const { date, time } = parseDate(dateRaw);

    // Cell 1: type span (data-operation-url attribute) + description text
    const $cell1 = cells.eq(1);
    const $span = $cell1.find('.operation-title-plain, .operation-title-link');
    const typeRaw = $span.find('strong').text().trim() || $span.text().trim();
    const url = $span.attr('data-operation-url') || `${BASE}/einsaetze/${year}/`;

    // Description is the text after the <br> in cell 1
    const cell1Html = $cell1.html() || '';
    const cell1Parts = cell1Html.split(/<br\s*\/?>/i);
    const description = cell1Parts.slice(1)
      .map(p => cheerio.load(p).text().trim())
      .filter(Boolean)
      .join(' ');

    if (!typeRaw) return; // skip empty rows (headers, spacers)

    incidents.push({
      id: `${SOURCE}-${year}-p${pageNum}-${idx}`,
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

  return incidents;
}

function getTotalPages($) {
  // The "Last" page link has aria-label="Last" and href="/einsaetze/YYYY/NN/"
  let max = 1;
  $('a[aria-label="Last"], a[aria-label="Letzte"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/\/einsaetze\/\d{4}\/(\d+)\/?/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });

  // Fallback: scan all pagination links for highest page number
  if (max === 1) {
    $('ul.pagination a.page-link').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/\/einsaetze\/\d{4}\/(\d+)\/?/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
  }

  return max;
}

async function scrapeYear(year) {
  console.log(`[fwluzern] Scraping year ${year}...`);
  // Both /einsaetze/2026/ and /einsaetze/2025/ use the same pattern
  const firstUrl = `${BASE}/einsaetze/${year}/`;

  let html;
  try {
    html = await fetchPage(firstUrl);
  } catch (err) {
    console.error(`[fwluzern] Failed to fetch ${firstUrl}: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const totalPages = getTotalPages($);
  console.log(`[fwluzern] Year ${year}: ${totalPages} pages`);

  const allIncidents = parsePage(html, year, 1);

  // Build remaining page URLs — always /einsaetze/YEAR/PAGE/
  const pageUrls = [];
  for (let p = 2; p <= totalPages; p++) {
    pageUrls.push({ url: `${BASE}/einsaetze/${year}/${p}/`, page: p });
  }

  // Fetch in batches to avoid hammering
  for (let i = 0; i < pageUrls.length; i += BATCH_SIZE) {
    const batch = pageUrls.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(({ url, page }) =>
        fetchPage(url).then(h => parsePage(h, year, page))
      )
    );
    results.forEach((r, bi) => {
      if (r.status === 'fulfilled') {
        allIncidents.push(...r.value);
      } else {
        console.error(`[fwluzern] Page ${batch[bi].page} failed: ${r.reason?.message}`);
      }
    });
    if (i + BATCH_SIZE < pageUrls.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`[fwluzern] Year ${year}: ${allIncidents.length} incidents scraped`);
  return allIncidents;
}

async function scrape() {
  const results = await Promise.all(YEARS.map(scrapeYear));
  return results.flat();
}

module.exports = { scrape };
