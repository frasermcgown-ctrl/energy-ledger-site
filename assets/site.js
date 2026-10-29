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

// Load editable text from content/site-content.json (managed in /admin) into [data-key] elements.
// If the fetch fails, the hard-coded fallback text already in the page still shows.
if (document.querySelector('[data-key]')) {
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
    })
    .catch(() => {});
}

document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
