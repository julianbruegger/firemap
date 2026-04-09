'use strict';

// ── Theme ────────────────────────────────────────────────────────────────────
function getEffectiveTheme() {
  const stored = localStorage.getItem('theme');
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

// Apply saved theme immediately to avoid flash
(function() {
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
})();

document.getElementById('btn-theme')?.addEventListener('click', () => {
  const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  // Re-render charts with new theme colors
  if (chartType || chartWeekday || chartHourly || chartMonthly || chartDept) {
    destroyAllCharts();
    if (activeTab === 'statistik') updateStatsCharts(applyFilters());
  }
});

function destroyAllCharts() {
  [chartType, chartWeekday, chartHourly, chartMonthly, chartDept].forEach(c => { if (c) c.destroy(); });
  chartType = chartWeekday = chartHourly = chartMonthly = chartDept = null;
}

// Helper to read CSS custom properties (for chart theming)
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ── State ─────────────────────────────────────────────────────────────────────
let allCalls = [];
let sortCol = 'date';
let sortDir = 'desc';
let activeTab = 'liste';

// Chart instances (lazily created)
let chartType = null;
let chartWeekday = null;
let chartHourly = null;
let chartMonthly = null;
let chartDept = null;

// Global time filter (null = all)
let globalDays = null;

// Map state
let mapInstance = null;
let mapMarkers = [];
let mapHours = 48;

// Polling
let polling = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tbody          = document.getElementById('calls-tbody');
const filterCanton   = document.getElementById('filter-canton');
const filterDept     = document.getElementById('filter-dept');
const filterYear     = document.getElementById('filter-year');
const filterType     = document.getElementById('filter-type');
const filterSearch   = document.getElementById('filter-search');
const btnRefresh   = document.getElementById('btn-refresh');
const btnReset     = document.getElementById('btn-reset');
const resultsCount = document.getElementById('results-count');
const lastUpdated  = document.getElementById('last-updated');
const statusText   = document.getElementById('status-text');
const warnBanner   = document.getElementById('warning-banner');
const warnDetail   = document.getElementById('warning-detail');

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_COLORS = {
  'Brand':                    '#b91c1c',
  'Brandmeldeanlage':         '#d97706',
  'Technische Hilfe':         '#1d4ed8',
  'Öl / Chemie':              '#7c3aed',
  'Rettung':                  '#059669',
  'Wasserschaden / Elementar':'#0891b2',
  'Falschalarm':              '#4b5563',
  'First Responder':          '#0d9488',
  'Sonstiges':                '#9ca3af',
  '144':                      '#f9fc4a',
  'Stützpunkt':               '#4ad2fc',
};

// SVG path data for each incident type icon (16×16 viewBox)
const TYPE_ICONS = {
  'Brand':                    '<path d="M8 1C8 1 3 6 3 10a5 5 0 0 0 10 0C13 6 8 1 8 1Zm0 12a3 3 0 0 1-3-3c0-1.5 1.5-3.5 3-5.5 1.5 2 3 4 3 5.5a3 3 0 0 1-3 3Z"/>',
  'Brandmeldeanlage':         '<path d="M8 1.5a1 1 0 0 1 1 1V4h2.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8.5v2.5a.5.5 0 0 1-1 0V12H4.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7V2.5a1 1 0 0 1 1-1ZM5 6.5a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H5Zm0 2.5a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5H5Z"/>',
  'Technische Hilfe':         '<path d="M6.5 1.5a1 1 0 0 1 2 0v1.585a4.003 4.003 0 0 1 2.915 2.915H13a1 1 0 1 1 0 2h-1.585A4.003 4.003 0 0 1 8.5 10.915V13a1 1 0 1 1-2 0v-2.085A4.003 4.003 0 0 1 3.585 8H2a1 1 0 0 1 0-2h1.585A4.003 4.003 0 0 1 6.5 3.085V1.5ZM7.5 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>',
  'Öl / Chemie':              '<path d="M7 1h2v3.28l3.9 5.858A2 2 0 0 1 11.234 13H4.766a2 2 0 0 1-1.664-3.11L7 4.28V1Zm1 5.72L5.268 11h5.464L8 6.72Z"/>',
  'Rettung':                  '<path d="M7 2h2v4h4v2H9v4H7V8H3V6h4V2Z"/>',
  'Wasserschaden / Elementar':'<path d="M2.5 5C3.5 3.5 5 2 8 2s4.5 1.5 5.5 3c-1 1.5-2.5 3-5.5 3S3.5 6.5 2.5 5Zm0 5c1-1.5 2.5-3 5.5-3s4.5 1.5 5.5 3c-1 1.5-2.5 3-5.5 3s-4.5-1.5-5.5-3Z"/>',
  'Falschalarm':              '<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 2a5 5 0 1 1 0 10A5 5 0 0 1 8 3Zm-.5 2v4h1V5h-1Zm0 5v1h1v-1h-1Z"/>',
  'First Responder':          '<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM5.5 7.5l2 2 3.5-4 1 1-4.5 5-3-3 1-1Z"/>',
  'Sonstiges':                '<circle cx="8" cy="8" r="5"/>',
  '144':                      '<path d="M7 2h2v4h4v2H9v4H7V8H3V6h4V2Z"/>',
  'Stützpunkt':               '<path d="M8 1l2.35 4.76L15 6.5l-3.5 3.41.83 4.82L8 12.42l-4.33 2.31.83-4.82L1 6.5l4.65-.74Z"/>',
};

// Fallback HQ coordinates per source key
const DEPT_COORDS = {
  'fwluzern':               [47.050, 8.310],
  'emmen':                  [47.083, 8.313],
  'malters-schachen':       [47.027, 8.182],
  'lodur-huerntal':         [47.197, 7.980],
  'lodur-rain':             [47.138, 8.165],
  'lodur-bueron-schlierbach':[47.210, 8.030],
  'lodur-seegemeinden':     [47.100, 8.180],
  'lodur-doppleschwand-romoos': [47.032, 7.972],
  'lodur-hergiswil-napf':   [47.195, 8.140],
  'lodur-buchrain':         [47.134, 8.165],
  'lodur-roemerswiil':      [47.132, 8.080],
  'lodur-triengen':         [47.114, 7.988],
  'lodur-sins-abtwil':      [47.332, 8.310],
  'lodur-auw':              [47.325, 8.295],
  'kriens':                 [47.030, 8.280],
  'willisau':               [47.125, 7.998],
  'rothenburg':             [47.085, 8.262],
  'sursee':                 [47.172, 8.107],
  'hitzkirch':              [47.121, 8.209],

  // ── Kt. Solothurn ───────────────────────────────────────────────────────────
  'olten':                  [47.350, 7.907],

  // ── Kt. Zürich ──────────────────────────────────────────────────────────────
  'lodur-duebendorf':     [47.397, 8.619],
  'lodur-horgen':         [47.259, 8.598],
  'lodur-dietikon':       [47.404, 8.400],
  'lodur-buelach':        [47.519, 8.541],
  'lodur-wallisellen':    [47.413, 8.595],
  'lodur-kuesnacht':      [47.319, 8.583],
  'lodur-adliswil':       [47.310, 8.524],
  'lodur-bassersdorf':    [47.443, 8.628],
  'lodur-langnau':        [47.289, 8.541],
  'lodur-pfaeffikon':     [47.366, 8.784],
  'lodur-moenchaltorf':   [47.307, 8.714],
  'lodur-zumikon':        [47.331, 8.623],
  'lodur-aeugst':         [47.269, 8.487],

  // ── Kt. Aargau ──────────────────────────────────────────────────────────────

  'lodur-aarau':            [47.393, 8.044],
  'lodur-auw':              [47.211, 8.366],
  'lodur-baden':            [47.473, 8.306],
  'lodur-buchs':            [47.394, 8.082],
  'lodur-frick':            [47.507, 8.018],
  'lodur-laufenburg':       [47.559, 8.062],
  'lodur-merenschwand':     [47.246, 8.377],
  'lodur-muri':             [47.274, 8.338],
  'lodur-seengen':          [47.325, 8.207],
  'lodur-sins-abtwil':      [47.193, 8.392],
  'lodur-stein':            [47.545, 7.952],
  'lodur-suhr':             [47.371, 8.079],
  'lodur-untersiggenthal':  [47.502, 8.255],
  'lodur-wohlen':           [47.352, 8.278],
  'lodur-wuerenlingen':     [47.534, 8.255],
  'lodur-wuerenlos':        [47.443, 8.362],
  'lodur-zurzach':          [47.589, 8.290],       
};

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function fmtAge(isoTs) {
  if (!isoTs) return '';
  const diffMs = Date.now() - new Date(isoTs).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 2) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `vor ${hrs} Std.`;
  return `vor ${Math.round(hrs / 24)} Tagen`;
}

