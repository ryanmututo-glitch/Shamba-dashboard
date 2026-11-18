// Shamba Monitor - Group 4D dashboard (fake-data version)
// To go live later, change DATA_URL (see section "Swapping in real data").
// Supabase configuration
const SUPABASE_URL =
  "https://mcdyegejqezsdelwuofv.supabase.co";

const SUPABASE_KEY =
  "YOUR_SUPABASE_PUBLISHABLE_KEY";

const DEVICE_ID = "node-01";

// Refresh every 15 seconds
const REFRESH_INTERVAL = 15000;

const OFFLINE_AFTER_MIN = 30;

// PLACEHOLDER thresholds. Replace after soil calibration in the lab (Lab 6).
const SOIL_DRY_BELOW = 25;
const SOIL_WET_ABOVE = 55;

const TEXT = {
  en: { soil: "Soil moisture", rain24: "Rain, last 24 hours", temp: "Temperature now",
        logTitle: "Farm log", dry: "Dry", good: "Good", wet: "Wet",
        rain7: "Last 7 days:", humidity: "Humidity", updated: "Last updated",
        offline: "No data from the node for", mins: "minutes. Check the node.",
        shallow: "Shallow (10 cm)", deep: "Deep (30 cm)", noData: "No data" },
  sw: { soil: "Unyevu wa udongo", rain24: "Mvua, saa 24 zilizopita", temp: "Joto sasa",
        logTitle: "Daftari la shamba", dry: "Kavu", good: "Nzuri", wet: "Unyevu mwingi",
        rain7: "Siku 7 zilizopita:", humidity: "Unyevu hewani", updated: "Imesasishwa",
        offline: "Hakuna data kutoka kwa kifaa kwa", mins: "dakika. Kagua kifaa.",
        shallow: "Juu (sm 10)", deep: "Chini (sm 30)", noData: "Hakuna data" },
};

let readings = [];
let lang = "en";
let liveTimer = null;

// ---------- helpers (pure functions) ----------
const last = (a) => a[a.length - 1];
const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "-" : Number(v).toFixed(d));
const toDate = (r) => new Date(r.ts_utc);

