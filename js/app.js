// Trade Memo — main UI
import { Days, Images, Settings, todayStr, uid, exportAll, blobToBase64 } from './db.js';
import * as S from './stats.js';
import { lineChart, barChart, calendarMonth, donut } from './charts.js';
import { parseMT5Screenshot, ENGINES } from './ai.js';
import { ocrImage, parseOcrText } from './ocr.js';
import { sync as driveSync, signOut as driveSignOut } from './drive.js';
import { infographicHTML, downloadInfographic } from './infographic.js';

// ---------- tiny helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => S.fmtMoney(n);
const signed = (n) => (n > 0 ? '+' : '') + money(n);
const cls = (n) => n > 0 ? 'pos' : n < 0 ? 'neg' : 'dim';
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- support links ----------
const AFFILIATE_URL = 'https://one.exnessonelink.com/a/uar9ilmj';
const KOFI_URL = 'https://ezdn.app/ikkyumedia'; // Easy Donate

const state = {
  view: 'diary',
  date: todayStr(),
  day: null,
  period: 'month',
  anchor: todayStr(),
  settings: null,
  days: [],
  objectUrls: new Map(),
};

// ---------- toast / modal / tooltip ----------
let toastTimer;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg; el.className = 'toast ' + type; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, type === 'err' ? 5000 : 2600);
}

function openModal(html, { wide = false, cardClass = '' } = {}) {
  const m = $('#modal'), card = $('#modalCard');
  card.className = 'modal-card' + (wide ? ' wide' : '') + (cardClass ? ' ' + cardClass : '');
  card.innerHTML = html; m.hidden = false;
  document.body.style.overflow = 'hidden';
  return card;
}
function closeModal() { const card = $('#modalCard'); $('#modal').hidden = true; card.innerHTML = ''; card._onPaste = null; document.body.style.overflow = ''; }
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

function confirmBox(text, { okText = 'ตกลง', danger = false } = {}) {
  return new Promise(resolve => {
    const c = openModal(`<div class="modal-head"><h3>ยืนยัน</h3></div><p>${esc(text)}</p>
      <div class="modal-foot"><button class="btn ghost" data-x>ยกเลิก</button><button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(okText)}</button></div>`);
    $('[data-x]', c).onclick = () => { closeModal(); resolve(false); };
    $('[data-ok]', c).onclick = () => { closeModal(); resolve(true); };
  });
}

// tooltip layer for charts (data-tip)
const tip = $('#tooltip');
function showTip(target, x, y) {
  tip.textContent = target.dataset.tip; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 10;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 10;
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
  const svg = target.closest('svg');
  if (svg && target.dataset.cx) { const c = $('.cursor', svg); if (c) { c.setAttribute('cx', target.dataset.cx); c.setAttribute('cy', target.dataset.cy); } }
}
document.addEventListener('pointermove', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (t) showTip(t, e.clientX, e.clientY); else if (!tip.hidden) { tip.hidden = true; $$('.chart .cursor').forEach(c => c.setAttribute('cx', -10)); }
});
document.addEventListener('pointerdown', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (t && e.pointerType === 'touch') showTip(t, e.clientX, e.clientY);
});
document.addEventListener('pointerleave', () => { tip.hidden = true; });
window.addEventListener('resize', debounce(() => {
  if (state.view === 'dashboard' && state.remount) state.remount();
  $$('textarea.auto').forEach(autoGrow);
}, 150));

// ---------- image helpers ----------
function urlFor(img) {
  if (!state.objectUrls.has(img.id)) state.objectUrls.set(img.id, URL.createObjectURL(img.blob));
  return state.objectUrls.get(img.id);
}
async function imagesHtml(kind, date) {
  const imgs = (await Images.byDate(date)).filter(i => i.kind === kind).sort((a, b) => a.createdAt - b.createdAt);
  return imgs.map(i => `<div class="img" data-img="${i.id}" tabindex="0"><img src="${urlFor(i)}" alt="${esc(i.name)}" loading="lazy"><button class="del" data-del-img="${i.id}" title="ลบรูป">✕</button></div>`).join('')
    + `<button class="img-add" data-add-img="${kind}"><span class="plus">＋</span>เพิ่มรูป</button>`;
}
function pickFiles({ multiple = true } = {}) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = multiple;
    inp.onchange = () => resolve([...inp.files]);
    inp.click();
  });
}
async function downscale(blob, max = 1800) {
  if (!blob.type.startsWith('image/') || blob.type === 'image/gif') return blob;
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return blob;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && blob.size < 1.5e6) return blob;
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return new Promise(r => c.toBlob(b => r(b || blob), type, 0.9));
}
function lightbox(img) {
  const c = openModal(`<img src="${urlFor(img)}" alt="">`, { cardClass: 'lightbox' });
  c.onclick = closeModal;
}

// ---------- routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, arg] = h.split('/');
  state.view = ['diary', 'dashboard', 'settings'].includes(view) ? view : 'diary';
  if (state.view === 'diary' && /^\d{4}-\d{2}-\d{2}$/.test(arg || '')) state.date = arg;
  $$('[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === state.view));
  render();
}
window.addEventListener('hashchange', route);

async function render() {
  const app = $('#app');
  state.settings = await Settings.get();
  if (state.view === 'diary') await renderDiary(app);
  else if (state.view === 'dashboard') await renderDashboard(app);
  else await renderSettings(app);
  window.scrollTo({ top: 0 });
}

// =====================================================================
// DIARY
// =====================================================================
const saveDay = debounce(async () => {
  if (!state.day) return;
  await Days.put(state.day);
  const el = $('.save-state'); if (el) { el.textContent = 'บันทึกแล้ว ✓'; setTimeout(() => { if (el.isConnected) el.textContent = ''; }, 1500); }
}, 500);

