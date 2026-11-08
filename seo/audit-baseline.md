# SEO audit — baseline

Date: 8 November 2026. Commit audited: `9f25a49` (branch `claude/cool-planck-mdrerh`, identical to `main` at the time).

## How this was measured

- The live domain could not be reached from the audit environment (its network proxy blocks theenergyledger.co.uk and most third-party sites). The audit was therefore run against the repository served locally (`python3 -m http.server`), with live JSON pulled from raw.githubusercontent.com exactly as production does.
- Lighthouse 12, mobile form factor, default throttling, headless Chromium.
- **Caveat on performance numbers:** the local server does not gzip/brotli, sends no cache headers and has no CDN, so "text compression" and "cache TTL" findings are artefacts of the test server, not of Netlify. Treat performance scores as a relative baseline for before/after, not as production figures. A run against the Netlify deploy preview (PageSpeed Insights) is the authoritative check.
- Google Analytics requests failed in the sandbox, which produces the "errors in console" Best Practices deduction. That is also a test artefact.

## Headline findings

1. **There are no article pages on this site.** Every newsletter issue lives on Substack (home.theenergyledger.co.uk). The site lists them from `content/substack-posts.json` and links out. There is no article template, and the Decap CMS has no articles collection (only Website Text, Ofgem Price Cap and UK Carbon Auctions). Steps 2, 4, 6 and 7 as written assume articles exist here. See "Questions" below.
2. **Substack already self-canonicalises and emits NewsArticle JSON-LD.** Checked on the 6 Nov issue: `<link rel="canonical" href="https://home.theenergyledger.co.uk/p/gas-falls-about-16-in-a-week-as-the">` and a `NewsArticle` block. So Substack is already the canonical home for issues.
3. **A lot of the basics are already in place**: unique titles and descriptions on every page, canonical tags (except `status.html`, which is `noindex`), Open Graph and `twitter:card`, `robots.txt` referencing the sitemap, `sitemap.xml`, Organization + WebSite JSON-LD on the home page, Dataset JSON-LD on four data pages, one H1 per page, plain-English explainer sections, breadcrumbs.
4. **The hourly data commits already do not trigger rebuilds.** `netlify.toml` has `ignore = "git diff --quiet ... -- . ':(exclude)content/'"`, so content-only commits skip the build. In the last 7 days there were 50 commits, of which 1 touched files outside `content/`. Pages fetch the JSON from raw.githubusercontent.com at view time. Nothing to fix for step 8's rebuild question; I could not confirm skipped builds in the Netlify deploy log from here.

## Titles and meta descriptions

Lengths are characters after decoding `&amp;`. Targets: title ≤ 60, description ≤ 155.

| Page | Title | Len | Description len | Issues |
|---|---|---|---|---|
| `/` | The Energy Ledger — UK gas, power, carbon & LNG, weekly | 55 | **186** | Description too long. "weekly" is out of date (now twice weekly). |
| `/prices.html` | UK Gas & Power Prices, Price Cap and Balancing Costs — The Energy Ledger | **72** | 155 | Title too long. |
| `/generation.html` | Live GB Generation & Carbon Intensity — The Energy Ledger | 57 | 155 | OK. |
| `/uk-gas.html` | Live UK Gas Supply, Demand and Storage — The Energy Ledger | 58 | **175** | Description too long. |
| `/lng.html` | Live European LNG Terminal Data — The Energy Ledger | 51 | 135 | Doesn't mention UK terminals, which the page leads with. |
| `/news.html` | UK Energy News: Gas, Power, Carbon and LNG — The Energy Ledger | **62** | **156** | Both marginally long. |
| `/sources.html` | Data Sources and Attribution — The Energy Ledger | 48 | 150 | OK. |
| `/status.html` | Data Status — The Energy Ledger | 31 | 90 | `noindex, nofollow` (intentional). OK. |

- No duplicate titles or descriptions.
- Only the home page has `twitter:title/description/image` and `og:image:width/height`. Other pages rely on OG fallbacks (works on X, but explicit tags are cleaner). All pages share one `og-image.png` (1200×630, 141 KB).

## Headings

- Exactly one H1 per page. The home page H1 is "Welcome to the Energy Ledger." — no topical keywords.
- Lighthouse `heading-order` fails on every page except the home page: the shared footer uses `<h4>` column headings ("Newsletter", "Live data", "Follow") directly after `<h2>`. `news.html` also jumps to `<h3>` in the item list.

## Canonicals, sitemap, robots

