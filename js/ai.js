// AI vision: parse an MT5 screenshot (history / trade list) into structured trades.
// Two engines, both called directly from the browser with the user's own key:
//   - claude: Anthropic Messages API (paid, most accurate)
//   - gemini: Google Gemini API (has a free tier)

import { blobToBase64 } from './db.js';

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_URL = (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

export const ENGINES = {
  claude: { label: 'Claude AI (แม่นสุด)', models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'], keyPlaceholder: 'sk-ant-…', keyHelp: 'console.anthropic.com', paid: true },
  gemini: { label: 'Gemini (มี free tier)', models: ['gemini-3.6-flash', 'gemini-3.6-pro', 'gemini-2.0-flash'], keyPlaceholder: 'AIza…', keyHelp: 'aistudio.google.com/apikey', paid: false },
};

const TRADE_SCHEMA = {
  type: 'object',
  properties: {
    trades: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticket: { type: 'string', description: 'order/deal ticket number if visible, else empty string' },
          symbol: { type: 'string', description: 'e.g. XAUUSD, EURUSD' },
          side: { type: 'string', enum: ['buy', 'sell'] },
          lots: { type: 'number' },
          entryTime: { type: 'string', description: 'YYYY-MM-DD HH:MM:SS as shown, or empty' },
          entryPrice: { type: 'number' },
          exitTime: { type: 'string', description: 'YYYY-MM-DD HH:MM:SS as shown, or empty' },
          exitPrice: { type: 'number' },
          sl: { type: 'number', description: '0 if not shown' },
          tp: { type: 'number', description: '0 if not shown' },
          commission: { type: 'number', description: 'as shown (usually negative or 0)' },
          swap: { type: 'number', description: 'as shown (0 if none)' },
          pnl: { type: 'number', description: 'profit column value, negative for losses' },
          comment: { type: 'string' }
        },
        required: ['ticket', 'symbol', 'side', 'lots', 'entryTime', 'entryPrice', 'exitTime', 'exitPrice', 'sl', 'tp', 'commission', 'swap', 'pnl', 'comment'],
        additionalProperties: false
      }
    },
    accountCurrency: { type: 'string', description: 'currency shown for profit, e.g. USD, or empty' },
    summary: { type: 'string', description: 'one short line describing what the screenshot shows' },
    warnings: { type: 'array', items: { type: 'string' }, description: 'unreadable values, cut-off rows, ambiguities' }
  },
  required: ['trades', 'accountCurrency', 'summary', 'warnings'],
  additionalProperties: false
};

// Gemini's schema subset (OpenAPI-style) doesn't understand additionalProperties.
function stripAdditionalProperties(schema) {
  if (Array.isArray(schema)) return schema.map(stripAdditionalProperties);
  if (schema && typeof schema === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'additionalProperties') continue;
      out[k] = stripAdditionalProperties(v);
    }
    return out;
  }
  return schema;
}
const GEMINI_SCHEMA = stripAdditionalProperties(TRADE_SCHEMA);

const SYSTEM = `You read screenshots from MetaTrader 5 (desktop or mobile) and extract closed trades as structured data.
Rules:
- Only extract closed positions/deals that show a profit value. Skip balance/deposit/withdrawal rows, pending orders, and summary rows (Profit/Loss totals, Balance, Equity).
- Keep the symbol exactly as shown (e.g. XAUUSD, XAUUSDm, EURUSD.pro).
- side is "buy" or "sell" (MT5 mobile shows small "buy"/"sell" text under the symbol; desktop history shows type column).
- Prices, lots, profit: copy the numbers precisely. Profit negative means a loss.
- Times: keep the date and time as printed. If only time is shown (no date), leave date out and give HH:MM:SS.
- If a value is not visible, use 0 for numbers and "" for strings, and mention it in warnings.
- Do not invent rows. If a row is partially cut off and unreadable, skip it and add a warning.`;

function stripDataUrl(b64) { return b64.replace(/\s+/g, ''); }
function pickMediaType(blob) { return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.type) ? blob.type : 'image/png'; }

