// Runs on a schedule (see the `config` export below). AGSI (Aggregated Gas
// Storage Inventory, run by Gas Infrastructure Europe) publishes how much gas
// is held in each country's underground storage once per gas day. This fetches
// the United Kingdom (country code GB, listed by GIE as "Non-EU – United
// Kingdom" from 2020-12-31) and commits the latest day plus about a year of
// history to content/uk-storage-levels.json. uk-gas-storage.html reads that
// file, so the API key never reaches the browser. Uses the same GIE_API_KEY as
// fetch-lng.mjs.
//
// AGSI fields per gas day (GIE API documentation v013): gasDayStart, status
// (E estimated / C confirmed / N no data), gasInStorage and workingGasVolume
// in TWh, full in %, trend in % change on the day, injection and withdrawal
// in GWh/d. Values arrive as strings.

import { writeJsonIfChanged, fetchJson, isoDate, daysAgo } from "../lib/github.mjs";

const PATH = "content/uk-storage-levels.json";
const PAGE_SIZE = 300;
const MAX_PAGES = 3;      // ~400 days of history needs two pages
const HISTORY_DAYS = 400;

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, dp) => (v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

async function fetchRows(key) {
  const rows = [];
  const from = isoDate(daysAgo(HISTORY_DAYS));
  const to = isoDate(new Date());
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://agsi.gie.eu/api?country=GB&from=${from}&to=${to}&size=${PAGE_SIZE}&page=${page}`;
    const json = await fetchJson(url, { headers: { "x-key": key } });
    rows.push(...(json.data || []));
    if (!json.last_page || page >= Number(json.last_page)) break;
  }
  return rows;
}

function toPayload(rows) {
  const usable = rows
    .filter(r => r.gasDayStart && r.status !== "N" && num(r.gasInStorage) !== null)
    .sort((a, b) => String(a.gasDayStart).localeCompare(String(b.gasDayStart)));
  if (!usable.length) return null;
  const last = usable[usable.length - 1];
  return {
    country: "GB",
    gasDay: last.gasDayStart,
    status: last.status,
    gasInStorageTWh: round(num(last.gasInStorage), 3),
    workingGasVolumeTWh: round(num(last.workingGasVolume), 3),
    fullPercent: round(num(last.full), 2),
    trendPercent: round(num(last.trend), 2),
    injectionGWhPerDay: round(num(last.injection), 1),
    withdrawalGWhPerDay: round(num(last.withdrawal), 1),
    // Oldest first: d = gas day, twh = gas in storage, full = % of working gas volume.
    history: usable.map(r => ({ d: r.gasDayStart, twh: round(num(r.gasInStorage), 3), full: round(num(r.full), 2) })),
    source: "Gas Infrastructure Europe AGSI (country GB)",
  };
}

export default async () => {
  const key = process.env.GIE_API_KEY;
  if (!key) {
    console.error("GIE_API_KEY not set — skipping this run.");
    return new Response("No API key", { status: 500 });
  }
  try {
    const payload = toPayload(await fetchRows(key));
    if (!payload) {
      console.error("AGSI returned no usable GB rows.");
      return new Response("No data", { status: 500 });
    }
    console.log(`AGSI GB gas day ${payload.gasDay} (${payload.status}): ${payload.gasInStorageTWh} TWh, ${payload.fullPercent}% full, ${payload.history.length} days of history`);
    await writeJsonIfChanged(PATH, payload, "Automated UK gas storage levels update");
    return new Response(JSON.stringify({ ...payload, history: payload.history.length }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("fetch-uk-storage error:", err.message);
    return new Response("Error", { status: 500 });
  }
};

// AGSI publishes at 19:30 and 23:00 CET (18:30 and 22:00 UTC in winter,
// 17:30 and 21:00 in summer). Running at 19:53 and 23:53 UTC catches both
// publications all year. Minute 53 is not used by any other function.
export const config = {
  schedule: "53 19,23 * * *",
};
