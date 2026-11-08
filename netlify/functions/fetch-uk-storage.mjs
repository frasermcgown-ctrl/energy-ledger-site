// Runs on a schedule (see the `config` export below). National Gas publishes
// UK storage stock levels once a day (around 16:00, for the previous gas day),
// in GWh, aggregated by storage type (short, medium and long range; in
// practice only medium-range sites hold gas today). This fetches about a
// year of those daily stocks and commits them to content/uk-storage-levels.json,
// which uk-gas-storage.html reads.
//
// Same public API and method as fetch-price-history.mjs: find the data items in
// the National Gas publications catalogue by exact name, then request their
// gas-day values. No API key is needed. Each item is requested on its own:
// a request listing many items was rejected (HTTP 400).
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

// Exact catalogue names (seen in the 8 Nov 2026 run). The total is the
// combined medium + long range item; if it has no values, fall back to
// summing the medium and long range items. Per-site opening stocks give the
// breakdown by site (Rough is the long range site).
const TOTAL_NAME = /^storage, medium and long range, stock levels$/i;
const RANGE_NAMES = [/^storage, medium range, stock levels$/i, /^storage, long range, stock levels$/i];
const SITE_NAME = /^opening stock, (.+?), (medium|long|short) range storage$/i;

// One request per item: the API returned 400 for a request listing many items.
async function fetchItem(item) {
  const data = await fetchJson(`${NG_API}/gasday`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromDate: isoDate(daysAgo(HISTORY_DAYS)),
      toDate: isoDate(new Date()),
      publicationIds: [item.id],
      latestValue: "Y",
    }),
  });
  const byDay = {};
  (((Array.isArray(data) ? data : [data])[0] || {}).publications || []).forEach(r => {
    const v = parseFloat(r.value);
    if (r.applicableFor && Number.isFinite(v) && v >= 0) byDay[r.applicableFor] = v;
  });
  return { item, byDay };
}

async function fetchItems(items) {
  const out = [];
  for (const item of items) out.push(await fetchItem(item));
  return out;
}

export default async () => {
  try {
    const entries = catalogueEntries(await fetchJson(`${NG_API}/catalogue`));
    const byName = re => entries.find(e => re.test(e.name.trim()));
    const totalItem = byName(TOTAL_NAME);
    const rangeItems = RANGE_NAMES.map(byName).filter(Boolean);
    if (!totalItem && !rangeItems.length) {
      const hints = entries.filter(e => /stock/i.test(e.name)).slice(0, 40).map(e => `${e.id} ${e.name}`);
      console.error(`Storage stock items not found in the National Gas catalogue (${entries.length} entries). Items mentioning 'stock': ${JSON.stringify(hints)}`);
      return new Response("No stock items", { status: 500 });
    }

    // Total stock per day.
    let totals = {};
    if (totalItem) {
      totals = (await fetchItems([totalItem]))[0].byDay;
      console.log(`${totalItem.id} "${totalItem.name}": ${Object.keys(totals).length} days`);
    }
    if (!Object.keys(totals).length && rangeItems.length) {
      const parts = await fetchItems(rangeItems);
      parts.forEach(p => {
        console.log(`${p.item.id} "${p.item.name}": ${Object.keys(p.byDay).length} days`);
        Object.entries(p.byDay).forEach(([d, v]) => { totals[d] = (totals[d] || 0) + v; });
      });
    }
    const days = Object.keys(totals).sort();
    if (!days.length) {
      console.error("Storage stock items returned no values.");
      return new Response("No data", { status: 500 });
    }
    const last = days[days.length - 1];

    // Per-site breakdown (optional: the total still saves if this fails).
    let sites = [];
    const siteItems = entries.filter(e => SITE_NAME.test(e.name.trim()));
    if (siteItems.length) {
      const res = [];
      for (const item of siteItems) {
        try { res.push(await fetchItem(item)); } catch (e) { console.log(`Per-site stock ${item.id} "${item.name}" unavailable: ${e.message}`); }
      }
      {
        sites = res.map(r => {
          const m = r.item.name.trim().match(SITE_NAME);
          const ds = Object.keys(r.byDay).sort();
          const d = ds[ds.length - 1];
          return d ? { site: m[1], range: m[2].toLowerCase(), gasDay: d, value: r.byDay[d] } : null;
        }).filter(Boolean).sort((a, b) => b.value - a.value);
      }
    }

    // The per-site items are published in kWh while the total is in GWh
    // (8 Nov 2026: sites summed to 11,210,691,464 against a total of 11,211).
    // Work out the factor from the data rather than assuming it, so the
    // breakdown stays right if National Gas changes the unit.
    const siteSum = sites.reduce((a, x) => a + x.value, 0);
    const ratio = totals[last] > 0 ? siteSum / totals[last] : 0;
    const factor = ratio > 3e5 ? 1e6 : ratio > 300 ? 1e3 : 1;
    sites = sites.map(({ value, ...x }) => ({ ...x, gwh: Math.round(value / factor) }));
    if (factor !== 1) console.log(`Per-site stocks converted to GWh (divided by ${factor}).`);

    const payload = {
      gasDay: last,
      stockGWh: Math.round(totals[last]),
      // Opening stock by site for its latest gas day (opening stock = end of the previous day).
      sites,
      // Oldest first: d = gas day, gwh = total medium + long range stock.
      history: days.map(d => ({ d, gwh: Math.round(totals[d]) })),
      source: "National Gas Transmission (storage stock levels, published on behalf of storage operators)",
      items: [totalItem, ...rangeItems].filter(Boolean).map(i => i.name),
    };
    console.log(`UK storage stock, gas day ${payload.gasDay}: ${payload.stockGWh} GWh, ${payload.history.length} days of history, ${sites.length} sites`);
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
