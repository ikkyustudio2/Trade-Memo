// Statistics: metrics from trade lists, period grouping

export function tradeNet(t) {
  const pnl = Number(t.pnl) || 0;
  const comm = Number(t.commission) || 0;
  const swap = Number(t.swap) || 0;
  return pnl + comm + swap; // commission/swap are typically negative in MT5
}

export function tradeResult(t) {
  const n = tradeNet(t);
  if (n > 0) return 'win';
  if (n < 0) return 'loss';
  return 'be';
}

export function computeMetrics(trades) {
  const nets = trades.map(tradeNet);
  const wins = nets.filter(n => n > 0);
  const losses = nets.filter(n => n < 0);
  const be = nets.filter(n => n === 0).length;
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const total = trades.length;
  const decided = wins.length + losses.length;
  const winrate = decided ? wins.length / decided : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const net = grossWin - grossLoss;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  const expectancy = total ? net / total : 0;
  const rr = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0);

  // max drawdown on cumulative curve
  let peak = 0, cum = 0, maxDD = 0;
  for (const n of nets) {
    cum += n;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }
  // streaks
  let curW = 0, curL = 0, maxW = 0, maxL = 0;
  for (const n of nets) {
    if (n > 0) { curW++; curL = 0; } else if (n < 0) { curL++; curW = 0; } else { curW = 0; curL = 0; }
    maxW = Math.max(maxW, curW); maxL = Math.max(maxL, curL);
  }
  const best = nets.length ? Math.max(...nets) : 0;
  const worst = nets.length ? Math.min(...nets) : 0;
  const lots = trades.reduce((a, t) => a + (Number(t.lots) || 0), 0);

  return { total, wins: wins.length, losses: losses.length, be, winrate, grossWin, grossLoss, net,
    profitFactor, expectancy, avgWin, avgLoss, rr, maxDD, maxWinStreak: maxW, maxLossStreak: maxL, best, worst, lots };
}

// ---- date helpers ----
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfWeek(d) { // Monday
  const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x;
}
export function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return { year: x.getUTCFullYear(), week: Math.ceil((((x - yearStart) / 86400000) + 1) / 7) };
}

export function periodRange(period, anchor) {
  // returns {start: Date, end: Date (inclusive), label}
  const a = parseDate(anchor);
  if (period === 'day') return { start: a, end: a, label: anchor };
  if (period === 'week') {
    const s = startOfWeek(a); const e = addDays(s, 6);
    const w = isoWeek(a);
    return { start: s, end: e, label: `สัปดาห์ ${w.week} / ${w.year}  (${fmtDate(s)} – ${fmtDate(e)})` };
  }
  if (period === 'month') {
    const s = new Date(a.getFullYear(), a.getMonth(), 1);
    const e = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { start: s, end: e, label: `${TH_MONTHS[a.getMonth()]} ${a.getFullYear()}` };
  }
  if (period === 'year') {
    return { start: new Date(a.getFullYear(), 0, 1), end: new Date(a.getFullYear(), 11, 31), label: `ปี ${a.getFullYear()}` };
  }
  return { start: new Date(2000, 0, 1), end: new Date(2100, 0, 1), label: 'ทั้งหมด' };
}

export function shiftAnchor(period, anchor, dir) {
  const a = parseDate(anchor);
  if (period === 'day') return fmtDate(addDays(a, dir));
  if (period === 'week') return fmtDate(addDays(a, 7 * dir));
  if (period === 'month') return fmtDate(new Date(a.getFullYear(), a.getMonth() + dir, Math.min(a.getDate(), 28)));
  if (period === 'year') return fmtDate(new Date(a.getFullYear() + dir, a.getMonth(), Math.min(a.getDate(), 28)));
  return anchor;
}

export const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const TH_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export function thaiDate(s, opts = {}) {
  const d = parseDate(s);
  const dow = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'][d.getDay()];
  if (opts.short) return `${d.getDate()} ${TH_MONTHS[d.getMonth()]}`;
  return `${dow} ${d.getDate()} ${TH_MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

// Flatten all trades from days within range, each tagged with date
export function tradesInRange(days, start, end) {
  const s = fmtDate(start), e = fmtDate(end);
  const out = [];
  for (const day of days) {
    if (day.date < s || day.date > e) continue;
    for (const t of day.trades || []) out.push({ ...t, date: day.date });
  }
  out.sort((a, b) => (a.date + (a.exitTime || a.entryTime || '')).localeCompare(b.date + (b.exitTime || b.entryTime || '')));
  return out;
}

// Group trades by key function -> [{key, label, trades, metrics}]
export function groupBy(trades, keyFn, labelFn = k => k) {
  const map = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, list]) => ({ key, label: labelFn(key), trades: list, metrics: computeMetrics(list) }));
}

export function dailySeries(trades, start, end) {
  // one point per calendar day in range with net pnl (0 if no trades)
  const byDay = new Map();
  for (const t of trades) byDay.set(t.date, (byDay.get(t.date) || 0) + tradeNet(t));
  const out = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const k = fmtDate(d);
    out.push({ date: k, net: byDay.get(k) || 0, has: byDay.has(k) });
  }
  return out;
}

export function equityCurve(trades) {
  let cum = 0;
  return trades.map((t, i) => { cum += tradeNet(t); return { i, date: t.date, cum, net: tradeNet(t) }; });
}

export function fmtMoney(n, cur = '') {
  if (!isFinite(n)) return '∞';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ' ' + cur : ''}`;
}
export function fmtPct(x) { return `${(x * 100).toFixed(1)}%`; }
export function fmtNum(n, d = 2) { return isFinite(n) ? Number(n).toFixed(d) : '∞'; }