// ---------------- Claude ----------------
async function callClaude({ apiKey, model, data, mediaType, hint, useFallback }) {
  const body = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: (hint ? `Context from the trader: ${hint}\n\n` : '') + 'Extract every closed trade from this MT5 screenshot.' }
      ]
    }],
    output_config: { format: { type: 'json_schema', schema: TRADE_SCHEMA } }
  };
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (useFallback) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }
  const res = await fetch(CLAUDE_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && json.error.message) || `HTTP ${res.status}`;
    const err = new Error(msg); err.status = res.status; err.raw = json; throw err;
  }
  return json;
}

async function runClaude({ apiKey, model, data, mediaType, hint }) {
  let json;
  try {
    json = await callClaude({ apiKey, model, data, mediaType, hint, useFallback: true });
  } catch (e) {
    // Older accounts / unsupported beta: retry once without the fallback option.
    if (e.status === 400 && /fallback|beta/i.test(e.message)) {
      json = await callClaude({ apiKey, model, data, mediaType, hint, useFallback: false });
    } else throw e;
  }
  if (json.stop_reason === 'refusal') {
    throw new Error('โมเดลปฏิเสธคำขอนี้ (refusal) ลองภาพอื่นหรือครอปให้เห็นเฉพาะตาราง');
  }
  const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('อ่านผลลัพธ์จากโมเดลไม่ได้: ' + text.slice(0, 200)); }
  parsed.model = json.model;
  parsed.usage = json.usage;
  return parsed;
}

// ---------------- Gemini ----------------
async function runGemini({ apiKey, model, data, mediaType, hint }) {
  const body = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mediaType, data } },
        { text: (hint ? `Context from the trader: ${hint}\n\n` : '') + 'Extract every closed trade from this MT5 screenshot.' }
      ]
    }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA }
  };
  const res = await fetch(GEMINI_URL(model, apiKey), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && json.error.message) || `HTTP ${res.status}`;
    const err = new Error(msg); err.status = res.status; err.raw = json; throw err;
  }
  const cand = (json.candidates || [])[0];
  if (!cand) throw new Error('Gemini ไม่ส่งผลลัพธ์กลับมา (อาจถูกบล็อกด้วยตัวกรองความปลอดภัย)');
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    throw new Error('Gemini หยุดกลางคัน (' + cand.finishReason + ') ลองภาพอื่นหรือครอปให้เห็นเฉพาะตาราง');
  }
  const text = (cand.content && cand.content.parts || []).map(p => p.text || '').join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('อ่านผลลัพธ์จากโมเดลไม่ได้: ' + text.slice(0, 200)); }
  parsed.model = model;
  parsed.usage = json.usageMetadata && { input_tokens: json.usageMetadata.promptTokenCount, output_tokens: json.usageMetadata.candidatesTokenCount };
  return parsed;
}

// ---------------- entry point ----------------
export async function parseMT5Screenshot({ engine = 'claude', apiKey, model, imageBlob, hint = '' }) {
  const cfg = ENGINES[engine];
  if (!cfg) throw new Error('ไม่รู้จักตัวอ่าน: ' + engine);
  if (!apiKey) throw new Error(`ยังไม่ได้ใส่ ${cfg.label} API key ในหน้าตั้งค่า`);
  const data = stripDataUrl(await blobToBase64(imageBlob));
  const mediaType = pickMediaType(imageBlob);
  const run = engine === 'gemini' ? runGemini : runClaude;
  const parsed = await run({ apiKey, model: model || cfg.models[0], data, mediaType, hint });
  parsed.trades = (parsed.trades || []).map(normalizeTrade);
  return parsed;
}

function normalizeTrade(t) {
  return {
    ticket: String(t.ticket || ''),
    symbol: String(t.symbol || '').trim().toUpperCase(),
    side: t.side === 'sell' ? 'sell' : 'buy',
    lots: Number(t.lots) || 0,
    entryTime: String(t.entryTime || ''),
    entryPrice: Number(t.entryPrice) || 0,
    exitTime: String(t.exitTime || ''),
    exitPrice: Number(t.exitPrice) || 0,
    sl: Number(t.sl) || 0,
    tp: Number(t.tp) || 0,
    commission: Number(t.commission) || 0,
    swap: Number(t.swap) || 0,
    pnl: Number(t.pnl) || 0,
    notes: String(t.comment || ''),
    source: 'mt5-screenshot',
  };
}
