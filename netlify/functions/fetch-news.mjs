// Runs on a schedule (see the `config` export below). Fetches gas/power/
// carbon/LNG-relevant items from gov.uk (DESNZ), Energy Live News, Carbon
// Brief, Renewables Now, Ofgem, NESO and RenewableUK, tags each with a topic, then
// commits the merged result to content/news-feed.json — which triggers
// Netlify's existing auto-deploy, so the homepage and News page pick it up.
// Headlines, short summaries and links only.

import { writeJsonIfChanged } from "../lib/github.mjs";

const GOVUK_FEED =
  "https://www.gov.uk/search/all.atom?organisations%5B%5D=department-for-energy-security-and-net-zero&order=updated-newest&count=40";

const ENERGY_LIVE_NEWS_FEED = "https://www.energylivenews.com/feed";
const CARBON_BRIEF_FEED = "https://www.carbonbrief.org/feed/";
const RENEWABLES_NOW_FEEDS = ["https://renewablesnow.com/feeds/europe/", "https://renewablesnow.com/feeds/offshore-wind/"];
// Ofgem's RSS feed is empty and NESO has none, so read their public listing pages.
// Ofgem's press release page fills its list with JavaScript from this listing
// API (listing 2054 = press releases), newest first. Each item carries the same
// teaser HTML as the page, so parseOfgemListing reads it.
const OFGEM_PRESS = "https://www.ofgem.gov.uk/api/listing/2054?sort%5Bfield_combined_date%5D%5Bpath%5D=field_combined_date&sort%5Bfield_combined_date%5D%5Bdirection%5D=desc";
const NESO_NEWS = "https://www.neso.energy/news-and-events";
const RENEWABLEUK_PRESS = "https://www.renewableuk.com/news-and-resources/press-releases/";
const MAX_ITEMS = 40;

// Wider sources (Carbon Brief, Renewables Now) are global, so keep only UK stories.
const UK_KEYWORDS = ["uk", "u.k.", "britain", "british", "england", "scotland", "scottish", "wales", "welsh", "northern ireland", "ofgem", "neso", "north sea"];

function isUK(title, summary) {
  const text = ` ${title} ${summary} `.toLowerCase();
  return UK_KEYWORDS.some(k => new RegExp(`[^a-z]${k.replace(/\./g, "\\.")}[^a-z]`).test(text));
}

// First matching topic wins; order runs from the most specific.
const TOPICS = [
  ["lng", ["lng", "liquefied natural gas", "regasification", "cargo"]],
  ["carbon", ["carbon price", "emissions trading", "uk ets", "eu ets", "allowance", "carbon capture", "ccs", "net zero", "emissions"]],
  ["gas", ["gas", "nbp", "ttf", "north sea", "storage", "pipeline"]],
  ["renewables", ["wind", "solar", "renewable", "offshore", "battery", "hydrogen", "nuclear", "cfd", "contracts for difference"]],
  ["power", ["electricity", "power", "grid", "balancing", "transmission", "interconnector", "capacity market", "generation"]],
  ["policy", ["ofgem", "price cap", "consultation", "regulation", "government", "budget", "policy", "licence", "bill"]],
];

