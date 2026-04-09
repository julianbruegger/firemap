'use strict';

// Scan all plausible lodur-ag.ch department slugs for modul=6 data
// Usage: node scan-lodur-ag.js

const axios = require('axios');

// All Canton Aargau municipalities + likely compound fire-dept slug names
const SLUGS = [
  // A
  'aarau', 'aarburg', 'abtwil', 'aristau', 'arni', 'arni-islisberg',
  'attelwil', 'auenstein',
  // B
  'bad-zurzach', 'baden', 'baldingen', 'bellikon', 'bergdietikon',
  'birrwil', 'birr', 'biberstein', 'böbikon', 'bözen',
  'bottenwil', 'brugg', 'brugg-windisch', 'buchs', 'büblikon',
  'büttikon',
  // D
  'dattwil', 'densbüren', 'densbueren', 'dottikon',
  // E
  'effingen', 'egliswil', 'eiken', 'elfingen', 'endingen',
  'entfelden', 'unterentfelden', 'oberentfelden',
  // F
  'fahrwangen', 'fischbach-goeslikon', 'frick',
  // G
  'gansingen', 'gebenstorf', 'geltwil', 'gontenschwil',
  // H
  'hallwil', 'hamikon', 'Habsburg', 'Habsburg-Brunegg', 'Habsburg-scherz',
  'habsburgring', 'hendschiken', 'herznach', 'herznach-ueken',
  'holderbank', 'holziken', 'hottwil', 'hunzenschwil',
  // I
  'islisberg',
  // K
  'kaiseraugst', 'kaiseraugst-rheinfelden', 'kaiserstuhl',
  'killwangen', 'küttigen', 'kuettigen',
  // L
  'laufenburg', 'leerau', 'leibstadt', 'leimbach', 'lenzburg',
  // M
  'magden', 'meisterschwanden', 'mellingen', 'merenschwand',
  'menziken', 'möhlin', 'moehlin', 'mumpf', 'münchwilen',
  'muenchenbuchsee', 'muri', 'muri-ag',
  // N
  'niederlenz', 'niederwil', 'noriken',
  // O
  'oberentfelden', 'oberkulm', 'olsberg',
  // R
  'reitnau', 'reinach', 'rheinfelden', 'rheinfelden-kaiseraugst',
  // S
  'sarmenstorf', 'schafisheim', 'scherz', 'schinznach',
  'schlossrued', 'schmiedrued', 'seengen', 'seon',
  'sins', 'sins-abtwil', 'staufen', 'stein',
  'suhr',
  // T
  'teufenthal', 'turgi',
  // U
  'ueken', 'umiken', 'unterentfelden', 'unterkulm',
  'unterlunkhofen', 'untersiggenthal',
  // V
  'veltheim', 'villmergen', 'villnachern', 'vogelsang',
  // W
  'wettingen', 'windisch', 'wittnau', 'wohlen', 'würenlingen',
  'wuerenlingen', 'würenlos', 'wuerenlos',
  // Z
  'zeihen', 'zetzwil', 'zofingen', 'zurzach',
  'auw', 'benzenschwil', 'besenbüren', 'besenbüren-benzenschwil',
  'besenbüren-aristau', 'bünzen', 'boswil', 'boswil-besenbüren',
];

const BASE = 'https://lodur-ag.ch';
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
  const unique = [...new Set(SLUGS.map(s => s.toLowerCase()))];
  console.log(`Scanning ${unique.length} slugs on ${BASE} (modul=6, year=${YEAR})...\n`);

  const found = [];

  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(checkSlug));
    for (const r of results) {
      if (r.result === '404' || r.result === 'err') continue;
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
  found.forEach(r => console.log(`  ['lodur-ag.ch', '${r.slug}'],   // ${r.title}`));
}

main().catch(console.error);
