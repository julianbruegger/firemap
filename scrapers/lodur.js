'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeType } = require('./normalize');

const YEARS = [2024, 2025, 2026];

// ── Department registry ───────────────────────────────────────────────────────
// Add new Lodur departments here. base must NOT have a trailing slash.
const DEPARTMENTS = [
  // ── Kt. Luzern ──────────────────────────────────────────────────────────────
  { canton: 'LU', source: 'lodur-huerntal',           sourceName: 'Feuerwehr Hürntal',            base: 'https://www.lodur-lu.ch/huerntal' },
  { canton: 'LU', source: 'lodur-bueron-schlierbach',  sourceName: 'Feuerwehr Büron-Schlierbach',   base: 'https://www.lodur-lu.ch/bueron-schlierbach' },
  { canton: 'LU', source: 'lodur-rain',                sourceName: 'Feuerwehr Rain',                base: 'https://www.lodur-lu.ch/rain' },
  { canton: 'LU', source: 'lodur-seegemeinden',        sourceName: 'Feuerwehr Seegemeinden',        base: 'https://www.lodur-lu.ch/seegemeinden' },
  { canton: 'LU', source: 'lodur-doppleschwand-romoos',sourceName: 'Feuerwehr Doppleschwand-Romoos',base: 'https://www.lodur-lu.ch/doppleschwand-romoos' },
  { canton: 'LU', source: 'lodur-hergiswil-napf',      sourceName: 'Feuerwehr Hergiswil am Napf',   base: 'https://www.lodur-lu.ch/hergiswil' },
  { canton: 'LU', source: 'lodur-buchrain',            sourceName: 'Feuerwehr Buchrain',            base: 'https://www.lodur-lu.ch/buchrain' },
  { canton: 'LU', source: 'lodur-roemerswil',          sourceName: 'Feuerwehr Römerswil',           base: 'https://www.lodur-lu.ch/roemerswil' },
  { canton: 'LU', source: 'lodur-triengen',            sourceName: 'Feuerwehr Triengen',            base: 'https://www.lodur-lu.ch/triengen-regiowehr' },
  { canton: 'LU', source: 'lodur-schuepfheim',         sourceName: 'Feuerwehr Schüpfheim',          base: 'https://www.lodur-lu.ch/schuepfheim' },
  { canton: 'LU', source: 'lodur-udligenswil',         sourceName: 'Feuerwehr Udligenswil',         base: 'https://www.lodur-lu.ch/udligenswil' },

  // ── Kt. Zürich ──────────────────────────────────────────────────────────────
  { canton: 'ZH', source: 'lodur-duebendorf',     sourceName: 'Feuerwehr Dübendorf',      base: 'https://lodur-zh.ch/duebendorf' },
  { canton: 'ZH', source: 'lodur-horgen',         sourceName: 'Feuerwehr Horgen',          base: 'https://lodur-zh.ch/horgen' },
  { canton: 'ZH', source: 'lodur-dietikon',       sourceName: 'Feuerwehr Dietikon',        base: 'https://lodur-zh.ch/dietikon' },
  { canton: 'ZH', source: 'lodur-buelach',        sourceName: 'Feuerwehr Bülach',          base: 'https://lodur-zh.ch/buelach' },
  { canton: 'ZH', source: 'lodur-wallisellen',    sourceName: 'Feuerwehr Wallisellen',     base: 'https://lodur-zh.ch/wallisellen' },
  { canton: 'ZH', source: 'lodur-kuesnacht',      sourceName: 'Feuerwehr Küsnacht',        base: 'https://lodur-zh.ch/kuesnacht' },
  { canton: 'ZH', source: 'lodur-adliswil',       sourceName: 'Feuerwehr Adliswil',        base: 'https://lodur-zh.ch/adliswil' },
  { canton: 'ZH', source: 'lodur-bassersdorf',    sourceName: 'Feuerwehr Bassersdorf',     base: 'https://lodur-zh.ch/bassersdorf' },
  { canton: 'ZH', source: 'lodur-langnau',        sourceName: 'Feuerwehr Langnau am Albis',base: 'https://lodur-zh.ch/langnau' },
  { canton: 'ZH', source: 'lodur-pfaeffikon',     sourceName: 'Feuerwehr Pfäffikon',       base: 'https://lodur-zh.ch/pfaeffikon' },
  { canton: 'ZH', source: 'lodur-moenchaltorf',   sourceName: 'Feuerwehr Mönchaltorf',     base: 'https://lodur-zh.ch/moenchaltorf' },
  { canton: 'ZH', source: 'lodur-zumikon',        sourceName: 'Feuerwehr Zumikon',         base: 'https://lodur-zh.ch/zumikon' },
  { canton: 'ZH', source: 'lodur-aeugst',         sourceName: 'Feuerwehr Aeugst am Albis', base: 'https://lodur-zh.ch/aeugst' },

  // ── Kt. Aargau ──────────────────────────────────────────────────────────────
  { canton: 'AG', source: 'lodur-aarau',               sourceName: 'Feuerwehr Aarau',               base: 'https://lodur-ag.ch/aarau' },
  { canton: 'AG', source: 'lodur-auw',                 sourceName: 'Feuerwehr Auw',                 base: 'https://lodur-ag.ch/auw' },
  { canton: 'AG', source: 'lodur-baden',               sourceName: 'Feuerwehr Baden',               base: 'https://lodur-ag.ch/baden' },
  { canton: 'AG', source: 'lodur-buchs',               sourceName: 'Feuerwehr Buchs',               base: 'https://lodur-ag.ch/buchs' },
  { canton: 'AG', source: 'lodur-frick',               sourceName: 'Feuerwehr Frick',               base: 'https://lodur-ag.ch/frick' },
  { canton: 'AG', source: 'lodur-laufenburg',          sourceName: 'Feuerwehr Laufenburg',          base: 'https://lodur-ag.ch/laufenburg' },
  { canton: 'AG', source: 'lodur-merenschwand',        sourceName: 'Feuerwehr Merenschwand',        base: 'https://lodur-ag.ch/merenschwand' },
  { canton: 'AG', source: 'lodur-muri',                sourceName: 'Feuerwehr Muri',                base: 'https://lodur-ag.ch/muri' },
  { canton: 'AG', source: 'lodur-seengen',             sourceName: 'Feuerwehr Seengen',             base: 'https://lodur-ag.ch/seengen' },
  { canton: 'AG', source: 'lodur-sins-abtwil',         sourceName: 'Feuerwehr Sins-Abtwil',         base: 'https://lodur-ag.ch/sins-abtwil' },
  { canton: 'AG', source: 'lodur-stein',               sourceName: 'Feuerwehr Stein',               base: 'https://lodur-ag.ch/stein' },
  { canton: 'AG', source: 'lodur-suhr',                sourceName: 'Feuerwehr Suhr',                base: 'https://lodur-ag.ch/suhr' },
  { canton: 'AG', source: 'lodur-untersiggenthal',     sourceName: 'Feuerwehr Untersiggenthal',     base: 'https://lodur-ag.ch/untersiggenthal' },
  { canton: 'AG', source: 'lodur-wohlen',              sourceName: 'Feuerwehr Wohlen',              base: 'https://lodur-ag.ch/wohlen' },
  { canton: 'AG', source: 'lodur-wuerenlingen',        sourceName: 'Feuerwehr Würenlingen',         base: 'https://lodur-ag.ch/wuerenlingen' },
  { canton: 'AG', source: 'lodur-wuerenlos',           sourceName: 'Feuerwehr Würenlos',            base: 'https://lodur-ag.ch/wuerenlos' },
  { canton: 'AG', source: 'lodur-zurzach',             sourceName: 'Feuerwehr Zurzach',             base: 'https://lodur-ag.ch/zurzach' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchPage(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0 FireAlerts-Aggregator/1.0' },
      });
      // Lodur pages are ISO-8859-1; decode as latin1 to preserve special chars (ü, ä, ö)
      const ct = (res.headers['content-type'] || '');
      const charset = (ct.match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
      const encoding = /iso-?8859-?1/i.test(charset) ? 'latin1' : 'utf8';
      return res.data.toString(encoding);
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

function normalizeTime(raw) {
  // Accept HH:MM or HH.MM
  return raw.replace('.', ':');
}

function parseDesc(desc) {
  let m;

  // ZH wallisellen: "NNN - HH:MM, ALARM, Type, Street, ZIP City"
  m = desc.match(/^\d+\s*-\s*(\d{2}:\d{2}),\s*([^,]+),\s*([^,]+),\s*(.+)/);
  if (m) {
    // Location may be "Street, ZIP City" or "Street, City" — combine and strip ZIP
    const location = m[4].replace(/\d{4}\s*/g, '').trim();
    return { time: m[1], location, typeRaw: m[3].trim() };
  }

  // ZH moenchaltorf: "NNN HH:MM ALARM| Type" or "NNN HH:MM ALARM|ALARM Type"
  m = desc.match(/^\d+\s+(\d{2}:\d{2})\s+[^|]*\|\s*(?:VA\s+)?(.+)/);
  if (m) return { time: m[1], location: '', typeRaw: m[2].trim() };

  // ZH duebendorf: "NNN - HH:MM Uhr / ALARM / Type / Street / City"
  // Alarm codes look like TK, KAN1, BAG5, KAN1+ADLN (letters/digits, no spaces)
  m = desc.match(/^\d+\s*-\s*(\d{2}[.:]\d{2})\s*(?:Uhr)?\s*\/\s*([A-Z0-9+]+)\s*\/\s*(.+)/);
  if (m) {
    const parts = m[3].split('/').map(s => s.trim());
    return { time: normalizeTime(m[1]), typeRaw: parts[0], location: parts.length >= 2 ? parts[parts.length - 1] : '' };
  }

  // ZH horgen: "NNN / Type / Street / City" (no time, slash-separated)
  m = desc.match(/^\d+\s*\/\s*(.+)/);
  if (m) {
    const parts = m[1].split('/').map(s => s.trim());
    return { time: null, typeRaw: parts[0], location: parts.length >= 3 ? parts[parts.length - 1] : '' };
  }

  // ZH bassersdorf: "HH:MM Uhr ALARM: [S] Type, Street, City"
  m = desc.match(/^(\d{1,2}:\d{2})\s*Uhr\s+[^:]+:\s*(?:S\s+)?(.+)/);
  if (m) {
    const parts = m[2].split(',').map(s => s.trim());
    return { time: m[1], location: parts.length >= 3 ? parts[parts.length - 1] : '', typeRaw: parts[0] };
  }

  // ZH zumikon: "Type (City - Street)"
  m = desc.match(/^([^(]+)\(([^)]+)\)/);
  if (m) {
    const loc = m[2].replace(/^[^-]+-\s*/, '').trim();
    return { time: null, location: loc, typeRaw: m[1].trim() };
  }

  // LU seegemeinden: "HH:MM Uhr: Location: Type"
  m = desc.match(/^(\d{2}:\d{2})\s*(?:Uhr)?\s*:\s*([^:]+):\s*(.+)/);
  if (m) return { time: m[1], location: m[2].trim(), typeRaw: m[3].trim() };

  // AG muri/merenschwand: "NNN - HH:MM Uhr - Location - Type"
  m = desc.match(/^\d+\s*-\s*(\d{2}[.:]\d{2})\s*Uhr\s*-\s*([^-]+?)\s*-\s*(.+)/);
  if (m) return { time: normalizeTime(m[1]), location: m[2].trim(), typeRaw: m[3].trim() };

  // AG baden: "NNN - HH:MM Uhr / Type / Street / Location"
  m = desc.match(/^\d+\s*-\s*(\d{2}[.:]\d{2})\s*(?:Uhr)?\s*\/\s*(.+)/);
  if (m) {
    const parts = m[2].split('/').map(s => s.trim());
    return { time: normalizeTime(m[1]), typeRaw: parts[0], location: parts[parts.length - 1] };
  }

  // AG zurzach: "NN - HH.MM Uhr Type, Location"
  m = desc.match(/^\d+\s*-\s*(\d{2}[.:]\d{2})\s*Uhr\s+(.+)/);
  if (m) {
    const parts = m[2].split(',').map(s => s.trim());
    return { time: normalizeTime(m[1]), typeRaw: parts[0], location: parts.slice(1).join(', ') };
  }

  // AG untersiggenthal: "NN - HH:MM; Type[, detail], Location"
  m = desc.match(/^\d+\s*-\s*(\d{2}:\d{2});\s*(.+)/);
  if (m) {
    const parts = m[2].split(',').map(s => s.trim());
    return { time: m[1], typeRaw: parts[0], location: parts[parts.length - 1] };
  }

  // AG buchs: "NN. HH:MM Uhr Type"
  m = desc.match(/^\d+\.\s+(\d{2}:\d{2})\s*Uhr\s+(.+)/);
  if (m) return { time: m[1], location: '', typeRaw: m[2].trim() };

  // ZH adliswil: "NNN. Type" (must come after buchs which is more specific)
  m = desc.match(/^\d+\.\s+(.+)/);
  if (m) return { time: null, location: '', typeRaw: m[1].trim() };

  // AG wuerenlingen / ZH buelach: "Nr. NN: Type" or "Nr. NNN / Type"
  m = desc.match(/^Nr\.\s*\d+\s*[.:/]\s*(.+)/i);
  if (m) return { time: null, location: '', typeRaw: m[1].trim() };

  // AG wohlen: "NNN Type" (plain number prefix, no separator)
  m = desc.match(/^\d{1,3}\s+([A-ZÄÖÜ].+)/);
  if (m) return { time: null, location: '', typeRaw: m[1].trim() };

  // AG stein: "Location / HH:MM / Street / Type [/ Detail]"
  m = desc.match(/^([^/\d][^/]*)\s*\/\s*(\d{2}:\d{2})\s*\/\s*(.+)/);
  if (m) {
    const rest = m[3].split('/').map(s => s.trim());
    return { time: m[2], location: m[1].trim(), typeRaw: rest[rest.length - 1] };
  }

  // AG auw: "HH:MM Uhr / Location / Type" or "HH:MM Uhr / Location Type"
  m = desc.match(/^(\d{2}:\d{2})\s*Uhr\s*\/\s*(.+)/);
  if (m) {
    const parts = m[2].split('/').map(s => s.trim());
    if (parts.length >= 2) return { time: m[1], location: parts[0], typeRaw: parts.slice(1).join(' / ') };
    return { time: m[1], location: '', typeRaw: parts[0] };
  }

  // AG laufenburg: "HH:MM; Type, in Location" or "HH:MM, Type"
  m = desc.match(/^(\d{2}:\d{2})[;,]\s*(.+)/);
  if (m) {
    const locMatch = m[2].match(/,?\s*in\s+(\S+)$/);
    const location = locMatch ? locMatch[1] : '';
    const typeRaw = m[2].replace(/,?\s*in\s+\S+$/, '').trim();
    return { time: m[1], location, typeRaw };
  }

  // AG merenschwand / general: "HH:MM / Type"
  m = desc.match(/^(\d{2}:\d{2})\s*\/\s*(.+)/);
  if (m) return { time: m[1], location: '', typeRaw: m[2].trim() };

  // AG aarau / wuerenlos: "HH:MM Uhr Type"
  m = desc.match(/^(\d{2}:\d{2})\s*(?:Uhr)?\s+(.+)/);
  if (m) return { time: m[1], location: '', typeRaw: m[2].trim() };

  // AG frick: "Location, Type" — location is a single place name (no spaces typically)
  // ZH pfaeffikon: "Type, Street" — type has spaces (e.g. "Brand Abfalleimer")
  // Disambiguate: if first segment contains a space, treat as "Type, Location"
  m = desc.match(/^([A-ZÄÖÜ][^,]{2,30}),\s*(.+)/);
  if (m) {
    const first = m[1].trim(), second = m[2].trim();
    if (/\s/.test(first)) return { time: null, location: second, typeRaw: first };
    return { time: null, location: first, typeRaw: second };
  }

  // LU other departments: "NN) Type, Street, City"
  m = desc.match(/^\d+\)\s*(.+)/);
  if (m) {
    const parts = m[1].split(',').map(s => s.trim());
    return { time: null, location: parts.slice(1).join(', '), typeRaw: parts[0] };
  }

  // Strip trailing "Sondersignal !" (ZH aeugst) and alarm codes like "T2", "N2"
  let cleaned = desc.replace(/\s*Sondersignal\s*!?\s*$/i, '').replace(/\s+[TNKB]\d\s*$/, '').trim();

  // Fallback
  return { time: null, location: '', typeRaw: cleaned || desc };
}

// ── Per-year scrape for one department ───────────────────────────────────────

async function scrapeYear(dept, year) {
  const listUrl = `${dept.base}/index.php?modul=6&year=${year}`;
  console.log(`[${dept.source}] Scraping ${listUrl}...`);

  let html;
  try {
    html = await fetchPage(listUrl);
  } catch (err) {
    console.error(`[${dept.source}] Failed ${listUrl}: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const incidents = [];
  const seen = new Set();

  $('a[href*="act_event_id"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';

    const idMatch = href.match(/act_event_id=(\d+)/);
    if (!idMatch) return;
    const eventId = idMatch[1];
    if (seen.has(eventId)) return;
    seen.add(eventId);

    const $row = $el.closest('tr');
    const $allLinks = $row.find('a[href*="act_event_id"]');

    let dateRaw = '';
    let descRaw = '';
    if ($allLinks.length >= 2) {
      dateRaw = $allLinks.eq(0).text();
      descRaw = $allLinks.eq(1).text();
    } else {
      const txt = $el.text().trim();
      if (/^\d{2}\.\d{2}\.\d{4}$/.test(txt)) dateRaw = txt;
      else descRaw = txt;
    }

    const date = parseDate(dateRaw);
    const url = href.startsWith('http') ? href : `${dept.base}/${href}`;
    const { time, location, typeRaw } = parseDesc(descRaw.trim());

    if (!typeRaw) return;

    incidents.push({
      id: `${dept.source}-${year}-${eventId}`,
      source: dept.source,
      sourceName: dept.sourceName,
      canton: dept.canton,
      date,
      time,
      typeRaw,
      type: normalizeType(typeRaw),
      location,
      description: '',
      url,
    });
  });

  console.log(`[${dept.source}] Year ${year}: ${incidents.length} incidents`);
  return incidents;
}

// ── Scrape all departments ────────────────────────────────────────────────────

async function scrape() {
  const results = [];
  for (const dept of DEPARTMENTS) {
    for (const year of YEARS) {
      results.push(...(await scrapeYear(dept, year)));
    }
  }
  return results;
}

module.exports = { scrape };
