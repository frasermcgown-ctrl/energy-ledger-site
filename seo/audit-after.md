# SEO audit: after

Date: 8 November 2026. Branch `claude/cool-planck-mdrerh`. Compare with [audit-baseline.md](audit-baseline.md).

## How this was measured

Same method as the baseline: the repository served locally, live JSON from raw.githubusercontent.com, Lighthouse 12, mobile, default throttling. The same caveats apply:

- The local server has no compression, caching or CDN, so performance figures are only good for comparing before and after. Run PageSpeed Insights on the Netlify deploy preview for production figures.
- Best Practices is 96 on every page in both runs because Google Analytics can't load in the test sandbox. That's a test artefact.
- External APIs called from the browser (NESO Carbon Intensity, Elexon) are blocked in the sandbox. The carbon intensity page was checked separately with mocked API responses.

## Lighthouse: original pages

| Page | Perf before → after | A11y before → after | SEO | FCP before → after | LCP before → after | CLS before → after | Render-blocking (est.) before → after |
|---|---|---|---|---|---|---|---|
| index | 98 → 100 | 95 → 100 | 100 | 1.9 → 1.2 s | 1.9 → 1.7 s | 0 → 0 | 950 → 301 ms |
| prices | 99 → 100 | 94 → 100 | 100 | 1.7 → 1.2 s | 1.7 → 1.7 s | 0 → 0 | 910 → 310 ms |
| generation | 99 → 100 | 93 → 100 | 100 | 1.7 → 1.2 s | 1.7 → 1.7 s | 0 → 0 | 950 → 462 ms |
| uk-gas | 99 → 100 | 92 → 100 | 100 | 1.6 → 1.1 s | 1.6 → 1.5 s | 0 → 0 | 883 → 310 ms |
| lng | 99 → 100 | 92 → 100 | 100 | 1.7 → 1.1 s | 1.7 → 1.5 s | 0 → 0 | 921 → 318 ms |
| news | 99 → 100 | 94 → 100 | 100 | 1.7 → 1.1 s | 1.7 → 1.5 s | 0 → 0 | 927 → 302 ms |
| sources | 99 → 100 | 93 → 100 | 100 | 1.7 → 1.1 s | 1.7 → 1.5 s | 0 → 0 | 917 → 300 ms |
| status (noindex) | 99 → 93 | 94 → 100 | 63 → 63* | 1.7 → 1.1 s | 1.7 → 1.5 s | 0 → 0.17† | 887 → 284 ms |

\* SEO 63 is the deliberate `noindex`.
† The status table has always pushed the note below it down when it loads (0.52 when traced directly on the baseline commit). The baseline Lighthouse run missed it because the font wait hid it. It's now reserved space and smaller, but not zero. The page is internal and noindex.

Total blocking time was 0 ms in both runs on every page. The remaining render-blocking items are the site's own `site.css` and `site.js`, which are small and same-origin.

## Lighthouse: new pages

| Page | Perf | A11y | Best practices | SEO | FCP | LCP | CLS |
|---|---|---|---|---|---|---|---|
| nbp-gas-price | 100 | 100 | 96 | 100 | 1.2 s | 1.7 s | 0 |
| uk-power-prices | 100 | 100 | 96 | 100 | 1.2 s | 1.7 s | 0 |
| uk-carbon-intensity | 100 | 100 | 96 | 100 | 1.2 s | 1.7 s | 0.011 |
| uk-gas-storage | 100 | 100 | 96 | 100 | 1.1 s | 1.5 s | 0 |
| topics/ (index) | 100 | 100 | 96 | 100 | 0.9 s | 1.4 s | 0 |
| topics/hormuz | 100 | 100 | 96 | 100 | 1.1 s | 1.5 s | 0 |
| topics/gas-storage | 100 | 100 | 96 | 100 | 0.9 s | 1.4 s | 0 |
| topics/price-cap | 100 | 100 | 96 | 100 | 1.1 s | 1.5 s | 0 |
| topics/grid | 100 | 100 | 96 | 100 | 0.9 s | 1.4 s | 0 |
| topics/power-prices | 100 | 100 | 96 | 100 | 0.9 s | 1.4 s | 0 |

## Other measurable changes

| Item | Before | After |
|---|---|---|
| Indexable pages in sitemap | 7 | 17 |
| Titles over 60 characters | 2 | 0 |
| Descriptions over 155 characters | 3 | 0 |
| Pages with full Twitter card tags | 1 of 8 | 18 of 18 |
| Pages with JSON-LD | 5 of 8 | 17 of 18 (status excluded) |
| Pages with BreadcrumbList | 0 | 16 |
| Lighthouse heading-order failures | 7 pages | 0 |
| Lighthouse colour-contrast failures | 8 pages | 0 |
| Third-party requests needed before first paint | Google Fonts CSS + font file | none (font self-hosted, 48 KB) |
| Links from data pages to newsletter issues | 0 | 3 latest related issues on each of 8 data pages |
| Topic pages | 0 | 5 + index |

## Netlify rebuilds from hourly data commits

No change needed. `netlify.toml` already skips the build when a commit only touches `content/`, and pages read the latest JSON from GitHub at view time. In the 7 days before this audit, 1 of 50 commits touched anything outside `content/`. I couldn't open the Netlify deploy log from here to confirm the skipped builds. Check Deploys in the Netlify UI: data commits should show as "Skipped" or "Canceled".

## Proposed, not applied

1. **Load the Netlify Identity widget only when needed.** Applied later at your request. The home page now loads the widget only when the URL carries an identity token (invite, recovery, confirmation, email change or sign-in), the same tokens the widget itself looks for. Tested in a browser with the widget's published build and a mocked identity API: a normal visit makes no request to identity.netlify.com; an invite link loads the widget, accepts a password and redirects to /admin/. The /admin page itself is unchanged.
2. **Long cache for the font file.** Applied later at your request: `/assets/fonts/*` is served with `Cache-Control: public, max-age=31536000, immutable`, so repeat visits skip the revalidation request. If the font is ever replaced, give the file a new name.
3. **UK gas storage stock levels.** Applied later at your request: a new scheduled function, `netlify/functions/fetch-uk-storage.mjs`, reads GIE AGSI for the United Kingdom (country GB, covered as non-EU since 31 Dec 2020) twice each evening, using the existing `GIE_API_KEY`, and writes `content/uk-storage-levels.json`. The storage page shows % full, TWh in storage, the daily change, the same day last year and a year's chart, and stays hidden until the first run. Existing functions are unchanged.

## Follow-up from Netlify traffic logs (7 days to 8 Nov)

Read through the Netlify connector after the main work:

- **Hourly data commits:** confirmed in the deploy list. Each automated commit shows "Canceled build due to no content change".
- **URL forms:** visitors reached pages more often without `.html` (e.g. `/uk-gas` 24 vs `/uk-gas.html` 13). Canonicals, `og:url`, JSON-LD, the sitemap and all internal links now use the short form (`/prices`, `/topics/hormuz`). The `.html` addresses still work and carry the short canonical.
- **`/favicon.ico`:** returned 404 (12 times). Added `favicon.ico` (16/32/48 px) and `apple-touch-icon.png` (180 px), made from the brand mark.
- **`/blog`:** returned 404 (4 times). Now 301-redirects to the Substack archive (`netlify.toml`).
- Other 404s were bots probing for `.env`, `.git/config` and `phpinfo.php` (nothing exposed), and crawlers guessing `/news_sitemap.xml`.
