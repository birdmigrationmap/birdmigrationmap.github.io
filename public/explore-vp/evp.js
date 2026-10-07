"use strict";

const DATASETS = {
  "vp-raw": { label: "2018 raw", daysKey: "nanrawday2018" },
  "vp-clean": { label: "2018 cleaned", daysKey: "nancleanday2018" },
  "vp-2019": { label: "2019 raw", daysKey: "nanrawday2019" },
};

const $ = (id) => document.getElementById(id);
const ui = {
  dataset: $("dataset"),
  radar: $("radar"),
  hideZero: $("hide-zero"),
  logScale: $("log-scale"),
  rangeFrom: $("range-from"),
  rangeTo: $("range-to"),
  status: $("status"),
  plot: $("plot"),
  mapDialog: $("map-dialog"),
  coverageDialog: $("coverage-dialog"),
};

let radars = new Map(); // name -> metadata from radar_list.json
let available = {}; // dataset -> [radar names with a data file]
let current = null; // { key, data } of the last loaded profile, data on a regular grid
let requestId = 0;
let map, markerLayer;

// Values exported from MATLAB use [] for missing numbers.
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function setStatus(message, isError = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle("error", isError);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function isAvailable(dataset, name) {
  return (available[dataset] || []).includes(name);
}

function refreshRadarOptions() {
  const dataset = ui.dataset.value;
  for (const option of ui.radar.options) {
    const ok = isAvailable(dataset, option.value);
    option.disabled = !ok;
    option.textContent = ok ? option.value : `${option.value} (no data)`;
  }
  if (!isAvailable(dataset, ui.radar.value)) {
    ui.radar.value = available[dataset][0];
  }
}

function syncUrl() {
  const params = new URLSearchParams({ data: ui.dataset.value, radar: ui.radar.value });
  history.replaceState(null, "", `?${params}`);
}

async function loadProfile() {
  const dataset = ui.dataset.value;
  const radar = ui.radar.value;
  const key = `${dataset}/${radar}`;
  syncUrl();
  if (current?.key === key) return draw();

  const id = ++requestId;
  setStatus(`Loading ${radar} (${DATASETS[dataset].label})…`);
  try {
    const data = await fetchJson(`./assets/${dataset}/dc_${radar}.json`);
    if (id !== requestId) return; // a newer request superseded this one
    viewRange = null;
    current = { key, data: toGrid(data) };
    draw();
    setStatus("");
  } catch (error) {
    if (id === requestId) setStatus(`Could not load ${radar}: ${error.message}`, true);
  }
}

// Resample the profiles onto a regular time grid (NaN = no data), so that
// gaps stay empty and time bins can be averaged by index.
function toGrid(d) {
  // 2019 files have trailing spaces and a few "NaN-NaN-NaN" times (with no data).
  const t = d.time.map((s) => Date.parse(`${s.trim().replace(" ", "T")}Z`));
  const valid = t.filter(Number.isFinite);
  // Some radars mix resolutions (e.g. 5 and 20 min), so use the common divisor.
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  let step = 0;
  for (let i = 1; i < valid.length; i++) step = gcd(step, Math.abs(valid[i] - valid[i - 1]));
  step = step || 5 * 60e3;
  const t0 = valid.reduce((a, b) => Math.min(a, b));
  const n = Math.round((valid.reduce((a, b) => Math.max(a, b)) - t0) / step) + 1;
  // A few Swedish files repeat timestamps with different values: average them.
  const rows = d.dens.map((values) => {
    const row = new Float32Array(n).fill(NaN);
    const count = new Uint8Array(n);
    values.forEach((v, i) => {
      if (v === null || !Number.isFinite(t[i])) return;
      const k = Math.round((t[i] - t0) / step);
      row[k] = count[k] ? row[k] + v : v;
      count[k]++;
    });
    count.forEach((c, k) => {
      if (c > 1) row[k] /= c;
    });
    return row;
  });
  return { name: d.name, alt: d.alt, height: d.height, t0, step, n, rows };
}

// Plotly paints a heatmap as one image with a pixel per column, which breaks
// beyond the browser's canvas size; so average time bins down to MAX_COLUMNS.
const MAX_COLUMNS = 5000;

function aggregate(g, i0, i1, transform) {
  const k = Math.max(1, Math.ceil((i1 - i0) / MAX_COLUMNS));
  const hideZero = ui.hideZero.checked;
  const x = [];
  const z = g.rows.map(() => []);
  for (let start = i0; start < i1; start += k) {
    const end = Math.min(start + k, i1);
    x.push(g.t0 + ((start + end - 1) / 2) * g.step);
    g.rows.forEach((row, j) => {
      let sum = 0;
      let count = 0;
      for (let i = start; i < end; i++) {
        const v = row[i];
        if (Number.isNaN(v) || (hideZero && v === 0)) continue;
        sum += v;
        count++;
      }
      z[j].push(count ? transform(sum / count) : null);
    });
  }
  return { x, z, binMs: k * g.step };
}

function formatDuration(ms) {
  const min = Math.round(ms / 60e3);
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) return `${+(min / 60).toFixed(1)} h`;
  return `${+(min / 1440).toFixed(1)} d`;
}

