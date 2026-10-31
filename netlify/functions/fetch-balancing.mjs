// Runs on a schedule (see the `config` export below). Totals NESO's daily
// balancing costs (BSUoS cost data, NESO Open Data Licence) by month and
// commits them to content/balancing-costs.json for the Prices page.
//
// NESO publishes one resource per financial year (April-March). The function
// finds the current and previous years' resources by name, so it keeps working
// when a new year's resource appears.

import { writeJsonIfChanged, fetchJson } from "../lib/github.mjs";

const PATH = "content/balancing-costs.json";
const NESO = "https://api.neso.energy/api/3/action";
const DATASET = "daily-balancing-costs-balancing-services-use-of-system";
const CATEGORIES = ["Energy Imbalance", "Frequency Control", "Positive Reserve", "Constraints", "Negative Reserve", "Other"];
const MONTHS_KEPT = 13;

// "Daily Balancing Costs 2026-2027" -> 2026
function financialYearStart(name) {
  const m = /(\d{4})\s*-\s*(\d{4})/.exec(name || "");
  return m ? Number(m[1]) : null;
}

async function yearResources() {
  const pkg = await fetchJson(`${NESO}/package_show?id=${DATASET}`);
  return ((pkg.result && pkg.result.resources) || [])
    .filter(r => r.datastore_active && financialYearStart(r.name))
    .sort((a, b) => financialYearStart(b.name) - financialYearStart(a.name))
    .slice(0, 2);
}

async function monthlyTotals(resourceId) {
  const cols = CATEGORIES.map(c => `SUM("${c}") AS "${c}"`).join(", ");
  const sql = `SELECT to_char("SETT_DATE",'YYYY-MM') AS m, COUNT(DISTINCT "SETT_DATE") AS days, ${cols} FROM "${resourceId}" GROUP BY m ORDER BY m`;
  const json = await fetchJson(`${NESO}/datastore_search_sql?sql=${encodeURIComponent(sql)}`);
  return ((json.result && json.result.records) || []).map(r => {
    const categories = Object.fromEntries(CATEGORIES.map(c => [c, Math.round(Number(r[c]) || 0)]));
    return {
      month: r.m,
      days: Number(r.days) || 0,
      total: Object.values(categories).reduce((a, b) => a + b, 0),
      categories,
    };
  });
}

export default async () => {
  try {
    const resources = await yearResources();
    if (!resources.length) throw new Error("no balancing cost resources found");
    // NESO's datastore allows about 2 requests a minute, so query the years one after the other.
    const months = {};
    for (const r of resources.reverse()) {
      (await monthlyTotals(r.id)).forEach(m => { months[m.month] = m; });
    }
    const list = Object.keys(months).sort().slice(-MONTHS_KEPT).map(k => months[k]);
    console.log(`Balancing costs: ${list.map(m => `${m.month} £${Math.round(m.total / 1e6)}m`).join(", ")}`);

    if (list.length) {
      await writeJsonIfChanged(PATH, {
        months: list,
        units: "£",
        source: "NESO (Daily Balancing Services Use of System cost data)",
      }, "Automated balancing costs update");
    }
    return new Response(JSON.stringify({ months: list.length }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("fetch-balancing error:", err.message);
    return new Response("Error", { status: 500 });
  }
};

export const config = {
  schedule: "49 0 * * *",
};
