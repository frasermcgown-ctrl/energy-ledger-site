// Shared helpers for the scheduled functions: read and write JSON files in
// content/ via the GitHub contents API. A commit triggers Netlify's normal
// auto-deploy, so the site picks the new data up.

const OWNER = "frasermcgown-ctrl";
const REPO = "energy-ledger-site";

function apiUrl(path) {
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "energy-ledger-data-fetch",
  };
}

// Returns { sha, data } for an existing file, or { sha: undefined, data: null }.
export async function readJson(path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { sha: undefined, data: null };
  try {
    const res = await fetch(apiUrl(path), { headers: headers(token) });
    if (!res.ok) return { sha: undefined, data: null };
    const body = await res.json();
    return { sha: body.sha, data: JSON.parse(Buffer.from(body.content, "base64").toString("utf8")) };
  } catch (e) {
    return { sha: undefined, data: null };
  }
}

// Writes data to path unless `same(existing)` says nothing changed.
// `data` gets an `updated` timestamp; `same` compares without it.
//
// Several scheduled functions commit to the same branch. If two commits land
// at once GitHub rejects the later one (409 conflict), so re-read and retry a
// few times with a random pause rather than lose the update.
const COMMIT_ATTEMPTS = 4;

export async function writeJsonIfChanged(path, data, message) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN not set — skipping commit, function will retry next run.");
    return false;
  }
  const strip = obj => { if (!obj) return null; const { updated, ...rest } = obj; return rest; };

  for (let attempt = 1; attempt <= COMMIT_ATTEMPTS; attempt++) {
    const { sha, data: existing } = await readJson(path);
    if (existing && JSON.stringify(strip(existing)) === JSON.stringify(strip(data))) {
      console.log(`${path} unchanged — skipping commit.`);
      return false;
    }

    const content = Buffer.from(
      JSON.stringify({ updated: new Date().toISOString(), ...strip(data) }, null, 2) + "\n"
    ).toString("base64");
    const res = await fetch(apiUrl(path), {
      method: "PUT",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ message, content, ...(sha ? { sha } : {}) }),
    });
    if (res.ok) {
      console.log(`Committed ${path}.`);
      return true;
    }
    const detail = await res.text();
    if ((res.status === 409 || res.status === 422) && attempt < COMMIT_ATTEMPTS) {
      const wait = 1000 + Math.floor(Math.random() * 3000) * attempt;
      console.log(`GitHub commit of ${path} clashed (${res.status}); retrying in ${wait} ms.`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    console.error(`GitHub commit of ${path} failed:`, res.status, detail);
    return false;
  }
  return false;
}

export async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`${url.split("?")[0]} status ${res.status}`);
  return res.json();
}

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(n, from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