const toMs = (v) => (typeof v === "number" ? v : Date.parse(`${String(v).replace(" ", "T")}Z`));
let viewRange = null; // [ms, ms] currently shown, or null for the full period

function draw() {
  const g = current.data;
  const meta = radars.get(g.name) || {};
  const log = ui.logScale.checked;
  const from = Math.max(0, Number(ui.rangeFrom.value) || 0);
  const to = Math.max(from, Number(ui.rangeTo.value) || 0);
  const transform = log ? (v) => (v > 0 ? Math.log10(v) : null) : (v) => v;
  const narrow = ui.plot.clientWidth < 600;

  const coloraxis = {
    colorscale: "Viridis",
    cmin: from,
    cmax: to,
    colorbar: { title: { text: "Bird density<br>[bird/km³]" }, outlinewidth: 0, thickness: narrow ? 10 : 24 },
  };
  if (log) {
    coloraxis.cmin = Math.log10(Math.max(from, 0.1));
    coloraxis.cmax = Math.log10(Math.max(to, 1));
    const exps = [];
    for (let e = Math.ceil(coloraxis.cmin); e <= Math.floor(coloraxis.cmax); e++) exps.push(e);
    coloraxis.colorbar.tickvals = exps;
    coloraxis.colorbar.ticktext = exps.map((e) => String(10 ** e));
  }
  const hovertemplate = log
    ? "%{x}<br>%{y} m<br>log₁₀ density: %{z:.2f}<extra></extra>"
    : "%{x}<br>%{y} m<br>%{z:.1f} bird/km³<extra></extra>";
  const heatmap = (agg, extra) => ({
    type: "heatmap",
    x: agg.x,
    y: g.alt,
    z: agg.z,
    coloraxis: "coloraxis",
    hoverongaps: false,
    hovertemplate,
    showlegend: false,
    ...extra,
  });

  // A coarse overview of the whole period (also drawn in the range slider),
  // plus a finer layer for the zoomed-in window and a margin around it.
  const overview = aggregate(g, 0, g.n, transform);
  const traces = [];
  let resolution = overview.binMs;
  if (viewRange) {
    const span = viewRange[1] - viewRange[0];
    const i0 = Math.max(0, Math.floor((viewRange[0] - span / 2 - g.t0) / g.step));
    const i1 = Math.min(g.n, Math.ceil((viewRange[1] + span / 2 - g.t0) / g.step) + 1);
    const detail = aggregate(g, i0, i1, transform);
    resolution = detail.binMs;
    traces.push(heatmap(overview, { hoverinfo: "skip", hovertemplate: undefined }), heatmap(detail));
  } else {
    traces.push(heatmap(overview));
  }

  const ends = [g.t0, g.t0 + (g.n - 1) * g.step];
  const line = (y, name, dash) => ({
    type: "scatter",
    mode: "lines",
    x: ends,
    y: [y, y],
    name,
    line: { color: "#ffffff", width: 2, dash },
    hovertemplate: `${name}: %{y} m<extra></extra>`,
  });
  if (num(g.height) !== null) traces.push(line(g.height, "Radar elevation", "solid"));
  const scatterLim = num(meta.scatter_lim);
  if (scatterLim !== null) traces.push(line(scatterLim, "Lowest usable altitude", "dot"));

  const layout = {
    title: {
      text: `${g.name} · ${DATASETS[ui.dataset.value].label}<span style="font-size:12px;color:#949495"> · ${formatDuration(resolution)} bins</span>`,
      x: 0.01,
      font: { size: 16 },
    },
    uirevision: current.key, // keep zoom when only the display options change
    paper_bgcolor: "#151515",
    plot_bgcolor: "#202022",
    font: { color: "#d0d0d2", family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
    margin: { t: 56, r: 24, b: 24, l: 64 },
    coloraxis,
    showlegend: !narrow,
    legend: { orientation: "h", x: 1, xanchor: "right", y: 1.06, bgcolor: "rgba(0,0,0,0)" },
    xaxis: {
      type: "date",
      gridcolor: "#333336",
      rangeslider: { thickness: 0.08, bgcolor: "#202022" },
      rangeselector: {
        bgcolor: "#202022",
        activecolor: "#3b3b3f",
        buttons: [
          { step: "day", stepmode: "backward", count: 1, label: "1d" },
          { step: "day", stepmode: "backward", count: 7, label: "1w" },
          { step: "month", stepmode: "backward", count: 1, label: "1m" },
          { step: "all", label: "all" },
        ],
      },
    },
    yaxis: { title: { text: "Altitude [m a.s.l.]" }, fixedrange: true, gridcolor: "#333336" },
  };

  Plotly.react(ui.plot, traces, layout, {
    responsive: true,
    displaylogo: false,
    showSendToCloud: false,
    modeBarButtonsToRemove: ["select2d", "lasso2d"],
    toImageButtonOptions: { filename: `vp_${g.name}_${ui.dataset.value}` },
  }).then(() => {
    // Plotly only adds .on() to the element once it has been plotted.
    if (!ui.plot.dataset.bound) {
      ui.plot.on("plotly_relayout", onRelayout);
      ui.plot.dataset.bound = "true";
    }
  });
}

// Re-render at a finer resolution after zooming or panning.
let relayoutTimer;
function onRelayout() {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    const g = current?.data;
    const range = ui.plot.layout?.xaxis?.range;
    if (!g || !range) return;
    let next = [toMs(range[0]), toMs(range[1])];
    // Zoomed out far enough that the overview already has full detail.
    if ((next[1] - next[0]) / g.step >= g.n * 0.9) next = null;
    if (JSON.stringify(next) === JSON.stringify(viewRange)) return;
    viewRange = next;
    draw();
  }, 150);
}

