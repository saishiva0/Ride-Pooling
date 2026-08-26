/**
 * Deterministic display formatting (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW).
 *
 * All formatters are pure and timezone-independent: they operate on UTC field
 * values and fixed month names, so tests and screens are deterministic on any
 * machine. No locale APIs, no currency symbols (currency branding is a product
 * decision), no invented conventions.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Formats a departure/event date as `Aug 18, 2026 · 10:05` (UTC, 24h). The
 * output is stable across timezones so screen tests can pin exact text.
 */
export function formatDateTime(date: Date): string {
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const hours = pad2(date.getUTCHours());
  const minutes = pad2(date.getUTCMinutes());
  return `${month} ${day}, ${year} · ${hours}:${minutes}`;
}

/**
 * Formats a distance in meters as `850 m` or `1.2 km` (rounded to one decimal
 * for kilometers). Deterministic and locale-free.
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
}

/**
 * Formats a per-kilometer price as `2.50 /km`. No currency symbol — currency
 * presentation is a product decision (OD-004 is about matching thresholds;
 * currency styling is deliberately left neutral here).
 */
export function formatPricePerKm(pricePerKm: number): string {
  return `${pricePerKm.toFixed(2)} /km`;
}