async function renderDiary(app) {
  const date = state.date;
  state.day = await Days.getOrCreate(date);
  const day = state.day;
  const isToday = date === todayStr();
  const m = S.computeMetrics(day.trades);

  // week strip
  const wkStart = S.startOfWeek(S.parseDate(date));
  const all = await Days.all();
  const byDate = new Map(all.map(d => [d.date, d]));
  let strip = '';
  for (let i = 0; i < 7; i++) {
    const d = S.addDays(wkStart, i); const k = S.fmtDate(d);
    const dd = byDate.get(k); const net = dd ? dd.trades.reduce((a, t) => a + S.tradeNet(t), 0) : 0;
    const has = dd && (dd.trades.length || dd.plan.setup || dd.review.notes);
    strip += `<button data-goto="${k}" class="${k === date ? 'sel' : ''} ${k === todayStr() ? 'today' : ''}">
      <span class="tiny">${S.TH_DAYS[d.getDay()]}</span><span class="d">${d.getDate()}</span>
      ${dd && dd.trades.length ? `<span class="v ${cls(net)}">${signed(net).replace('.00', '')}</span>` : `<span class="dot ${has ? '' : 'hide'}"></span>`}
    </button>`;
  }

  app.innerHTML = `
  <div class="stack">
    <div class="dayhead">
      <button class="iconbtn" data-nav="-1" title="วันก่อน">‹</button>
      <div class="title">
        <h1>${esc(S.thaiDate(date))}${isToday ? ' <span class="pill">วันนี้</span>' : ''}</h1>
        <div class="sub">${day.trades.length ? `${day.trades.length} ออเดอร์ · <b class="${cls(m.net)}">${signed(m.net)}</b> · winrate ${S.fmtPct(m.winrate)}` : 'ยังไม่มีออเดอร์วันนี้'}</div>
      </div>
      <input type="date" id="datePick" value="${date}">
      <button class="iconbtn" data-nav="1" title="วันถัดไป">›</button>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:-6px">
      <button class="btn ghost small" data-preview>👁️ พรีวิวสรุปวันนี้</button>
    </div>
    <div class="weekstrip">${strip}</div>

    <section class="card">
      <div class="card-head"><h2>📋 แผนก่อนเทรด</h2><span class="save-state"></span></div>
      <div class="stack">
        <div>
          <div class="small muted" style="margin-bottom:6px">มุมมองวันนี้</div>
          <div class="chips" data-chips="plan.bias">
            ${chip('Long', 'Long 📈', day.plan.bias, 'pos')}${chip('Short', 'Short 📉', day.plan.bias, 'neg')}${chip('Sideway', 'Sideway ↔️', day.plan.bias)}${chip('รอดู', 'รอดูก่อน 👀', day.plan.bias)}${chip('ไม่เทรด', 'วันนี้ไม่เทรด 🛑', day.plan.bias)}
          </div>
        </div>
        <label class="field"><span>Setup วันนี้เป็นยังไง</span><textarea class="auto" data-bind="plan.setup" placeholder="เช่น ราคาอยู่ในโซน demand H4, รอ break structure ใน M15 แล้วค่อยเข้า…">${esc(day.plan.setup)}</textarea></label>
        <div class="grid-2">
          <label class="field"><span>เงื่อนไขเข้า / ออก</span><textarea class="auto" data-bind="plan.entryRules" placeholder="เข้าเมื่อ… ออกเมื่อ… SL ที่… TP ที่…">${esc(day.plan.entryRules)}</textarea></label>
          <label class="field"><span>ความเสี่ยง / lot / ข่าว</span><textarea class="auto" data-bind="plan.riskNotes" placeholder="เสี่ยง 1% ต่อไม้, ข่าว NFP 19:30 หลบก่อน…">${esc(day.plan.riskNotes)}</textarea></label>
        </div>
        <div>
          <div class="small muted" style="margin-bottom:6px">รูปกราฟที่วาดไว้</div>
          <div class="imgs" data-imgs="plan">${await imagesHtml('plan', date)}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>📈 ออเดอร์วันนี้</h2>
        <div class="actions">
          <button class="btn soft small" data-mt5>📷 อ่านจาก MT5</button>
          <button class="btn small" data-add-trade>＋ เพิ่ม</button>
        </div>
      </div>
      ${day.trades.length ? `
      <div class="tiles compact" style="margin-bottom:12px">
        <div class="tile"><span class="l">กำไร/ขาดทุนสุทธิ</span><span class="v ${cls(m.net)}">${signed(m.net)}</span></div>
        <div class="tile"><span class="l">Winrate</span><span class="v">${S.fmtPct(m.winrate)}</span><span class="s">${m.wins}W · ${m.losses}L${m.be ? ` · ${m.be}BE` : ''}</span></div>
        <div class="tile"><span class="l">ไม้ที่ดีสุด / แย่สุด</span><span class="v"><span class="pos">${signed(m.best)}</span></span><span class="s neg">${signed(m.worst)}</span></div>
        <div class="tile"><span class="l">รวม lot</span><span class="v">${S.fmtNum(m.lots, 2)}</span><span class="s">${day.trades.length} ออเดอร์</span></div>
      </div>` : ''}
      ${tradesListHtml(day.trades)}
      <details class="sec" style="margin-top:12px" ${(await Images.byDate(date)).some(i => i.kind === 'mt5') ? 'open' : ''}>
        <summary>ภาพหน้าจอ MT5 ที่บันทึกไว้</summary>
        <div class="imgs" data-imgs="mt5" style="margin-top:8px">${await imagesHtml('mt5', date)}</div>
      </details>
    </section>

    <section class="card">
      <div class="card-head"><h2>🧠 สรุปหลังเทรด</h2></div>
      <div class="stack">
        <div>
          <div class="small muted" style="margin-bottom:6px">วันนี้รู้สึกยังไง</div>
          <div class="chips" data-chips="review.mood">
            ${chip('great', '😎 ปังมาก', day.review.mood, 'pos')}${chip('good', '🙂 โอเค', day.review.mood)}${chip('meh', '😐 เฉยๆ', day.review.mood)}${chip('bad', '😤 หงุดหงิด', day.review.mood, 'neg')}${chip('awful', '😵 พังยับ', day.review.mood, 'neg')}
          </div>
        </div>
        <label class="field"><span>วันนี้เป็นไงบ้าง</span><textarea class="auto" data-bind="review.notes" placeholder="เทรดตามแผนมั้ย? อะไรที่ทำได้ดี? อะไรที่พลาด?">${esc(day.review.notes)}</textarea></label>
        <label class="field"><span>บทเรียน / พรุ่งนี้จะทำอะไรต่างไป</span><textarea class="auto" data-bind="review.lessons" placeholder="เช่น อย่ารีบเข้าก่อนแท่งปิด…">${esc(day.review.lessons)}</textarea></label>
        <div>
          <div class="small muted" style="margin-bottom:6px">รูปประกอบ</div>
          <div class="imgs" data-imgs="review">${await imagesHtml('review', date)}</div>
        </div>
      </div>
    </section>
  </div>`;

  // --- bindings ---
  $$('[data-nav]', app).forEach(b => b.onclick = () => gotoDate(S.fmtDate(S.addDays(S.parseDate(state.date), Number(b.dataset.nav)))));
  $('#datePick').onchange = e => gotoDate(e.target.value);
  $('.dayhead h1', app).onclick = () => { const p = $('#datePick'); try { p.showPicker(); } catch { p.focus(); p.click(); } };
  $$('[data-goto]', app).forEach(b => b.onclick = () => gotoDate(b.dataset.goto));
  $$('textarea[data-bind]', app).forEach(t => {
    autoGrow(t);
    t.addEventListener('input', () => { setPath(state.day, t.dataset.bind, t.value); autoGrow(t); markSaving(); saveDay(); });
  });
  $$('[data-chips]', app).forEach(group => {
    group.onclick = e => {
      const c = e.target.closest('.chip'); if (!c) return;
      const cur = getPath(state.day, group.dataset.chips);
      const val = cur === c.dataset.val ? '' : c.dataset.val;
      setPath(state.day, group.dataset.chips, val);
      $$('.chip', group).forEach(x => x.classList.toggle('on', x.dataset.val === val));
      markSaving(); saveDay();
    };
  });
  $$('[data-imgs]', app).forEach(grid => {
    grid.onclick = async e => {
      const add = e.target.closest('[data-add-img]');
      const del = e.target.closest('[data-del-img]');
      const im = e.target.closest('[data-img]');
      if (add) { const files = await pickFiles(); for (const f of files) await Images.add(await downscale(f), state.date, add.dataset.addImg, f.name); await refreshImgs(grid); }
      else if (del) { if (await confirmBox('ลบรูปนี้?', { danger: true, okText: 'ลบ' })) { await Images.delete(del.dataset.delImg); await refreshImgs(grid); } }
      else if (im) { lightbox(await Images.get(im.dataset.img)); }
    };
  });
  $('[data-add-trade]', app).onclick = () => tradeModal(null);
  $('[data-mt5]', app).onclick = () => mt5Modal();
  $('[data-preview]', app).onclick = () => infographicModal(state.day);
  $$('[data-trade]', app).forEach(el => el.onclick = () => tradeModal(el.dataset.trade));
}

