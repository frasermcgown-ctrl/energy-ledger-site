// Runs on a schedule (see the `config` export below). ALSI (Aggregated LNG
// Storage Inventory, run by Gas Infrastructure Europe) publishes EU-aggregate
// LNG terminal data once per gas day. This fetches the latest reported day and
// commits it to content/lng-data.json; lng.html reads that static file, so the
// API key never reaches the browser.
//
// ALSI fields (GIE API documentation, section 2.4): gasDayStart, status
// (E estimated / C confirmed / N no data), sendOut and dtrs in GWh/d, and
// inventory / dtmi as objects with `lng` (thousand m3 LNG) and `gwh`.

import { writeJsonIfChanged, fetchJson, isoDate, daysAgo } from "../lib/github.mjs";

const PATH = "content/lng-data.json";

const num = v => {
  const n = parseFloat(v && typeof v === "object" ? v.lng : v);
  return Number.isFinite(n) ? n : null;
};

function latestRow(rows) {
  return rows
    .filter(r => r.gasDayStart && r.status !== "N" && num(r.sendOut) !== null)
    .sort((a, b) => String(b.gasDayStart).localeCompare(String(a.gasDayStart)))[0] || null;
}

function toPayload(row) {
  const inventory = num(row.inventory);
  const maxInventory = num(row.dtmi);
  return {
    gasDay: row.gasDayStart,
    status: row.status,
    lngInventoryThousandM3: inventory,
    sendOutGWhPerDay: num(row.sendOut),
    maxInventoryThousandM3: maxInventory,
    maxSendOutGWhPerDay: num(row.dtrs),
    fillPercent: inventory !== null && maxInventory > 0 ? Math.round((inventory / maxInventory) * 1000) / 10 : null,
  };
}

export default async () => {
  const key = process.env.GIE_API_KEY;
  if (!key) {
    console.error("GIE_API_KEY not set — skipping this run.");
    return new Response("No API key", { status: 500 });
  }
  try {
    // Last 7 days of EU-aggregate data, so a late or missing day doesn't blank the page.
    const url = `https://alsi.gie.eu/api/data/eu?from=${isoDate(daysAgo(7))}&till=${isoDate(new Date())}`;
    const json = await fetchJson(url, { headers: { "x-key": key } });
    const row = latestRow(json.data || []);
    if (!row) {
      console.error("ALSI returned no usable rows.");
      return new Response("No data", { status: 500 });
    }
    const payload = toPayload(row);
    console.log(`ALSI gas day ${payload.gasDay} (${payload.status}): send-out ${payload.sendOutGWhPerDay} GWh/d, inventory ${payload.lngInventoryThousandM3} k m3, fill ${payload.fillPercent}%`);
    await writeJsonIfChanged(PATH, payload, "Automated LNG data update");
    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("fetch-lng error:", err.message);
    return new Response("Error", { status: 500 });
  }
};

// ALSI publishes once a gas day; checking four times a day picks it up promptly.
// Minutes are staggered across functions so their GitHub commits don't collide.
export const config = {
  schedule: "42 */6 * * *",
};
