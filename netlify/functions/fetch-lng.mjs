// Runs on a schedule. ALSI (Aggregated LNG Storage Inventory, run by Gas
// Infrastructure Europe) updates once per gas day, so hourly is more than
// enough. Fetches EU-aggregate LNG terminal data and commits it to
// content/lng-data.json — Netlify then auto-deploys, and lng.html reads
// this static file client-side (the API key never reaches the browser).

async function commitToGitHub(payload) {
  const owner = "frasermcgown-ctrl";
  const repo = "energy-ledger-site";
  const path = "content/lng-data.json";
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.error("GITHUB_TOKEN not set — skipping commit.");
    return;
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "energy-ledger-lng-fetch",
  };

  let sha;
  try {
    const getRes = await fetch(apiBase, { headers });
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha;
    }
  } catch (e) {
    console.log("No existing lng-data.json found, will create new.");
  }

  const content = Buffer.from(JSON.stringify(payload, null, 2)).toString("base64");

  const body = {
    message: "Automated LNG data update",
    content,
    ...(sha ? { sha } : {}),
  };

  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    console.error("GitHub commit failed:", putRes.status, errText);
  } else {
    console.log("Committed LNG data to GitHub.");
  }
}

export default async () => {
  try {
    const alsiKey = process.env.GIE_API_KEY;
    if (!alsiKey) {
      console.error("GIE_API_KEY not set — skipping this run.");
      return new Response("No API key", { status: 500 });
    }

    // Last 7 days of EU-aggregate data, so we can pick out the most recent entry.
    const till = new Date().toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);
    const from = fromDate.toISOString().slice(0, 10);

    const url = `https://alsi.gie.eu/api/data/eu?from=${from}&till=${till}`;
    const res = await fetch(url, {
      headers: { "x-key": alsiKey, Accept: "application/json" },
    });

    if (!res.ok) {
      console.error(`ALSI fetch failed: ${res.status}`);
      return new Response("ALSI fetch failed", { status: 500 });
    }

    const json = await res.json();
    const rows = json.data || [];
    if (rows.length === 0) {
      console.error("ALSI returned no rows.");
      return new Response("No data", { status: 500 });
    }

    // Most recent gas day first.
    rows.sort((a, b) => new Date(b.gasDayStartedOn) - new Date(a.gasDayStartedOn));
    const latest = rows[0];

    const inventory = parseFloat(latest.lngInventory);   // thousand m3 LNG
    const sendOut = parseFloat(latest.sendOut);           // GWh/d
    const dtmi = parseFloat(latest.dtmi);                 // thousand m3 LNG, max capacity
    const dtrs = parseFloat(latest.dtrs);                 // GWh/d, max send-out capacity
    const fillPct = dtmi > 0 ? Math.round((inventory / dtmi) * 1000) / 10 : null;

    const payload = {
      updated: new Date().toISOString(),
      gasDay: latest.gasDayStartedOn,
      status: latest.status,
      lngInventoryThousandM3: inventory,
      sendOutGWhPerDay: sendOut,
      maxInventoryThousandM3: dtmi,
      maxSendOutGWhPerDay: dtrs,
      fillPercent: fillPct,
    };

    await commitToGitHub(payload);

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("fetch-lng function error:", err);
    return new Response("Error", { status: 500 });
  }
};

export const config = {
  schedule: "@hourly",
};
