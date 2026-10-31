// Runs on a schedule (see the `config` export below). Summarises the UK
// renewables and storage project pipeline from DESNZ's Renewable Energy
// Planning Database (REPD, Open Government Licence), published quarterly, and
// commits it to content/repd-pipeline.json for the Generation page.
//
// The CSV's address changes every quarter, so it is found through the GOV.UK
// content API. If the file hasn't changed since the last run, nothing is
// downloaded.

import { readJson, writeJsonIfChanged, fetchJson } from "../lib/github.mjs";
import { parseCsv } from "../lib/csv.mjs";

const PATH = "content/repd-pipeline.json";
const PAGE = "https://www.gov.uk/api/content/government/publications/renewable-energy-planning-database-quarterly-extract";

// "Development Status (short)" -> pipeline stage. Anything else (refused,
// withdrawn, abandoned, expired, decommissioned, revised) is left out.
const STAGES = {
  "operational": "operational",
  "under construction": "construction",
  "awaiting construction": "consented",
  "application submitted": "planning",
  "appeal lodged": "planning",
  "secretary of state - intervened": "planning",
};
const STAGE_ORDER = ["operational", "construction", "consented", "planning"];

function techGroup(type) {
  const t = (type || "").toLowerCase();
  if (/wind offshore/.test(t)) return "Offshore wind";
  if (/wind onshore/.test(t)) return "Onshore wind";
  if (/solar/.test(t)) return "Solar";
  if (/battery|pumped|storage|flywheel|compressed air|liquid air/.test(t)) return "Storage";
  return "Other renewables";
}
const TECH_ORDER = ["Offshore wind", "Onshore wind", "Solar", "Storage", "Other renewables"];

function summarise(csvText) {
  const rows = parseCsv(csvText.replace(/^﻿/, ""));
  const header = rows.shift().map(h => h.trim());
  const col = name => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const iTech = col("Technology Type"), iCap = col("Installed Capacity (MWelec)"), iStatus = col("Development Status (short)");
  if (iTech < 0 || iCap < 0 || iStatus < 0) throw new Error(`REPD columns not found (have: ${header.slice(0, 25).join(" | ")})`);

  const mw = {};
  const unknown = {};
  let projects = 0;
  for (const r of rows) {
    if (r.length < header.length / 2) continue;
    const status = (r[iStatus] || "").trim().toLowerCase();
    const stage = STAGES[status];
    const cap = parseFloat((r[iCap] || "").replace(/,/g, ""));
    if (!stage) { unknown[status] = (unknown[status] || 0) + 1; continue; }
    if (!Number.isFinite(cap) || cap <= 0) continue;
    const tech = techGroup(r[iTech]);
    mw[tech] = mw[tech] || {};
    mw[tech][stage] = (mw[tech][stage] || 0) + cap;
    projects++;
  }
  const gw = v => Math.round((v || 0) / 100) / 10;
  const byTechnology = TECH_ORDER.filter(t => mw[t]).map(t => ({
    technology: t,
    ...Object.fromEntries(STAGE_ORDER.map(s => [s, gw(mw[t][s])])),
  }));
  const totals = Object.fromEntries(STAGE_ORDER.map(s => [s, gw(TECH_ORDER.reduce((a, t) => a + ((mw[t] || {})[s] || 0), 0))]));
  return { byTechnology, totals, projects, skippedStatuses: unknown };
}

export default async () => {
  try {
    const page = await fetchJson(PAGE);
    const csv = ((page.details && page.details.attachments) || []).find(a => a.content_type === "text/csv" || /\.csv$/i.test(a.url || ""));
    if (!csv) throw new Error("no CSV attachment on the REPD page");

    const { data: existing } = await readJson(PATH);
    if (existing && existing.file === csv.filename) {
      console.log(`REPD ${csv.filename} already summarised — nothing to do.`);
      return new Response("Unchanged", { status: 200 });
    }

    const res = await fetch(csv.url);
    if (!res.ok) throw new Error(`REPD CSV download failed: ${res.status}`);
    const summary = summarise(await res.text());
    console.log(`REPD ${csv.filename}: ${summary.projects} projects; GW ${JSON.stringify(summary.totals)}; left out ${JSON.stringify(summary.skippedStatuses)}`);

    const { skippedStatuses, ...rest } = summary;
    await writeJsonIfChanged(PATH, {
      file: csv.filename,
      title: csv.title,
      published: page.public_updated_at || null,
      ...rest,
      units: "GW (installed capacity, MWelec / 1000)",
      source: "DESNZ Renewable Energy Planning Database, Open Government Licence",
    }, "Automated REPD pipeline update");
    return new Response(JSON.stringify(summary.totals), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("fetch-repd error:", err.message);
    return new Response("Error", { status: 500 });
  }
};

// REPD is published quarterly; a weekly check (Mondays 05:49 UTC) picks it up.
export const config = {
  schedule: "49 5 * * 1",
};
