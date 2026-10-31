// Runs on a schedule. National Gas Transmission's instantaneous flow API is
// fully open (no key needed), but calling it directly from the browser risks
// being blocked by CORS since it's not a public-facing consumer API. Fetching
// it server-side here and committing a snapshot avoids that entirely.
//
// The API returns flows in groups: supply from entry points, supply from
// terminals, total supply, demand by category, demand from interconnectors
// (exports), total demand and linepack. All flows are mcm/d; linepack is mcm.
// Entry-point flows are gas going INTO the grid, so for a storage site a
// positive flow is a withdrawal; injection shows up as "Storage Demand Flow".

import { writeJsonIfChanged } from "../lib/github.mjs";

const STORAGE_SITES = ['ALDBROUGH', 'EASINGTON ROUGH ST', 'HILLTOP', 'HOLE HOUSE FARM', 'HOLFORD', 'HORNSEA', 'HUMBLY GROVE', 'STUBLACH'];

function latestFlow(site) {
  const detail = site.siteGasDetail || [];
  const latest = detail[detail.length - 1] || {};
  return Number.isFinite(latest.flowRate) ? Math.round(latest.flowRate * 1000) / 1000 : null;
}

export default async () => {
  try {
    const res = await fetch("https://api.nationalgas.com/operationaldata/v1/instantaneousflow/sites", {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.error(`National Gas fetch failed: ${res.status}`);
      return new Response("Fetch failed", { status: 500 });
    }

    const data = await res.json();
    const groups = (data.instantaneousFlow || []).map(g => ({
      description: g.description || "",
      sites: (g.sites || []).map(s => ({ name: s.siteName, flow: latestFlow(s) })),
    }));

    const entryPoints = (groups.find(g => /entry points/i.test(g.description)) || { sites: [] }).sites;
    // Storage withdrawals: storage sites' supply into the grid.
    const sites = entryPoints
      .filter(s => STORAGE_SITES.includes((s.name || "").toUpperCase()))
      .map(s => ({ name: s.name, flowRate: s.flow }));

    const payload = {
      publishedTime: data.publishedTime,
      currentGasDay: data.currentGasDay,
      sites,
      groups,
    };

    console.log(`Gas day ${data.currentGasDay}: ${groups.map(g => `${g.description} (${g.sites.length})`).join(", ")}`);
    await writeJsonIfChanged("content/uk-gas-data.json", payload, "Automated UK gas storage data update");

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("fetch-uk-gas function error:", err);
    return new Response("Error", { status: 500 });
  }
};

// Every 3 hours, so the page shows today's flows rather than a midnight snapshot.
export const config = {
  schedule: "21 */3 * * *",
};