function typeBadgeClass(type) {
  const map = {
    'Brand': 'badge-Brand',
    'Brandmeldeanlage': 'badge-Brandmeldeanlage',
    'Technische Hilfe': 'badge-Technische-Hilfe',
    'Öl / Chemie': 'badge-Öl-Chemie',
    'Rettung': 'badge-Rettung',
    'Wasserschaden / Elementar': 'badge-Wasserschaden',
    'Falschalarm': 'badge-Falschalarm',
    'First Responder': 'badge-First-Responder',
    'Sonstiges': 'badge-Sonstiges',
  };
  return map[type] || 'badge-Sonstiges';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('hidden', el.id !== `tab-${tab}`);
  });

  if (tab === 'karte') {
    initMap();
    loadMap(mapHours);
  } else if (tab === 'statistik') {
    updateStatsCharts(applyFilters());
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ── Filtering & Sorting ───────────────────────────────────────────────────────

function applyFilters() {
  const canton = filterCanton.value;
  const dept   = filterDept.value;
  const year   = filterYear.value;
  const type   = filterType.value;
  const search = filterSearch.value.toLowerCase().trim();
  const cutoff = globalDays !== null ? Date.now() - globalDays * 86400000 : null;

  return allCalls.filter(c => {
    if (cutoff && c.date) {
      const ts = new Date(`${c.date}T${c.time || '00:00'}:00`).getTime();
      if (ts < cutoff) return false;
    }
    if (canton && c.canton !== canton) return false;
    if (dept && c.source !== dept) return false;
    if (year && (!c.date || !c.date.startsWith(year))) return false;
    if (type && c.type !== type) return false;
    if (search) {
      const hay = [c.typeRaw, c.type, c.location, c.description, c.sourceName].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function applySort(calls) {
  return [...calls].sort((a, b) => {
    let av = sortCol === 'date'
      ? (a.date || '0000-00-00') + (a.time || '00:00')
      : (a[sortCol] ?? '');
    let bv = sortCol === 'date'
      ? (b.date || '0000-00-00') + (b.time || '00:00')
      : (b[sortCol] ?? '');
    const cmp = String(av).localeCompare(String(bv), 'de', { numeric: true });
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

// ── Table rendering ───────────────────────────────────────────────────────────

function renderTable(calls) {
  if (calls.length === 0) {
    tbody.innerHTML = `<tr class="placeholder-row"><td colspan="7">Keine Einsätze gefunden.</td></tr>`;
    resultsCount.textContent = '0 Einsätze';
    return;
  }
  resultsCount.textContent = `${calls.length.toLocaleString('de')} Einsätze`;
  tbody.innerHTML = calls.map(c => {
    const badge = typeBadgeClass(c.type);
    const link  = c.url
      ? `<a class="ext-link" href="${escHtml(c.url)}" target="_blank" rel="noopener">↗</a>`
      : '—';
    return `<tr>
      <td class="date">${fmtDate(c.date)}</td>
      <td class="time">${c.time || '—'}</td>
      <td class="canton"><span class="canton-badge canton-${escHtml(c.canton || '')}">${escHtml(c.canton || '—')}</span></td>
      <td class="dept">${escHtml(c.sourceName)}</td>
      <td><span class="badge ${badge}">${escHtml(c.type)}</span></td>
      <td class="type-raw">${escHtml(c.typeRaw || '')}</td>
      <td>${escHtml(c.location || '—')}</td>
      <td>${link}</td>
    </tr>`;
  }).join('');
}

// ── Update (filters changed) ──────────────────────────────────────────────────

function update() {
  const filtered = applyFilters();
  renderTable(applySort(filtered));
  if (activeTab === 'statistik') updateStatsCharts(filtered);
}

// ── Dropdown population ───────────────────────────────────────────────────────

function populateDropdowns(calls) {
  const canton = filterCanton.value;
  const visible = canton ? calls.filter(c => c.canton === canton) : calls;

  const depts = [...new Set(visible.map(c => c.source))].sort();
  const types = [...new Set(calls.map(c => c.type))].sort();
  const deptLabels = {};
  calls.forEach(c => { deptLabels[c.source] = c.sourceName; });

  const prevDept = filterDept.value;
  filterDept.innerHTML = '<option value="">Alle Abteilungen</option>'
    + depts.map(d => `<option value="${d}">${escHtml(deptLabels[d] || d)}</option>`).join('');
  if (depts.includes(prevDept)) filterDept.value = prevDept;

  filterType.innerHTML = '<option value="">Alle Einsatzarten</option>'
    + types.map(t => `<option value="${t}">${escHtml(t)}</option>`).join('');
}

// ── Sort controls ─────────────────────────────────────────────────────────────

document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    sortDir = (sortCol === col && sortDir === 'desc') ? 'asc' : (col === 'date' ? 'desc' : 'asc');
    sortCol = col;
    document.querySelectorAll('th.sortable').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
    th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    update();
  });
});
document.querySelector(`th[data-col="${sortCol}"]`)?.classList.add('sort-desc');

// ── Filter listeners ──────────────────────────────────────────────────────────

filterCanton.addEventListener('change', () => { populateDropdowns(allCalls); update(); });
[filterDept, filterYear, filterType].forEach(el => el.addEventListener('change', update));
filterSearch.addEventListener('input', update);
btnReset.addEventListener('click', () => {
  filterCanton.value = filterDept.value = filterYear.value = filterType.value = filterSearch.value = '';
  globalDays = null;
  document.querySelectorAll('.global-time-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.global-time-btn[data-days=""]')?.classList.add('active');
  update();
});

document.querySelectorAll('.global-time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.global-time-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    globalDays = btn.dataset.days ? parseInt(btn.dataset.days) : null;
    update();
  });
});

// ── Map ───────────────────────────────────────────────────────────────────────

function initMap() {
  if (mapInstance) return;
  mapInstance = L.map('map').setView([47.07, 8.25], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapInstance);
  buildMapLegend();
}

function buildMapLegend() {
  const legend = document.getElementById('map-legend');
  legend.innerHTML = Object.entries(TYPE_COLORS).map(([type, color]) => {
    const icon = TYPE_ICONS[type] || TYPE_ICONS['Sonstiges'];
    return `<span class="legend-item"><svg class="legend-icon" viewBox="0 0 16 16" width="14" height="14" fill="${color}">${icon}</svg>${escHtml(type)}</span>`;
  }).join('');
}

/**
 * Build an SVG marker icon for a single incident type.
 */
function makeMarkerSvg(color, iconSvg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3))">
    <path d="M16 38 C16 38 3 22 3 14a13 13 0 0 1 26 0c0 8-13 24-13 24Z"
          fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <g transform="translate(8,6)" fill="#fff">${iconSvg}</g>
  </svg>`;
}

/**
 * Build an SVG cluster marker showing a count.
 */
function makeClusterSvg(color, count) {
  const r = Math.min(24, 16 + count * 1.5);
  const size = r * 2 + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.25))">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="${color}" stroke="#fff" stroke-width="2" opacity="0.9"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r-4}" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>
    <text x="${size/2}" y="${size/2}" text-anchor="middle" dy="0.35em"
          fill="#fff" font-family="system-ui,sans-serif" font-weight="700" font-size="${count > 99 ? 10 : 12}">${count}</text>
  </svg>`;
}

