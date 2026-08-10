// Runs on a schedule (see the `config` export below). Fetches the official
// gov.uk Atom feed for DESNZ publications, keeps only items relevant to
// gas, power, carbon and LNG markets, and commits the result to
// content/news-feed.json in this repo — which triggers Netlify's existing
// auto-deploy, so the homepage picks it up automatically.

const GOVUK_FEED =
  "https://www.gov.uk/search/all.atom?organisations%5B%5D=department-for-energy-security-and-net-zero&order=updated-newest&count=40";

// Only keep items that look like they're actually about gas, power, carbon
// or LNG markets — not the wider consumer/EV/smart-meter beat DESNZ also covers.
const INCLUDE_KEYWORDS = [
  "gas", "electricity", "power", "carbon", "ets", "lng",
  "interconnector", "balancing", "capacity market", "transmission",
  "distribution", "wholesale", "gigawatt", "megawatt", "generation",
  "grid", "storage", "nuclear", "offshore wind", "hydrogen"
];

const EXCLUDE_KEYWORDS = [
  "smart meter", "electric vehicle", "ev charging", "fuel poverty",
  "warm home discount", "boiler upgrade", "insulation", "heat pump grant",
  "priority services register", "prepayment meter"
];

function isRelevant(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  const hasInclude = INCLUDE_KEYWORDS.some(k => text.includes(k));
  const hasExclude = EXCLUDE_KEYWORDS.some(k => text.includes(k));
  return hasInclude && !hasExclude;
}

// Minimal Atom parser — gov.uk's feed structure is simple and stable enough
// not to need a full XML dependency.
function parseAtomEntries(xml) {
  const entries = [];
  const entryBlocks = xml.split("<entry>").slice(1);
  for (const block of entryBlocks) {
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1];
    const link = (block.match(/<link[^>]*href="([^"]*)"/) || [])[1];
    const summary = (block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1];
    const updated = (block.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1];
    if (title && link) {
      entries.push({
        title: decodeEntities(title.trim()),
        link: link.trim(),
        summary: decodeEntities((summary || "").replace(/<[^>]+>/g, "").trim()).slice(0, 220),
        updated: updated ? updated.trim() : null,
      });
    }
  }
  return entries;
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function commitToGitHub(items) {
  const owner = "frasermcgown-ctrl";
  const repo = "energy-ledger-site";
  const path = "content/news-feed.json";
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.error("GITHUB_TOKEN not set — skipping commit, function will retry next run.");
    return;
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "energy-ledger-news-fetch",
  };

  // Get current file SHA (required by GitHub's API to update an existing file)
  let sha;
  try {
    const getRes = await fetch(apiBase, { headers });
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha;
    }
  } catch (e) {
    console.log("No existing file found, will create new.");
  }

  const content = Buffer.from(
    JSON.stringify({ updated: new Date().toISOString(), items }, null, 2)
  ).toString("base64");

  const body = {
    message: "Automated news feed update",
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
    console.log(`Committed ${items.length} news items to GitHub.`);
  }
}

export default async () => {
  try {
    const res = await fetch(GOVUK_FEED, {
      headers: { "User-Agent": "energy-ledger-news-fetch (contact: via theenergyledger.co.uk)" },
    });
    if (!res.ok) {
      console.error("Feed fetch failed:", res.status);
      return new Response("Feed fetch failed", { status: 500 });
    }
    const xml = await res.text();
    const entries = parseAtomEntries(xml);
    const relevant = entries
      .filter(e => isRelevant(e.title, e.summary))
      .slice(0, 10)
      .map(e => ({
        title: e.title,
        link: e.link,
        summary: e.summary,
        source: "Dept for Energy Security & Net Zero",
        published: e.updated,
      }));

    await commitToGitHub(relevant);

    return new Response(JSON.stringify({ found: relevant.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("fetch-news function error:", err);
    return new Response("Error", { status: 500 });
  }
};

export const config = {
  schedule: "@hourly",
};
