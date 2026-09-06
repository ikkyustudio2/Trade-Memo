// Lightweight SVG charts (no deps). Each function returns an HTML string.
// Hover tooltips: elements carry data-tip; app.js wires a single tooltip layer.

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

const fmtShort = n => {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return Number.isInteger(n) ? String(n) : n.toFixed(a < 10 ? 2 : 0);
};

// Equity curve: points [{cum, date, net}]
export function lineChart(points, { width = 800, height = 220, fmt = fmtShort, emptyText = 'ยังไม่มีข้อมูล' } = {}) {
  const W = Math.max(280, width), H = height, padL = 52, padR = 14, padT = 14, padB = 28;
  if (!points.length) return emptyBox(emptyText, H);
  const vals = points.map(p => p.cum);
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const x = i => padL + (points.length === 1 ? (W - padL - padR) / 2 : (i / (points.length - 1)) * (W - padL - padR));
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const last = points[points.length - 1];
  const posClass = last.cum >= 0 ? 'pos' : 'neg';
  let s = `<svg class="chart line-chart ${posClass}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="เส้นกำไรสะสม">`;
  s += `<defs><linearGradient id="lg-${posClass}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient></defs>`;
  for (const t of ticks) {
    s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`;
    s += `<text class="tick" x="${padL - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${fmt(t)}</text>`;
  }
  s += `<line class="zero" x1="${padL}" x2="${W - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`;
  s += `<path class="area" d="${area}" fill="url(#lg-${posClass})"/>`;
  s += `<path class="line" d="${path}"/>`;
  // hover targets
  const step = points.length > 1 ? (W - padL - padR) / (points.length - 1) : W;
  points.forEach((p, i) => {
    const tip = `${p.date}\nสะสม: ${fmt(p.cum)}\nรายการนี้: ${p.net >= 0 ? '+' : ''}${fmt(p.net)}`;
    s += `<rect class="hit" x="${(x(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}" data-tip="${esc(tip)}" data-cx="${x(i).toFixed(1)}" data-cy="${y(p.cum).toFixed(1)}"/>`;
  });
  s += `<circle class="cursor" r="5" cx="-50" cy="-50"/>`;
  // x labels: first, middle, last
  const idxs = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  for (const i of idxs) {
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    s += `<text class="tick" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${points[i].date.slice(5)}</text>`;
  }
  s += `</svg>`;
  return s;
}

// Bar chart: items [{label, value, tip}]
export function barChart(items, { width = 800, height = 200, fmt = fmtShort, emptyText = 'ยังไม่มีข้อมูล', maxLabels } = {}) {
  const W = Math.max(280, width), H = height, padL = 52, padR = 14, padT = 14, padB = 28;
  if (!maxLabels) maxLabels = Math.max(4, Math.floor((W - padL - padR) / 56));
  if (!items.length || items.every(i => i.value === 0 && !i.has)) return emptyBox(emptyText, H);
  const vals = items.map(i => i.value);
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const n = items.length;
  const slot = (W - padL - padR) / n;
  const bw = Math.max(2, Math.min(28, slot * 0.7));
  let s = `<svg class="chart bar-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="กำไรขาดทุนรายวัน">`;
  for (const t of ticks) {
    s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`;
    s += `<text class="tick" x="${padL - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${fmt(t)}</text>`;
  }
  s += `<line class="zero" x1="${padL}" x2="${W - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`;
  const labelEvery = Math.ceil(n / maxLabels);
  items.forEach((it, i) => {
    const cx = padL + slot * i + slot / 2;
    const y0 = y(0), y1 = y(it.value);
    const top = Math.min(y0, y1), h = Math.max(1.5, Math.abs(y1 - y0));
    const cls = it.value > 0 ? 'pos' : it.value < 0 ? 'neg' : 'flat';
    const tip = it.tip || `${it.label}\n${it.value >= 0 ? '+' : ''}${fmt(it.value)}`;
    s += `<rect class="hit" x="${(cx - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" data-tip="${esc(tip)}"/>`;
    s += `<rect class="bar ${cls}" x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 2)}"/>`;
    if (i % labelEvery === 0) s += `<text class="tick" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  s += `</svg>`;
  return s;
}

// Calendar heatmap for one month: days [{date, net, has, count}]; month index & year
export function calendarMonth(year, month, dayMap, { onDayAttr = 'data-date' } = {}) {
  const first = new Date(year, month, 1);
  const daysIn = new Date(year, month + 1, 0).getDate();
  const startDow = (first.getDay() + 6) % 7; // Monday = 0
  const maxAbs = Math.max(1, ...[...dayMap.values()].map(d => Math.abs(d.net)));
  let s = `<div class="cal"><div class="cal-head">${['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map(d => `<span>${d}</span>`).join('')}</div><div class="cal-grid">`;
  for (let i = 0; i < startDow; i++) s += `<span class="cal-cell empty"></span>`;
  for (let d = 1; d <= daysIn; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const info = dayMap.get(key);
    let cls = 'cal-cell', style = '', tip = key;
    if (info && info.count) {
      const inten = 0.25 + 0.75 * Math.min(1, Math.abs(info.net) / maxAbs);
      cls += info.net > 0 ? ' pos' : info.net < 0 ? ' neg' : ' flat';
      style = `--i:${inten.toFixed(2)}`;
      tip = `${key}\n${info.net >= 0 ? '+' : ''}${fmtShort(info.net)} · ${info.count} เทรด`;
    } else if (info && info.hasNote) {
      cls += ' noted';
      tip = `${key}\nมีบันทึก`;
    }
    s += `<button class="${cls}" style="${style}" ${onDayAttr}="${key}" data-tip="${esc(tip)}"><span class="d">${d}</span>${info && info.count ? `<span class="v">${info.net >= 0 ? '+' : ''}${fmtShort(info.net)}</span>` : ''}</button>`;
  }
  s += `</div></div>`;
  return s;
}

// Winrate donut (single hue + track)
export function donut(ratio, label, { size = 120 } = {}) {
  const r = 44, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, ratio || 0));
  return `<svg class="donut" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${esc(label)}">
    <circle class="track" cx="60" cy="60" r="${r}"/>
    <circle class="val" cx="60" cy="60" r="${r}" stroke-dasharray="${(c * pct).toFixed(1)} ${(c * (1 - pct)).toFixed(1)}" transform="rotate(-90 60 60)"/>
    <text class="big" x="60" y="60" text-anchor="middle" dominant-baseline="central">${(pct * 100).toFixed(0)}%</text>
    <text class="sub" x="60" y="84" text-anchor="middle">${esc(label)}</text>
  </svg>`;
}

function emptyBox(text, h) {
  return `<div class="chart-empty" style="height:${h}px">${esc(text)}</div>`;
}
