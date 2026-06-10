import { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import { config } from '../config.js';
import { WEEKDAYS, type GroupKey, type NodeWarTier, type WarDay, type WarEvent } from '../types.js';
import type { EventStore } from '../store.js';

const NODEWAR_DURATION_MS = 60 * 60 * 1000;
const WIZARD_DAYS: WarDay[] = [...WEEKDAYS];

export function parseTime(value: string): string {
  const normalized = value.trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(normalized);
  if (!match) {
    throw new Error("Time must use 24-hour HH:mm format, for example 22:15.");
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function schedulerHour(): number {
  return Number.parseInt(config.nodeWarPostTime.split(":")[0] ?? "22", 10);
}

function schedulerMinute(): number {
  return Number.parseInt(config.nodeWarPostTime.split(":")[1] ?? "10", 10);
}

function announcementIsDue(
  date: string,
  time: string,
  now: { date: string; hour: number; minute: number }
): boolean {
  if (date < now.date) {
    return true;
  }
  if (date > now.date) {
    return false;
  }
  return minutesSinceMidnight(time) <= now.hour * 60 + now.minute;
}

export function announcementDateForEvent(eventDate: string): string {
  const date = new Date(`${eventDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function minutesSinceMidnight(time: string): number {
  const [hourValue, minuteValue = "00"] = time.split(":");
  return Number.parseInt(hourValue, 10) * 60 + Number.parseInt(minuteValue, 10);
}

export function zonedNow(timezone: string): { date: string; hour: number; minute: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number.parseInt(value("hour"), 10),
    minute: Number.parseInt(value("minute"), 10),
    weekday: value("weekday").toLowerCase()
  };
}

function nextWarDateInTimezone(day: WarDay, timezone: string): string {
  const now = zonedNow(timezone);
  const todayIndex = weekdayIndex(now.weekday);
  const targetIndex = weekdayIndex(day);
  const delta = (targetIndex - todayIndex + 7) % 7;
  const date = new Date(`${now.date}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function todayWarDayFromSelection(days: WarDay[], timezone: string): { day: WarDay; date: string } {
  const day = days[0];
  if (!day) {
    throw new Error("Choose today's Node War day.");
  }

  return { day, date: zonedNow(timezone).date };
}

export function currentWarDay(timezone: string): WarDay {
  const day = warDayFromWeekday(zonedNow(timezone).weekday);
  if (!day) {
    throw new Error("There is no configured Node War preset for today.");
  }
  return day;
}

/** Selects today's raid before its end window or the next allowed future raid day. */
export function nextWarDayFromSelection(
  days: WarDay[],
  timezone: string,
  now = zonedNow(timezone)
): { day: WarDay; date: string } {
  const allowedDays = days.length ? days : WIZARD_DAYS;
  const today = warDayFromWeekday(now.weekday);
  if (today && allowedDays.includes(today) && now.hour * 60 + now.minute < minutesSinceMidnight(config.nodeWarStartTime) + NODEWAR_DURATION_MS / 60_000) {
    return { day: today, date: now.date };
  }

  const next = nextWarDayAfterToday(timezone, allowedDays, now);
  if (!next) {
    throw new Error("No valid future Node War day selected.");
  }
  return next;
}

function nextWarDayAfterToday(
  timezone: string,
  allowedDays: WarDay[] = WIZARD_DAYS,
  now = zonedNow(timezone)
): { day: WarDay; date: string } | undefined {
  const todayIndex = weekdayIndex(now.weekday);
  const baseDate = new Date(`${now.date}T00:00:00Z`);

  for (let offset = 1; offset <= 7; offset += 1) {
    const index = (todayIndex + offset) % 7;
    const day = warDayFromWeekday(WEEKDAYS[index] ?? "");
    if (!day || !allowedDays.includes(day)) {
      continue;
    }

    const date = new Date(baseDate);
    date.setUTCDate(date.getUTCDate() + offset);
    return { day, date: date.toISOString().slice(0, 10) };
  }

  return undefined;
}

function warDayFromWeekday(weekday: string): WarDay | undefined {
  const normalized = weekday.toLowerCase();
  if (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].includes(normalized)) {
    return normalized as WarDay;
  }
  return undefined;
}

function weekdayIndex(day: string): number {
  return WEEKDAYS.findIndex((weekday) => weekday === day);
}

async function resolveEventId(store: EventStore, guildId: string, input: string): Promise<string> {
  const normalized = normalizeEventIdInput(input);
  const event = (await store.listEvents()).find(
    (candidate) =>
      candidate.guildId === guildId &&
      (candidate.id === normalized || candidate.id.toLowerCase() === normalized.toLowerCase())
  );
  if (!event) {
    throw new Error(`Event not found for ID "${normalized}". Use /event list and copy the ID after "ID:".`);
  }
  return event.id;
}

export function requireGuildId(interaction: ChatInputCommandInteraction): string {
  if (!interaction.guildId) {
    throw new Error("Use this command inside a Discord server.");
  }
  return interaction.guildId;
}

async function getGuildEvent(store: EventStore, guildId: string, id: string): Promise<WarEvent | undefined> {
  const event = await store.getEvent(normalizeEventIdInput(id));
  return event?.guildId === guildId ? event : undefined;
}

function normalizeEventIdInput(input: string): string {
  return input
    .trim()
    .replace(/^ID:\s*/i, "")
    .replace(/^`+|`+$/g, "")
    .replace(/^\(|\)$/g, "")
    .trim();
}

export async function getNodeWarChannelId(store: EventStore, guildId: string): Promise<string | undefined> {
  const settings = await store.getSettings();
  return (
    settings.nodeWarChannelIds?.[guildId] ??
    (guildId === config.discordGuildId ? settings.nodeWarChannelId ?? config.nodeWarChannelId : undefined)
  );
}

function getAnnouncementRoleIds(event: WarEvent): string[] {
  if (event.announcementRoleIds) {
    return [...new Set(event.announcementRoleIds)];
  }
  const roleId = event.announcementRoleId ?? config.nodeWarRoleId;
  return roleId ? [roleId] : [];
}

function groupCapacity(event: WarEvent, key: GroupKey, fallback: number): number {
  return event.groups.find((group) => group.key === key)?.capacity ?? fallback;
}
function groupsForCapacity(groups: WarEvent["groups"], totalCapacity: number): WarEvent["groups"] {
  const nextGroups = groups.map((group) => ({ ...group }));
  const mainball = nextGroups.find((group) => group.key === "mainball");
  const specialistTotal = nextGroups
    .filter((group) => group.key !== "mainball" && group.key !== "bench")
    .reduce((sum, group) => sum + group.capacity, 0);
  if (specialistTotal > totalCapacity) {
    throw new Error(`Specialist slots (${specialistTotal}) exceed ${totalCapacity}-player capacity.`);
  }
  if (mainball) {
    mainball.capacity = totalCapacity - specialistTotal;
  }
  return nextGroups;
}

function nextDateAfter(date: string, day: WarDay): string {
  const value = new Date(`${date}T00:00:00Z`);
  const delta = (weekdayIndex(day) - value.getUTCDay() + 7) % 7 || 7;
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}

function nextSelectedRaidAfter(date: string, days: WarDay[]): { day: WarDay; date: string } | undefined {
  return days
    .map((day) => ({ day, date: nextDateAfter(date, day) }))
    .sort((left, right) => left.date.localeCompare(right.date))[0];
}

export {
  schedulerHour,
  schedulerMinute,
  announcementIsDue,
  minutesSinceMidnight,
  nextWarDateInTimezone,
  nextWarDayAfterToday,
  warDayFromWeekday,
  weekdayIndex,
  resolveEventId,
  getGuildEvent,
  normalizeEventIdInput,
  getAnnouncementRoleIds,
  groupCapacity,
  groupsForCapacity,
  nextDateAfter,
  nextSelectedRaidAfter,
};
