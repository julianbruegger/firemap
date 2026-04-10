# Firemap — Codebase Guide for Claude

This document covers the architecture, data flow, and key design decisions so future sessions can pick up context quickly.

---

## What the app does

Aggregates Swiss fire-department emergency calls (Einsätze) from ~12 sources across four cantons (LU, ZH, AG, SO), geocodes them, and presents them via a single-page web app with four views:

- **Liste** — filterable, sortable table of all incidents
- **Karte** — Leaflet map with pin/cluster markers (last 24 h / 48 h / 7 d)
- **Statistik** — ten Chart.js graphs (type, weekday, hourly, monthly, YoY, dept, location, heatmap, trends)
- **Gemeinden** — choropleth Leaflet map where each Swiss municipality is coloured by incident count; click any municipality to see a popup of all matching alerts

---

## Stack

| Layer | Technology |
|---|---|
| Server | Node.js + Express |
| Scraping | Axios + Cheerio |
| Geocoding | Nominatim (OSM) |
| Frontend | Vanilla JS (no framework) |
| Maps | Leaflet 1.9.4 + OpenStreetMap tiles |
| Charts | Chart.js 4.4.1 |
| Styling | CSS custom properties (OKLCH), light/dark theme |

---

## File map

```
server.js              Express routes, scraper orchestration, cache management
scrapers/
  lodur.js             LODUR system scraper — covers 35+ departments across ZH/LU/AG
  fwluzern.js          Feuerwehr Stadt Luzern HTML table scraper
  [10 more *.js]       One file per smaller department/source
  geocode.js           Nominatim lookup, in-memory + disk cache (cache/geocode.json)
  normalize.js         Maps raw type strings → canonical type names + colours
public/
  index.html           Single HTML shell; loads Leaflet, Chart.js, app.js
  app.js               All frontend logic (~1000 lines)
  style.css            OKLCH theme tokens, component styles, dark mode
cache/
  calls.json           Scraped incidents — written by server, read on every request
  geocode.json         Nominatim lat/lon cache — keyed by "location, Kanton X, Schweiz"
  gemeinden.json       swisstopo WFS GeoJSON cache — TTL 24 h
```

---

## Incident data model

```js
{
  id:          string,   // unique per source
  source:      string,   // e.g. 'fwluzern', 'lodur-rain'
  sourceName:  string,   // human display name
  canton:      'LU'|'ZH'|'AG'|'SO',
  date:        'YYYY-MM-DD',
  time:        'HH:MM' | null,
  typeRaw:     string,   // original type string from source
  type:        string,   // normalised (see TYPE_COLORS in app.js)
  location:    string,   // free-text — street / village
  description: string,
  url:         string,   // link back to source
  lat?:        number,   // added by geocoder if found
  lon?:        number,
}
```

---

## Server routes

| Method | Path | Notes |
|---|---|---|
| GET | `/api/calls` | Full scraped dataset (6 h cache) |
| GET | `/api/recent?hours=N` | Last N hours (max 168); adds cached lat/lon, kicks off background geocoding for new entries |
| POST | `/api/refresh` | Trigger a fresh scrape in the background (202 response) |
| GET | `/api/status` | `{ scraping, cacheAge, count, errors }` |
| GET | `/api/gemeinden` | Swiss municipality GeoJSON (swisstopo WFS, filtered to LU/ZH/AG/SO, 24 h cache) |

---

## Geocoding

`scrapers/geocode.js` wraps Nominatim:

- Cache key: `"<location>, Kanton <name>, Schweiz"`
- Stores `{ lat, lon }` on hit, `null` on miss — so failed lookups are not re-requested
- Rate-limited to 1 req/s (Nominatim policy)
- The `/api/recent` endpoint does a synchronous cache read and fires background geocoding for uncached entries; the frontend polls `/api/recent` every 8 s while `geocoding: true`

---

## Normalised incident types