function makePopupEntry(c) {
  return `<div class="map-popup-entry">
    <span class="popup-type-dot" style="background:${TYPE_COLORS[c.type] || TYPE_COLORS['Sonstiges']}"></span>
    <div>
      <strong>${escHtml(c.type)}</strong><br>
      ${fmtDate(c.date)} ${c.time || ''} · <em>${escHtml(c.sourceName)}</em>
      ${c.typeRaw ? `<br><span class="popup-detail">${escHtml(c.typeRaw)}</span>` : ''}
      ${c.url ? ` <a href="${escHtml(c.url)}" target="_blank" rel="noopener">↗</a>` : ''}
    </div>
  </div>`;
}

async function loadMap(hours) {
  if (!mapInstance) return;
  const countEl = document.getElementById('map-count');
  countEl.textContent = 'Lade…';

  let data;
  try {
    const res = await fetch(`/api/recent?hours=${hours}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error('[map] loadMap error:', err);
    countEl.textContent = `Fehler beim Laden: ${err.message}`;
    return;
  }

  // Clear existing markers
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];

  const calls = data.calls || [];

  // Resolve coordinates and group by location key
  const groups = {};
  calls.forEach(c => {
    let lat = c.lat;
    let lon = c.lon;
    if (!lat || !lon) {
      const hq = DEPT_COORDS[c.source];
      if (!hq) return;
      [lat, lon] = hq;
    }
    // Round to ~11m precision to cluster nearby incidents
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (!groups[key]) groups[key] = { lat, lon, calls: [] };
    groups[key].calls.push(c);
  });

  let placed = 0;
  Object.values(groups).forEach(group => {
    const { lat, lon, calls: gcalls } = group;
    let marker;

    if (gcalls.length === 1) {
      // Single incident — pin marker with type icon
      const c = gcalls[0];
      const color = TYPE_COLORS[c.type] || TYPE_COLORS['Sonstiges'];
      const iconSvg = TYPE_ICONS[c.type] || TYPE_ICONS['Sonstiges'];
      const svg = makeMarkerSvg(color, iconSvg);

      marker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'fire-marker',
          html: svg,
          iconSize: [32, 40],
          iconAnchor: [16, 38],
          popupAnchor: [0, -34],
        }),
      });

      marker.bindPopup(`<div class="map-popup">${makePopupEntry(c)}${c.location ? `<div class="popup-location">${escHtml(c.location)}</div>` : ''}</div>`, { maxWidth: 320 });
    } else {
      // Multiple incidents at same location — cluster marker
      // Use the most "severe" type's color for the cluster
      const typePriority = ['Brand', 'Rettung', '144', 'Öl / Chemie', 'Wasserschaden / Elementar', 'Technische Hilfe', 'Brandmeldeanlage', 'Stützpunkt', 'Falschalarm', 'Sonstiges'];
      const topType = typePriority.find(t => gcalls.some(c => c.type === t)) || 'Sonstiges';
      const color = TYPE_COLORS[topType] || TYPE_COLORS['Sonstiges'];
      const size = Math.min(48, 32 + gcalls.length * 3);
      const svg = makeClusterSvg(color, gcalls.length);

      marker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'fire-cluster',
          html: svg,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          popupAnchor: [0, -size / 2 + 4],
        }),
      });

      // Sort by date descending
      gcalls.sort((a, b) => ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || '')));
      const loc = gcalls.find(c => c.location)?.location || '';
      const popupHtml = `<div class="map-popup map-popup-cluster">
        ${loc ? `<div class="popup-location cluster-location">${escHtml(loc)}</div>` : ''}
        <div class="popup-count">${gcalls.length} Einsätze</div>
        <div class="popup-entries">${gcalls.map(makePopupEntry).join('')}</div>
      </div>`;
      marker.bindPopup(popupHtml, { maxWidth: 360, maxHeight: 320 });
    }

    marker.addTo(mapInstance);
    mapMarkers.push(marker);
    placed += gcalls.length;
  });

  countEl.textContent = `${placed} Einsätze${data.geocoding ? ' (Geocoding läuft…)' : ''}`;

  if (data.geocoding) {
    setTimeout(() => { if (activeTab === 'karte') loadMap(mapHours); }, 8000);
  }
}

// Time range buttons
document.querySelectorAll('.time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mapHours = parseInt(btn.dataset.hours);
    loadMap(mapHours);
  });
});

// ── Statistics charts ─────────────────────────────────────────────────────────

function makeBarOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} Einsätze` } },
    },
    scales: {
      y: { beginAtZero: true, ticks: { stepSize: 1, color: cssVar('--chart-text') }, grid: { color: cssVar('--chart-grid') } },
      x: { grid: { display: false }, ticks: { color: cssVar('--chart-text') } },
    },
  };
}