/* Map picker */

function popupContent(r) {
  const dataset = ui.dataset.value;
  const rows = [["Radar elevation", `${r.height} m`]];
  const lim = num(r.scatter_lim);
  if (lim !== null) rows.push(["Lowest usable altitude", `${lim} m`]);
  if (num(r.maxrange) !== null) rows.push(["Scan radius", `${r.maxrange} km`]);
  const dt = num(r.dt);
  if (dt !== null && dt <= 60) rows.push(["Time resolution", `${dt} min`]);
  for (const [key, ds] of Object.entries(DATASETS)) {
    const days = num(r[ds.daysKey]);
    if (days !== null && isAvailable(key, r.name)) rows.push([`Data (${ds.label})`, `${days.toFixed(1)} days`]);
  }

  const el = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = r.name;
  const dl = document.createElement("dl");
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    dl.append(dt, dd);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Load ${r.name}`;
  button.disabled = !isAvailable(dataset, r.name);
  button.addEventListener("click", () => {
    ui.radar.value = r.name;
    ui.mapDialog.close();
    loadProfile();
  });
  el.append(title, dl, button);
  return el;
}

function openMap() {
  ui.mapDialog.showModal();
  if (!map) {
    map = L.map("map", { worldCopyJump: true });
    // Esri canvas tiles need no API key.
    const esri = "https://services.arcgisonline.com/arcgis/rest/services/Canvas";
    const attribution = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";
    L.tileLayer(`${esri}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, attribution }).addTo(map);
    L.tileLayer(`${esri}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16 }).addTo(map);
    markerLayer = L.featureGroup().addTo(map);
  }

  markerLayer.clearLayers();
  const dataset = ui.dataset.value;
  for (const r of radars.values()) {
    if (!isAvailable(dataset, r.name) || num(r.lat) === null) continue;
    const selected = r.name === ui.radar.value;
    L.circleMarker([r.lat, r.lon], {
      radius: selected ? 9 : 6,
      color: "#151515",
      weight: 1,
      fillColor: selected ? "#fde725" : "#35b779",
      fillOpacity: 0.95,
    })
      .bindTooltip(r.name)
      .bindPopup(() => popupContent(r))
      .addTo(markerLayer);
  }
  // The dialog must be laid out before Leaflet can measure the map container.
  requestAnimationFrame(() => {
    map.invalidateSize();
    map.fitBounds(markerLayer.getBounds(), { padding: [24, 24] });
  });
}

/* Wiring */

async function init() {
  setStatus("Loading radar list…");
  try {
    const [list, avail] = await Promise.all([
      fetchJson("./assets/radar_list.json"),
      fetchJson("./assets/available.json"),
    ]);
    radars = new Map(list.map((r) => [r.name, r]));
    available = avail;
  } catch (error) {
    setStatus(`Could not load the radar list: ${error.message}`, true);
    return;
  }

  const names = [...new Set(Object.values(available).flat())].sort();
  for (const name of names) ui.radar.add(new Option(name, name));

  const params = new URLSearchParams(location.search);
  if (DATASETS[params.get("data")]) ui.dataset.value = params.get("data");
  if (names.includes(params.get("radar"))) ui.radar.value = params.get("radar");
  refreshRadarOptions();
  loadProfile();
}

ui.dataset.addEventListener("change", () => {
  refreshRadarOptions();
  loadProfile();
});
ui.radar.addEventListener("change", loadProfile);
for (const input of [ui.hideZero, ui.logScale, ui.rangeFrom, ui.rangeTo]) {
  input.addEventListener("change", () => current && draw());
}
$("controls").addEventListener("submit", (event) => event.preventDefault());
$("open-map").addEventListener("click", openMap);
$("open-coverage").addEventListener("click", () => ui.coverageDialog.showModal());
for (const dialog of [ui.mapDialog, ui.coverageDialog]) {
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  // Close when clicking the backdrop.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

init();
