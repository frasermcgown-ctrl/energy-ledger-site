// Runs on a schedule (see the `config` export below). Fetches Ember's monthly
// European wholesale (day-ahead) electricity prices (CC BY 4.0, attribute
// Ember) and commits the last 13 months for a handful of markets to
// content/eu-power-prices.json for the Prices page. Ember updates the file
// monthly; the function skips the commit when nothing has changed.

import { writeJsonIfChanged } from "../lib/github.mjs";
import { parseCsv } from "../lib/csv.mjs";

const PATH = "content/eu-power-prices.json";
const CSV = "https://files.ember-energy.org/public-downloads/price/outputs/european_wholesale_electricity_price_data_monthly.csv";
// Great Britain first if Ember includes it, then GB's main interconnected markets.
const MARKETS = ["GBR", "DEU", "FRA", "NLD", "IRL", "NOR", "ESP"];
const MONTHS_KEPT = 13;

function summarise(text) {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const header = rows.shift().map(h => h.trim().toLowerCase());
  const iIso = header.findIndex(h => h.startsWith("iso3"));
  const iCountry = header.indexOf("country");
  const iDate = header.indexOf("date");
  const iPrice = header.findIndex(h => h.startsWith("price"));
  if (iIso < 0 || iDate < 0 || iPrice < 0) throw new Error(`Ember price columns not found (have: ${header.join(" | ")})`);

  const series = {};
  for (const r of rows) {
    const iso = (r[iIso] || "").trim();
    const price = parseFloat(r[iPrice]);
    const month = (r[iDate] || "").trim().slice(0, 7);
    if (!MARKETS.includes(iso) || !Number.isFinite(price) || !/^\d{4}-\d{2}$/.test(month)) continue;
    const s = (series[iso] = series[iso] || { iso, country: (r[iCountry] || iso).trim(), points: {} });
    s.points[month] = Math.round(price * 10) / 10;
  }
  const months = [...new Set(Object.values(series).flatMap(s => Object.keys(s.points)))].sort().slice(-MONTHS_KEPT);
  return {
    months,
    markets: MARKETS.filter(m => series[m]).map(m => ({
      iso: m,
      country: series[m].country,
      prices: months.map(mo => (mo in series[m].points ? series[m].points[mo] : null)),
    })),
  };
}

export default async () => {
  try {
    const res = await fetch(CSV, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TheEnergyLedgerBot/1.0; +https://www.theenergyledger.co.uk)" } });
    if (!res.ok) throw new Error(`Ember price CSV download failed: ${res.status}`);
    const data = summarise(await res.text());
    console.log(`Ember prices: ${data.months[0]}..${data.months[data.months.length - 1]}; markets ${data.markets.map(m => m.iso).join(", ")}`);
    if (data.markets.length) {
      await writeJsonIfChanged(PATH, { ...data, units: "EUR/MWh (day-ahead, monthly average)", source: "Ember European wholesale electricity price data (CC BY 4.0)" }, "Automated European power prices update");
    }
    return new Response(JSON.stringify({ markets: data.markets.length, months: data.months.length }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("fetch-eu-prices error:", err.message);
    return new Response("Error", { status: 500 });
  }
};

// Ember updates monthly; a weekly check (Tuesdays 06:49 UTC) is plenty.
export const config = {
  schedule: "49 6 * * 2",
};
