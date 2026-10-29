// Runs on a schedule (see the `config` export below). Pulls every published
// post from The Energy Ledger on Substack and commits the list to
// content/substack-posts.json — which triggers Netlify's existing
// auto-deploy, so the homepage's "Latest issues" section stays current.
//
// Substack's archive API returns every post; the RSS feed only carries the
// latest 20, so it is used as a fallback if the archive API fails.
// Only post titles, links, dates and subtitles are stored.

const PUBLICATION = "https://home.theenergyledger.co.uk";
const ARCHIVE_API = `${PUBLICATION}/api/v1/archive?sort=new`;
const RSS_FEED = `${PUBLICATION}/feed`;
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; TheEnergyLedgerBot/1.0; +https://www.theenergyledger.co.uk)",
};

function decodeEntities(str) {
  return str
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isPostUrl(url) {
  return typeof url === "string" && url.startsWith(`${PUBLICATION}/p/`);
}

async function fetchFromArchive() {
  const posts = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`${ARCHIVE_API}&offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`, {
      headers: { ...HEADERS, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`archive API status ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error("archive API returned unexpected data");
    for (const p of batch) {
      if (!isPostUrl(p.canonical_url) || !p.title || !p.post_date) continue;
      posts.push({
        title: p.title.trim(),
        url: p.canonical_url,
        published: new Date(p.post_date).toISOString(),
        subtitle: (p.subtitle || p.description || "").trim().slice(0, 240),
      });
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return posts;
}

async function fetchFromRss() {
  const res = await fetch(RSS_FEED, {
    headers: { ...HEADERS, Accept: "application/rss+xml, application/xml, text/xml" },
  });
  if (!res.ok) throw new Error(`RSS status ${res.status}`);
  const xml = await res.text();
  const posts = [];
  for (const block of xml.split("<item>").slice(1)) {
    const get = tag => (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1];
    const title = get("title");
    const link = get("link");
    const pubDate = get("pubDate");
    if (!title || !isPostUrl((link || "").trim()) || !pubDate) continue;
    posts.push({
      title: decodeEntities(title).trim(),
      url: link.trim(),
      published: new Date(pubDate.trim()).toISOString(),
      subtitle: decodeEntities(get("description") || "").replace(/<[^>]+>/g, "").trim().slice(0, 240),
    });
  }
  return posts;
}

// mergeWithExisting: the RSS fallback only carries the latest 20 posts, so add
// them to the stored list rather than replacing it.
async function commitToGitHub(posts, mergeWithExisting) {
  const owner = "frasermcgown-ctrl";
  const repo = "energy-ledger-site";
  const path = "content/substack-posts.json";
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.error("GITHUB_TOKEN not set — skipping commit, function will retry next run.");
    return;
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "energy-ledger-substack-fetch",
  };

  let sha;
  try {
    const getRes = await fetch(apiBase, { headers });
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha;
      // Skip the commit (and the redeploy it triggers) when nothing has changed.
      const existing = JSON.parse(Buffer.from(getData.content, "base64").toString("utf8"));
      if (mergeWithExisting && Array.isArray(existing.posts)) {
        const fresh = new Set(posts.map(p => p.url));
        posts = [...posts, ...existing.posts.filter(p => !fresh.has(p.url))]
          .sort((a, b) => new Date(b.published) - new Date(a.published));
      }
      if (JSON.stringify(existing.posts) === JSON.stringify(posts)) {
        console.log(`No change in ${posts.length} posts — skipping commit.`);
        return;
      }
    }
  } catch (e) {
    console.log("No existing file found, will create new.");
  }

  const content = Buffer.from(
    JSON.stringify({ updated: new Date().toISOString(), posts }, null, 2) + "\n"
  ).toString("base64");

  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Automated Substack posts update",
      content,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    console.error("GitHub commit failed:", putRes.status, errText);
  } else {
    console.log(`Committed ${posts.length} Substack posts to GitHub.`);
  }
}

export default async () => {
  try {
    let posts;
    let fromRss = false;
    try {
      posts = await fetchFromArchive();
      console.log(`Substack archive API: ${posts.length} posts.`);
    } catch (err) {
      console.log(`Substack archive API failed (${err.message}) — falling back to RSS.`);
      posts = await fetchFromRss();
      fromRss = true;
      console.log(`Substack RSS: ${posts.length} posts.`);
    }

    if (posts.length === 0) {
      console.log("No posts returned — keeping the existing list.");
      return new Response(JSON.stringify({ found: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    posts.sort((a, b) => new Date(b.published) - new Date(a.published));
    await commitToGitHub(posts, fromRss);

    return new Response(JSON.stringify({ found: posts.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("fetch-substack function error:", err);
    return new Response("Error", { status: 500 });
  }
};

export const config = {
  schedule: "@hourly",
};
