// Runs on a schedule (see the `config` export below). Builds the GB
// generation outlook in content/outlook.json for the Live Generation page:
//
//   - wind:     Elexon wind generation forecast (transmission-connected), hourly, ~3 days.
//   - embedded: NESO embedded wind and solar forecast, half-hourly, ~12 days
//               (NESO Open Data Licence).
//   - demand:   Elexon national demand forecast, daily, 2-14 days ahead.

import { writeJsonIfChanged, fetchJson } from "../lib/github.mjs";

const PATH = "content/outlook.json";
const ELEXON = "https://data.elexon.co.uk/bmrs/api/v1";
const NESO_EMBEDDED = "https://api.neso.energy/api/3/action/datastore_search?resource_id=db6c038f-98af-4570-ab60-24d71ebd0ae5&limit=1000";

async function fetchWind() {
  const json = await fetchJson(`${ELEXON}/forecast/generation/wind?format=json`);
  return (json.data || [])
    .filter(r => r.startTime && Number.isFinite(r.generation))
    .map(r => ({ t: r.startTime, mw: r.generation }))
    .sort((a, b) => a.t.localeCompare(b.t));
}

async function fetchEmbedded() {
  const json = await fetchJson(NESO_EMBEDDED);
  const now = Date.now() - 30 * 60 * 1000;
  return ((json.result && json.result.records) || [])
    .map(r => {
      // DATE_GMT is midnight of the day; TIME_GMT is the half-hour start (GMT).
      const t = new Date(`${String(r.DATE_GMT).slice(0, 10)}T${r.TIME_GMT}:00Z`);
      return { t: t.toISOString(), solar: Number(r.EMBEDDED_SOLAR_FORECAST), wind: Number(r.EMBEDDED_WIND_FORECAST) };
    })
    .filter(r => !Number.isNaN(Date.parse(r.t)) && Date.parse(r.t) >= now && Number.isFinite(r.solar) && Number.isFinite(r.wind))
    .sort((a, b) => a.t.localeCompare(b.t));
}

async function fetchDemand() {
  const json = await fetchJson(`${ELEXON}/forecast/demand/daily?format=json`);
  return (Array.isArray(json) ? json : json.data || [])
    .filter(r => r.forecastDate && Number.isFinite(r.nationalDemand))
    .map(r => ({ d: r.forecastDate, mw: r.nationalDemand }))
    .sort((a, b) => a.d.localeCompare(b.d));
}

export default async () => {
  const [wind, embedded, demand] = await Promise.all([
    fetchWind().catch(err => { console.error(`Wind forecast failed: ${err.message}`); return []; }),
    fetchEmbedded().catch(err => { console.error(`Embedded forecast failed: ${err.message}`); return []; }),
    fetchDemand().catch(err => { console.error(`Demand forecast failed: ${err.message}`); return []; }),
  ]);
  console.log(`Wind: ${wind.length} hours. Embedded: ${embedded.length} half-hours. Demand: ${demand.length} days.`);

  if (wind.length || embedded.length || demand.length) {
    await writeJsonIfChanged(PATH, {
      wind, embedded, demand,
      sources: {
        wind: "Elexon (wind generation forecast)",
        embedded: "NESO (embedded wind and solar forecast)",
        demand: "Elexon (national demand forecast)",
      },
    }, "Automated generation outlook update");
  }

  return new Response(JSON.stringify({ wind: wind.length, embedded: embedded.length, demand: demand.length }), {
    headers: { "Content-Type": "application/json" },
  });
};

// Every 3 hours: forecasts are republished through the day.
export const config = {
  schedule: "28 */3 * * *",
};