function topicOf(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  const hit = TOPICS.find(([, words]) => words.some(w => text.includes(w)));
  return hit ? hit[0] : "policy";
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// Listing pages may use relative links ("/press-release/...") in the HTML a
// server receives, even though a browser shows full URLs. Resolve either form.
function absolute(href, base) {
  if (!href) return null;
  try { return new URL(href.replace(/&amp;/g, "&"), base).href; } catch { return null; }
}

// "29 October 2026" / "14 Apr 2026" -> ISO date at midday UTC.
function parseDayMonthYear(text) {
  const t = Date.parse(`${text} 12:00 UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Ofgem press release listing: <article> cards with link, <h3> title, summary <p> and "Publication date".
function parseOfgemListing(html) {
  return (html.match(/<article[\s\S]*?<\/article>/g) || []).map(card => {
    const link = absolute((card.match(/href="((?:https:\/\/www\.ofgem\.gov\.uk)?\/(?:press-release|news)\/[^"]+)"/) || [])[1], "https://www.ofgem.gov.uk");
    const title = stripTags((card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || "");
    const summary = stripTags((card.match(/<p>([\s\S]*?)<\/p>/) || [])[1] || "").slice(0, 220);
    const date = (stripTags(card).match(/Publication date:\s*(\d{1,2} [A-Za-z]+ \d{4})/) || [])[1];
    return link && title ? { title, link, summary, updated: date ? parseDayMonthYear(date) : null } : null;
  }).filter(Boolean);
}

// NESO news listing: <article class="... node--view-mode-teaser"> cards with title, "14 Apr 2026 - 3 minute read" and description.
function parseNesoListing(html) {
  const seen = new Set();
  return (html.match(/<article class="[^"]*node--view-mode-teaser[\s\S]*?<\/article>/g) || []).map(card => {
    const link = absolute((card.match(/href="((?:https:\/\/www\.neso\.energy)?\/news\/[^"]+)"/) || [])[1], "https://www.neso.energy");
    const title = stripTags((card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || "");
    const summary = stripTags((card.match(/class="article-description">([\s\S]*?)<\/div>/) || [])[1] || "").slice(0, 220);
    const date = (stripTags((card.match(/class="published-read">([\s\S]*?)<\/p>/) || [])[1] || "").match(/\d{1,2} [A-Za-z]+ \d{4}/) || [])[0];
    if (!link || !title || seen.has(link)) return null;
    seen.add(link);
    return { title, link, summary, updated: date ? parseDayMonthYear(date) : null };
  }).filter(Boolean);
}

function parseOfgemApi(text) {
  const items = (JSON.parse(text).items || []).map(i => i.markup || "");
  return parseOfgemListing(items.join("\n"));
}

// RenewableUK press releases: a featured story (<h5 title="01 September 2026">) and
// cards (<h5>29/09/26</h5>), each followed by a link to the release and an <h2> title.
function parseRenewableUKListing(html) {
  const seen = new Set();
  const out = [];
  const re = /<h5(?:\s+title="([^"]+)")?[^>]*>([^<]*)<\/h5>[\s\S]{0,400}?href="((?:https:\/\/www\.renewableuk\.com)?\/news-and-resources\/press-releases\/[^"#]+)"[\s\S]{0,200}?<h2[^>]*>([\s\S]*?)<\/h2>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, longDate, shortDate, href, rawTitle] = m;
    const link = absolute(href, "https://www.renewableuk.com");
    let updated = longDate ? parseDayMonthYear(longDate) : null;
    const dmy = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec((shortDate || "").trim());
    if (!updated && dmy) updated = new Date(Date.UTC(2000 + Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), 12)).toISOString();
    const title = stripTags(rawTitle);
    if (!title || seen.has(link)) continue;
    seen.add(link);
    out.push({ title, link, summary: "", updated });
  }
  return out;
}

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
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
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

// NESO's listing cuts long titles and summaries short with "…". For those,
// read the full headline from the article's <title> ("Headline | National
// Energy System Operator") and the full summary from its meta description.
const TRUNCATED = /(…|\.\.\.)\s*$/;

function metaContent(html, name) {
  const tag = (html.match(new RegExp(`<meta[^>]+(?:name|property)="${name}"[^>]*>`, "i")) || [])[0] || "";
  return decodeEntities((tag.match(/content="([^"]*)"/) || [])[1] || "").trim();
}

async function expandTruncated(entry) {
  if (!TRUNCATED.test(entry.title) && !TRUNCATED.test(entry.summary || "")) return entry;
  try {
    const res = await fetch(entry.link, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TheEnergyLedgerBot/1.0; +https://www.theenergyledger.co.uk)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return entry;
    const html = await res.text();
    const pageTitle = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/\s*\|[^|]*$/, "").trim();
    const description = metaContent(html, "description") || metaContent(html, "og:description");
    return {
      ...entry,
      // Only trust the page title if it starts like the shortened one.
      title: TRUNCATED.test(entry.title) && pageTitle && pageTitle.toLowerCase().startsWith(entry.title.replace(TRUNCATED, "").trim().toLowerCase().slice(0, 30))
        ? pageTitle : entry.title,
      summary: TRUNCATED.test(entry.summary || "") && description ? description.slice(0, 220) : entry.summary,
    };
  } catch {
    return entry; // keep the shortened version rather than drop the item
  }
}

// Feeds are asked for as XML, listing pages as HTML and Ofgem's API as JSON.
const HTML_PARSERS = new Set([parseNesoListing, parseRenewableUKListing]);
const JSON_PARSERS = new Set([parseOfgemApi]);
const UA = "Mozilla/5.0 (compatible; TheEnergyLedgerBot/1.0; +https://www.theenergyledger.co.uk)";

async function fetchFeed(url, sourceName, parser) {
  try {
    const html = HTML_PARSERS.has(parser);
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: JSON_PARSERS.has(parser)
          ? "application/json"
          : html
          ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          : "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });
    if (!res.ok) {
      console.log(`${sourceName}: fetch failed with status ${res.status}`);
      return [];
    }
    const body = await res.text();
    const entries = parser(body);
    if (!entries.length) {
      // Usually a changed page layout or a bot check: log enough to tell which.
      const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
      console.log(`${sourceName}: 0 items from ${res.status} ${res.headers.get("content-type") || ""}, ${body.length} bytes, title "${title.trim().slice(0, 80)}"`);
    }
    return entries.map(e => ({ ...e, source: sourceName }));
  } catch (err) {
    console.log(`${sourceName}: fetch error — ${err.message}. Skipping this source for this run.`);
    return [];
  }
}

// TEMPORARY: keep a copy of a response exactly as received here, so a parser
// can be matched to it. Remove once RenewableUK is confirmed working.
async function captureDebug(sourceName, url, status, body) {
  const slug = sourceName.toLowerCase().replace(/[^a-z]+/g, "-");
  await writeJsonIfChanged(`content/debug/news-${slug}.json`, { url, status, html: String(body).slice(0, 400000) }, `Debug capture of ${sourceName} listing page`)
    .catch(e => console.log(`debug capture failed: ${e.message}`));
}

// RenewableUK's page holds only a featured story; the list arrives when the
// page's own form posts back to the same address on load (an ASP.NET form with
// an anti-forgery token and cookie). Do the same: load the page, then post its
// form with the token and cookie, and parse the returned list.
async function fetchRenewableUK() {
  const source = "RenewableUK";
  try {
    const page = await fetch(RENEWABLEUK_PRESS, { headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-GB,en;q=0.9" } });
    const html = await page.text();
    const featured = parseRenewableUKListing(html);
    const form = (html.match(/<form[^>]+action="\/news-and-resources\/press-releases\/"[^>]*>([\s\S]*?)<\/form>/) || [])[1] || "";
    const fields = new URLSearchParams();
    for (const tag of form.match(/<input[^>]*>/g) || []) {
      const name = (tag.match(/name="([^"]*)"/) || [])[1];
      if (name) fields.append(name, decodeEntities((tag.match(/value="([^"]*)"/) || [])[1] || ""));
    }
    const setCookies = page.headers && typeof page.headers.getSetCookie === "function" ? page.headers.getSetCookie() : [(page.headers && page.headers.get("set-cookie")) || ""];
    const cookie = setCookies.flatMap(c => c.split(/,(?=\s*[^;,=\s]+=)/)).map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
    let listed = [];
    if ([...fields.keys()].length) {
      const res = await fetch(RENEWABLEUK_PRESS, {
        method: "POST",
        headers: { "User-Agent": UA, Accept: "text/html, */*", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest", Referer: RENEWABLEUK_PRESS, Origin: "https://www.renewableuk.com", ...(cookie ? { Cookie: cookie } : {}) },
        body: fields.toString(),
      });
      const body = await res.text();
      listed = res.ok ? parseRenewableUKListing(body) : [];
      if (!listed.length) {
        console.log(`${source}: list post returned ${res.status}, ${body.length} bytes, 0 items (fields: ${[...fields.keys()].join(", ")}; cookie ${cookie ? "sent" : "missing"})`);
        await captureDebug(source, RENEWABLEUK_PRESS + " [POST]", res.status, body);
      }
    } else {
      console.log(`${source}: list form not found on the page`);
    }
    const seen = new Set();
    return [...listed, ...featured].filter(e => !seen.has(e.link) && seen.add(e.link)).map(e => ({ ...e, source }));
  } catch (err) {
    console.log(`${source}: fetch error — ${err.message}. Skipping this source for this run.`);
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
    const [govukEntries, elnEntries, cbEntries, rnEurope, rnOffshore, ofgemEntries, nesoEntries, rukEntries] = await Promise.all([
      fetchFeed(GOVUK_FEED, "Dept for Energy Security & Net Zero", parseAtomEntries),
      fetchFeed(ENERGY_LIVE_NEWS_FEED, "Energy Live News", parseRssItems),
      fetchFeed(CARBON_BRIEF_FEED, "Carbon Brief", parseRssItems),
      fetchFeed(RENEWABLES_NOW_FEEDS[0], "Renewables Now", parseRssItems),
      fetchFeed(RENEWABLES_NOW_FEEDS[1], "Renewables Now", parseRssItems),
      fetchFeed(OFGEM_PRESS, "Ofgem", parseOfgemApi),
      fetchFeed(NESO_NEWS, "NESO", parseNesoListing),
      fetchRenewableUK(),
    ]);

    console.log(`gov.uk: ${govukEntries.length}, Energy Live News: ${elnEntries.length}, Carbon Brief: ${cbEntries.length}, ` +
      `Renewables Now: ${rnEurope.length + rnOffshore.length}, Ofgem: ${ofgemEntries.length}, NESO: ${nesoEntries.length}, RenewableUK: ${rukEntries.length} entries fetched.`);

    const notExcluded = e => !EXCLUDE_KEYWORDS.some(k => `${e.title} ${e.summary}`.toLowerCase().includes(k));
    const allEntries = [
      ...[...govukEntries, ...elnEntries].filter(e => isRelevant(e.title, e.summary)),
      ...[...cbEntries, ...rnEurope, ...rnOffshore].filter(e => isRelevant(e.title, e.summary) && isUK(e.title, e.summary)),
      // Official regulator, system operator and trade body news is always in scope.
      ...[...ofgemEntries, ...nesoEntries, ...rukEntries].filter(notExcluded),
    ];
    const seen = new Set();
    const latest = allEntries
      .filter(e => e.updated && !seen.has(e.link) && seen.add(e.link))
      .sort((a, b) => new Date(b.updated) - new Date(a.updated))
      .slice(0, MAX_ITEMS);
    const relevant = (await Promise.all(latest.map(e => (e.source === "NESO" ? expandTruncated(e) : e))))
      .map(e => ({
        title: e.title,
        link: e.link,
        summary: e.summary,
        source: e.source,
        topic: topicOf(e.title, e.summary),
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

// Every 6 hours, so the News page stays current through the day.
export const config = {
  schedule: "35 */6 * * *",
};
