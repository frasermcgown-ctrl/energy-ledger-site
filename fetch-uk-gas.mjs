// Runs on a schedule. National Gas Transmission's instantaneous flow API is
// fully open (no key needed), but calling it directly from the browser risks
// being blocked by CORS since it's not a public-facing consumer API. Fetching
// it server-side here and committing a snapshot avoids that entirely.

const STORAGE_SITES = ['ALDBROUGH', 'HOLE HOUSE', 'HORNSEA', 'HUMBLY GROVE', 'STUBLACH', 'HILL TOP FARM', 'HOLFORD', 'ATWICK'];

async function commitToGitHub(payload) {
  const owner = "frasermcgown-ctrl";
  const repo = "energy-ledger-site";
  const path = "content/uk-gas-data.json";
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.error("GITHUB_TOKEN not set — skipping commit.");
    return;
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "energy-ledger-uk-gas-fetch",
  };

  let sha;
  try {
    const getRes = await fetch(apiBase, { headers });
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha;
    }
  } catch (e) {
    console.log("No existing uk-gas-data.json found, will create new.");
  }

  const content = Buffer.from(JSON.stringify(payload, null, 2)).toString("base64");
  const body = { message: "Automated UK gas storage data update", content, ...(sha ? { sha } : {}) };

  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    console.error("GitHub commit failed:", putRes.status, errText);
  } else {
    console.log("Committed UK gas storage data to GitHub.");
  }
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
    const allSites = (data.instantaneousFlow && data.instantaneousFlow[0] && data.instantaneousFlow[0].sites) || [];
    const storageSites = allSites.filter(s => STORAGE_SITES.includes((s.siteName || "").toUpperCase()));

    const sites = storageSites.map(site => {
      const latest = (site.siteGasDetail && site.siteGasDetail[site.siteGasDetail.length - 1]) || {};
      return {
        name: site.siteName,
        flowRate: latest.flowRate !== undefined ? latest.flowRate : null,
      };
    });

    const payload = {
      updated: new Date().toISOString(),
      publishedTime: data.publishedTime,
      currentGasDay: data.currentGasDay,
      sites,
    };

    await commitToGitHub(payload);

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("fetch-uk-gas function error:", err);
    return new Response("Error", { status: 500 });
  }
};

export const config = {
  schedule: "@hourly",
};
