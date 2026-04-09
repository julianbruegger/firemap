'use strict';

// Scan all plausible lodur-lu.ch department slugs and check for modul=6 data
// Usage: node scan-lodur-lu.js

const axios = require('axios');

// All Canton Lucerne municipalities + known fire dept compound names,
// in likely slug forms (lowercase, umlauts as ue/ae/oe or stripped)
const SLUGS = [
  // A
  'adligenswil', 'aesch', 'alberswil', 'altbueron', 'altishofen', 'altwis',
  // B
  'ballwil', 'beromunster', 'beromunster-triengen', 'beromunster-knutwil',
  'buchrain', 'bueron', 'bueron-schlierbach', 'buttisholz',
  // D
  'dagmersellen', 'dierikon', 'doppleschwand', 'doppleschwand-romoos',
  // E
  'ebersecken', 'ebikon', 'egolzwil', 'eich', 'emmen',
  'entlebuch', 'ermensee', 'eschenbach', 'escholzmatt', 'escholzmatt-marbach', 'ettiswil',
  // F
  'fischbach', 'flühli', 'fluhli',
  // G
  'gettnau', 'geuensee', 'gisikon', 'gisikon-honau', 'greppen', 'grossdietwil',
  'grossdietwil-ebersecken', 'grosswangen', 'gunzwil',
  // H
  'hasle', 'hasle-entlebuch', 'hergiswil', 'hergiswil-napf', 'hildisrieden',
  'hitzkirch', 'hochdorf', 'hohenrain', 'honau', 'horw', 'huerntal',
  // I
  'inwil',
  // K
  'knutwil', 'kriens', 'kussnacht',
  // L
  'luthern', 'luzern',
  // M
  'malters', 'malters-schachen', 'mauensee', 'meggen', 'menznau', 'menzberg',
  'munster', 'münster', 'münster-entlebuch',
  // N
  'nebikon', 'neudorf', 'neuenkirch', 'nottwil',
  // O
  'oberkirch', 'oberkirch-neudorf', 'ohmstal',
  // P
  'pfaffnau',
  // R
  'rain', 'reiden', 'rickenbach', 'romoos', 'roemerswil', 'rothenburg', 'ruswil',
  // S
  'schachen', 'schoetz', 'schüpfheim', 'schuepfheim', 'seegemeinden',
  'sempach', 'sursee',
  // T
  'triengen', 'triengen-knutwil',
  // U
  'udligenswil', 'ufhusen',
  // V
  'vitznau',
  // W
  'wauwil', 'weggis', 'werthenstein', 'willisau', 'wolhusen',
  // Z
  'zell',
];

const BASE = 'https://www.lodur-lu.ch';
const YEAR = 2025;
const CONCURRENCY = 12;

async function checkSlug(slug) {
  const url = `${BASE}/${slug}/index.php?modul=6&year=${YEAR}`;
  try {
    const r = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 FireAlerts-Aggregator/1.0' },
      responseType: 'arraybuffer',
      validateStatus: s => true,
    });
    if (r.status === 404) return { slug, result: '404' };
    const html = r.data.toString('latin1');
    const eventCount = Math.floor((html.match(/act_event_id/g) || []).length / 2);
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = (titleMatch ? titleMatch[1] : '').replace('LODUR ', '').trim();
    return { slug, result: r.status === 200 ? 'ok' : r.status, eventCount, title };
  } catch (e) {
    return { slug, result: 'err', error: e.message };
  }
}

async function main() {
  const unique = [...new Set(SLUGS)];
  console.log(`Scanning ${unique.length} slugs on ${BASE} (modul=6, year=${YEAR})...\n`);

  const found = [];
  const errors = [];

  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(checkSlug));
    for (const r of results) {
      if (r.result === '404') continue;
      if (r.result === 'err') { errors.push(r); continue; }
      if (r.eventCount > 0) {
        console.log(`  ✓  ${r.slug.padEnd(35)} ${String(r.eventCount).padStart(4)} events   ${r.title}`);
        found.push(r);
      } else {
        console.log(`  -  ${r.slug.padEnd(35)}    0 events   ${r.title}`);
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Departments WITH events (${found.length}):`);
  found.forEach(r => console.log(`  https://www.lodur-lu.ch/${r.slug}  (${r.eventCount} events)`));

  if (errors.length) {
    console.log(`\nErrors (${errors.length}):`);
    errors.forEach(r => console.log(`  ${r.slug}: ${r.error}`));
  }
}

main().catch(console.error);