function chip(val, label, cur, tone = '') {
  return `<button class="chip ${cur === val ? 'on ' + tone : ''}" data-val="${esc(val)}" data-tone="${tone}">${label}</button>`;
}
function markSaving() { const el = $('.save-state'); if (el) el.textContent = 'กำลังบันทึก…'; }
function autoGrow(t) {
  if (!t.value) { t.style.height = ''; return; }
  t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px';
}
function getPath(o, p) { return p.split('.').reduce((a, k) => a && a[k], o); }
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] = a[k] || {}), o); t[last] = v; }
async function refreshImgs(grid) { grid.innerHTML = await imagesHtml(grid.dataset.imgs, state.date); }
function gotoDate(d) { if (!d) return; location.hash = `#/diary/${d}`; }

function tradesListHtml(trades) {
  if (!trades.length) return `<div class="empty">ยังไม่มีออเดอร์ · กด <b>＋ เพิ่ม</b> หรือ <b>📷 อ่านจาก MT5</b></div>`;
  const rows = trades.map(t => {
    const n = S.tradeNet(t);
    return `<tr class="clickable" data-trade="${t.id}">
      <td><b>${esc(t.symbol)}</b></td><td><span class="side ${t.side}">${t.side.toUpperCase()}</span></td>
      <td class="num">${S.fmtNum(t.lots, 2)}</td>
      <td class="num">${px(t.entryPrice)}</td><td class="num">${px(t.exitPrice)}</td>
      <td class="dim small">${esc(shortTime(t.entryTime))}${t.exitTime ? ' → ' + esc(shortTime(t.exitTime)) : ''}</td>
      <td class="num ${cls(n)}"><b>${signed(n)}</b></td>
    </tr>`;
  }).join('');
  const cards = trades.map(t => {
    const n = S.tradeNet(t);
    return `<div class="trade-card" data-trade="${t.id}">
      <span class="side ${t.side}">${t.side.toUpperCase()}</span>
      <span class="main"><span class="sym">${esc(t.symbol)} <span class="dim small">${S.fmtNum(t.lots, 2)} lot</span></span>
      <span class="meta">${px(t.entryPrice)} → ${px(t.exitPrice)}${t.exitTime ? ' · ' + esc(shortTime(t.exitTime)) : ''}</span></span>
      <span class="pnl ${cls(n)}">${signed(n)}</span>
    </div>`;
  }).join('');
  return `<div class="table-wrap only-desktop"><table><thead><tr><th>คู่เงิน</th><th>ฝั่ง</th><th class="num">Lot</th><th class="num">เข้า</th><th class="num">ออก</th><th>เวลา</th><th class="num">กำไร</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="trades-list only-mobile">${cards}</div>`;
}
function px(n) { return n ? String(parseFloat(Number(n).toFixed(5))) : '-'; }
function shortTime(s) { if (!s) return ''; const m = s.match(/(\d{1,2}:\d{2})(?::\d{2})?/); return m ? m[1] : s; }

// ---------- trade modal ----------
function tradeModal(id) {
  const existing = id ? state.day.trades.find(t => t.id === id) : null;
  const t = existing || { id: uid(), createdAt: Date.now(), symbol: lastSymbol(), side: 'buy', lots: 0.01, entryTime: '', entryPrice: '', exitTime: '', exitPrice: '', sl: '', tp: '', pnl: '', commission: '', swap: '', notes: '', source: 'manual' };
  const c = openModal(`
    <div class="modal-head"><h3>${existing ? 'แก้ไขออเดอร์' : 'เพิ่มออเดอร์'}</h3><button class="iconbtn" data-x>✕</button></div>
    <form id="tradeForm" class="form-grid cols-3">
      <label class="field"><span>คู่เงิน</span><input name="symbol" type="text" value="${esc(t.symbol)}" placeholder="XAUUSD" required style="text-transform:uppercase"></label>
      <label class="field"><span>ฝั่ง</span><select name="side"><option value="buy" ${t.side === 'buy' ? 'selected' : ''}>Buy</option><option value="sell" ${t.side === 'sell' ? 'selected' : ''}>Sell</option></select></label>
      <label class="field"><span>Lot</span><input name="lots" type="number" step="0.01" value="${esc(t.lots)}"></label>
      <label class="field"><span>ราคาเข้า</span><input name="entryPrice" type="number" step="any" value="${esc(t.entryPrice)}"></label>
      <label class="field"><span>ราคาออก</span><input name="exitPrice" type="number" step="any" value="${esc(t.exitPrice)}"></label>
      <label class="field"><span>กำไร/ขาดทุน (ตามบัญชี)</span><input name="pnl" type="number" step="any" value="${esc(t.pnl)}" placeholder="-12.50" required></label>
      <label class="field"><span>เวลาเข้า</span><input name="entryTime" type="text" value="${esc(t.entryTime)}" placeholder="10:25"></label>
      <label class="field"><span>เวลาออก</span><input name="exitTime" type="text" value="${esc(t.exitTime)}" placeholder="11:40"></label>
      <label class="field"><span>SL / TP</span><div class="row" style="gap:6px;flex-wrap:nowrap"><input name="sl" type="number" step="any" value="${esc(t.sl)}" placeholder="SL"><input name="tp" type="number" step="any" value="${esc(t.tp)}" placeholder="TP"></div></label>
      <label class="field"><span>ค่าคอม</span><input name="commission" type="number" step="any" value="${esc(t.commission)}" placeholder="-0.70"></label>
      <label class="field"><span>Swap</span><input name="swap" type="number" step="any" value="${esc(t.swap)}" placeholder="0"></label>
      <label class="field"><span>Ticket</span><input name="ticket" type="text" value="${esc(t.ticket || '')}"></label>
      <label class="field full"><span>โน้ต (setup ที่ใช้ / เหตุผลที่เข้า / อารมณ์ตอนนั้น)</span><textarea name="notes" rows="2">${esc(t.notes)}</textarea></label>
    </form>
    <div class="modal-foot">
      ${existing ? '<button class="btn danger left" data-del>ลบ</button>' : ''}
      <button class="btn ghost" data-x>ยกเลิก</button><button class="btn" data-save>บันทึก</button>
    </div>`);
  $$('[data-x]', c).forEach(b => b.onclick = closeModal);
  $('[data-save]', c).onclick = async () => {
    const f = $('#tradeForm');
    if (!f.reportValidity()) return;
    const fd = new FormData(f);
    const num = k => { const v = fd.get(k); return v === '' || v == null ? 0 : Number(v); };
    const nt = { ...t, symbol: String(fd.get('symbol')).trim().toUpperCase(), side: fd.get('side'), lots: num('lots'), entryPrice: num('entryPrice'), exitPrice: num('exitPrice'), pnl: num('pnl'), entryTime: fd.get('entryTime').trim(), exitTime: fd.get('exitTime').trim(), sl: num('sl'), tp: num('tp'), commission: num('commission'), swap: num('swap'), ticket: fd.get('ticket').trim(), notes: fd.get('notes').trim() };
    if (existing) Object.assign(existing, nt); else state.day.trades.push(nt);
    await Days.put(state.day); closeModal(); toast('บันทึกออเดอร์แล้ว', 'ok'); renderDiary($('#app'));
  };
  const del = $('[data-del]', c);
  if (del) del.onclick = async () => { if (await confirmBox('ลบออเดอร์นี้?', { danger: true, okText: 'ลบ' })) { state.day.trades = state.day.trades.filter(x => x.id !== id); await Days.put(state.day); closeModal(); renderDiary($('#app')); } };
  setTimeout(() => $('input[name=symbol]', c).focus(), 50);
}
function lastSymbol() {
  const ts = state.day && state.day.trades; if (ts && ts.length) return ts[ts.length - 1].symbol;
  return state.settings.lastSymbol || '';
}

