// Reads the static economic-calendar snapshot (data/calendar.json, refreshed by
// a GitHub Action) and filters it down to headlines that typically move gold:
// high/medium-impact USD releases and Fed events.

let cache = null;

export async function loadCalendar() {
  if (cache) return cache;
  try {
    const res = await fetch('./data/calendar.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    cache = await res.json();
  } catch {
    cache = { fetchedAt: null, events: [] };
  }
  return cache;
}

function isGoldRelevant(e) {
  return e.country === 'USD' && (e.impact === 'High' || e.impact === 'Medium');
}

// Returns events whose local calendar date (in the viewer's timezone) matches dateStr (YYYY-MM-DD).
export function eventsForDate(calendar, dateStr) {
  return (calendar.events || [])
    .filter(isGoldRelevant)
    .filter(e => localDateStr(e.date) === dateStr)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function localDateStr(iso) {
  const d = new Date(iso);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function localTime(iso) {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

// Range covered by the snapshot, for a friendly "no data" message outside it.
export function calendarRange(calendar) {
  const dates = (calendar.events || []).map(e => localDateStr(e.date)).sort();
  if (!dates.length) return null;
  return { start: dates[0], end: dates[dates.length - 1] };
}
