// Runs on a schedule (see the `config` export below). Fetches the two market
// prices that are published as free official open data and commits them to
// content/market-prices.json, which the homepage "Market snapshot" reads:
//
//   - Gas: National Gas System Average Price (SAP), the daily volume-weighted
//     average price of gas traded on the On-the-day Commodity Market. Published
//     in p/kWh; shown in p/therm (1 therm = 29.3071 kWh).
//   - Power: Elexon Market Index Data (MID) from the APX/EPEX provider, the GB
//     short-term wholesale power price per settlement period. Shown as the
//     volume-weighted average for the latest complete settlement day, in £/MWh.
//
// TTF and EUA prices need an exchange licence to display publicly, so they stay
// as hand-entered values in /admin (ticker_ttf, ticker_eua).

const KWH_PER_THERM = 29.3071;
const NG_API = "https://api.nationalgas.com/operationaldata/v1/publications";
const ELEXON_MID = "https://data.elexon.co.uk/bmrs/api/v1/datasets/MID";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// Walk the National Gas catalogue (nested categories) and collect every entry
// that carries a publicationId.
function catalogueEntries(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach(n => catalogueEntries(n, out));
  } else if (node && typeof node === "object") {
    if (node.publicationId && node.name) out.push({ id: node.publicationId, name: node.name });
    Object.values(node).forEach(v => { if (v && typeof v === "object") catalogueEntries(v, out); });
  }
  return out;
}

// Pick the SAP data item: prefer "System Average Price" / "SAP, Actual Day"
// over forecasts, 7-day averages or other derived series.
function findSapItem(entries) {
  const sap = entries.filter(e => /system average price|^sap\b/i.test(e.name));
  const excluded = /forecast|7.?day|average of|rolling|marginal|smp/i;
  const ranked = sap
    .filter(e => !excluded.test(e.name))
    .sort((a, b) => Number(/actual/i.test(b.name)) - Number(/actual/i.test(a.name)));
  return { pick: ranked[0] || null, candidates: sap.map(e => `${e.id} ${e.name}`) };
}

async function fetchGasSap() {
  const catRes = await fetch(`${NG_API}/catalogue`, { headers: { Accept: "application/json" } });
  if (!catRes.ok) throw new Error(`catalogue status ${catRes.status}`);
  const { pick, candidates } = findSapItem(catalogueEntries(await catRes.json()));
  console.log(`SAP catalogue candidates: ${candidates.join(" | ") || "none"}`);
  if (!pick) throw new Error("SAP data item not found in catalogue");

  const res = await fetch(`${NG_API}/gasday`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      fromDate: isoDate(daysAgo(7)),
      toDate: isoDate(new Date()),
      publicationIds: [pick.id],
      latestValue: "Y",
    }),
  });
  if (!res.ok) throw new Error(`gasday status ${res.status}`);
  const data = await res.json();
  const rows = ((Array.isArray(data) ? data : [data])[0] || {}).publications || [];
  const latest = rows
    .map(r => ({ day: r.applicableFor, value: parseFloat(r.value) }))
    .filter(r => r.day && Number.isFinite(r.value) && r.value > 0)
    .sort((a, b) => a.day.localeCompare(b.day))
    .pop();
  if (!latest) throw new Error("no SAP values in the last 7 days");

  return {
    label: "NBP system average price (SAP)",
    pencePerTherm: Math.round(latest.value * KWH_PER_THERM * 100) / 100,
    pencePerKwh: latest.value,
    gasDay: latest.day,
    source: "National Gas Transmission",
    sourceItem: `${pick.id} ${pick.name}`,
  };
}

async function fetchPowerMid() {
  const url = `${ELEXON_MID}?from=${isoDate(daysAgo(3))}&to=${isoDate(new Date())}&dataProviders=APXMIDP&format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`MID status ${res.status}`);
  const json = await res.json();
  const rows = (Array.isArray(json) ? json : json.data || [])
    .filter(r => r.dataProvider === "APXMIDP" && Number.isFinite(r.price) && Number.isFinite(r.volume) && r.volume > 0);
  if (!rows.length) throw new Error("no MID rows with traded volume");

  // Group by settlement date and use the latest day that is (nearly) complete,
  // so a half-finished today doesn't show a partial average.
  const byDay = {};
  rows.forEach(r => { (byDay[r.settlementDate] = byDay[r.settlementDate] || []).push(r); });
  const days = Object.keys(byDay).sort();
  const complete = days.filter(d => byDay[d].length >= 40);
  const day = (complete.length ? complete : days).pop();
  const dayRows = byDay[day];
  const volume = dayRows.reduce((s, r) => s + r.volume, 0);
  const avg = dayRows.reduce((s, r) => s + r.price * r.volume, 0) / volume;

  return {
    label: "GB power, market index (daily average)",
    poundsPerMwh: Math.round(avg * 100) / 100,
    settlementDate: day,
    periods: dayRows.length,
    source: "Elexon (APX market index)",
  };
}

async function commitToGitHub(payload) {
  const owner = "frasermcgown-ctrl";
  const repo = "energy-ledger-site";
  const path = "content/market-prices.json";
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.error("GITHUB_TOKEN not set — skipping commit, function will retry next run.");
    return;
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "energy-ledger-prices-fetch",
  };

  let sha;
  let existing = {};
  try {
    const getRes = await fetch(apiBase, { headers });
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha;
      existing = JSON.parse(Buffer.from(getData.content, "base64").toString("utf8"));
    }
  } catch (e) {
    console.log("No existing file found, will create new.");
  }

  // Keep the last good value for a source that failed this run.
  const merged = { gas: payload.gas || existing.gas || null, power: payload.power || existing.power || null };
  if (JSON.stringify({ gas: existing.gas || null, power: existing.power || null }) === JSON.stringify(merged)) {
    console.log("Prices unchanged — skipping commit.");
    return;
  }

  const content = Buffer.from(
    JSON.stringify({ updated: new Date().toISOString(), ...merged }, null, 2) + "\n"
  ).toString("base64");

  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Automated market prices update", content, ...(sha ? { sha } : {}) }),
  });

  if (!putRes.ok) {
    console.error("GitHub commit failed:", putRes.status, await putRes.text());
  } else {
    console.log("Committed market prices to GitHub.");
  }
}

export default async () => {
  const [gas, power] = await Promise.all([
    fetchGasSap().catch(err => { console.error(`SAP fetch failed: ${err.message}`); return null; }),
    fetchPowerMid().catch(err => { console.error(`MID fetch failed: ${err.message}`); return null; }),
  ]);
  console.log(`Gas: ${gas ? `${gas.pencePerTherm}p/th for ${gas.gasDay}` : "unavailable"}. Power: ${power ? `£${power.poundsPerMwh}/MWh for ${power.settlementDate}` : "unavailable"}.`);

  if (gas || power) await commitToGitHub({ gas, power });

  return new Response(JSON.stringify({ gas, power }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  schedule: "@hourly",
};
