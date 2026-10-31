// Runs on a schedule (see the `config` export below). Totals Contracts for
// Difference generation and payments by month from the Low Carbon Contracts
// Company's open data (UK Open Government Licence) and commits them to
// content/cfd.json for the Prices page.
//
// CfD payments are strike price minus market reference price, times output:
// positive when LCCC tops generators up (funded through supplier levies, so
// bills), negative when high wholesale prices mean generators pay money back.
// LCCC publishes per generator per day, a week or two in arrears.

import { writeJsonIfChanged, fetchJson } from "../lib/github.mjs";

const PATH = "content/cfd.json";
const RESOURCE = "37d1bef4-55d7-4b8e-8a47-1d24b123a20e"; // Actual CfD Generation and avoided GHG emissions
const API = "https://dp.lowcarboncontracts.uk/api/3/action/datastore_search";
const ROWS = 32000; // newest ~15 months at ~110 generators a day; the portal's page limit
const MONTHS_KEPT = 13;

function summarise(rows) {
  const months = {};
  for (const [date, tech, gen, pay] of rows) {
    const day = String(date).slice(0, 10);
    const g = parseFloat(gen), p = parseFloat(pay);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(g) || !Number.isFinite(p)) continue;
    const m = (months[day.slice(0, 7)] = months[day.slice(0, 7)] || { days: new Set(), mwh: 0, gbp: 0, tech: {} });
    m.days.add(day);
    m.mwh += g;
    m.gbp += p;
    const t = (m.tech[tech || "Other"] = m.tech[tech || "Other"] || { mwh: 0, gbp: 0 });
    t.mwh += g;
    t.gbp += p;
  }
  return Object.keys(months).sort().map(month => {
    const m = months[month];
    return {
      month,
      days: m.days.size,
      lastDay: [...m.days].sort().pop(),
      generationTWh: Math.round(m.mwh / 1e4) / 100,
      paymentsGBP: Math.round(m.gbp),
      byTechnology: Object.fromEntries(Object.entries(m.tech)
        .sort((a, b) => b[1].mwh - a[1].mwh)
        .map(([k, v]) => [k, { generationTWh: Math.round(v.mwh / 1e4) / 100, paymentsGBP: Math.round(v.gbp) }])),
    };
  });
}

export default async () => {
  try {
    const fields = "Settlement_Date,Technology,CFD_Generation_MWh,CFD_Payments_GBP";
    const url = `${API}?resource_id=${RESOURCE}&limit=${ROWS}&sort=${encodeURIComponent("Settlement_Date desc")}&fields=${fields}&records_format=lists`;
    const json = await fetchJson(url);
    const rows = (json.result && json.result.records) || [];
    // The oldest month in the page is usually cut part-way through, so drop it.
    const all = summarise(rows);
    const months = all.slice(1).slice(-MONTHS_KEPT);
    console.log(`CfD: ${rows.length} rows; ${months.map(m => `${m.month} ${m.generationTWh} TWh £${Math.round(m.paymentsGBP / 1e6)}m (${m.days}d)`).join(", ")}`);
    if (months.length) {
      await writeJsonIfChanged(PATH, {
        months,
        dataTo: months[months.length - 1].lastDay,
        units: { generation: "TWh", payments: "£ (nominal)" },
        source: "Low Carbon Contracts Company (Actual CfD Generation), Open Government Licence",
      }, "Automated CfD data update");
    }
    return new Response(JSON.stringify({ months: months.length }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("fetch-cfd error:", err.message);
    return new Response("Error", { status: 500 });
  }
};

// LCCC updates daily. 04:49 UTC sits clear of the other functions' commit times.
export const config = {
  schedule: "49 4 * * *",
};
