'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const scrapeFwLuzern = require('./scrapers/fwluzern').scrape;
const scrapeMalters = require('./scrapers/malters-schachen').scrape;
const scrapeLodur = require('./scrapers/lodur').scrape;
const scrapeEmmen = require('./scrapers/emmen').scrape;
const scrapeRothenburg = require('./scrapers/rothenburg').scrape;
const scrapeKriens = require('./scrapers/kriens').scrape;
const scrapeHitzkirch = require('./scrapers/hitzkirch').scrape;
const scrapeFwEdi = require('./scrapers/fwedi').scrape;
const scrapeWillisau = require('./scrapers/willisau').scrape;
const scrapeSursee = require('./scrapers/sursee').scrape;
const scrapeFwos = require('./scrapers/fwos').scrape;
const scrapeOlten = require('./scrapers/olten').scrape;
const geocode = require('./scrapers/geocode');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_FILE = path.join(__dirname, 'cache', 'calls.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const GEMEINDEN_CACHE_FILE = path.join(__dirname, 'cache', 'gemeinden.json');
const GEMEINDEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// BFS canton numbers covered by this app: ZH=1, LU=3, SO=11, AG=19
const COVERED_CANTONS = new Set([1, 3, 11, 19]);

// Track ongoing scrape so parallel requests don't double-scrape
let scrapeInProgress = null;

// ── Cache helpers ────────────────────────────────────────────────────────────

function readCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(data) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function isCacheFresh(cache) {
  if (!cache?.scrapedAt) return false;
  return Date.now() - new Date(cache.scrapedAt).getTime() < CACHE_TTL_MS;
}

// ── Scraping ─────────────────────────────────────────────────────────────────

async function runAllScrapers() {
  const errors = [];
  const results = await Promise.allSettled([
    scrapeFwLuzern(),
    scrapeMalters(),
    scrapeLodur(),
    scrapeEmmen(),
    scrapeRothenburg(),
    scrapeKriens(),
    scrapeHitzkirch(),
    scrapeFwEdi(),
    scrapeWillisau(),
    scrapeSursee(),
    scrapeFwos(),
    scrapeOlten(),
  ]);

  const calls = [];
  const labels = ['fwluzern', 'malters-schachen', 'lodur', 'emmen',
    'rothenburg', 'kriens', 'hitzkirch', 'fwedi', 'willisau', 'sursee', 'fwos', 'olten'];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      calls.push(...r.value);
    } else {
      console.error(`[server] Scraper "${labels[i]}" failed:`, r.reason?.message);
      errors.push({ source: labels[i], error: r.reason?.message || 'Unknown error' });
    }
  });

  // Sort by date descending (most recent first), nulls at end
  calls.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    const da = a.date + (a.time || '00:00');
    const db = b.date + (b.time || '00:00');
    return db.localeCompare(da);
  });

  const cache = { scrapedAt: new Date().toISOString(), errors, calls };
  writeCache(cache);
  console.log(`[server] Scrape complete: ${calls.length} incidents, ${errors.length} source errors`);
  return cache;
}

