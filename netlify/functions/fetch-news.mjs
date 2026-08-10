// Runs on a schedule (see the `config` export below). Fetches gas/power/
// carbon/LNG-relevant items from gov.uk (DESNZ) and Energy Live News, then
// commits the merged, filtered result to content/news-feed.json — which
// triggers Netlify's existing auto-deploy, so the homepage picks it up.

const GOVUK_FEED =
  "https://www.gov.uk/search/all.atom?organisations%5B%5D=department-for-energy-security-and-net-zero&order=updated-newest&count=40";

const ENERGY_LIVE_NEWS_FEED = "https://www.energylivenews.com/feed";

// Only keep items that look like they're actually about gas, power, carbon
// or LNG markets — not the wider consumer/EV/smart-meter/renewables-only beat.
const INCLUDE_KEYWORDS = [
  "gas", "electricity", "power", "carbon", "ets", "lng",
  "interconnector", "balancing", "capacity market", "transmission",
  "distribution", "wholesale", "gigawatt", "megawatt", "generation",
  "grid", "storage", "nuclear", "offshore wind", "hydrogen"
];

const EXCLUDE_KEYWORDS = [
  "smart meter", "electric vehicle", "ev charging", "fuel poverty",
  "warm home discount", "boiler upgrade", "insulation", "heat pump grant",
  "priority services register", "prepayment meter", "solar panel install"
];

function isRelevant(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  const hasInclude = INCLUDE_KEYWORDS.some(k => text.includes(k));
  const hasExclude = EXCLUDE_KEYWORDS.some(k => text.includes(k));
  return hasInclude && !hasExclude;
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "");
}

// Atom parser — used by gov.uk's feed.
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

// Standard RSS 2.0 parser — used by Energy Live News and most WordPress-based sites.
function parseRssItems(xml) {
  const entries = [];
  const itemBlocks = xml.split("<item>").slice(1);
  for (const block of itemBlocks) {
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1];
    const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1];
    const description = (block.match(/<description[^>]*>([\s\S]*?)<\/description>/) || [])[1];
    const pubDate = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/) || [])[1];
    if (title && link) {
      entries.push({
        title: decodeEntities(title.trim()),
        link: link.trim(),
        summary: decodeEntities((description || "").replace(/<[^>]+>/g, "").trim()).slice(0, 220),
        updated: pubDate ? new Date(pubDate.trim()).toISOString() : null,
      });
    }
  }
  return entries;
}

async function fetchFeed(url, sourceName, parser) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; TheEnergyLedgerBot/1.0; +https://www.theenergyledger.co.uk)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      },
    });
    if (!res.ok) {
      console.log(`${sourceName}: fetch failed with status ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const entries = parser(xml);
    return entries.map(e => ({ ...e, source: sourceName }));
  } catch (err) {
    console.log(`${sourceName}: fetch error — ${err.message}. Skipping this source for this run.`);
    return [];
  }
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
  // --- TEMPORARY TEST: checking whether ALSI's LNG terminal endpoint is reachable ---
  // This does not affect the news feed below. Safe to remove once tested.
  try {
    const alsiKey = process.env.GIE_API_KEY;
    if (!alsiKey) {
      console.log("ALSI TEST: GIE_API_KEY not set in environment.");
    } else {
      const alsiUrl = "https://alsi.gie.eu/api/data/eu?limit=3";
      const alsiRes = await fetch(alsiUrl, {
        headers: { "x-key": alsiKey, Accept: "application/json" },
      });
      if (alsiRes.ok) {
        const alsiData = await alsiRes.json();
        console.log("ALSI TEST: success. Sample response:", JSON.stringify(alsiData).slice(0, 600));
      } else {
        console.log(`ALSI TEST: failed with status ${alsiRes.status}`);
        const errBody = await alsiRes.text();
        console.log("ALSI TEST: error body:", errBody.slice(0, 300));
      }
    }
  } catch (err) {
    console.log("ALSI TEST: fetch error —", err.message);
  }
  // --- END TEMPORARY TEST ---

  try {
    const [govukEntries, elnEntries] = await Promise.all([
      fetchFeed(GOVUK_FEED, "Dept for Energy Security & Net Zero", parseAtomEntries),
      fetchFeed(ENERGY_LIVE_NEWS_FEED, "Energy Live News", parseRssItems),
    ]);

    console.log(`gov.uk: ${govukEntries.length} entries fetched. Energy Live News: ${elnEntries.length} entries fetched.`);

    const allEntries = [...govukEntries, ...elnEntries];
    const relevant = allEntries
      .filter(e => isRelevant(e.title, e.summary))
      .sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0))
      .slice(0, 12)
      .map(e => ({
        title: e.title,
        link: e.link,
        summary: e.summary,
        source: e.source,
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
