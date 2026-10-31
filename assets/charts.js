// The Energy Ledger — small SVG chart helpers (line and bar) with hover tooltips.
// Used by the Prices, Live Generation and UK gas pages. No dependencies.

(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const INK_3 = '#64748b', GRID = '#eef0f3', AXIS = '#d6dae1';

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  }

  // Round tick values: 3-5 ticks covering [min, max].
  function niceTicks(min, max, count = 4) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return ticks;
  }

  function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'bn';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'm';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
    return String(Math.round(v * 100) / 100);
  }

  function tooltip(wrap) {
    let tip = wrap.querySelector('.chart-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; wrap.appendChild(tip); }
    return tip;
  }

  function placeTip(tip, wrap, x, y) {
    tip.hidden = false;
    const w = tip.offsetWidth, W = wrap.clientWidth;
    tip.style.left = Math.max(0, Math.min(W - w, x - w / 2)) + 'px';
    tip.style.top = Math.max(0, y - tip.offsetHeight - 12) + 'px';
  }

  function legend(wrap, series) {
    if (series.length < 2) return;
    const lg = document.createElement('div');
    lg.className = 'chart-legend';
    lg.innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`).join('');
    wrap.appendChild(lg);
  }

  // series: [{ name, color, points: [{ x: Date, y: number }] }]
  // opts: { height, yFormat(v), xFormat(Date), tipDate(Date), area, label }
  function lineChart(wrap, series, opts = {}) {
    const draw = () => {
      wrap.innerHTML = '';
      wrap.classList.add('chart');
      const pts = series.flatMap(s => s.points);
      if (!pts.length) { wrap.innerHTML = '<p class="loading">No data yet.</p>'; return; }
      const W = Math.max(280, wrap.clientWidth), H = opts.height || 240;
      const m = { t: 12, r: 12, b: 28, l: 48 };
      const xs = pts.map(p => +p.x), ys = pts.map(p => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const yMin = opts.zero ? Math.min(0, ...ys) : Math.min(...ys), yMax = Math.max(...ys);
      const ticks = niceTicks(yMin - (opts.zero ? 0 : (yMax - yMin) * 0.05), yMax + (yMax - yMin) * 0.05);
      const ty0 = ticks[0], ty1 = ticks[ticks.length - 1];
      const X = v => m.l + ((v - x0) / Math.max(1, x1 - x0)) * (W - m.l - m.r);
      const Y = v => H - m.b - ((v - ty0) / (ty1 - ty0)) * (H - m.t - m.b);

      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opts.label || '' }, wrap);
      ticks.forEach(t => {
        el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: GRID, 'stroke-width': 1 }, svg);
        const tx = el('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: INK_3 }, svg);
        tx.textContent = (opts.yTick || compact)(t);
      });
      el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: AXIS, 'stroke-width': 1 }, svg);
      const nX = Math.max(2, Math.min(6, Math.floor((W - m.l - m.r) / 90)));
      // With opts.xStep (ms), ticks sit on round multiples of the step (e.g. every 12 hours).
      let xTicks = [];
      if (opts.xStep) {
        const first = Math.ceil(x0 / opts.xStep) * opts.xStep;
        for (let v = first; v <= x1; v += opts.xStep) xTicks.push(v);
        const every = Math.ceil(xTicks.length / nX);
        xTicks = xTicks.filter((_, i) => i % every === 0);
      } else {
        for (let i = 0; i < nX; i++) xTicks.push(x0 + (i / (nX - 1)) * (x1 - x0));
      }
      xTicks.forEach((v, i) => {
        const anchor = opts.xStep ? 'middle' : i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle';
        const tx = el('text', { x: X(v), y: H - 8, 'text-anchor': anchor, 'font-size': 11, fill: INK_3 }, svg);
        tx.textContent = (opts.xFormat || (d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })))(new Date(v));
      });

      series.forEach(s => {
        const p = s.points;
        if (!p.length) return;
        const d = p.map((q, i) => `${i ? 'L' : 'M'}${X(+q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join('');
        if (opts.area !== false) el('path', { d: `${d}L${X(+p[p.length - 1].x)},${Y(ty0)}L${X(+p[0].x)},${Y(ty0)}Z`, fill: s.color, 'fill-opacity': 0.08 }, svg);
        el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
        const last = p[p.length - 1];
        el('circle', { cx: X(+last.x), cy: Y(last.y), r: 4, fill: s.color, stroke: '#fff', 'stroke-width': 2 }, svg);
      });

      // Hover: crosshair + tooltip with every series' nearest point.
      const cross = el('line', { y1: m.t, y2: H - m.b, stroke: AXIS, 'stroke-width': 1, visibility: 'hidden' }, svg);
      const dots = series.map(s => el('circle', { r: 4, fill: s.color, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' }, svg));
      const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
      const tip = tooltip(wrap);
      const move = ev => {
        const r = svg.getBoundingClientRect();
        const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
        const xv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
        let rows = [], anchor = null;
        series.forEach((s, i) => {
          if (!s.points.length) return;
          const q = s.points.reduce((a, b) => Math.abs(+b.x - xv) < Math.abs(+a.x - xv) ? b : a);
          dots[i].setAttribute('cx', X(+q.x)); dots[i].setAttribute('cy', Y(q.y)); dots[i].setAttribute('visibility', 'visible');
          anchor = anchor || q;
          rows.push(`<div><i style="background:${s.color}"></i>${series.length > 1 ? escapeHtml(s.name) + ': ' : ''}<b>${escapeHtml((opts.yFormat || compact)(q.y))}</b></div>`);
        });
        if (!anchor) return;
        cross.setAttribute('x1', X(+anchor.x)); cross.setAttribute('x2', X(+anchor.x)); cross.setAttribute('visibility', 'visible');
        tip.innerHTML = `<div class="chart-tip-date">${escapeHtml((opts.tipDate || (d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })))(new Date(+anchor.x)))}</div>${rows.join('')}`;
        placeTip(tip, wrap, X(+anchor.x), Y(anchor.y));
      };
      const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); };
      hit.addEventListener('mousemove', move); hit.addEventListener('touchstart', move, { passive: true });
      hit.addEventListener('touchmove', move, { passive: true }); hit.addEventListener('mouseleave', leave);
      legend(wrap, series);
    };
    draw();
    observe(wrap, draw);
  }

  // bars: [{ label, value, tip (html), faded }]; opts: { height, color, yFormat, label }
  function barChart(wrap, bars, opts = {}) {
    const draw = () => {
      wrap.innerHTML = '';
      wrap.classList.add('chart');
      if (!bars.length) { wrap.innerHTML = '<p class="loading">No data yet.</p>'; return; }
      const W = Math.max(280, wrap.clientWidth), H = opts.height || 240;
      const m = { t: 20, r: 8, b: 28, l: 48 };
      const vals = bars.map(b => b.value);
      const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals));
      const ty0 = ticks[0], ty1 = ticks[ticks.length - 1];
      const Y = v => H - m.b - ((v - ty0) / (ty1 - ty0)) * (H - m.t - m.b);
      const band = (W - m.l - m.r) / bars.length;
      const bw = Math.min(24, band - 2);
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opts.label || '' }, wrap);
      ticks.forEach(t => {
        el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? AXIS : GRID, 'stroke-width': 1 }, svg);
        const tx = el('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: INK_3 }, svg);
        tx.textContent = (opts.yTick || compact)(t);
      });
      const tip = tooltip(wrap);
      const every = Math.ceil(bars.length / Math.max(2, Math.floor((W - m.l - m.r) / 44)));
      bars.forEach((b, i) => {
        const cx = m.l + band * (i + 0.5);
        const y0 = Y(0), y1 = Y(b.value), top = Math.min(y0, y1), h = Math.max(1, Math.abs(y0 - y1));
        const r = Math.min(4, h, bw / 2);
        // Rounded data end, square at the baseline.
        const up = b.value >= 0;
        const x = cx - bw / 2;
        const d = up
          ? `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${y0}Z`
          : `M${x},${y0}V${top + h - r}Q${x},${top + h} ${x + r},${top + h}H${x + bw - r}Q${x + bw},${top + h} ${x + bw},${top + h - r}V${y0}Z`;
        el('path', { d, fill: b.color || opts.color || '#0f172a', 'fill-opacity': b.faded ? 0.45 : 1 }, svg);
        if (i % every === 0 || i === bars.length - 1) {
          const tx = el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: INK_3 }, svg);
          tx.textContent = b.label;
        }
        const hit = el('rect', { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' }, svg);
        const show = () => { tip.innerHTML = b.tip || `${escapeHtml(b.label)}: <b>${escapeHtml((opts.yFormat || compact)(b.value))}</b>`; placeTip(tip, wrap, cx, top); };
        hit.addEventListener('mouseenter', show); hit.addEventListener('touchstart', show, { passive: true });
        hit.addEventListener('mouseleave', () => { tip.hidden = true; });
      });
    };
    draw();
    observe(wrap, draw);
  }

  // Redraw when the container width changes (responsive charts).
  function observe(wrap, draw) {
    if (!window.ResizeObserver) return;
    let last = wrap.clientWidth, t;
    new ResizeObserver(() => {
      if (Math.abs(wrap.clientWidth - last) < 8) return;
      last = wrap.clientWidth; clearTimeout(t); t = setTimeout(draw, 120);
    }).observe(wrap);
  }

  window.ELCharts = { lineChart, barChart, compact };
})();
