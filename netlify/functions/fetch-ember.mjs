// Runs on a schedule (see the `config` export below). Fetches Ember's yearly
// UK electricity generation by source (CC BY 4.0, attribute Ember) and commits
// it to content/ember-uk.json for the long-run chart on the Live Generation page.
//
// Needs a free Ember API key in the EMBER_API_KEY environment variable
// (sign up at https://ember-energy.org/data/api/). Without it the function
// does nothing and the page hides the chart.

import { writeJsonIfChanged, fetchJson } from "../lib/github.mjs";

const PATH = "content/ember-uk.json";
const START_YEAR = 2010;

export default async () => {
  // Trim stray spaces, line breaks and quote marks picked up when pasting the key.
  const key = (process.env.EMBER_API_KEY || "").trim().replace(/^["']+|["']+$/g, "").trim();
  if (!key) {
    console.log("EMBER_API_KEY not set — skipping. Add a free Ember API key in Netlify to enable the long-run chart.");
    return new Response("No key", { status: 200 });
  }
  try {
    const url = `https://api.ember-energy.org/v1/electricity-generation/yearly?entity_code=GBR&is_aggregate_series=false&start_date=${START_YEAR}&api_key=${encodeURIComponent(key)}`;
    const json = await fetchJson(url);
    const rows = (json.data || []).filter(r => r.date && r.series && Number.isFinite(Number(r.generation_twh)));
    const years = {};
    rows.forEach(r => {
      const y = String(r.date).slice(0, 4);
      (years[y] = years[y] || {})[r.series] = Math.round(Number(r.generation_twh) * 10) / 10;
    });
    const list = Object.keys(years).sort().map(y => ({ year: Number(y), twh: years[y] }));
    console.log(`Ember: ${list.length} years, series: ${[...new Set(rows.map(r => r.series))].join(", ")}`);
    if (list.length) {
      await writeJsonIfChanged(PATH, { years: list, units: "TWh", source: "Ember (CC BY 4.0)" }, "Automated Ember yearly data update");
    }
    return new Response(JSON.stringify({ years: list.length }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("fetch-ember error:", err.message);
    if (/status (401|403)/.test(err.message)) {
      console.error(`Ember rejected the API key (length ${key.length}). Re-copy it from your Ember account into EMBER_API_KEY, then redeploy.`);
    }
    return new Response("Error", { status: 500 });
  }
};

// Ember updates its yearly data a few times a year.
export const config = {
  schedule: "56 1 * * 0",
};