// Display times in East Africa Time (UTC+3). Data stays in UTC.
const eat = (d) => new Date(d.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + " EAT";

function rainSum(rows, hours, nowMs) {
  const from = nowMs - hours * 3600 * 1000;
  return rows.filter((r) => toDate(r).getTime() > from)
             .reduce((s, r) => s + (r.rain_mm_10min || 0), 0);
}

function soilStatus(pct) {
  if (pct === null || pct === undefined) return "none";
  if (pct < SOIL_DRY_BELOW) return "dry";
  if (pct > SOIL_WET_ABOVE) return "wet";
  return "good";
}

function minutesSince(row, nowMs) {
  return Math.round((nowMs - toDate(row).getTime()) / 60000);
}

// ---------- farmer view ----------
function renderFarmer() {
  const t = TEXT[lang];
  if (!readings.length) return;
  const latest = last(readings);
  const nowMs = Date.now();
  const status = soilStatus(latest.soil_moist_10cm_pct);
  const card = document.getElementById("card-soil");
  card.className = "card big " + status;
  document.getElementById("soil-word").textContent = status === "none" ? t.noData : t[status];
  document.getElementById("soil-detail").textContent =
  `Moisture level: ${fmt(latest.soil_moist_10cm_pct)}%`;
  document.getElementById("rain24").textContent = fmt(rainSum(readings, 24, nowMs)) + " mm";
  document.getElementById("rain7").textContent = `${t.rain7} ${fmt(rainSum(readings, 168, nowMs))} mm`;
  document.getElementById("temp-now").textContent = fmt(latest.air_temp_c) + " °C";
  document.getElementById("hum-now").textContent = `${t.humidity}: ${fmt(latest.humidity_pct, 0)}%`;
  document.getElementById("updated").textContent = `${t.updated}: ${eat(toDate(latest))}`;
  const mins = minutesSince(latest, nowMs);
  const banner = document.getElementById("offline-banner");
  if (mins > OFFLINE_AFTER_MIN) {
    banner.hidden = false;
    banner.textContent = `${t.offline} ${mins} ${t.mins}`;
  } else {
    banner.hidden = true;
  }
}

// ---------- charts: small hand-made SVG line charts, no libraries ----------
function lineChart(containerId, rows, key, opts = {}) {
  const W = 480, H = 200, L = 40, R = 10, T = 10, B = 24;
  const pts = rows.map((r) => ({ x: toDate(r).getTime(), y: r[key] }));
  const vals = pts.map((p) => p.y).filter((v) => v !== null && v !== undefined);
  const el = document.getElementById(containerId);
  if (!vals.length) { el.textContent = TEXT[lang].noData; return; }

  let ymin = Math.min(...vals), ymax = Math.max(...vals);
  if (opts.zero) ymin = 0;
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  const pad = (ymax - ymin) * 0.08;
  if (!opts.zero) ymin -= pad;
  ymax += pad;
  const xmin = pts[0].x, xmax = last(pts).x || xmin + 1;
  const sx = (x) => L + ((x - xmin) / (xmax - xmin || 1)) * (W - L - R);
  const sy = (y) => T + (1 - (y - ymin) / (ymax - ymin)) * (H - T - B);

  let path = "", pen = false;
  const gapMs = 25 * 60 * 1000; // a hole longer than this breaks the line
  let prevX = null;
  for (const p of pts) {
    if (p.y === null || p.y === undefined || (prevX !== null && p.x - prevX > gapMs)) pen = false;
    if (p.y !== null && p.y !== undefined) {
      path += (pen ? "L" : "M") + sx(p.x).toFixed(1) + " " + sy(p.y).toFixed(1) + " ";
      pen = true;
    }
    prevX = p.x;
  }

  const ticks = [0, 0.5, 1].map((f) => ymin + f * (ymax - ymin));
  const grid = ticks.map((v) =>
    `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="#e5e2d8"/>` +
    `<text x="${L - 4}" y="${sy(v) + 4}" text-anchor="end">${v.toFixed(opts.dec ?? 1)}</text>`).join("");
  const days = Math.max(1, Math.round((xmax - xmin) / 86400000));
  const xlab = `<text x="${L}" y="${H - 6}">${eat(new Date(xmin)).slice(5, 10)}</text>` +
    `<text x="${W - R}" y="${H - 6}" text-anchor="end">${eat(new Date(xmax)).slice(5, 10)} (${days}d)</text>`;

  const color = opts.color || "#2f6b4f";
  const shape = opts.bars
    ? pts.filter((p) => p.y).map((p) =>
        `<rect x="${sx(p.x) - 1}" y="${sy(p.y)}" width="2" height="${sy(ymin) - sy(p.y)}" fill="${color}"/>`).join("")
    : `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.8"/>`;

  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid}${shape}${xlab}</svg>`;
}

function rowsInRange(days) {
  const from = Date.now() - days * 86400000;
  return readings.filter((r) => toDate(r).getTime() >= from);
}

function renderResearcher() {
  const rows = rowsInRange(Number(document.getElementById("range").value));
  lineChart("chart-soil", rows, "soil_moist_10cm_pct", { color: "#1f5f99" });
  lineChart("chart-rain", rows, "rain_mm_10min", { color: "#1f5f99", bars: true, zero: true, dec: 1 });
  lineChart("chart-temp", rows, "air_temp_c", { color: "#b4531f" });
  lineChart("chart-rssi", rows, "rssi_dbm", { color: "#66726b", dec: 0 });
  renderHealth();
}

function renderHealth() {
  if (!readings.length) return;
  const latest = last(readings);
  const nowMs = Date.now();
  const mins = minutesSince(latest, nowMs);

  // Missed readings: gaps in the sequence number inside the last 7 days
  let missed = 0;
  for (let i = 1; i < readings.length; i++) missed += Math.max(0, readings[i].seq - readings[i - 1].seq - 1);
  const monitoredFields = [
  "air_temp_c",
  "humidity_pct",
  "soil_moist_10cm_pct",
  "rain_mm_10min",
  "rssi_dbm"
];

const nulls = readings.reduce(
  (total, reading) =>
    total + monitoredFields.filter(
      field => reading[field] == null
    ).length,
  0
);

  const rows = [
    ["Device", latest.device_id],
    ["Status", mins > OFFLINE_AFTER_MIN ? `OFFLINE (${mins} min since last reading)` : "Online"],
    ["Last reading", eat(toDate(latest))],
    ["Signal", fmt(latest.rssi_dbm, 0) + " dBm"],
    ["Firmware", latest.fw],
    ["Readings loaded", readings.length],
    ["Missed readings (sequence gaps)", missed],
    ["Missing values (null)", nulls],
  ];
  document.getElementById("health").innerHTML =
    rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
}

// ---------- CSV export ----------
function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v) => (v === null || v === undefined ? "" : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

function downloadCsv() {
  const rows = rowsInRange(Number(document.getElementById("range").value));
  const blob = new Blob([toCsv(rows)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "readings.csv";
  a.click();
}

// ---------- simulate live data ----------
function addFakeReading() {
  const p = last(readings);
  const jitter = (v, s) => (v === null ? null : Math.round((v + (Math.random() - 0.5) * s) * 10) / 10);
  readings.push({
    ...p, seq: p.seq + 1,
    ts_utc: new Date().toISOString().slice(0, 19) + "Z",
    air_temp_c: jitter(p.air_temp_c, 0.6),
    soil_moist_10cm_pct: jitter(p.soil_moist_10cm_pct, 1.2),
    rain_mm_10min: Math.random() < 0.15 ? 0.2 : 0,
  });
  renderFarmer();
  if (!document.getElementById("view-researcher").hidden) renderResearcher();
}

function toggleLive() {
  const btn = document.getElementById("live");
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; btn.textContent = "Simulate live data"; return; }
  liveTimer = setInterval(addFakeReading, 3000);
  btn.textContent = "Stop live data";
}

// ---------- farm log (saved in this browser only) ----------
const LOG_KEY = "shamba-log";

function loadLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (e) { return memoryLog; }
}

let memoryLog = [];

function saveLog(list) {
  memoryLog = list;
  try { localStorage.setItem(LOG_KEY, JSON.stringify(list)); } catch (e) { /* storage blocked */ }
}

function renderLog() {
  const list = loadLog();
  const ul = document.getElementById("log-list");
  ul.innerHTML = "";
  list.slice().reverse().forEach((e) => {
    const li = document.createElement("li");
    li.textContent = `${e.date} - ${e.crop}: ${e.action}${e.notes ? " (" + e.notes + ")" : ""}`;
    ul.appendChild(li);
  });
}

function onLogSubmit(ev) {
  ev.preventDefault();
  const entry = {
    date: document.getElementById("log-date").value,
    crop: document.getElementById("log-crop").value,
    action: document.getElementById("log-action").value,
    notes: document.getElementById("log-notes").value.trim(),
  };
  saveLog([...loadLog(), entry]);
  document.getElementById("log-notes").value = "";
  renderLog();
}

// ---------- tabs and language ----------
function show(view) {
  const farmer = view === "farmer";
  document.getElementById("view-farmer").hidden = !farmer;
  document.getElementById("view-researcher").hidden = farmer;
  document.getElementById("tab-farmer").classList.toggle("active", farmer);
  document.getElementById("tab-researcher").classList.toggle("active", !farmer);
  if (!farmer) renderResearcher();
}

function applyLang() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = TEXT[lang][el.dataset.i18n]; });
  document.getElementById("lang").textContent = lang === "en" ? "Kiswahili" : "English";
  renderFarmer();
}

// ---------- Supabase data fetching ----------
async function fetchSupabaseReadings() {
  const url =
    `${SUPABASE_URL}/rest/v1/readings` +
    `?select=*` +
    `&device_id=eq.${encodeURIComponent(DEVICE_ID)}` +
    `&order=ts_utc.desc.nullslast` +
    `&limit=1000`;

  const response = await fetch(url, {
    headers: {
      "apikey":"sb_publishable_x8P8D39H5k22GmEU9-KqtA_b9YpH55r",
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Supabase error ${response.status}: ${error}`
    );
  }

  const data = await response.json();

  // Ignore records with missing or invalid timestamps
  const validData = data.filter(
    r => r.ts_utc &&
      !Number.isNaN(new Date(r.ts_utc).getTime())
  );

  // Your existing charts expect oldest -> newest
  readings = validData.reverse();

  console.log(
    `Loaded ${readings.length} readings from Supabase`
  );

  renderFarmer();

  if (!document.getElementById("view-researcher").hidden) {
    renderResearcher();
  }

  if (!readings.length) {
    document.getElementById("updated").textContent =
      "No timestamped sensor readings available.";
  }
}

// ---------- start ----------
async function init() {

  document.getElementById("tab-farmer").onclick =
    () => show("farmer");

  document.getElementById("tab-researcher").onclick =
    () => show("researcher");

  document.getElementById("lang").onclick = () => {
    lang = lang === "en" ? "sw" : "en";
    applyLang();
  };

  document.getElementById("range").onchange =
    renderResearcher;

  document.getElementById("export").onclick =
    downloadCsv;

  document.getElementById("live").onclick =
    toggleLive;

  document.getElementById("log-form").onsubmit =
    onLogSubmit;

  document.getElementById("log-date").value =
    new Date().toISOString().slice(0, 10);

  // Load real data from Supabase
  async function refreshData() {
    try {
      await fetchSupabaseReadings();
    } catch (error) {
      console.error("Failed to load data:", error);

      document.getElementById("updated").textContent =
        "Error loading Supabase data. Check console.";
    }
  }

  await refreshData();

  // Poll Supabase automatically
  setInterval(refreshData, REFRESH_INTERVAL);

  applyLang();
  renderLog();
}

if (typeof document !== "undefined" && document.getElementById("view-farmer")) init();
if (typeof module !== "undefined") module.exports = { soilStatus, rainSum, toCsv, minutesSince };