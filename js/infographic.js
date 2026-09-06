// One-page shareable infographic for a diary day: pastel "trading plan card"
// style, rendered to HTML then exported to PNG via html2canvas (CDN, lazy-loaded).

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
const lines = t => String(t || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

const BIAS = {
  Long: { label: 'Long 📈', bg: '#d7f6e6', ink: '#1f9d63', rot: -4 },
  Short: { label: 'Short 📉', bg: '#ffe0e4', ink: '#e0455a', rot: -4 },
  Sideway: { label: 'Sideway ↔️', bg: '#dfeaff', ink: '#3b64e0', rot: -4 },
  'รอดู': { label: 'รอดูก่อน 👀', bg: '#fff3cf', ink: '#b5791c', rot: -4 },
  'ไม่เทรด': { label: 'วันนี้ไม่เทรด 🛑', bg: '#ffe0e4', ink: '#e0455a', rot: -4 },
};
const MOOD = { great: { e: '😎', t: 'ปังมาก วันนี้ทำได้ดี' }, good: { e: '🙂', t: 'โอเค เป็นไปตามแผน' }, meh: { e: '😐', t: 'เฉยๆ ธรรมดา' }, bad: { e: '😤', t: 'หงุดหงิด ต้องทบทวน' }, awful: { e: '😵', t: 'พังยับ พักก่อนดีกว่า' } };

function dominantSymbol(trades) {
  const count = {};
  for (const t of trades) count[t.symbol] = (count[t.symbol] || 0) + 1;
  const keys = Object.keys(count);
  if (!keys.length) return '';
  return keys.sort((a, b) => count[b] - count[a])[0];
}

function bulletBox({ tone, icon, title, items }) {
  if (!items.length) return '';
  const tones = {
    blue: { bg: '#eaf2ff', line: '#cfe0ff', ink: '#2451c9', dot: '#3b64e0' },
    green: { bg: '#e9f9f0', line: '#c9efd9', ink: '#1a8a58', dot: '#1f9d63' },
    amber: { bg: '#fff7e0', line: '#fbe9b8', ink: '#9c6d0e', dot: '#d99a1e' },
  }[tone];
  return `<div class="ig-box" style="background:${tones.bg};border-color:${tones.line}">
    <p class="ig-box-h" style="color:${tones.ink}">${icon} ${esc(title)}</p>
    <ul class="ig-list">${items.map(x => `<li><span class="dot" style="background:${tones.dot}"></span><span>${esc(x)}</span></li>`).join('')}</ul>
  </div>`;
}

export function infographicHTML(day, planImages) {
  const trades = day.trades || [];
  const m = S.computeMetrics(trades);
  const hasTrades = trades.length > 0;
  const bias = BIAS[day.plan.bias];
  const sym = dominantSymbol(trades);
  const mood = MOOD[day.review.mood];
  const setupLines = lines(day.plan.setup);
  const entryLines = lines(day.plan.entryRules);
  const riskLines = lines(day.plan.riskNotes);
  const topTrades = trades.slice().sort((a, b) => Math.abs(S.tradeNet(b)) - Math.abs(S.tradeNet(a))).slice(0, 4);
  const netColor = m.net > 0 ? '#1f9d63' : m.net < 0 ? '#e0455a' : '#7a7189';
  const checklist = [
    { done: !!day.plan.setup, label: 'มีแผนก่อนเทรด' },
    { done: !!day.plan.entryRules, label: 'กำหนดเงื่อนไขเข้า-ออก' },
    { done: !!day.plan.riskNotes, label: 'ประเมินความเสี่ยงไว้ล่วงหน้า' },
    { done: hasTrades, label: 'บันทึกผลการเทรดจริง' },
  ];
  const empty = !bias && !setupLines.length && !entryLines.length && !riskLines.length && !hasTrades && !mood && !planImages.length;

  return `
  <style>
    .ig-card{width:480px;max-width:100%;background:#fffaf3;color:#2c2438;font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;border-radius:26px;overflow:hidden;box-shadow:0 16px 40px -18px rgba(80,50,90,.35);padding:16px;box-sizing:border-box}
    .ig-card *{box-sizing:border-box}
    .ig-banner{position:relative;background:linear-gradient(135deg,#ffd9ec 0%,#ffe9c9 55%,#dcefff 100%);border-radius:20px;padding:20px 20px 22px;overflow:hidden}
    .ig-eyebrow{font-family:'Mitr',sans-serif;font-size:.72rem;letter-spacing:.1em;color:#a8558f;margin:0 0 6px;display:flex;align-items:center;gap:6px}
    .ig-title{font-family:'Mitr',sans-serif;font-weight:600;font-size:1.5rem;color:#3a2350;margin:0;text-shadow:2px 2px 0 #fff8;line-height:1.25}
    .ig-sym{display:inline-flex;margin-top:8px;background:#3a2350;color:#fff5e6;font-family:'Mitr',sans-serif;font-size:.85rem;font-weight:500;padding:4px 14px;border-radius:999px}
    .ig-ribbon{position:absolute;top:16px;right:-6px;transform:rotate(6deg);padding:8px 18px 8px 16px;border-radius:10px 4px 4px 10px;font-family:'Mitr',sans-serif;font-weight:500;font-size:.82rem;box-shadow:0 4px 10px -4px rgba(0,0,0,.25)}
    .ig-body{padding:16px 4px 4px}
    .ig-imgs{display:grid;grid-template-columns:repeat(${Math.min(2, planImages.length) || 1},1fr);gap:8px;margin-bottom:14px}
    .ig-imgs img{width:100%;height:150px;object-fit:cover;border-radius:14px;border:3px solid #fff;box-shadow:0 6px 16px -8px rgba(60,40,70,.35)}
    .ig-box{border:1.5px solid;border-radius:16px;padding:12px 14px;margin-bottom:10px}
    .ig-box-h{font-family:'Mitr',sans-serif;font-size:.85rem;font-weight:500;margin:0 0 8px}
    .ig-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
    .ig-list li{display:flex;align-items:flex-start;gap:8px;font-size:.86rem;line-height:1.5;color:#3a3346}
    .ig-list .dot{width:7px;height:7px;border-radius:50%;margin-top:6px;flex:none}
    .ig-stats{display:flex;gap:8px;margin:6px 0 12px}
    .ig-stat{flex:1;background:#f3eefc;border:1.5px solid #e3d7f7;border-radius:14px;padding:10px 8px;text-align:center}
    .ig-stat .l{font-size:.65rem;color:#7a6a92}
    .ig-stat .v{font-family:'Mitr',sans-serif;font-size:1.05rem;font-weight:600;margin-top:2px}
    .ig-trades{background:#f6f3fe;border:1.5px solid #e3d7f7;border-radius:16px;padding:10px 14px;margin-bottom:10px}
    .ig-trade{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:.85rem}
    .ig-trade+.ig-trade{border-top:1px dashed #ddd0f2}
    .ig-side{font-size:.62rem;font-weight:700;padding:2px 8px;border-radius:999px}
    .ig-side.buy{background:#d7f6e6;color:#1a8a58}
    .ig-side.sell{background:#ffe0e4;color:#c23349}
    .ig-sym-cell{font-weight:600;flex:1;font-family:'Mitr',sans-serif;font-size:.82rem}
    .ig-mood{display:flex;align-items:center;gap:12px;background:#fff1e8;border:1.5px solid #ffd9c2;border-radius:16px;padding:12px 14px;margin-bottom:10px}
    .ig-mood .e{font-size:1.8rem}
    .ig-mood p{margin:0;font-size:.86rem;color:#7a4a2c;line-height:1.5}
    .ig-check{background:#eef7ff;border:1.5px solid #cfe6ff;border-radius:16px;padding:12px 14px;margin-bottom:6px}
    .ig-check-row{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:.85rem;color:#2c4a6b}
    .ig-check-row .box{width:16px;height:16px;border-radius:5px;flex:none;display:flex;align-items:center;justify-content:center;font-size:.7rem}
    .ig-check-row .box.on{background:#3b8f5e;color:#fff}
    .ig-check-row .box.off{background:#fff;border:1.5px solid #b9cfe6}
    .ig-foot{background:linear-gradient(90deg,#ffd9ec,#ffe9c9);border-radius:16px;padding:12px 16px;text-align:center;margin-top:6px}
    .ig-foot .tag{font-family:'Mitr',sans-serif;font-weight:600;color:#a8558f;font-size:.95rem;margin:0 0 3px}
    .ig-foot .warn{font-size:.68rem;color:#8a6b7a;margin:0}
    .ig-empty{padding:34px 20px;text-align:center;color:#8a7a99}
  </style>
  <div class="ig-card" id="igCard">
    <div class="ig-banner">
      <p class="ig-eyebrow">📓 TRADE MEMO · แผนการเทรด</p>
      <p class="ig-title">${esc(S.thaiDate(day.date))}</p>
      ${sym ? `<span class="ig-sym">${esc(sym)}</span>` : ''}
      ${bias ? `<div class="ig-ribbon" style="background:${bias.bg};color:${bias.ink};transform:rotate(${bias.rot}deg)">${bias.label}</div>` : ''}
    </div>
    <div class="ig-body">
      ${empty ? `<div class="ig-empty">📝 วันนี้ยังไม่ได้เขียนแผนไว้เลย<br>ลองกลับไปกรอกแผนก่อนเทรดดูนะ</div>` : `
      ${planImages.length ? `<div class="ig-imgs">${planImages.map(u => `<img src="${u}">`).join('')}</div>` : ''}
      ${bulletBox({ tone: 'blue', icon: '🔎', title: 'สิ่งที่สังเกตวันนี้', items: setupLines })}
      ${bulletBox({ tone: 'green', icon: '✅', title: 'เงื่อนไขเข้า-ออก', items: entryLines })}
      ${bulletBox({ tone: 'amber', icon: '⚠️', title: 'ความเสี่ยง / จุดที่ต้องระวัง', items: riskLines })}
      ${hasTrades ? `
      <div class="ig-stats">
        <div class="ig-stat"><div class="l">กำไร/ขาดทุน</div><div class="v" style="color:${netColor}">${m.net >= 0 ? '+' : ''}${S.fmtMoney(m.net)}</div></div>
        <div class="ig-stat"><div class="l">Winrate</div><div class="v">${S.fmtPct(m.winrate)}</div></div>
        <div class="ig-stat"><div class="l">ออเดอร์</div><div class="v">${m.total}</div></div>
      </div>
      <div class="ig-trades">
        ${topTrades.map(t => { const n = S.tradeNet(t); return `<div class="ig-trade"><span class="ig-side ${t.side}">${t.side.toUpperCase()}</span><span class="ig-sym-cell">${esc(t.symbol)}</span><span style="color:${n >= 0 ? '#1a8a58' : '#c23349'};font-weight:600">${n >= 0 ? '+' : ''}${S.fmtMoney(n)}</span></div>`; }).join('')}
      </div>` : ''}
      ${mood ? `<div class="ig-mood"><span class="e">${mood.e}</span><p>${esc(day.review.lessons || day.review.notes || mood.t)}</p></div>` : ''}
      <div class="ig-check">
        ${checklist.map(c => `<div class="ig-check-row"><span class="box ${c.done ? 'on' : 'off'}">${c.done ? '✓' : ''}</span><span>${esc(c.label)}</span></div>`).join('')}
      </div>`}
    </div>
    <div class="ig-foot">
      <p class="tag">มีวินัย มีแผน มีโอกาสชนะ 💪</p>
      <p class="warn">การลงทุนมีความเสี่ยง ศึกษาให้ดีก่อนตัดสินใจเทรด · ${esc(day.date)}</p>
    </div>
  </div>`;
}

export async function downloadInfographic(cardEl, filename) {
  await loadHtml2Canvas();
  const canvas = await html2canvas(cardEl, { backgroundColor: '#fffaf3', scale: 2, useCORS: true });
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