function updateTypeChart(calls) {
  const typeCount = {};
  calls.forEach(c => { const t = c.type || 'Sonstiges'; typeCount[t] = (typeCount[t] || 0) + 1; });
  const labels = Object.keys(typeCount).sort();
  const data   = labels.map(l => typeCount[l]);
  const colors = labels.map(l => TYPE_COLORS[l] || '#999');

  if (!chartType) {
    const ctx = document.getElementById('typeChart');
    if (!ctx) return;
    chartType = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: cssVar('--chart-doughnut-border'), borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10, usePointStyle: true, color: cssVar('--chart-text') } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed}` } },
        },
      },
    });
  } else {
    chartType.data.labels = labels;
    chartType.data.datasets[0].data = data;
    chartType.data.datasets[0].backgroundColor = colors;
    chartType.update();
  }
}

function updateWeekdayChart(calls) {
  // JS getDay(): 0=Sun, 1=Mon... convert to Mon=0..Sun=6
  const counts = new Array(7).fill(0);
  calls.forEach(c => {
    if (!c.date) return;
    const d = new Date(c.date).getDay();
    const idx = d === 0 ? 6 : d - 1; // Sun→6
    counts[idx]++;
  });

  if (!chartWeekday) {
    const ctx = document.getElementById('weekdayChart');
    if (!ctx) return;
    chartWeekday = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: WEEKDAYS,
        datasets: [{ data: counts, backgroundColor: cssVar('--chart-bar-primary'), borderRadius: 4 }],
      },
      options: makeBarOptions(),
    });
  } else {
    chartWeekday.data.datasets[0].data = counts;
    chartWeekday.update();
  }
}

function updateHourlyChart(calls) {
  const counts = new Array(24).fill(0);
  calls.forEach(c => {
    if (!c.time) return;
    const h = parseInt(c.time.split(':')[0], 10);
    if (h >= 0 && h < 24) counts[h]++;
  });

  const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

  if (!chartHourly) {
    const ctx = document.getElementById('hourlyChart');
    if (!ctx) return;
    chartHourly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: counts, backgroundColor: cssVar('--chart-bar-secondary'), borderRadius: 3 }],
      },
      options: makeBarOptions(),
    });
  } else {
    chartHourly.data.datasets[0].data = counts;
    chartHourly.update();
  }
}

function updateMonthlyChart(calls) {
  // Build last 30 months
  const now = new Date();
  const months = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const counts = {};
  months.forEach(m => { counts[m] = 0; });
  calls.forEach(c => {
    if (!c.date) return;
    const m = c.date.substring(0, 7);
    if (counts[m] !== undefined) counts[m]++;
  });

  const labels = months.map(m => {
    const [y, mo] = m.split('-');
    return `${mo}/${y.slice(2)}`;
  });
  const data = months.map(m => counts[m]);

  if (!chartMonthly) {
    const ctx = document.getElementById('monthlyChart');
    if (!ctx) return;
    chartMonthly = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          borderColor: cssVar('--chart-line'),
          backgroundColor: cssVar('--chart-line-fill'),
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} Einsätze` } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { color: cssVar('--chart-text') }, grid: { color: cssVar('--chart-grid') } },
          x: { ticks: { maxRotation: 45, font: { size: 10 }, color: cssVar('--chart-text') }, grid: { display: false } },
        },
      },
    });
  } else {
    chartMonthly.data.labels = labels;
    chartMonthly.data.datasets[0].data = data;
    chartMonthly.update();
  }
}