// ---------- day infographic ----------
async function infographicModal(day) {
  const planImgs = (await Images.byDate(day.date)).filter(i => i.kind === 'plan').map(urlFor);
  const c = openModal(`
    <div class="modal-head"><h3>👁️ พรีวิวสรุปวันนี้</h3><button class="iconbtn" data-x>✕</button></div>
    <div id="igWrap" style="display:flex;justify-content:center;overflow:hidden"></div>
    <div class="modal-foot">
      <button class="btn ghost" data-x>ปิด</button>
      <button class="btn" id="igDownload">⬇️ ดาวน์โหลดเป็นรูป</button>
    </div>`, { wide: true });
  $$('[data-x]', c).forEach(b => b.onclick = closeModal);
  const wrap = $('#igWrap', c);
  wrap.innerHTML = infographicHTML(day, planImgs);
  const card = $('#igCard', wrap);
  const fitScale = () => {
    const avail = wrap.clientWidth;
    const natural = card.offsetWidth;
    const scale = Math.min(1, avail / natural);
    card.style.transform = `scale(${scale})`;
    card.style.transformOrigin = 'top center';
    wrap.style.height = (card.offsetHeight * scale) + 'px';
  };
  requestAnimationFrame(fitScale);
  $('#igDownload', c).onclick = async (e) => {
    const btn = e.currentTarget; const old = btn.textContent;
    btn.disabled = true; btn.textContent = 'กำลังสร้างรูป…';
    try {
      const prevTransform = card.style.transform; card.style.transform = 'none';
      await downloadInfographic(card, `trade-memo-${day.date}.png`);
      card.style.transform = prevTransform;
      toast('ดาวน์โหลดรูปแล้ว', 'ok');
    } catch (err) { toast('สร้างรูปไม่สำเร็จ: ' + err.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = old; }
  };
}

// ---------- MT5 import modal ----------
function mt5Modal(initialBlob) {
  const hasClaude = !!state.settings.claudeKey;
  const hasGemini = !!state.settings.geminiKey;
  const defaultEngine = state.settings.aiEngine === 'gemini' && hasGemini ? 'gemini' : hasClaude ? 'claude' : hasGemini ? 'gemini' : 'ocr';
  let blob = initialBlob || null; let parsed = null;
  const c = openModal(`
    <div class="modal-head"><h3>📷 อ่านออเดอร์จากภาพ MT5</h3><button class="iconbtn" data-x>✕</button></div>
    <div class="stack">
      <div class="dropzone" id="dz" tabindex="0">${blob ? `<img src="${URL.createObjectURL(blob)}">` : `<div>📎 แตะเพื่อเลือกรูป, ลากมาวาง, หรือ <b>Ctrl+V</b> วางภาพที่แคปมา</div><div class="dim small" style="margin-top:4px">ใช้ได้กับหน้า History ของ MT5 ทั้งมือถือและคอม</div>`}</div>
      <div class="form-grid">
        <label class="field"><span>ตัวอ่าน</span><select id="engine">
          <option value="claude" ${hasClaude ? '' : 'disabled'} ${defaultEngine === 'claude' ? 'selected' : ''}>${ENGINES.claude.label}${hasClaude ? '' : ' · ต้องใส่ key ก่อน'}</option>
          <option value="gemini" ${hasGemini ? '' : 'disabled'} ${defaultEngine === 'gemini' ? 'selected' : ''}>${ENGINES.gemini.label}${hasGemini ? '' : ' · ต้องใส่ key ก่อน'}</option>
          <option value="ocr" ${defaultEngine === 'ocr' ? 'selected' : ''}>OCR ฟรี (Tesseract · ต้องตรวจตัวเลข)</option>
        </select></label>
        <label class="field"><span>บอกใบ้เพิ่ม (ไม่บังคับ)</span><input id="hint" type="text" placeholder="เช่น บัญชี USD, ภาพจากมือถือ"></label>
      </div>
      <div class="row">
        <label class="row small"><input type="checkbox" id="keepImg" checked> เก็บภาพนี้ไว้ในบันทึกของวัน</label>
        <label class="row small"><input type="checkbox" id="byDate" checked> จัดเข้าวันตามวันที่ในภาพ (ถ้ามี)</label>
      </div>
      <div id="result"></div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" data-x>ปิด</button>
      <button class="btn" id="readBtn" ${blob ? '' : 'disabled'}>อ่านรูป</button>
      <button class="btn hide" id="addBtn">เพิ่มเข้าบันทึก</button>
    </div>`, { wide: true });
  $$('[data-x]', c).forEach(b => b.onclick = closeModal);
  const dz = $('#dz', c), readBtn = $('#readBtn', c), addBtn = $('#addBtn', c), result = $('#result', c);
  const setBlob = b => { blob = b; dz.innerHTML = `<img src="${URL.createObjectURL(b)}">`; readBtn.disabled = false; parsed = null; result.innerHTML = ''; addBtn.classList.add('hide'); };
  dz.onclick = async () => { const [f] = await pickFiles({ multiple: false }); if (f) setBlob(f); };
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/')); if (f) setBlob(f); };
  c.dataset.pasteTarget = '1';
  c._onPaste = (b) => setBlob(b);

  readBtn.onclick = async () => {
    if (!blob) return;
    const engine = $('#engine', c).value; const hint = $('#hint', c).value.trim();
    readBtn.disabled = true; result.innerHTML = `<div class="row"><span class="spinner"></span> <span id="prog">กำลังอ่านภาพ…</span></div>`;
    try {
      if (engine === 'claude' || engine === 'gemini') {
        const apiKey = engine === 'claude' ? state.settings.claudeKey : state.settings.geminiKey;
        const model = engine === 'claude' ? state.settings.claudeModel : state.settings.geminiModel;
        parsed = await parseMT5Screenshot({ engine, apiKey, model, imageBlob: await downscale(blob, 2000), hint });
        Settings.set({ aiEngine: engine });
      } else {
        const text = await ocrImage(blob, p => { const el = $('#prog', c); if (el) el.textContent = `OCR ${p}%`; });
        parsed = parseOcrText(text);
      }
      parsed.trades.forEach(t => { t.id = uid(); t.createdAt = Date.now(); });
      result.innerHTML = parsedHtml(parsed);
      addBtn.classList.toggle('hide', !parsed.trades.length);
    } catch (e) {
      result.innerHTML = `<div class="note" style="color:var(--neg)">อ่านไม่สำเร็จ: ${esc(e.message)}</div>`;
    } finally { readBtn.disabled = false; }
  };

  addBtn.onclick = async () => {
    const chosen = $$('input[data-pick]:checked', result).map(i => parsed.trades.find(t => t.id === i.dataset.pick)).filter(Boolean);
    if (!chosen.length) { toast('ยังไม่ได้เลือกรายการ'); return; }
    const byDate = $('#byDate', c).checked;
    const groups = new Map();
    for (const t of chosen) {
      let d = state.date;
      if (byDate) { const m = (t.exitTime || t.entryTime || '').match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})/); if (m) d = `${m[1]}-${m[2]}-${m[3]}`; }
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(t);
    }
    let added = 0, skipped = 0;
    for (const [d, list] of groups) {
      const day = d === state.date ? state.day : await Days.getOrCreate(d);
      const tickets = new Set(day.trades.map(t => t.ticket).filter(Boolean));
      for (const t of list) {
        if (t.ticket && tickets.has(t.ticket)) { skipped++; continue; }
        day.trades.push({ ...t, entryTime: stripDate(t.entryTime), exitTime: stripDate(t.exitTime) }); added++;
      }
      await Days.put(day);
    }
    if ($('#keepImg', c).checked) await Images.add(await downscale(blob), state.date, 'mt5', 'mt5-screenshot.png');
    if (chosen[0]) Settings.set({ lastSymbol: chosen[0].symbol });
    closeModal();
    toast(`เพิ่ม ${added} ออเดอร์${skipped ? ` (ข้าม ${skipped} ที่ซ้ำ)` : ''}${groups.size > 1 ? ` ใน ${groups.size} วัน` : ''}`, 'ok');
    renderDiary($('#app'));
  };
}
function stripDate(s) { return String(s || '').replace(/^\d{4}[.\-/]\d{2}[.\-/]\d{2}[ T]?/, '').trim(); }
function parsedHtml(p) {
  const rows = p.trades.map(t => `<tr>
    <td><input type="checkbox" data-pick="${t.id}" checked></td>
    <td><b>${esc(t.symbol)}</b></td><td><span class="side ${t.side}">${t.side.toUpperCase()}</span></td>
    <td class="num">${S.fmtNum(t.lots, 2)}</td><td class="num">${px(t.entryPrice)}</td><td class="num">${px(t.exitPrice)}</td>
    <td class="dim small">${esc(t.exitTime || t.entryTime || '')}</td>
    <td class="num ${cls(S.tradeNet(t))}"><b>${signed(S.tradeNet(t))}</b></td></tr>`).join('');
  const net = p.trades.reduce((a, t) => a + S.tradeNet(t), 0);
  return `<div class="stack">
    <div class="row between"><span class="muted small">${esc(p.summary || '')}${p.model ? ` · ${esc(p.model)}` : ''}</span><span class="small">รวม <b class="${cls(net)}">${signed(net)}</b></span></div>
    ${p.trades.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>คู่เงิน</th><th>ฝั่ง</th><th class="num">Lot</th><th class="num">เข้า</th><th class="num">ออก</th><th>เวลา</th><th class="num">กำไร</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">ไม่พบออเดอร์ในภาพ</div>'}
    ${p.warnings && p.warnings.length ? `<div class="note">⚠️ ${p.warnings.map(esc).join('<br>')}</div>` : ''}
    <div class="dim tiny">เพิ่มแล้วแตะที่ออเดอร์เพื่อแก้ไขตัวเลขได้ทีหลัง</div>
  </div>`;
}

