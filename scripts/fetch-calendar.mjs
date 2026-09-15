// Fetches the ForexFactory economic calendar (via the public nfs.faireconomy.media
// mirror) server-side and writes a merged snapshot to data/calendar.json.
// Runs from a GitHub Action (or manually) — never called from the browser, since
// that host doesn't send CORS headers for cross-origin fetch.

const BASE = 'https://nfs.faireconomy.media';
// Only "thisweek" is actually served by this mirror (last/next week 404).
const WEEKS = ['ff_calendar_thisweek.json'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchWeek(file, attempt = 1) {
  const res = await fetch(`${BASE}/${file}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 429 && attempt < 8) {
    console.log(`${file}: rate limited, retry ${attempt} in ${10 * attempt}s`);
    await sleep(10000 * attempt);
    return fetchWeek(file, attempt + 1);
  }
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json();
}

const seen = new Set();
const events = [];
for (const file of WEEKS) {
  const week = await fetchWeek(file);
  for (const e of week) {
    const key = `${e.title}|${e.country}|${e.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(e);
  }
  await sleep(3000);
}

events.sort((a, b) => a.date.localeCompare(b.date));

const out = { fetchedAt: new Date().toISOString(), source: 'https://nfs.faireconomy.media (ForexFactory calendar mirror)', events };

const fs = await import('node:fs/promises');
await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../data/calendar.json', import.meta.url), JSON.stringify(out));
console.log(`Wrote ${events.length} events to data/calendar.json`);
