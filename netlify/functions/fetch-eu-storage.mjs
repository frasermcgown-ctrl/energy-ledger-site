// Runs on a schedule (see the `config` export below). AGSI+ (Aggregated Gas
// Storage Inventory, run by Gas Infrastructure Europe) publishes EU-aggregate
// gas storage once per gas day. This fetches the latest reported day and
// commits it to content/eu-storage.json, which the market strip on every page
// reads, so the API key never reaches the browser.
//
// AGSI+ fields (GIE API documentation): gasDayStartedOn, status (E estimated /
// C confirmed / N no data), gasInStorage in TWh, full as % of working gas
// volume, trend in percentage points per day, injection and withdrawal in GWh/d.
// Uses the same GIE_API_KEY as fetch-lng.mjs. The UK is not in AGSI+ (see
// fetch-uk-storage.mjs), so this is the EU aggregate only.

import { writeJsonIfChanged, fetchJson, isoDate, daysAgo } from "../lib/github.mjs";

const PATH = "content/eu-storage.json";

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export function latestRow(rows) {
  return (rows || [])
    .filter(r => r.gasDayStartedOn && r.status !== "N" && num(r.full) !== null)
    .sort((a, b) => String(b.gasDayStartedOn).localeCompare(String(a.gasDayStartedOn)))[0] || null;
}

export function toPayload(row) {
  return {
    gasDay: row.gasDayStartedOn,
    status: row.status,
    fullPercent: num(row.full),
    gasInStorageTWh: num(row.gasInStorage),
    trendPercentPerDay: num(row.trend),
    injectionGWhPerDay: num(row.injection),
    withdrawalGWhPerDay: num(row.withdrawal),
    workingGasVolumeTWh: num(row.workingGasVolume),
  };
}

export default async () => {
  const key = process.env.GIE_API_KEY;
  if (!key) {
    console.error("GIE_API_KEY not set — skipping this run.");
    return new Response("No API key", { status: 500 });
  }
  try {
    // Last 7 days of EU-aggregate data, so a late or missing day doesn't blank the strip.
    const url = `https://agsi.gie.eu/api?type=eu&from=${isoDate(daysAgo(7))}&to=${isoDate(new Date())}&page=1&size=30`;
    const json = await fetchJson(url, { headers: { "x-key": key } });
    const row = latestRow(json.data);
    if (!row) {
      console.error("AGSI returned no usable rows.");
      return new Response("No data", { status: 500 });
    }
    const payload = toPayload(row);
    console.log(`AGSI gas day ${payload.gasDay} (${payload.status}): EU storage ${payload.fullPercent}% full, ${payload.gasInStorageTWh} TWh`);
    await writeJsonIfChanged(PATH, payload, "Automated EU gas storage update");
    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("fetch-eu-storage error:", err.message);
    return new Response("Error", { status: 500 });
  }
};

// AGSI+ publishes once a gas day; checking four times a day picks it up promptly.
// Minutes are staggered across functions so their GitHub commits don't collide.
export const config = {
  schedule: "47 */6 * * *",
};