// global paste: image in clipboard
document.addEventListener('paste', async e => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (!item) return;
  const blob = item.getAsFile(); if (!blob) return;
  const card = $('#modalCard');
  if (!$('#modal').hidden && card._onPaste) { card._onPaste(blob); return; }
  if (state.view !== 'diary') return;
  e.preventDefault();
  const c = openModal(`<div class="modal-head"><h3>วางรูปแล้ว จะเอาไปไว้ไหน?</h3><button class="iconbtn" data-x>✕</button></div>
    <div class="row" style="justify-content:center;margin-bottom:12px"><img src="${URL.createObjectURL(blob)}" style="max-height:200px;max-width:100%;border-radius:10px"></div>
    <div class="stack">
      <button class="btn soft wide" data-k="mt5">📷 อ่านออเดอร์จากภาพ MT5</button>
      <button class="btn ghost wide" data-k="plan">📋 รูปแผน / กราฟที่วาด</button>
      <button class="btn ghost wide" data-k="review">🧠 รูปประกอบสรุปหลังเทรด</button>
    </div>`);
  $('[data-x]', c).onclick = closeModal;
  $$('[data-k]', c).forEach(b => b.onclick = async () => {
    const k = b.dataset.k; closeModal();
    if (k === 'mt5') { mt5Modal(blob); return; }
    await Images.add(await downscale(blob), state.date, k, 'pasted.png');
    const grid = $(`[data-imgs="${k}"]`); if (grid) await refreshImgs(grid);
    toast('เพิ่มรูปแล้ว', 'ok');
  });
});

