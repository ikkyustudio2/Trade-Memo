// One-page shareable infographic for a diary day: renders an HTML card and
// exports it to PNG via html2canvas (loaded from CDN on first use).

import * as S from './stats.js';

let loading = null;
function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = resolve; s.onerror = () => reject(new Error('โหลดตัวสร้างรูปไม่สำเร็จ (ต้องต่อเน็ตครั้งแรก)'));
    document.head.appendChild(s);
  });
  return loading;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BIAS_LABEL = { Long: 'Long 📈', Short: 'Short 📉', Sideway: 'Sideway ↔️', 'รอดู': 'รอดูก่อน 👀', 'ไม่เทรด': 'วันนี้ไม่เทรด 🛑' };
const MOOD = { great: { e: '😎', t: 'ปังมาก' }, good: { e: '🙂', t: 'โอเค' }, meh: { e: '😐', t: 'เฉยๆ' }, bad: { e: '😤', t: 'หงุดหงิด' }, awful: { e: '😵', t: 'พังยับ' } };

function palette(theme) {
  return theme === 'light'
    ? { bg0: '#eef1fb', bg1: '#ffffff', ink: '#1b1f2a', ink2: '#5a6178', line: '#e3e6f0', accent: '#3b64e0', pos: '#1f9d63', neg: '#e0455a', chip: '#f1f3fb' }
    : { bg0: '#171a24', bg1: '#20232f', ink: '#eef0f6', ink2: '#a9aec2', line: '#31354a', accent: '#8aa2ff', pos: '#4fd897', neg: '#ff7a86', chip: '#282c3c' };
}

const CLAMP_BASE = 'display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;';

