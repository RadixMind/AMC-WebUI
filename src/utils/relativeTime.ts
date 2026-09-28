export type RelativeTimeTranslator = (key: string, params?: Record<string, string | number>) => string;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * Format timestamp into compact relative time string:
 * - < 1 min: just now (刚刚 / now)
 * - < 1 hour: {n}m ({n}分钟 / {n}m)
 * - < 1 day: {n}h ({n}小时 / {n}h)
 * - < 30 days: {n}d ({n}天 / {n}d)
 * - < 365 days: {n}mo ({n}个月 / {n}mo)
 * - >= 365 days: {n}y ({n}年 / {n}y)
 */
export function formatRelativeTime(timestamp: number, t: RelativeTimeTranslator, now: number = Date.now()): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return t('historyTimeJustNow');
  }

  const diff = Math.max(0, now - timestamp);

  if (diff < MINUTE_MS) {
    return t('historyTimeJustNow');
  }
  if (diff < HOUR_MS) {
    const n = Math.floor(diff / MINUTE_MS);
    return t('historyTimeMinutes', { n });
  }
  if (diff < DAY_MS) {
    const n = Math.floor(diff / HOUR_MS);
    return t('historyTimeHours', { n });
  }
  if (diff < MONTH_MS) {
    const n = Math.floor(diff / DAY_MS);
    return t('historyTimeDays', { n });
  }
  if (diff < YEAR_MS) {
    const n = Math.floor(diff / MONTH_MS);
    return t('historyTimeMonths', { n });
  }
  const n = Math.floor(diff / YEAR_MS);
  return t('historyTimeYears', { n });
}

/**
 * Format timestamp to standardized date string: YYYY-MM-DD HH:mm
 */
export function formatDateTime(timestamp: number): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return '';
  }
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
