// Runs on a schedule (see the `config` export below). National Gas publishes
// UK storage stock levels once a day (around 16:00, for the previous gas day),
// in GWh, aggregated by storage type (short, medium and long range; in
// practice only medium-range sites hold gas today). This fetches about a
// year of those daily stocks and commits them to content/uk-storage-levels.json,
// which uk-gas-storage.html reads.
//
// Same public API and method as fetch-price-history.mjs: find the data items in
// the National Gas publications catalogue by name, then request their gas-day
// values. No API key is needed.
//
// GIE AGSI was tried first, but it lists the UK with no data ("N") for every
// day since Brexit, so it can't be used for UK stocks.

import { writeJsonIfChanged, fetchJson, isoDate, daysAgo } from "../lib/github.mjs";

const PATH = "content/uk-storage-levels.json";
const HISTORY_DAYS = 400;
const NG_API = "https://api.nationalgas.com/operationaldata/v1/publications";

function catalogueEntries(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach(n => catalogueEntries(n, out));
  } else if (node && typeof node === "object") {
    if (node.publicationId && node.name) out.push({ id: node.publicationId, name: node.name });
    Object.values(node).forEach(v => { if (v && typeof v === "object") catalogueEntries(v, out); });
  }
  return out;
}

// Aggregate stock level items, one per storage range. Excludes forecasts,
// LNG stocks, monitors/safety levels and capacity items.
function findStockItems(entries) {
  const seen = new Set();
  return entries.filter(e => {
    const n = e.name;
    const ok = /stock/i.test(n) && /storage/i.test(n) && /\b(short|medium|long)\b/i.test(n) &&
      !/lng|forecast|monitor|safety|capacity|deliverability|space|injectab|withdraw|%|percent/i.test(n);
    if (!ok || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

const rangeOf = name => (name.match(/\b(short|medium|long)\b/i) || [])[1].toLowerCase();

async function fetchItemHistory(ids) {
  const data = await fetchJson(`${NG_API}/gasday`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromDate: isoDate(daysAgo(HISTORY_DAYS)),
      toDate: isoDate(new Date()),
      publicationIds: ids,
      latestValue: "Y",
    }),
  });
  return Array.isArray(data) ? data : [data];
}

export default async () => {
  try {
    const entries = catalogueEntries(await fetchJson(`${NG_API}/catalogue`));
    const items = findStockItems(entries);
    if (!items.length) {
      const hints = entries.filter(e => /stock/i.test(e.name)).slice(0, 40).map(e => `${e.id} ${e.name}`);
      console.error(`No storage stock items found in the National Gas catalogue (${entries.length} entries). Items mentioning 'stock': ${JSON.stringify(hints)}`);
      return new Response("No stock items", { status: 500 });
    }
    console.log(`Storage stock items: ${items.map(i => `${i.id} "${i.name}"`).join("; ")}`);

    const results = await fetchItemHistory(items.map(i => i.id));
    // day -> { short, medium, long } in GWh
    const byDay = {};
    results.forEach((res, idx) => {
      const item = items.find(i => i.id === res.publicationId || i.name === res.publicationObjectName) || items[idx];
      if (!item) return;
      const range = rangeOf(item.name);
      (res.publications || []).forEach(r => {
        const v = parseFloat(r.value);
        if (!r.applicableFor || !Number.isFinite(v) || v < 0) return;
        const day = (byDay[r.applicableFor] = byDay[r.applicableFor] || {});
        day[range] = Math.round(v);
      });
    });

    const days = Object.keys(byDay).sort();
    if (!days.length) {
      console.error(`Storage stock items returned no values: ${JSON.stringify(results.map(r => ({ id: r.publicationId, name: r.publicationObjectName, n: (r.publications || []).length })))}`);
      return new Response("No data", { status: 500 });
    }
    const total = d => Object.values(byDay[d]).reduce((a, v) => a + v, 0);
    const last = days[days.length - 1];
    const payload = {
      gasDay: last,
      stockGWh: total(last),
      byRangeGWh: byDay[last],
      // Oldest first: d = gas day, gwh = total stock across all ranges.
      history: days.map(d => ({ d, gwh: total(d) })),
      source: "National Gas Transmission (storage stock levels, published on behalf of storage operators)",
      items: items.map(i => i.name),
    };
    console.log(`UK storage stock, gas day ${payload.gasDay}: ${payload.stockGWh} GWh ${JSON.stringify(payload.byRangeGWh)}, ${payload.history.length} days of history`);
    await writeJsonIfChanged(PATH, payload, "Automated UK gas storage levels update");
    return new Response(JSON.stringify({ ...payload, history: payload.history.length }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("fetch-uk-storage error:", err.message);
    return new Response("Error", { status: 500 });
  }
};

// National Gas publishes stock levels around 16:00 UK time for the previous
// gas day. Running at 16:53 and 19:53 UTC picks them up in winter and summer,
// with a second chance if publication is late. Minute 53 is not used by any
// other function.
export const config = {
  schedule: "53 16,19 * * *",
};