export function infographicHTML(day, images, theme) {
  const p = palette(theme);
  const trades = day.trades || [];
  const m = S.computeMetrics(trades);
  const hasTrades = trades.length > 0;
  const netColor = m.net > 0 ? p.pos : m.net < 0 ? p.neg : p.ink2;
  const mood = MOOD[day.review.mood];
  const biasLabel = BIAS_LABEL[day.plan.bias];
  const topImgs = (images || []).slice(0, 2);
  const topTrades = trades.slice().sort((a, b) => Math.abs(S.tradeNet(b)) - Math.abs(S.tradeNet(a))).slice(0, 4);

  return `
  <style>
    .ig-card{width:460px;max-width:100%;background:${p.bg0};color:${p.ink};font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;border-radius:24px;overflow:hidden;box-shadow:0 20px 50px -20px rgba(0,0,0,.4)}
    .ig-card *{box-sizing:border-box}
    .ig-head{padding:26px 26px 18px;background:${p.bg1};border-bottom:1px solid ${p.line}}
    .ig-brand{font-family:'Mitr',sans-serif;font-size:.78rem;letter-spacing:.06em;color:${p.accent};display:flex;align-items:center;gap:6px;margin-bottom:14px}
    .ig-date{font-family:'Mitr',sans-serif;font-size:1.3rem;font-weight:500;margin:0}
    .ig-bias{display:inline-flex;margin-top:10px;padding:5px 14px;border-radius:999px;background:${p.chip};color:${p.ink};font-size:.85rem;font-weight:500}
    .ig-stats{display:flex;gap:10px;padding:20px 26px;background:${p.bg1}}
    .ig-stat{flex:1;background:${p.chip};border-radius:14px;padding:12px 14px;text-align:center}
    .ig-stat .l{font-size:.68rem;color:${p.ink2}}
    .ig-stat .v{font-family:'Mitr',sans-serif;font-size:1.15rem;font-weight:500;margin-top:2px}
    .ig-sec{padding:18px 26px}
    .ig-sec+.ig-sec{border-top:1px solid ${p.line}}
    .ig-lbl{font-family:'Mitr',sans-serif;font-size:.78rem;color:${p.accent};margin:0 0 8px;display:flex;align-items:center;gap:6px}
    .ig-txt{font-size:.92rem;line-height:1.6;color:${p.ink};margin:0 0 8px;${CLAMP_BASE}}
    .ig-txt.c5{-webkit-line-clamp:5}
    .ig-txt.c3{-webkit-line-clamp:3}
    .ig-txt:last-child{margin-bottom:0}
    .ig-imgs{display:flex;gap:8px;margin-top:10px}
    .ig-imgs img{width:100%;height:110px;object-fit:cover;border-radius:10px;border:1px solid ${p.line}}
    .ig-trade{display:flex;align-items:center;gap:8px;padding:7px 0;font-size:.85rem}
    .ig-trade+.ig-trade{border-top:1px solid ${p.line}}
    .ig-side{font-size:.65rem;font-weight:600;padding:2px 7px;border-radius:5px}
    .ig-side.buy{background:${p.pos}22;color:${p.pos}}
    .ig-side.sell{background:${p.neg}22;color:${p.neg}}
    .ig-sym{font-weight:500;flex:1}
    .ig-mood{display:flex;align-items:center;gap:10px}
    .ig-mood .e{font-size:1.6rem}
    .ig-foot{padding:16px 26px 22px;text-align:center;color:${p.ink2};font-size:.72rem;background:${p.bg1};border-top:1px solid ${p.line}}
  </style>
  <div class="ig-card" id="igCard">
    <div class="ig-head">
      <div class="ig-brand">📓 TRADE MEMO</div>
      <p class="ig-date">${esc(S.thaiDate(day.date))}</p>
      ${biasLabel ? `<span class="ig-bias">${biasLabel}</span>` : ''}
    </div>
    ${hasTrades ? `
    <div class="ig-stats">
      <div class="ig-stat"><div class="l">กำไร/ขาดทุน</div><div class="v" style="color:${netColor}">${m.net >= 0 ? '+' : ''}${S.fmtMoney(m.net)}</div></div>
      <div class="ig-stat"><div class="l">Winrate</div><div class="v">${S.fmtPct(m.winrate)}</div></div>
      <div class="ig-stat"><div class="l">ออเดอร์</div><div class="v">${m.total}</div></div>
    </div>` : ''}
    ${day.plan.setup || day.plan.entryRules || day.plan.riskNotes ? `
    <div class="ig-sec">
      <p class="ig-lbl">📋 แผนวันนี้</p>
      ${day.plan.setup ? `<p class="ig-txt c5">${esc(day.plan.setup)}</p>` : ''}
      ${day.plan.entryRules ? `<p class="ig-txt c3" style="color:${p.ink2}">${esc(day.plan.entryRules)}</p>` : ''}
      ${topImgs.length ? `<div class="ig-imgs">${topImgs.map(u => `<img src="${u}">`).join('')}</div>` : ''}
    </div>` : ''}
    ${topTrades.length ? `
    <div class="ig-sec">
      <p class="ig-lbl">📈 ออเดอร์เด่น</p>
      ${topTrades.map(t => { const n = S.tradeNet(t); return `<div class="ig-trade"><span class="ig-side ${t.side}">${t.side.toUpperCase()}</span><span class="ig-sym">${esc(t.symbol)}</span><span style="color:${n >= 0 ? p.pos : p.neg};font-weight:500">${n >= 0 ? '+' : ''}${S.fmtMoney(n)}</span></div>`; }).join('')}
    </div>` : ''}
    ${mood || day.review.notes || day.review.lessons ? `
    <div class="ig-sec">
      <p class="ig-lbl">🧠 สรุปหลังเทรด</p>
      <div class="ig-mood">
        ${mood ? `<span class="e">${mood.e}</span>` : ''}
        <p class="ig-txt c3" style="margin:0">${esc(day.review.lessons || day.review.notes || '')}</p>
      </div>
    </div>` : ''}
    <div class="ig-foot">สรุปการเทรดวันนี้ · ${esc(day.date)}</div>
  </div>`;
}

export async function downloadInfographic(cardEl, filename) {
  await loadHtml2Canvas();
  const canvas = await html2canvas(cardEl, { backgroundColor: null, scale: 2, useCORS: true });
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