function updateDeptChart(calls) {
  const counts = {};
  calls.forEach(c => { counts[c.sourceName] = (counts[c.sourceName] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(e => e[0]);
  const data   = sorted.map(e => e[1]);

  if (!chartDept) {
    const ctx = document.getElementById('deptChart');
    if (!ctx) return;
    chartDept = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data, backgroundColor: cssVar('--chart-bar-secondary'), borderRadius: 4 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.parsed.x} Einsätze` } },
        },
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1, color: cssVar('--chart-text') }, grid: { color: cssVar('--chart-grid') } },
          y: { grid: { display: false }, ticks: { font: { size: 11 }, color: cssVar('--chart-text') } },
        },
      },
    });
  } else {
    chartDept.data.labels = labels;
    chartDept.data.datasets[0].data = data;
    chartDept.update();
  }
}

function updateStatsCharts(calls) {
  updateTypeChart(calls);
  updateWeekdayChart(calls);
  updateHourlyChart(calls);
  updateMonthlyChart(calls);
  updateDeptChart(calls);
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const res = await fetch('/api/calls');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    allCalls = data.calls || [];
    populateDropdowns(allCalls);
    update();

    const ts = data.scrapedAt;
    lastUpdated.textContent = ts ? `Aktualisiert ${fmtAge(ts)}` : '';

    if (data.errors?.length) {
      warnDetail.textContent = data.errors.map(e => `${e.source}: ${e.error}`).join('; ');
      warnBanner.style.display = '';
    } else {
      warnBanner.style.display = 'none';
    }
  } catch (err) {
    statusText.textContent = 'Fehler beim Laden';
    tbody.innerHTML = `<tr class="placeholder-row"><td colspan="7">Fehler: ${escHtml(err.message)}</td></tr>`;
  }
}

// ── Background scrape polling ─────────────────────────────────────────────────

async function startPolling() {
  if (polling) return;
  polling = true;
  btnRefresh.disabled = true;
  btnRefresh.classList.add('spinning');

  while (true) {
    await new Promise(r => setTimeout(r, 4000));
    let status;
    try { status = await fetch('/api/status').then(r => r.json()); }
    catch { continue; }

    if (status.scraping) {
      const hint = status.count > 0 ? ` (${status.count.toLocaleString('de')} bisher)` : '';
      statusText.textContent = `Scrape läuft…${hint}`;
    } else {
      await loadData();
      statusText.textContent = allCalls.length
        ? `${allCalls.length.toLocaleString('de')} Einsätze geladen`
        : 'Keine Daten';
      btnRefresh.disabled = false;
      btnRefresh.classList.remove('spinning');
      polling = false;
      return;
    }
  }
}

btnRefresh.addEventListener('click', async () => {
  statusText.textContent = 'Scrape gestartet…';
  polling = false; // allow startPolling to run even if already polling
  btnRefresh.disabled = false;
  btnRefresh.classList.remove('spinning');
  await fetch('/api/refresh', { method: 'POST' });
  startPolling();
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  let status;
  try {
    status = await fetch('/api/status').then(r => r.json());
  } catch {
    statusText.textContent = 'Server nicht erreichbar';
    tbody.innerHTML = `<tr class="placeholder-row"><td colspan="7">Server nicht erreichbar.</td></tr>`;
    return;
  }

  if (status.count > 0) {
    await loadData();
    statusText.textContent = `${allCalls.length.toLocaleString('de')} Einsätze geladen`;
  } else {
    statusText.textContent = 'Scrape wird gestartet…';
    tbody.innerHTML = `<tr class="placeholder-row"><td colspan="7"><div class="spinner-inline"></div> Erster Scrape läuft im Hintergrund…</td></tr>`;
    await fetch('/api/refresh', { method: 'POST' });
  }

  if (status.scraping || status.count === 0) startPolling();
}

init();
