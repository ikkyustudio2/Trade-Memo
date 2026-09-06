// Free, offline-ish OCR fallback using Tesseract.js (loaded from CDN on first use).
// Best-effort parser for MT5 history rows; user reviews/edits before saving.

let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = resolve; s.onerror = () => reject(new Error('โหลด Tesseract.js ไม่สำเร็จ (ต้องต่อเน็ตครั้งแรก)'));
    document.head.appendChild(s);
  });
  return loading;
}

export async function ocrImage(blob, onProgress = () => {}) {
  await loadTesseract();
  const url = URL.createObjectURL(blob);
  try {
    const res = await Tesseract.recognize(url, 'eng', {
      logger: m => { if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100)); },
    });
    return res.data.text || '';
  } finally { URL.revokeObjectURL(url); }
}

const NUM = /^[+-]?\d{1,3}(?:[ ,]\d{3})*(?:\.\d+)?$|^[+-]?\d+(?:\.\d+)?$/;
const TIME = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const DATE = /^\d{4}[.\-/]\d{2}[.\-/]\d{2}$/;
const SYMBOL = /^[A-Z]{3,}[A-Z0-9.#_\-]*$/i;

function toNum(s) { return Number(String(s).replace(/[ ,](?=\d{3})/g, '').replace(/[^0-9.+-]/g, '')) || 0; }

export function parseOcrText(text) {
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const trades = [];
  const warnings = [];
  let i = 0;
  while (i < rawLines.length) {
    let line = rawLines[i];
    const sideMatch = line.match(/\b(buy|sell)\b/i);
    if (!sideMatch) { i++; continue; }
    // merge following lines until we have enough numbers (mobile layouts split rows)
    let merged = line, j = i + 1;
    while (countNums(merged) < 3 && j < rawLines.length && j < i + 4 && !/\b(buy|sell)\b/i.test(rawLines[j])) { merged += ' ' + rawLines[j]; j++; }
    const t = parseRow(merged);
    if (t) trades.push(t); else warnings.push('อ่านแถวนี้ไม่ออก: ' + merged.slice(0, 60));
    i = j > i + 1 && countNums(line) < 3 ? j : i + 1;
  }
  if (!trades.length) warnings.push('ไม่พบแถวที่มี buy/sell ในภาพ ลองครอปให้ชัดขึ้น หรือใช้ Claude แทน');
  return { trades, warnings, summary: `OCR พบ ${trades.length} รายการ (ตรวจสอบตัวเลขก่อนบันทึก)` };
}

function countNums(s) { return s.split(/\s+/).filter(t => NUM.test(t.replace(/[()]/g, ''))).length; }

function parseRow(line) {
  // join thousands separated by a space (mobile MT5 prints "2 510.20")
  const toks = line.replace(/(\d) (\d{3}(?:\.\d+)?)(?!\d)/g, '$1$2').replace(/[|,;]+/g, ' ').split(/\s+/).filter(Boolean);
  const sideIdx = toks.findIndex(t => /^(buy|sell)$/i.test(t));
  if (sideIdx < 0) return null;
  const side = toks[sideIdx].toLowerCase();
  // symbol: nearest symbol-looking token before side (skip "in"/"out"), else after side
  let symbol = '';
  for (let k = sideIdx - 1; k >= 0 && k >= sideIdx - 4; k--) {
    if (SYMBOL.test(toks[k]) && !/^(in|out|buy|sell)$/i.test(toks[k]) && !NUM.test(toks[k])) { symbol = toks[k]; break; }
  }
  if (!symbol) for (let k = sideIdx + 1; k < Math.min(toks.length, sideIdx + 4); k++) if (SYMBOL.test(toks[k]) && !NUM.test(toks[k])) { symbol = toks[k]; break; }
  const dates = toks.filter(t => DATE.test(t));
  const times = toks.filter(t => TIME.test(t));
  const nums = toks.slice(sideIdx + 1).map(t => t.replace(/[()]/g, '')).filter(t => NUM.test(t) && !TIME.test(t) && !DATE.test(t)).map(toNum);
  if (nums.length < 2) return null;
  const lots = nums[0];
  const entryPrice = nums[1];
  const pnl = nums[nums.length - 1];
  let rest = nums.slice(2, -1);
  // strip likely ticket-sized integers
  rest = rest.filter(n => !(Number.isInteger(n) && n > 100000));
  let exitPrice = 0;
  if (rest.length) {
    let best = Infinity;
    for (const n of rest) { if (n === 0) continue; const d = Math.abs(n - entryPrice) / Math.max(1e-9, Math.abs(entryPrice)); if (d < best && d < 0.2) { best = d; exitPrice = n; } }
  }
  const stamp = (d, t) => (d ? d.replace(/[/.]/g, '-') : '') + (t ? (d ? ' ' : '') + t : '');
  return {
    ticket: '', symbol: symbol.toUpperCase(), side, lots, entryPrice, exitPrice,
    entryTime: stamp(dates[0], times[0]), exitTime: times[1] ? stamp(dates[1] || dates[0], times[1]) : '',
    sl: 0, tp: 0, commission: 0, swap: 0, pnl, notes: '', source: 'mt5-ocr',
  };
}