async function getOrScrape(force = false) {
  if (!force) {
    const cache = readCache();
    if (isCacheFresh(cache)) return cache;
  }

  if (scrapeInProgress) {
    console.log('[server] Scrape already in progress, waiting...');
    return scrapeInProgress;
  }

  scrapeInProgress = runAllScrapers().finally(() => { scrapeInProgress = null; });
  return scrapeInProgress;
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/calls', async (req, res) => {
  try {
    const data = await getOrScrape(false);
    res.json(data);
  } catch (err) {
    console.error('[server] /api/calls error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/refresh', async (req, res) => {
  try {
    // Return immediately with 202, scrape runs in background
    res.status(202).json({ message: 'Scrape started' });
    await getOrScrape(true);
  } catch (err) {
    console.error('[server] /api/refresh error:', err);
  }
});

app.get('/api/recent', async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours) || 48, 168); // max 7 days
  const cache = readCache();
  if (!cache?.calls) return res.json({ calls: [], hours });

  const cutoff = Date.now() - hours * 3600 * 1000;
  const recent = cache.calls.filter(c => {
    if (!c.date) return false;
    const ts = new Date(`${c.date}T${c.time || '00:00'}:00`).getTime();
    return ts >= cutoff;
  });

  // Canton code → name for geocode cache keys
  const CANTON_NAMES = {
    AG: 'Aargau', AI: 'Appenzell Innerrhoden', AR: 'Appenzell Ausserrhoden',
    BE: 'Bern', BL: 'Basel-Landschaft', BS: 'Basel-Stadt',
    FR: 'Freiburg', GE: 'Genf', GL: 'Glarus', GR: 'Graubünden',
    JU: 'Jura', LU: 'Luzern', NE: 'Neuenburg', NW: 'Nidwalden',
    OW: 'Obwalden', SG: 'St. Gallen', SH: 'Schaffhausen', SO: 'Solothurn',
    SZ: 'Schwyz', TG: 'Thurgau', TI: 'Tessin', UR: 'Uri',
    VD: 'Waadt', VS: 'Wallis', ZG: 'Zug', ZH: 'Zürich',
  };
  function geoQuery(c) {
    const cn = CANTON_NAMES[c.canton] || c.canton || 'Luzern';
    return `${c.location.trim()}, Kanton ${cn}, Schweiz`;
  }

  // Add cached geocoords synchronously (no waiting for new requests)
  const withCoords = recent.map(c => {
    if (!c.location) return c;
    const coords = geocode.getFromCache(geoQuery(c));
    return coords ? { ...c, lat: coords.lat, lon: coords.lon } : c;
  });

  // Kick off background geocoding for anything uncached (fire and forget)
  const uncached = recent.filter(c => {
    if (!c.location) return false;
    return geocode.getFromCache(geoQuery(c)) === undefined;
  });
  if (uncached.length > 0) {
    geocode.geocodeCalls(uncached).catch(() => {});
  }

  res.json({ calls: withCoords, hours, geocoding: uncached.length > 0 });
});

app.get('/api/status', (req, res) => {
  const cache = readCache();
  res.json({
    scraping: scrapeInProgress !== null,
    cacheAge: cache?.scrapedAt
      ? Math.round((Date.now() - new Date(cache.scrapedAt).getTime()) / 1000)
      : null,
    scrapedAt: cache?.scrapedAt || null,
    count: cache?.calls?.length || 0,
    errors: cache?.errors || [],
  });
});

// ── Gemeinden GeoJSON ────────────────────────────────────────────────────────

app.get('/api/gemeinden', async (req, res) => {
  // Serve from disk cache if fresh
  try {
    const raw = fs.readFileSync(GEMEINDEN_CACHE_FILE, 'utf8');
    const cached = JSON.parse(raw);
    if (cached.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < GEMEINDEN_TTL_MS) {
      return res.json(cached.geojson);
    }
  } catch { /* no fresh cache */ }

  // Fetch from swisstopo WFS
  const WFS_URL =
    'https://wms.geo.admin.ch/?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
    '&TYPENAMES=ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill' +
    '&SRSNAME=EPSG:4326&OUTPUTFORMAT=application/json&COUNT=3000';

  try {
    const resp = await axios.get(WFS_URL, {
      timeout: 60000,
      headers: { 'User-Agent': 'FireAlerts-LU/1.0 (educational)' },
    });
    const geojson = resp.data;

    // Keep only the 4 covered cantons
    if (Array.isArray(geojson.features)) {
      geojson.features = geojson.features.filter(f => {
        const p = f.properties || {};
        const ktnr = parseInt(p.KTNR ?? p.ktnr ?? -1);
        return COVERED_CANTONS.has(ktnr);
      });
    }

    fs.mkdirSync(path.dirname(GEMEINDEN_CACHE_FILE), { recursive: true });
    fs.writeFileSync(GEMEINDEN_CACHE_FILE,
      JSON.stringify({ fetchedAt: new Date().toISOString(), geojson }));
    console.log(`[server] Cached ${geojson.features?.length ?? 0} Gemeinden`);
    res.json(geojson);
  } catch (err) {
    console.error('[server] /api/gemeinden error:', err.message);
    // Fall back to stale cache if available
    try {
      const raw = fs.readFileSync(GEMEINDEN_CACHE_FILE, 'utf8');
      return res.json(JSON.parse(raw).geojson);
    } catch {}
    res.status(502).json({ error: 'Gemeindedaten nicht verfügbar', detail: err.message });
  }
});

// ── Startup ──────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  const cache = readCache();
  if (isCacheFresh(cache)) {
    console.log(`[server] Using cached data (${cache.calls.length} incidents, scraped ${cache.scrapedAt})`);
  } else {
    console.log('[server] No fresh cache found, starting initial scrape...');
    getOrScrape(true).catch(err => console.error('[server] Initial scrape failed:', err));
  }
});
