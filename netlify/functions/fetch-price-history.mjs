// Runs on a schedule (see the `config` export below). Keeps a daily price
// history in content/price-history.json for the Prices page charts:
//
//   - gas:   National Gas System Average Price (SAP), p/therm per gas day.
//            Fetched in one request (National Gas keeps 5 years of history).
//   - power: Elexon APX market index, volume-weighted daily average in £/MWh.
//            Elexon allows at most 7 days per request, so the history is
//            backfilled a few weeks per run until it covers HISTORY_DAYS.
//
// Same sources and method as fetch-prices.mjs, which drives the homepage snapshot.

import { readJson, writeJsonIfChanged, fetchJson, isoDate, daysAgo } from "../lib/github.mjs";

const PATH = "content/price-history.json";
const HISTORY_DAYS = 400;
const KWH_PER_THERM = 29.3071;
const NG_API = "https://api.nationalgas.com/operationaldata/v1/publications";
const ELEXON_MID = "https://data.elexon.co.uk/bmrs/api/v1/datasets/MID";
const POWER_CHUNKS_PER_RUN = 12; // 12 windows per run
// Each window covers 5 settlement days, but is requested with a day either side
// (7 days in all, Elexon's limit). Elexon's `to` is midnight at the start of
// that date, and UK settlement days start at local midnight, so without the
// padding the edge days come back incomplete and get dropped.
const WINDOW_DAYS = 5;

function catalogueEntries(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach(n => catalogueEntries(n, out));
  } else if (node && typeof node === "object") {
    if (node.publicationId && node.name) out.push({ id: node.publicationId, name: node.name });
    Object.values(node).forEach(v => { if (v && typeof v === "object") catalogueEntries(v, out); });
  }
  return out;
}

function findSapItem(entries) {
  const excluded = /forecast|7.?day|average of|rolling|marginal|smp/i;
  return entries
    .filter(e => /system average price|^sap\b/i.test(e.name) && !excluded.test(e.name))
    .sort((a, b) => Number(/actual/i.test(b.name)) - Number(/actual/i.test(a.name)))[0] || null;
}

async function fetchGasHistory() {
  const sap = findSapItem(catalogueEntries(await fetchJson(`${NG_API}/catalogue`)));
  if (!sap) throw new Error("SAP data item not found in catalogue");
  const data = await fetchJson(`${NG_API}/gasday`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromDate: isoDate(daysAgo(HISTORY_DAYS)),
      toDate: isoDate(new Date()),
      publicationIds: [sap.id],
      latestValue: "Y",
    }),
  });
  const rows = ((Array.isArray(data) ? data : [data])[0] || {}).publications || [];
  const byDay = {};
  rows.forEach(r => {
    const v = parseFloat(r.value);
    if (r.applicableFor && Number.isFinite(v) && v > 0) byDay[r.applicableFor] = Math.round(v * KWH_PER_THERM * 100) / 100;
  });
  return Object.keys(byDay).sort().map(d => ({ d, v: byDay[d] }));
}

// Volume-weighted daily averages for complete settlement days in [from, to].
async function fetchPowerRange(from, to) {
  const qFrom = isoDate(daysAgo(1, new Date(from)));
  const qTo = isoDate(daysAgo(-1, new Date(to)));
  const json = await fetchJson(`${ELEXON_MID}?from=${qFrom}&to=${qTo}&dataProviders=APXMIDP&format=json`);
  const byDay = {};
  (Array.isArray(json) ? json : json.data || []).forEach(r => {
    if (r.dataProvider !== "APXMIDP" || !Number.isFinite(r.price) || !Number.isFinite(r.volume) || r.volume <= 0) return;
    const day = (byDay[r.settlementDate] = byDay[r.settlementDate] || { pv: 0, v: 0, n: 0 });
    day.pv += r.price * r.volume; day.v += r.volume; day.n += 1;
  });
  return Object.entries(byDay)
    .filter(([d, x]) => d >= from && d <= to && x.n >= 40)
    .map(([d, x]) => ({ d, v: Math.round((x.pv / x.v) * 100) / 100 }));
}

// Work out which windows are still missing, newest first, so the
// latest days always arrive before the older backfill.
function missingPowerWindows(existing) {
  const have = new Set(existing.map(p => p.d));
  const windows = [];
  let end = daysAgo(1);
  const oldest = daysAgo(HISTORY_DAYS);
  while (end >= oldest) {
    const start = daysAgo(WINDOW_DAYS - 1, end) < oldest ? oldest : daysAgo(WINDOW_DAYS - 1, end);
    let gap = false;
    for (let d = new Date(start); d <= end; d = daysAgo(-1, d)) if (!have.has(isoDate(d))) { gap = true; break; }
    if (gap) windows.push([isoDate(start), isoDate(end)]);
    end = daysAgo(1, start);
  }
  return windows;
}

async function fetchPowerHistory(existing) {
  const windows = missingPowerWindows(existing).slice(0, POWER_CHUNKS_PER_RUN);
  const merged = Object.fromEntries(existing.map(p => [p.d, p.v]));
  const results = await Promise.allSettled(windows.map(([f, t]) => fetchPowerRange(f, t)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") r.value.forEach(p => { merged[p.d] = p.v; });
    else console.log(`MID window ${windows[i].join("..")} failed: ${r.reason.message}`);
  });
  const cutoff = isoDate(daysAgo(HISTORY_DAYS));
  console.log(`Power: fetched ${windows.length} window(s); ${missingPowerWindows(Object.keys(merged).map(d => ({ d }))).length} still to backfill.`);
  return Object.keys(merged).filter(d => d >= cutoff).sort().map(d => ({ d, v: merged[d] }));
}

export default async () => {
  const { data: existing } = await readJson(PATH);
  const [gas, power] = await Promise.all([
    fetchGasHistory().catch(err => { console.error(`SAP history failed: ${err.message}`); return null; }),
    fetchPowerHistory((existing && existing.power) || []).catch(err => { console.error(`MID history failed: ${err.message}`); return null; }),
  ]);

  const payload = {
    gas: gas && gas.length ? gas : (existing && existing.gas) || [],
    power: power && power.length ? power : (existing && existing.power) || [],
    units: { gas: "p/therm", power: "£/MWh" },
    sources: { gas: "National Gas Transmission (SAP)", power: "Elexon (APX market index)" },
  };
  console.log(`Gas: ${payload.gas.length} days. Power: ${payload.power.length} days.`);
  if (payload.gas.length || payload.power.length) await writeJsonIfChanged(PATH, payload, "Automated price history update");

  return new Response(JSON.stringify({ gas: payload.gas.length, power: payload.power.length }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  schedule: "14 * * * *",
};