// =====================================================================
// DASHBOARD
// =====================================================================
async function renderDashboard(app) {
  state.days = await Days.all();
  const { period, anchor } = state;
  const range = S.periodRange(period, anchor);
  const trades = S.tradesInRange(state.days, range.start, range.end);
  const m = S.computeMetrics(trades);
  const cur = state.settings.currency || '';

  // main bar series
  let bars, barsTitle;
  if (period === 'day') { bars = trades.map((t, i) => ({ label: t.symbol, value: S.tradeNet(t), tip: `${t.symbol} ${t.side.toUpperCase()} ${S.fmtNum(t.lots, 2)} lot\n${signed(S.tradeNet(t))}` })); barsTitle = 'ทีละออเดอร์'; }
  else if (period === 'year') { const g = S.groupBy(trades, t => t.date.slice(0, 7), k => S.TH_MONTHS[Number(k.slice(5)) - 1]); bars = fillMonths(anchor, g); barsTitle = 'รายเดือน'; }
  else if (period === 'all') { const g = S.groupBy(trades, t => t.date.slice(0, 7)); bars = g.map(x => ({ label: x.key.slice(2), value: x.metrics.net, has: true, tip: `${x.key}\n${signed(x.metrics.net)} · ${x.metrics.total} เทรด` })); barsTitle = 'รายเดือน'; }
  else { bars = S.dailySeries(trades, range.start, range.end).map(d => ({ label: S.thaiDate(d.date, { short: true }), value: d.net, has: d.has, tip: `${d.date}\n${signed(d.net)}` })); barsTitle = 'รายวัน'; }

  const eq = S.equityCurve(trades);
  const a = S.parseDate(anchor);
  const dayMap = new Map();
  for (const d of state.days) { const n = d.trades.reduce((x, t) => x + S.tradeNet(t), 0); dayMap.set(d.date, { net: n, count: d.trades.length, hasNote: !!(d.plan.setup || d.review.notes) }); }

  const bySymbol = S.groupBy(trades, t => t.symbol);
  const bySide = S.groupBy(trades, t => t.side, k => k === 'buy' ? 'Buy' : 'Sell');
  const byDow = S.groupBy(trades, t => String(S.parseDate(t.date).getDay()), k => ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'][Number(k)]);
  const subGroups = period === 'year' ? S.groupBy(trades, t => t.date.slice(0, 7), k => `${S.TH_MONTHS_FULL[Number(k.slice(5)) - 1]}`) :
    period === 'month' ? S.groupBy(trades, t => { const w = S.isoWeek(S.parseDate(t.date)); return `${w.year}-W${String(w.week).padStart(2, '0')}`; }, k => `สัปดาห์ ${Number(k.slice(-2))}`) :
    period === 'all' ? S.groupBy(trades, t => t.date.slice(0, 4), k => `ปี ${k}`) :
    S.groupBy(trades, t => t.date, k => S.thaiDate(k));

  const showAffiliate = !localStorage.getItem('tm-hide-affiliate');
  app.innerHTML = `
  <div class="stack">
    ${showAffiliate ? `<div class="card" id="affiliateBanner" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="font-size:1.4rem">💹</span>
      <span style="flex:1;min-width:200px" class="small muted">ยังไม่มีบัญชีเทรด หรืออยากเปลี่ยนโบรกเกอร์? เปิดบัญชีกับ Exness ผ่านลิงก์นี้ไม่มีค่าใช้จ่ายเพิ่ม ช่วยสนับสนุนแอพนี้ด้วย</span>
      <a class="btn small" href="${AFFILIATE_URL}" target="_blank" rel="noopener sponsored">เปิดบัญชี</a>
      <button class="iconbtn" id="dismissAffiliate" title="ซ่อน">✕</button>
    </div>` : ''}
    <div class="periodbar">
      <div class="seg">${['day', 'week', 'month', 'year', 'all'].map(p => `<button class="${p === period ? 'on' : ''}" data-p="${p}">${{ day: 'วัน', week: 'สัปดาห์', month: 'เดือน', year: 'ปี', all: 'ทั้งหมด' }[p]}</button>`).join('')}</div>
      <div class="periodnav ${period === 'all' ? 'hide' : ''}">
        <button class="iconbtn" data-shift="-1">‹</button><span class="lbl">${esc(period === 'day' ? S.thaiDate(anchor) : range.label)}</span><button class="iconbtn" data-shift="1">›</button>
        <button class="btn ghost small" data-today>วันนี้</button>
      </div>
    </div>

    <div class="tiles">
      <div class="tile hero">
        ${donut(m.winrate, 'winrate')}
        <div style="min-width:0">
          <span class="l">กำไร/ขาดทุนสุทธิ${cur ? ` (${esc(cur)})` : ''}</span>
          <div class="v ${cls(m.net)}">${signed(m.net)}</div>
          <span class="s">${m.total} ออเดอร์ · ${m.wins} ชนะ · ${m.losses} แพ้${m.be ? ` · ${m.be} เท่าทุน` : ''}</span>
        </div>
      </div>
      ${tile('Profit factor', S.fmtNum(m.profitFactor), 'กำไรรวม ÷ ขาดทุนรวม', m.profitFactor >= 1 ? 'pos' : (m.total ? 'neg' : ''))}
      ${tile('Expectancy', signed(m.expectancy), 'กำไรเฉลี่ยต่อไม้', cls(m.expectancy))}
      ${tile('R:R เฉลี่ย', S.fmtNum(m.rr), `ชนะเฉลี่ย ${money(m.avgWin)} / แพ้เฉลี่ย ${money(m.avgLoss)}`)}
      ${tile('Max drawdown', money(m.maxDD), 'จากจุดสูงสุดของกำไรสะสม', m.maxDD ? 'neg' : '')}
      ${tile('ไม้ดีสุด', signed(m.best), '', 'pos')}
      ${tile('ไม้แย่สุด', signed(m.worst), '', 'neg')}
      ${tile('ชนะติดกันสูงสุด', m.maxWinStreak, `แพ้ติดกันสูงสุด ${m.maxLossStreak}`)}
      ${tile('รวม lot', S.fmtNum(m.lots, 2), `กำไรรวม ${money(m.grossWin)} · ขาดทุนรวม ${money(m.grossLoss)}`)}
    </div>

    <section class="card"><div class="card-head"><h2>📈 กำไรสะสม</h2><span class="dim small">${eq.length} ออเดอร์</span></div><div class="chart-box" id="eqBox"></div></section>
    <section class="card"><div class="card-head"><h2>📊 กำไร/ขาดทุน ${barsTitle}</h2></div><div class="chart-box bars" id="barBox"></div></section>

    ${period === 'month' ? `<section class="card"><div class="card-head"><h2>🗓️ ปฏิทิน</h2><span class="dim small">แตะวันเพื่อเปิดไดอารี่</span></div>${calendarMonth(a.getFullYear(), a.getMonth(), dayMap)}</section>` : ''}

    <div class="grid-2">
      ${groupTable('ตามช่วงเวลา', subGroups, period === 'day' || period === 'week')}
      ${groupTable('ตามคู่เงิน', bySymbol)}
      ${groupTable('ตาม Buy / Sell', bySide)}
      ${groupTable('ตามวันในสัปดาห์', byDow)}
    </div>

    <section class="card">
      <div class="card-head"><h2>📜 รายการออเดอร์</h2><span class="dim small">${trades.length} รายการ</span></div>
      ${trades.length ? `<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>คู่เงิน</th><th>ฝั่ง</th><th class="num">Lot</th><th class="num">เข้า</th><th class="num">ออก</th><th class="num">กำไร</th></tr></thead><tbody>
        ${trades.slice().reverse().map(t => `<tr class="clickable" data-open="${t.date}"><td class="dim small">${t.date}</td><td><b>${esc(t.symbol)}</b></td><td><span class="side ${t.side}">${t.side.toUpperCase()}</span></td><td class="num">${S.fmtNum(t.lots, 2)}</td><td class="num">${px(t.entryPrice)}</td><td class="num">${px(t.exitPrice)}</td><td class="num ${cls(S.tradeNet(t))}"><b>${signed(S.tradeNet(t))}</b></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">ไม่มีออเดอร์ในช่วงนี้</div>'}
    </section>
  </div>`;

  const mountCharts = () => {
    const eb = $('#eqBox'), bb = $('#barBox'); if (!eb || !bb) return;
    const small = window.innerWidth < 560;
    eb.innerHTML = lineChart(eq, { width: eb.clientWidth, height: small ? 200 : 240 });
    bb.innerHTML = barChart(bars, { width: bb.clientWidth, height: small ? 180 : 220 });
  };
  mountCharts();
  state.remount = mountCharts;
  const dismissBtn = $('#dismissAffiliate', app);
  if (dismissBtn) dismissBtn.onclick = () => { try { localStorage.setItem('tm-hide-affiliate', '1'); } catch {} $('#affiliateBanner', app).remove(); };
  $$('[data-p]', app).forEach(b => b.onclick = () => { state.period = b.dataset.p; renderDashboard(app); });
  $$('[data-shift]', app).forEach(b => b.onclick = () => { state.anchor = S.shiftAnchor(period, anchor, Number(b.dataset.shift)); renderDashboard(app); });
  $('[data-today]', app).onclick = () => { state.anchor = todayStr(); renderDashboard(app); };
  $$('[data-date]', app).forEach(b => b.onclick = () => gotoDate(b.dataset.date));
  $$('[data-open]', app).forEach(r => r.onclick = () => gotoDate(r.dataset.open));
}
function tile(l, v, s, tone = '') { return `<div class="tile"><span class="l">${esc(l)}</span><span class="v ${tone}">${esc(String(v))}</span>${s ? `<span class="s">${esc(s)}</span>` : ''}</div>`; }
function fillMonths(anchor, groups) {
  const y = anchor.slice(0, 4); const map = new Map(groups.map(g => [g.key, g]));
  return Array.from({ length: 12 }, (_, i) => { const k = `${y}-${String(i + 1).padStart(2, '0')}`; const g = map.get(k); return { label: S.TH_MONTHS[i], value: g ? g.metrics.net : 0, has: !!g, tip: `${S.TH_MONTHS_FULL[i]}\n${g ? signed(g.metrics.net) + ' · ' + g.metrics.total + ' เทรด' : 'ไม่มีเทรด'}` }; });
}
function groupTable(title, groups, hide = false) {
  if (hide) return '';
  return `<section class="card"><div class="card-head"><h3>${esc(title)}</h3></div>
    ${groups.length ? `<div class="table-wrap"><table><thead><tr><th></th><th class="num">เทรด</th><th class="num">Winrate</th><th class="num">กำไร</th></tr></thead><tbody>
    ${groups.map(g => `<tr><td>${esc(g.label)}</td><td class="num">${g.metrics.total}</td><td class="num">${S.fmtPct(g.metrics.winrate)}</td><td class="num ${cls(g.metrics.net)}"><b>${signed(g.metrics.net)}</b></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">ไม่มีข้อมูล</div>'}</section>`;
}

// =====================================================================
// SETTINGS
// =====================================================================
async function renderSettings(app) {
  const s = state.settings;
  const origin = location.origin;
  app.innerHTML = `
  <div class="stack">
    <h1>⚙️ ตั้งค่า</h1>

    <section class="card"><div class="card-head"><h2>ทั่วไป</h2></div>
      <div class="form-grid">
        <label class="field full"><span>ธีม</span><select id="themeSel">
          <option value="auto" ${savedTheme() === 'auto' ? 'selected' : ''}>ตามระบบ (อัตโนมัติ)</option>
          <option value="light" ${savedTheme() === 'light' ? 'selected' : ''}>☀️ กลางวัน</option>
          <option value="dark" ${savedTheme() === 'dark' ? 'selected' : ''}>🌙 กลางคืน</option>
        </select></label>
        <label class="field"><span>สกุลเงินบัญชี</span><input id="currency" type="text" value="${esc(s.currency)}" placeholder="USD"></label>
        <label class="field"><span>ยอดเริ่มต้นบัญชี (ไว้ดูเฉยๆ)</span><input id="startingBalance" type="number" step="any" value="${esc(s.startingBalance || '')}"></label>
      </div>
    </section>

    <section class="card"><div class="card-head"><h2>☁️ Google Drive</h2>${s.lastSync ? `<span class="dim small">ซิงค์ล่าสุด ${new Date(s.lastSync).toLocaleString('th-TH')}</span>` : ''}</div>
      <div class="stack">
        <div class="form-grid">
          <label class="field full"><span>OAuth Client ID</span><input id="driveClientId" type="text" value="${esc(s.driveClientId)}" placeholder="xxxx.apps.googleusercontent.com"></label>
          <label class="field"><span>ชื่อโฟลเดอร์บน Drive</span><input id="driveFolderName" type="text" value="${esc(s.driveFolderName)}"></label>
        </div>
        <div class="row"><button class="btn" id="syncNow">☁️ ซิงค์เดี๋ยวนี้</button><button class="btn ghost" id="driveOut">ออกจาก Google</button></div>
        <details class="sec"><summary>วิธีเอา Client ID (ฟรี ทำครั้งเดียว)</summary>
          <div class="note" style="margin-top:8px">
            1. ไปที่ <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> → สร้างโปรเจกต์ใหม่<br>
            2. <b>APIs & Services → Library</b> → เปิดใช้ <b>Google Drive API</b><br>
            3. <b>OAuth consent screen</b> → External → ใส่ชื่อแอพ + อีเมล → เพิ่มตัวเองใน Test users<br>
            4. <b>Credentials → Create credentials → OAuth client ID</b> → Web application<br>
            5. Authorized JavaScript origins ใส่ <code>${esc(origin)}</code> (และ URL ที่ใช้เปิดจากมือถือ ถ้ามี)<br>
            6. ก๊อป Client ID มาวางด้านบน แล้วกดซิงค์ · ข้อมูลจะไปอยู่ในโฟลเดอร์ <b>${esc(s.driveFolderName)}</b> บน Drive ของคุณเอง
          </div>
        </details>
      </div>
    </section>

    <section class="card"><div class="card-head"><h2>🤖 อ่านภาพ MT5 ด้วย AI</h2></div>
      <div class="stack">
        <div class="form-grid">
          <label class="field full"><span>Claude API key</span><input id="claudeKey" type="password" value="${esc(s.claudeKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
          <label class="field"><span>โมเดล Claude</span><select id="claudeModel">
            ${ENGINES.claude.models.map(m => `<option value="${m}" ${s.claudeModel === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select></label>
        </div>
        <div class="note">สมัคร key ได้ที่ <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a> (จ่ายตามใช้ ภาพละไม่กี่สตางค์)</div>
        <div class="divider"></div>
        <div class="form-grid">
          <label class="field full"><span>Gemini API key</span><input id="geminiKey" type="password" value="${esc(s.geminiKey)}" placeholder="AIza…" autocomplete="off"></label>
          <label class="field"><span>โมเดล Gemini</span><select id="geminiModel">
            ${ENGINES.gemini.models.map(m => `<option value="${m}" ${s.geminiModel === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select></label>
        </div>
        <div class="note">สมัคร key ฟรีได้ที่ <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> (มี free tier ต่อวัน)</div>
        <div class="note">ไม่ใส่ทั้งคู่ก็ได้ — จะใช้ OCR ฟรี (Tesseract) แทน แต่ต้องตรวจตัวเลขเอง · key เก็บอยู่ในเครื่องนี้เท่านั้น ไม่ถูกส่งไป Drive</div>
      </div>
    </section>

    <section class="card"><div class="card-head"><h2>🤝 สนับสนุนแอพนี้</h2></div>
      <div class="stack">
        <div class="note">แอพนี้ทำและดูแลฟรี ไม่คิดค่าใช้จ่าย ถ้าอยากช่วยสนับสนุนให้พัฒนาต่อ เลือกได้ตามสะดวก ไม่บังคับ</div>
        <div class="row">
          <a class="btn" href="${AFFILIATE_URL}" target="_blank" rel="noopener sponsored">💹 เปิดบัญชีเทรดกับ Exness</a>
          ${KOFI_URL ? `<a class="btn soft" href="${KOFI_URL}" target="_blank" rel="noopener sponsored">☕ เลี้ยงกาแฟผู้พัฒนา</a>` : ''}
        </div>
        <div class="dim tiny">เปิดบัญชีผ่านลิงก์นี้ไม่มีค่าใช้จ่ายเพิ่มกับคุณ แค่เป็นลิงก์แนะนำที่ทำให้ผู้พัฒนาได้ค่าคอมมิชชั่นเล็กน้อย</div>
      </div>
    </section>

    <section class="card"><div class="card-head"><h2>💾 สำรองข้อมูล</h2></div>
      <div class="row">
        <button class="btn ghost" id="exportBtn">ดาวน์โหลดไฟล์สำรอง (.json)</button>
        <button class="btn ghost" id="importBtn">นำเข้าไฟล์สำรอง</button>
        <button class="btn danger" id="wipeBtn">ล้างข้อมูลทั้งหมดในเครื่อง</button>
      </div>
      <div class="dim small" style="margin-top:8px">ไฟล์สำรองมีทั้งบันทึกและรูปทั้งหมด · ใช้ย้ายเครื่องได้โดยไม่ต้องใช้ Drive</div>
    </section>

    <section class="card"><div class="card-head"><h2>📱 ใช้บนมือถือ</h2></div>
      <div class="note">เปิดแอพในเบราว์เซอร์มือถือแล้วเลือก <b>Add to Home Screen</b> จะได้ไอคอนเหมือนแอพจริง เปิดออฟไลน์ได้ · ข้อมูลของแต่ละเครื่องแยกกัน ให้กดซิงค์ Drive เพื่อรวมกัน</div>
    </section>

    <section class="card"><div class="card-head"><h2>📘 คู่มือ</h2></div>
      <div class="row"><a class="btn ghost" href="guide.html" target="_blank" rel="noopener">เปิดคู่มือติดตั้งและตั้งค่า</a></div>
      <div class="note" style="margin-top:10px">อยากชวนเพื่อนมาใช้ ส่งลิงก์คู่มือนี้ให้เพื่อนอ่านได้เลย ไม่ต้องมีบัญชีอะไรก็เปิดดูได้</div>
    </section>
    <div class="save-state" style="text-align:center"></div>
  </div>`;

  const save = debounce(async () => {
    await Settings.set({
      currency: $('#currency').value.trim(), startingBalance: Number($('#startingBalance').value) || 0,
      driveClientId: $('#driveClientId').value.trim(), driveFolderName: $('#driveFolderName').value.trim() || 'Trade Memo',
      claudeKey: $('#claudeKey').value.trim(), claudeModel: $('#claudeModel').value,
      geminiKey: $('#geminiKey').value.trim(), geminiModel: $('#geminiModel').value,
    });
    state.settings = await Settings.get();
    const el = $('.save-state'); if (el) { el.textContent = 'บันทึกแล้ว ✓'; setTimeout(() => { if (el.isConnected) el.textContent = ''; }, 1500); }
  }, 400);
  $$('input, select', app).forEach(i => { if (i.id !== 'themeSel') i.addEventListener('input', save); });
  $('#themeSel').onchange = e => applyTheme(e.target.value);
  $('#syncNow').onclick = () => { save(); setTimeout(doSync, 450); };
  $('#driveOut').onclick = () => { driveSignOut(); toast('ออกจาก Google แล้ว'); };
  $('#exportBtn').onclick = exportBackup;
  $('#importBtn').onclick = importBackup;
  $('#wipeBtn').onclick = async () => {
    if (!await confirmBox('ลบบันทึก ออเดอร์ และรูปทั้งหมดในเครื่องนี้? (ข้อมูลบน Drive ไม่ถูกลบ)', { danger: true, okText: 'ลบทั้งหมด' })) return;
    for (const d of await Days.all()) await Days.delete(d.date);
    for (const i of await Images.all()) await Images.delete(i.id);
    toast('ล้างข้อมูลแล้ว'); renderSettings(app);
  };
}

// ---------- backup / sync ----------
async function exportBackup() {
  const data = await exportAll();
  const imgs = await Images.all();
  data.imageData = {};
  for (const i of imgs) data.imageData[i.id] = await blobToBase64(i.blob);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `trade-memo-backup-${todayStr()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('ดาวน์โหลดไฟล์สำรองแล้ว', 'ok');
}
async function importBackup() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await store.importDays(data.days || []);
      let imgs = 0;
      for (const m of data.images || []) {
        if (await Images.get(m.id)) continue;
        const b64 = data.imageData && data.imageData[m.id]; if (!b64) continue;
        const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
        await Images.put({ ...m, blob: new Blob([arr], { type: m.type || 'image/png' }) }); imgs++;
      }
      toast(`นำเข้าแล้ว: ${r.added} วันใหม่, ${r.updated} วันอัปเดต, ${imgs} รูป`, 'ok');
    } catch (e) { toast('นำเข้าไม่สำเร็จ: ' + e.message, 'err'); }
  };
  inp.click();
}

const store = {
  exportAll,
  listImageMeta: () => Images.allMeta(),
  getImageBlob: async (id) => { const i = await Images.get(id); return i && i.blob; },
  addImage: (img) => Images.put(img),
  async importDays(remoteDays) {
    let added = 0, updated = 0;
    for (const rd of remoteDays) {
      const local = await Days.get(rd.date);
      if (!local) { await Days.putRaw(rd); added++; }
      else if ((rd.updatedAt || 0) > (local.updatedAt || 0)) { await Days.putRaw(mergeDay(local, rd)); updated++; }
    }
    return { added, updated };
  },
};
function mergeDay(local, remote) {
  // remote is newer: take remote fields, but keep any local trades missing remotely (by id)
  const ids = new Set((remote.trades || []).map(t => t.id));
  const extra = (local.trades || []).filter(t => !ids.has(t.id) && (t.createdAt || 0) > (remote.updatedAt || 0));
  return { ...remote, trades: [...(remote.trades || []), ...extra] };
}

let syncing = false;
async function doSync() {
  if (syncing) return;
  const s = await Settings.get();
  if (!s.driveClientId) { toast('ใส่ Google OAuth Client ID ในหน้าตั้งค่าก่อนนะ', 'err'); location.hash = '#/settings'; return; }
  syncing = true; const btn = $('#syncBtn'); btn.disabled = true; btn.textContent = '☁️ กำลังซิงค์…';
  try {
    const r = await driveSync({ clientId: s.driveClientId, folderName: s.driveFolderName, store, onProgress: (m) => { btn.textContent = '☁️ ' + m; } });
    await Settings.set({ lastSync: Date.now() });
    toast(`ซิงค์แล้ว · ดึงมา ${r.added + r.updated} วัน, ${r.imagesDown} รูป · ส่งขึ้น ${r.imagesUp} รูป`, 'ok');
    render();
  } catch (e) { toast('ซิงค์ไม่สำเร็จ: ' + e.message, 'err'); }
  finally { syncing = false; btn.disabled = false; btn.textContent = '☁️ ซิงค์'; }
}
$('#syncBtn').onclick = doSync;

// ---------- theme ----------
function currentTheme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
function applyTheme(t) {
  if (t === 'auto') { try { localStorage.removeItem('tm-theme'); } catch {} t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  else { try { localStorage.setItem('tm-theme', t); } catch {} }
  document.documentElement.dataset.theme = t;
  const meta = $('meta[name=theme-color]'); if (meta) meta.content = t === 'light' ? '#f4f5f9' : '#0f1115';
  updateThemeBtn();
  if (state.view === 'settings') { const sel = $('#themeSel'); if (sel) sel.value = savedTheme(); }
}
function savedTheme() { try { return localStorage.getItem('tm-theme') || 'auto'; } catch { return 'auto'; } }
function updateThemeBtn() { const b = $('#themeBtn'); if (b) b.textContent = currentTheme() === 'light' ? '🌙' : '☀️'; }
$('#themeBtn').onclick = () => applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (savedTheme() === 'auto') applyTheme('auto'); });
updateThemeBtn();

// ---------- boot ----------
(async () => {
  // responsive helpers for trade list
  const style = document.createElement('style');
  style.textContent = `.only-desktop{display:none}.only-mobile{display:flex}@media(min-width:640px){.only-desktop{display:block}.only-mobile{display:none}}`;
  document.head.appendChild(style);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (!location.hash) location.hash = '#/diary';
  route();
})();