- Canonicals: present and self-referencing on all indexable pages. `status.html` has none (it is `noindex`, so acceptable).
- `robots.txt`: present, disallows `/admin/`, references the sitemap.
- `sitemap.xml`: present, 7 URLs, correctly excludes `status.html`. `lastmod` is a hand-written static date (2026-11-02) that won't move as data updates.
- URLs use `.html` suffixes. Netlify serves pretty URLs too (`/prices`) unless disabled; worth confirming in the deploy preview that the non-`.html` form redirects or canonicalises cleanly.

## Structured data

| Page | JSON-LD |
|---|---|
| `/` | Organization + WebSite (valid JSON) |
| `/prices.html`, `/generation.html`, `/uk-gas.html`, `/lng.html` | Dataset |
| `/news.html`, `/sources.html`, `/status.html` | none |

No `BreadcrumbList` despite visible breadcrumbs. No `NewsArticle` on this site (there are no articles here; Substack provides it).

## Images

- No `<img>` elements on any page: the logo and icons are inline SVG, charts are drawn in script. Nothing missing alt text, nothing to lazy-load.
- `brand/` holds 18 PNGs (4 KB to 398 KB). None is referenced by any page; they are social/brand assets and do not affect page weight. They are publicly served, which is fine.

## Mobile layout

Checked at iPhone 13 (390 px) on all 8 pages: no horizontal overflow, viewport meta present, no tap-target failures in Lighthouse. Three pieces of text on the home page render under 12 px.

## Broken links

- Internal: 11 URLs crawled from the home page, 0 broken.
- External: 33 unique outbound links. These **could not be verified** from the audit environment (proxy blocked them). Recommend a link check from your own machine or a crawler such as Screaming Frog.

## Lighthouse (mobile, local server)

| Page | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| index | 98 | 95 | 96 | 100 | 1.9 s | 0 | 0 ms |
| prices | 99 | 94 | 96 | 100 | 1.7 s | 0 | 0 ms |
| generation | 99 | 93 | 96 | 100 | 1.7 s | 0 | 0 ms |
| uk-gas | 99 | 92 | 96 | 100 | 1.6 s | 0 | 0 ms |
| lng | 99 | 92 | 96 | 100 | 1.7 s | 0 | 0 ms |
| news | 99 | 94 | 96 | 100 | 1.7 s | 0 | 0 ms |
| sources | 99 | 93 | 96 | 100 | 1.7 s | 0 | 0 ms |
| status | 99 | 94 | 96 | 63* | 1.7 s | 0 | 0 ms |

\* `status.html` loses SEO points only for `noindex`, which is deliberate.

Lighthouse flags (real, not test artefacts):
- **Colour contrast** (all pages): muted grey text — footer tagline/copyright, footer `<h4>`s, home "this week in numbers" labels (`.wk-label`, `.wk-sub`), `.section-desc`, `.tag` pills on news, the 30d/365d range buttons on prices.
- **Heading order** (7 pages): footer `<h4>` as above.
- **Render-blocking resources** (~0.9 s estimated): the Google Fonts stylesheet, `site.css`, `site.js` (and `charts.js` on prices/generation) all load in `<head>` without `defer`.
- Minor: ~2 KB unminified CSS/JS; ~11 KB unused CSS on news/sources.
- `netlify-identity-widget.js` loads on the home page for every visitor (needed for CMS invite/recovery links landing on `/`). Could be loaded only when the URL has an identity token.

## What this means for the plan

| Step | Status from audit |
|---|---|
| 2 Metadata | Partly needed: 4 over-length titles/descriptions, "weekly" wording, explicit Twitter/OG image tags on inner pages. |
| 3 Canonicals/sitemap/robots | Mostly done. Needs your canonical decision only if articles will be published here. Sitemap lastmod could be generated. |
| 4 JSON-LD | Organization/WebSite/Dataset done. Gaps: BreadcrumbList, Dataset `dateModified`, Dataset for any new data pages. NewsArticle only applies if articles live here. |
| 5 Evergreen data pages | Real gap. Current pages bundle several feeds each; there is no dedicated page for UK gas storage, NBP/TTF, carbon intensity or GB power prices targeting those queries. Note: TTF is not in any current feed (only NBP SAP and EU power), and "LNG arrivals" isn't a feed either: we have GIE ALSI terminal inventory/send-out and NGT terminal flows, not ship arrivals. |
| 6 Internal linking / tag pages | Possible on this site using `substack-posts.json` (title/subtitle keyword matching), but the issues themselves are on Substack. |
| 7 Article template | No template exists here. Would need a new CMS collection and article pages. |
| 8 Performance/images | No images to compress. Rebuild issue already solved. Real items: render-blocking fonts/scripts, contrast, heading order. |
