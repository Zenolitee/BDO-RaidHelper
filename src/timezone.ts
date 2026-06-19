/**
 * Timezone utilities for converting date+time strings to UTC timestamps.
 *
 * All events store an IANA timezone string (e.g. "Asia/Singapore", "America/New_York").
 * These helpers use Intl.DateTimeFormat to resolve the correct UTC offset for that
 * timezone on a given date, avoiding hardcoded +08:00 assumptions.
 */

/** Common timezone offsets cached for performance. Falls back to Intl lookup. */
const OFFSET_CACHE = new Map<string, number>();

/**
 * Returns the UTC offset in milliseconds for an IANA timezone on a specific date.
 * Uses Intl.DateTimeFormat to reliably handle DST transitions.
 */
export function timezoneOffsetMs(timezone: string, dateIso: string): number {
  const cacheKey = `${timezone}:${dateIso}`;
  const cached = OFFSET_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  // Parse the date-only string as UTC noon to avoid edge cases
  const match = dateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;

  const [, yearStr, monthStr, dayStr] = match;
  const utcDate = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr), 12, 0, 0));

  // Get the formatted time in the target timezone
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(utcDate);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");

  const tzYear = get("year");
  const tzMonth = get("month") - 1;
  const tzDay = get("day");
  const tzHour = get("hour");
  const tzMinute = get("minute");
  const tzSecond = get("second");

  // Construct the timestamp as if the local time were UTC, then compute the difference
  const tzAsUtc = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute, tzSecond);
  const offset = tzAsUtc - utcDate.getTime();

  OFFSET_CACHE.set(cacheKey, offset);
  return offset;
}

/**
 * Converts a date string (YYYY-MM-DD) and time string (HH:mm) in a given timezone
 * to a Unix timestamp in seconds.
 */
export function dateTimeToUnix(date: string, time: string, timezone: string): number | undefined {
  const [hourStr, minuteStr = "00"] = time.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;

  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;

  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  const day = Number(dayStr);

  // Get the offset for this timezone on this date
  const offsetMs = timezoneOffsetMs(timezone, date);

  // Construct UTC timestamp: local time minus offset = UTC
  const utcMs = Date.UTC(year, month, day, hour, minute, 0) - offsetMs;

  return Math.floor(utcMs / 1000);
}

/**
 * Converts a date+time to a Date object using the given timezone.
 */
export function dateTimeToDate(date: string, time: string, timezone: string): Date | undefined {
  const [hourStr, minuteStr = "00"] = time.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;

  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;

  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  const day = Number(dayStr);

  const offsetMs = timezoneOffsetMs(timezone, date);
  const utcMs = Date.UTC(year, month, day, hour, minute, 0) - offsetMs;

  return new Date(utcMs);
}

/**
 * Returns the timezone offset as a string like "+08:00" or "-05:00".
 */
export function timezoneOffsetString(timezone: string, date: string): string {
  const offsetMs = timezoneOffsetMs(timezone, date);
  const totalMinutes = Math.round(offsetMs / 60_000);
  const sign = totalMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Common timezones available for selection in the dashboard.
 */
export const TIMEZONE_OPTIONS = [
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT, UTC+8)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST, UTC+9)" },
  { value: "Asia/Seoul", label: "Asia/Seoul (KST, UTC+9)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (CST, UTC+8)" },
  { value: "Asia/Taipei", label: "Asia/Taipei (CST, UTC+8)" },
  { value: "Asia/Bangkok", label: "Asia/Bangkok (ICT, UTC+7)" },
  { value: "Asia/Jakarta", label: "Asia/Jakarta (WIB, UTC+7)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (IST, UTC+5:30)" },
  { value: "Europe/London", label: "Europe/London (GMT/BST)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (CET/CEST)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET/CEST)" },
  { value: "Europe/Moscow", label: "Europe/Moscow (MSK, UTC+3)" },
  { value: "America/New_York", label: "America/New_York (EST/EDT)" },
  { value: "America/Chicago", label: "America/Chicago (CST/CDT)" },
  { value: "America/Denver", label: "America/Denver (MST/MDT)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PST/PDT)" },
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo (BRT, UTC-3)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST/AEDT)" },
  { value: "Pacific/Auckland", label: "Pacific/Auckland (NZST/NZDT)" },
  { value: "UTC", label: "UTC" }
] as const;
