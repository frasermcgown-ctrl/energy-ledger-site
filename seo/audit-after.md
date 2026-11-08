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

1. **Load the Netlify Identity widget only when needed.** The home page loads `netlify-identity-widget.js` for every visitor so that CMS invite and password-reset links landing on `/` work. It could load only when the URL carries an identity token. I left it alone because a mistake here would break CMS invites, and it can't be tested without a real invite link.
2. **Long cache for the font file.** A `Cache-Control: public, max-age=31536000, immutable` header for `/assets/fonts/*` in `netlify.toml` would save a revalidation request on repeat visits. It's safe as long as a changed font gets a new filename.
3. **UK gas storage stock levels.** The storage page shows flow rates only, because no current feed has stock levels ("how full"). A new scheduled function would be needed, for example from GIE AGSI+, which uses the same GIE API key, if it covers the GB sites. This means touching the scheduled functions, so it's out of scope here.
