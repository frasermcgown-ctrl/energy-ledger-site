// Regenerates sitemap.xml from the site's HTML pages.
// Run from the repository root:  node seo/build-sitemap.mjs
//
// A page is included when it has a <link rel="canonical"> and no noindex
// robots tag. Its <lastmod> is the date of the last git commit that touched
// the file (or today, if it isn't committed yet). Data refreshes in content/
// don't change page files, so they don't move lastmod.
// Not run during Netlify builds: re-run it and commit when pages are added.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SKIP_DIRS = new Set(['.git', 'admin', 'netlify', 'node_modules', 'content', 'assets', 'brand', 'seo']);

function htmlFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(name) ? [] : htmlFiles(p);
    return name.endsWith('.html') ? [p] : [];
  });
}

function lastmod(file) {
  try {
    const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { encoding: 'utf8' }).trim();
    if (d) return d;
  } catch {}
  return new Date().toISOString().slice(0, 10);
}

const entries = htmlFiles('.')
  .map(file => {
    const html = readFileSync(file, 'utf8');
    const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    if (!canonical || /<meta name="robots" content="[^"]*noindex/.test(html)) return null;
    return { loc: canonical, lastmod: lastmod(file) };
  })
  .filter(Boolean)
  .sort((a, b) => (a.loc.length - b.loc.length) || a.loc.localeCompare(b.loc));

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e => `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n  </url>`).join('\n')}
</urlset>
`;
writeFileSync('sitemap.xml', xml);
console.log(`sitemap.xml: ${entries.length} URLs`);
