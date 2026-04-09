'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'cache', 'geocode.json');
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// In-memory cache, persisted to disk
let memCache = {};

function loadCache() {
  try {
    memCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    memCache = {};
  }
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(memCache, null, 2), 'utf8');
  } catch (err) {
    console.error('[geocode] Failed to save cache:', err.message);
  }
}

// Rate-limit: Nominatim requires max 1 req/sec
let lastRequestTime = 0;
async function rateLimit() {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < 1100) await new Promise(r => setTimeout(r, 1100 - elapsed));
  lastRequestTime = Date.now();
}

/**
 * Look up lat/lon for a location string.
 * Returns { lat, lon } or null if not found.
 * Results are cached permanently (addresses don't move).
 */
async function lookup(location, sourceName, canton = 'Luzern') {
  if (!location || location.trim().length < 3) return null;

  const query = `${location.trim()}, Kanton ${canton}, Schweiz`;

  if (memCache[query] !== undefined) {
    return memCache[query]; // null = previously not found, object = found
  }

  await rateLimit();
  try {
    const res = await axios.get(NOMINATIM, {
      params: { q: query, format: 'json', limit: 1, countrycodes: 'ch' },
      headers: {
        'User-Agent': 'FireAlerts-LU/1.0 (educational aggregator)',
        'Accept-Language': 'de',
      },
      timeout: 8000,
    });

    if (res.data.length > 0) {
      const { lat, lon } = res.data[0];
      memCache[query] = { lat: parseFloat(lat), lon: parseFloat(lon) };
    } else {
      // Try fallback: just the source name + canton
      if (sourceName) {
        const fallbackQuery = `${sourceName}, ${canton}, Schweiz`;
        if (memCache[fallbackQuery] !== undefined) {
          memCache[query] = memCache[fallbackQuery];
        } else {
          await rateLimit();
          const fb = await axios.get(NOMINATIM, {
            params: { q: fallbackQuery, format: 'json', limit: 1, countrycodes: 'ch' },
            headers: { 'User-Agent': 'FireAlerts-LU/1.0 (educational aggregator)' },
            timeout: 8000,
          });
          memCache[fallbackQuery] = fb.data.length > 0
            ? { lat: parseFloat(fb.data[0].lat), lon: parseFloat(fb.data[0].lon) }
            : null;
          memCache[query] = memCache[fallbackQuery];
        }
      } else {
        memCache[query] = null;
      }
    }
  } catch (err) {
    console.error(`[geocode] Lookup failed for "${query}": ${err.message}`);
    return null; // don't cache errors — allow retry
  }

  saveCache();
  return memCache[query];
}

/**
 * Geocode a batch of calls, respecting rate limits.
 * Only geocodes calls with a non-empty location that aren't cached yet.
 * Returns the same array with lat/lon added where found.
 */
async function geocodeCalls(calls) {
  const results = [];
  for (const call of calls) {
    if (!call.location) {
      results.push(call);
      continue;
    }
    const query = `${call.location.trim()}, Kanton Luzern, Schweiz`;
    if (memCache[query] !== undefined) {
      // Already cached — no HTTP request needed
      const coords = memCache[query];
      results.push(coords ? { ...call, lat: coords.lat, lon: coords.lon } : call);
    } else {
      const coords = await lookup(call.location, call.sourceName);
      results.push(coords ? { ...call, lat: coords.lat, lon: coords.lon } : call);
    }
  }
  return results;
}

/** Return a cached result without triggering a network request. Returns undefined if not cached. */
function getFromCache(query) {
  return memCache[query]; // undefined = not cached; null = cached miss; object = hit
}

// Load cache on module init
loadCache();

module.exports = { lookup, geocodeCalls, getFromCache };
