// Data files (content/*.json) are updated by scheduled functions that commit
// to GitHub. Netlify skips rebuilding for data-only commits (see netlify.toml),
// so each update costs no deploy credits; pages read the latest copy straight
// from the public GitHub repository instead, falling back to the copy deployed
// with the site if GitHub can't be reached.
(function () {
  const DATA_BASE = 'https://raw.githubusercontent.com/frasermcgown-ctrl/energy-ledger-site/main/content/';
  const localFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : '';
    const m = /^\/content\/([\w.-]+\.json)(\?.*)?$/.exec(url);
    if (!m) return localFetch(input, init);
    return localFetch(DATA_BASE + m[1], init)
      .then(r => (r.ok ? r : Promise.reject(new Error('GitHub ' + r.status))))
      .catch(() => localFetch(input, init));
  };
})();

// The Energy Ledger — shared behaviour for every page.

// Mobile nav toggle
(function () {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('nav.links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  links.addEventListener('click', e => {
    if (e.target.closest('a')) {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
})();

// Escape text from external feeds before it goes into innerHTML.
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtNumber(n, digits) {
  if (n === null || n === undefined || isNaN(n)) return null;
  return Number(n).toLocaleString('en-GB', { maximumFractionDigits: digits === undefined ? 1 : digits });
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

// Social media icon buttons. Links come from the social_* fields in /admin
// (content/site-content.json); a platform's icon only shows once its link is set.
// Icons: Simple Icons (CC0) and Bootstrap Icons (MIT, LinkedIn).
const SOCIALS = [
  { key: 'social_linkedin', label: 'LinkedIn', hosts: ["linkedin.com"], viewBox: '0 0 16 16',
    path: 'M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z' },
  { key: 'social_x', label: 'X', hosts: ["x.com", "twitter.com"], viewBox: '0 0 24 24',
    path: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z' },
  { key: 'social_bluesky', label: 'Bluesky', hosts: ["bsky.app"], viewBox: '0 0 24 24',
    path: 'M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026' },
  { key: 'social_threads', label: 'Threads', hosts: ["threads.net", "threads.com"], viewBox: '0 0 24 24',
    path: 'M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z' },
  { key: 'social_instagram', label: 'Instagram', hosts: ["instagram.com"], viewBox: '0 0 24 24',
    path: 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077' },
  { key: 'social_facebook', label: 'Facebook', hosts: ["facebook.com"], viewBox: '0 0 24 24',
    path: 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z' },
  { key: 'social_tiktok', label: 'TikTok', hosts: ["tiktok.com"], viewBox: '0 0 24 24',
    path: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z' },
  { key: 'social_youtube', label: 'YouTube', hosts: ["youtube.com"], viewBox: '0 0 24 24',
    path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' },
  { key: 'social_substack', label: 'Substack', hosts: ["theenergyledger.co.uk", "substack.com"], viewBox: '0 0 24 24',
    path: 'M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z' },
];

function socialUrl(net, value) {
  try {
    const u = new URL(String(value || '').trim());
    if (u.protocol === 'http:') u.protocol = 'https:';
    const host = u.hostname.replace(/^www\./, '');
    if (u.protocol === 'https:' && net.hosts.some(h => host === h || host.endsWith('.' + h))) return u.href;
  } catch (e) {}
  return null;
}

function renderSocials(data) {
  const links = SOCIALS.map(net => ({ net, url: socialUrl(net, data[net.key]) })).filter(s => s.url);
  if (!links.length) return;
  const html = links.map(({ net, url }) =>
    `<a class="social" href="${escapeHtml(url)}" target="_blank" rel="noopener me" aria-label="The Energy Ledger on ${net.label}" title="${net.label}">` +
    `<svg viewBox="${net.viewBox}" aria-hidden="true" focusable="false"><path d="${net.path}"/></svg></a>`
  ).join('');
  document.querySelectorAll('[data-socials]').forEach(el => { el.innerHTML = html; });
}

// Load editable text from content/site-content.json (managed in /admin) into [data-key] elements,
// and render the social icon buttons. If the fetch fails, the hard-coded fallbacks in the page still show.
if (document.querySelector('[data-key], [data-socials]')) {
  fetch('/content/site-content.json')
    .then(r => r.json())
    .then(data => {
      document.querySelectorAll('[data-key]').forEach(el => {
        const key = el.getAttribute('data-key');
        if (data[key] === undefined) return;
        if (el.getAttribute('data-html') === 'true') {
          el.innerHTML = data[key];
        } else {
          el.textContent = data[key];
        }
      });
      renderSocials(data);
    })
    .catch(() => {});
}

document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
