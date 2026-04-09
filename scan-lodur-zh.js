'use strict';

// Scan all plausible lodur-zh.ch department slugs for modul=6 data
// Usage: node scan-lodur-zh.js

const axios = require('axios');

// Canton Zurich municipalities + likely compound fire-dept slug names
const SLUGS = [
  // A
  'adliswil', 'aesch', 'aeugst', 'aeugst-am-albis', 'affoltern', 'affoltern-am-albis',
  'altikon', 'andelfingen', 'aubonne',
  // B
  'baretswil', 'bassersdorf', 'bauma', 'berg-am-irchel', 'birmensdorf', 'bonstetten',
  'brütten', 'bruetten', 'buch-am-irchel', 'bubikon', 'bülach', 'buelach',
  // D
  'dachsen', 'dällikon', 'daellikon', 'dänikon', 'daenikon', 'dättlikon', 'daettlikon',
  'dietikon', 'dietlikon', 'dinhard', 'dübendorf', 'duebendorf', 'durnten', 'dürnten',
  // E
  'egg', 'ehrendingen', 'elgg', 'elsau', 'embrach', 'erlenbach',
  // F
  'fällanden', 'faellanden', 'fehraltorf', 'feuerthalen', 'fischenthal',
  'flurlingen', 'freienstein-teufen',
  // G
  'geroldswil', 'glattfelden', 'gossau', 'grüningen', 'grueningen',
  // H
  'hausen-am-albis', 'hedingen', 'henggart', 'herrliberg', 'hinwil',
  'hirzel', 'hittnau', 'hombrechtikon', 'horgen', 'horw', 'hüntwangen', 'huentwangen',
  // I
  'illnau', 'illnau-effretikon',
  // K
  'kappel', 'kappel-am-albis', 'kilchberg', 'kleinandelfingen',
  'kloten', 'knonau', 'küsnacht', 'kuesnacht', 'kyburg',
  // L
  'langnau', 'langnau-am-albis', 'laufen-uhwiesen', 'lindau', 'lufingen',
  // M
  'männedorf', 'maennedorf', 'marthalen', 'maschwanden', 'maur',
  'meilen', 'mettmenstetten', 'mönchaltorf', 'moenchaltorf',
  // N
  'neerach', 'neftenbach', 'niederweningen', 'nürensdorf', 'nuerensdorf',
  // O
  'oberembrach', 'oberglatt', 'oberrieden', 'oberstammheim',
  'oberweningen', 'obfelden', 'oetwil', 'oetwil-am-see', 'oetwil-an-der-limmat',
  'opfikon', 'ossingen', 'otelfingen', 'ottenbach',
  // P
  'pfäffikon', 'pfaeffikon', 'pfungen',
  // R
  'rafz', 'regensdorf', 'richterswil', 'rorbas', 'rümlang', 'ruemlang',
  'rüschlikon', 'rueschlikon', 'russikon', 'rüti', 'rueti',
  // S
  'schlatt', 'schleinikon', 'schlieren', 'seuzach', 'stallikon',
  'stammheim', 'stäfa', 'staefa', 'steinmaur',
  // T
  'thalheim', 'thalheim-an-der-thur', 'thalwil', 'trüllikon', 'truellikon',
  'turbenthal', 'turbenthal-wila', 'uster', 'uitikon',
  // U
  'unterengstringen', 'unterstammheim', 'urdorf',
  // V
  'volketswil',
  // W
  'wald', 'wallisellen', 'wädenswil', 'waedenswil', 'wasterkingen',
  'weiningen', 'weisslingen', 'wetzikon', 'wiesendangen',
  'wil', 'wila', 'winkel', 'winterthur', 'witikon',
  // Z
  'zell', 'zollikon', 'zumikon', 'zürich', 'zuerich',

  // Common compound / area names
  'furttal', 'glatttal', 'knonaueramt', 'limmattal', 'oberland',
  'unterland', 'weinland', 'zimmerberg',
  'dietikon-geroldswil', 'uster-greifensee',
  'winterthur-stadt', 'winti',
];

const BASE = 'https://lodur-zh.ch';
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
  console.log(`Departments WITH modul=6 events (${found.length}):`);
  found.sort((a, b) => b.eventCount - a.eventCount);
  found.forEach(r => console.log(`  { slug: '${r.slug}', events: ${r.eventCount}, title: '${r.title}' }`));
}

main().catch(console.error);