Defined in `scrapers/normalize.js` and mirrored in `TYPE_COLORS` / `TYPE_ICONS` in `app.js`:

| Type | Hex | Notes |
|---|---|---|
| Brand | `#b91c1c` | fire, explosion, chimney |
| Brandmeldeanlage | `#d97706` | alarm panels, smoke detectors |
| Technische Hilfe | `#1d4ed8` | accidents, technical rescue |
| Öl / Chemie | `#7c3aed` | oil, hazmat, gas |
| Rettung | `#059669` | rescue, persons, animals |
| Wasserschaden / Elementar | `#0891b2` | flooding, storm |
| Falschalarm | `#4b5563` | false alarms |
| First Responder | `#0d9488` | medical first response |
| Stützpunkt | `#4ad2fc` | staging / support points |
| 144 | `#f9fc4a` | patient rescue |
| Sonstiges | `#9ca3af` | catch-all |

---

## Gemeinden map — how it works

**Data source**: `GET /api/gemeinden` → swisstopo WFS endpoint:
```
https://wms.geo.admin.ch/?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature
  &TYPENAMES=ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill
  &SRSNAME=EPSG:4326&OUTPUTFORMAT=application/json&COUNT=3000
```
Server-side filters to canton numbers 1 (ZH), 3 (LU), 11 (SO), 19 (AG) and caches to `cache/gemeinden.json` for 24 hours.

**Client-side matching** (`buildAlertsByGemeinde` in `app.js`):

1. **Geocoded calls** (`lat`/`lon` present): ray-casting point-in-polygon against each feature.  
   Bounding-box pre-filter (cached as `feature._bbox`) eliminates the vast majority of features before the polygon test, keeping the loop fast (typically < 20 ms for a few hundred calls × ~500 features).

2. **Non-geocoded calls**: substring match — if the call's `location` field contains a municipality name (≥ 3 chars), the longest match wins.

**Choropleth colour ramp**:

| Count | Colour |
|---|---|
| 0 | `#e8e8e8` light grey |
| 1–2 | `#fde8c8` light amber |
| 3–5 | `#f9a02a` amber |
| 6–10 | `#e06000` dark orange |
| ≥ 11 | `#b91c1c` red |

**Click popup**: sorted by date desc, reuses `makePopupEntry()` from the Karte tab.

**Filter reactivity**: `update()` calls `loadGemeindenMap(applyFilters())` when any global filter changes and the Gemeinden tab is active. The GeoJSON is only fetched once per page load (`gemeindenGeojson` cache variable).

---

## Frontend tab lifecycle

```
switchTab(name)
  ├─ 'liste'     → (nothing extra, table already rendered by update())
  ├─ 'karte'     → initMap() + loadMap(mapHours)
  ├─ 'statistik' → updateStatsCharts(applyFilters())
  └─ 'gemeinden' → initGemeindenMap() + loadGemeindenMap(applyFilters())

update()   ← fired on every filter change
  ├─ renderTable(applySort(applyFilters()))
  ├─ if statistik active → updateStatsCharts(filtered)
  └─ if gemeinden active → loadGemeindenMap(filtered)
```

---

## Adding a new scraper

1. Create `scrapers/<name>.js` exporting `async function scrape()` that returns an array of incident objects (see data model above).
2. Import and call it in `server.js` inside `runAllScrapers()`.
3. Add a fallback HQ coordinate in `DEPT_COORDS` in `public/app.js` so the Karte tab can place ungeocoded calls.

---

## Caches

All caches live in `cache/` (gitignored). Delete any file to force a refresh:

| File | TTL | Contents |
|---|---|---|
| `calls.json` | 6 h | Scraped incidents |
| `geocode.json` | permanent | Nominatim results keyed by query string |
| `gemeinden.json` | 24 h | swisstopo municipality GeoJSON |

---

## Environment

```
PORT=3000          (default)
TUNNEL_TOKEN=...   (optional, for cloudflare tunnel)
```
