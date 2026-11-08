// Runs on a schedule (see the `config` export below). AGSI (Aggregated Gas
// Storage Inventory, run by Gas Infrastructure Europe) publishes how much gas
// is held in each country's underground storage once per gas day. This fetches
// the United Kingdom (listed by GIE as "Non-EU – United Kingdom" from
// 2020-12-31; see ATTEMPTS below for how it is requested) and commits the
// latest day plus about a year of history to content/uk-storage-levels.json. uk-gas-storage.html reads that
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

// GIE splits the UK into a pre-Brexit series (EU, until 2020-12-30) and a
// post-Brexit one (Non-EU, from 2020-12-31), but the documentation doesn't say
// which query returns which. Try the likely requests in order and use the first
// that returns recent usable rows. Each attempt is logged so a failed run shows
// what GIE actually sent back.
const ATTEMPTS = [
  { label: "type=ne&country=gb", query: "type=ne&country=gb" },
  { label: "country=gb", query: "country=gb" },
  { label: "country=GB", query: "country=GB" },
  { label: "type=ne (UK child)", query: "type=ne", child: true },
];

const isUk = o => o && /^gb\*?$/i.test(String(o.code || o.url || "")) || /united kingdom/i.test(String(o && o.name || ""));
const usable = r => r && r.gasDayStart && r.status !== "N" && num(r.gasInStorage) !== null;

// In an aggregate (type=ne) response each day's row lists its countries under
// `children`; pull out the UK entry and keep the day.
function ukFromChildren(row) {
  const stack = [...(row.children || [])];
  while (stack.length) {
    const c = stack.shift();
    if (isUk(c)) return { ...c, gasDayStart: c.gasDayStart || row.gasDayStart };
    if (Array.isArray(c.children)) stack.push(...c.children);
  }
  return null;
}

async function fetchAttempt(key, attempt) {
  const rows = [];
  const from = isoDate(daysAgo(HISTORY_DAYS));
  const to = isoDate(new Date());
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://agsi.gie.eu/api?${attempt.query}&from=${from}&to=${to}&size=${PAGE_SIZE}&page=${page}`;
    const json = await fetchJson(url, { headers: { "x-key": key } });
    const data = Array.isArray(json.data) ? json.data : [];
    if (page === 1) {
      const first = data[0] || {};
      console.log(`AGSI ${attempt.label}: ${data.length} rows on page 1, last_page ${json.last_page}, dataset ${JSON.stringify(json.dataset)}; ` +
        `first row ${JSON.stringify({ name: first.name, code: first.code, gasDayStart: first.gasDayStart, status: first.status, gasInStorage: first.gasInStorage, full: first.full, children: Array.isArray(first.children) ? first.children.length : undefined })}` +
        (json.message || json.error ? `; message ${JSON.stringify(json.message || json.error)}` : ""));
    }
    rows.push(...(attempt.child ? data.map(ukFromChildren).filter(Boolean) : data));
    if (!json.last_page || page >= Number(json.last_page)) break;
  }
  return rows;
}

async function fetchRows(key) {
  const recent = isoDate(daysAgo(10));
  for (const attempt of ATTEMPTS) {
    try {
      const rows = await fetchAttempt(key, attempt);
      const good = rows.filter(usable);
      if (good.some(r => String(r.gasDayStart) >= recent)) {
        console.log(`Using AGSI ${attempt.label}: ${good.length} usable rows.`);
        return { rows, used: attempt.label };
      }
      console.log(`AGSI ${attempt.label}: ${good.length} usable rows, none in the last 10 days.`);
    } catch (err) {
      console.log(`AGSI ${attempt.label} failed: ${err.message}`);
    }
  }
  return { rows: [], used: null };
}

function toPayload(rows, used) {
  const good = rows
    .filter(usable)
    .sort((a, b) => String(a.gasDayStart).localeCompare(String(b.gasDayStart)));
  if (!good.length) return null;
  const last = good[good.length - 1];
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
    history: good.map(r => ({ d: r.gasDayStart, twh: round(num(r.gasInStorage), 3), full: round(num(r.full), 2) })),
    source: `Gas Infrastructure Europe AGSI, United Kingdom (${used})`,
  };
}

export default async () => {
  const key = process.env.GIE_API_KEY;
  if (!key) {
    console.error("GIE_API_KEY not set — skipping this run.");
    return new Response("No API key", { status: 500 });
  }
  try {
    const { rows, used } = await fetchRows(key);
    const payload = toPayload(rows, used);
    if (!payload) {
      console.error("AGSI returned no recent usable UK rows from any query (see lines above).");
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
