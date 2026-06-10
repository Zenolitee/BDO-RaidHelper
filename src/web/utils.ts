import { config } from '../config.js';
import { getGroupEmoji, getGroupEmojiUrl } from '../emojis.js';
import { buildNodeWarTitle, getNodeWarCapacity, labelWarDay, NODE_WAR_PRESETS } from '../nodewar-presets.js';
import { activeRosterSignupCount } from '../store.js';
import { formatClockTime } from '../time-format.js';
import { WEEKDAYS, type BotSettings, type GroupKey, type WarDay, type WarEvent } from '../types.js';
import type { DiscordGuild, GuildDashboardSummary, UpcomingAnnouncement } from './types.js';

const WEB_WAR_DAYS: WarDay[] = [...WEEKDAYS];

export function buildGuildDashboardSummaries(guilds: DiscordGuild[], events: WarEvent[], settings: BotSettings = {}): GuildDashboardSummary[] {
  return guilds.map((guild) => {
    const visibleEvents = events.filter((event) => event.guildId === guild.id && (!event.closed || (event.recurrence === "once" && event.active === false)));
    const activeEvents = visibleEvents.filter(isEventActive);
    const announcements = activeEvents.flatMap((event) => getUpcomingAnnouncements(event, 1)).sort((left, right) => announcementTimestamp(left) - announcementTimestamp(right));
    const featuredRaid = [...activeEvents].sort((left, right) => eventSortTimestamp(left) - eventSortTimestamp(right))[0];
    const nextWar = featuredRaid ? warStartTimestamp(featuredRaid) : undefined;
    const channelConfigured = Boolean(settings.nodeWarChannelIds?.[guild.id] || settings.nodeWarChannelId || activeEvents.some((event) => event.announcementChannelId || event.channelId));
    const roleConfigured = activeEvents.some((event) => Boolean(event.announcementRoleIds?.length || event.announcementRoleId));
    const schedulerActive = activeEvents.some((event) => event.autoRepost !== false || event.announcementDate || event.recurrence === "weekly");
    const setupWarnings = [
      ...(channelConfigured ? [] : ["Channel not configured"]),
      ...(roleConfigured ? [] : ["Role not configured"]),
      ...(schedulerActive ? [] : ["No active schedule"])
    ];
    return {
      guild,
      activeRaids: activeEvents.length,
      upcomingRaids: announcements.length,
      totalSignups: activeEvents.reduce((sum, event) => sum + activeRosterSignupCount(event), 0),
      weeklyRaids: activeEvents.filter((event) => event.recurrence === "weekly").length,
      nextAnnouncement: announcements[0] ? formatAnnouncementDateTime(announcements[0]) : "None queued",
      nextAnnouncementTime: announcements[0] ? announcementTimestamp(announcements[0]) : undefined,
      nextWarStart: featuredRaid ? `${formatDateLabel(featuredRaid.date)} ${formatClockTime(featuredRaid.time)}` : "No war queued",
      nextWarStartTime: nextWar,
      featuredRaid,
      botInstalled: true,
      channelConfigured,
      roleConfigured,
      schedulerActive,
      setupWarnings,
      events: visibleEvents
    };
  });
}

export function eventSortTimestamp(event: WarEvent): number {
  const announcement = getUpcomingAnnouncements(event, 1)[0];
  return announcement ? announcementTimestamp(announcement) : warStartTimestamp(event);
}

export function warStartTimestamp(event: WarEvent): number {
  return new Date(`${event.date}T${event.time}:00+08:00`).getTime();
}

export function getUpcomingAnnouncements(event: WarEvent, limit: number): UpcomingAnnouncement[] {
  const announcementTime = event.announcementTime ?? config.nodeWarPostTime;
  if (event.recurrence !== "weekly") {
    const announcement = {
      date: event.date,
      announcementDate: event.announcementDate ?? previousDate(event.date),
      announcementTime,
      day: event.day ?? warDayForDate(event.date),
      title: event.title,
      totalCapacity: event.totalCapacity
    };
    return !event.announcedAt && announcementTimestamp(announcement) > Date.now() ? [announcement] : [];
  }

  const days = event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
  const start = new Date(`${currentDateInTimezone()}T12:00:00Z`);
  const announcements: UpcomingAnnouncement[] = [];
  for (let offset = 0; announcements.length < limit && offset < 28; offset += 1) {
    const warDate = new Date(start);
    warDate.setUTCDate(start.getUTCDate() + offset);
    const date = warDate.toISOString().slice(0, 10);
    const day = warDayForDate(date);
    if (!days.includes(day)) {
      continue;
    }
    const totalCapacity = event.tier ? getNodeWarCapacity(event.tier, day) : event.totalCapacity;
    const announcement: UpcomingAnnouncement = {
      date,
      announcementDate: previousDate(date),
      announcementTime,
      day,
      title: event.tier ? buildNodeWarTitle(day, event.tier, totalCapacity) : event.title,
      totalCapacity
    };
    if (announcementTimestamp(announcement) > Date.now()) {
      announcements.push(announcement);
    }
  }
  return announcements;
}

export function announcementTimestamp(announcement: Pick<UpcomingAnnouncement, "announcementDate" | "announcementTime">): number {
  return new Date(`${announcement.announcementDate}T${announcement.announcementTime}:00+08:00`).getTime();
}

export function formatAnnouncementDateTime(announcement: Pick<UpcomingAnnouncement, "announcementDate" | "announcementTime">): string {
  return `${formatDateLabel(announcement.announcementDate)} ${formatClockTime(announcement.announcementTime)}`;
}

export function formatDateLabel(date: string): string {
  const parsed = parseDateOnlyAsUtc(date);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export function parseDateOnlyAsUtc(date: string): Date {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return new Date(Number.NaN);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function scheduleTitle(event: WarEvent): string {
  if (!event.tier) {
    return `${event.kind === "siege" ? "Siege" : "Node War"} [${event.id}]`;
  }
  const tier = event.tier === "tier1" ? "T1" : event.tier === "tier2" ? "T2" : "T3";
  return `${tier} ${NODE_WAR_PRESETS[event.tier].territoryGroup} War [${event.id}]`;
}

export function isEventActive(event: WarEvent): boolean {
  return event.active ?? !event.closed;
}

export function formatRaidDays(event: WarEvent): string {
  const days = event.recurrence === "weekly" && event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
  return days.map((day) => labelWarDay(day).slice(0, 3)).join(", ") || "No days selected";
}

export function formatAnnouncementLabel(event: WarEvent): string {
  const next = getUpcomingAnnouncements(event, 1)[0];
  if (next) {
    return formatAnnouncementDateTime(next);
  }
  return event.announcedAt ? "Already posted" : "Not queued";
}

export function labelRecurrence(recurrence: WarEvent["recurrence"]): string {
  return {
    once: "Once",
    daily: "Every day",
    every_other_day: "Every other day",
    weekly: "Weekly"
  }[recurrence];
}

export function orderedGroups(event: WarEvent): WarEvent["groups"] {
  const order = ["mainball", "defense", "zerker", "shai", "bench", "tentative", "absence"];
  return [...event.groups].sort((a, b) => {
    const left = order.indexOf(a.key);
    const right = order.indexOf(b.key);
    return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
  });
}

export function renderSignupIcon(event: WarEvent, groupKey: GroupKey, requestedGroup?: GroupKey): string {
  const visibleKey = groupKey === "bench" && requestedGroup ? requestedGroup : groupKey;
  const group = event.groups.find((candidate) => candidate.key === visibleKey);
  return renderGroupIcon(visibleKey, group?.emoji);
}

export function renderGroupIcon(groupKey: GroupKey, configuredEmoji?: string): string {
  const url = getGroupEmojiUrl(groupKey, configuredEmoji);
  if (url) {
    return `<img class="role-icon" src="${escapeHtml(url)}" alt="">`;
  }

  return `<span class="role-emoji">${escapeHtml(getGroupEmoji(groupKey, configuredEmoji))}</span>`;
}

export function renderInviteButton(label = "Invite to Server"): string {
  const url = botInviteUrl();
  if (!url) {
    return "";
  }

  return `<a class="button button-secondary" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

export function botInviteUrl(): string | undefined {
  if (!config.discordClientId) {
    return undefined;
  }

  const params = new URLSearchParams({
    client_id: config.discordClientId,
    permissions: "137439366144",
    integration_type: "0",
    scope: "bot applications.commands"
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export function formatStatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(absolute >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(value));
}

export function previousDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function defaultNextWarDay(): WarDay {
  return warDayForDate(nextDateForDay());
}

export function nextDateForDay(day?: WarDay): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const value = new Date(`${values.year}-${values.month}-${values.day}T12:00:00Z`);
  const currentDay = value.getUTCDay();
  const targetDay = day ? WEB_WAR_DAYS.indexOf(day) : (currentDay + 1) % 7;
  const delta = (targetDay - currentDay + 7) % 7;
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}

/** Returns today's selected raid before war end or the nearest selected future date. */
export function nextScheduledRaid(days: WarDay[], today = currentDateInTimezone(), now = Date.now()): { day: WarDay; date: string } {
  const todayDay = warDayForDate(today);
  if (days.includes(todayDay) && now < warEndsAt(today)) {
    return { day: todayDay, date: today };
  }
  return days
    .map((day) => ({ day, date: nextDateAfter(today, day) }))
    .sort((left, right) => left.date.localeCompare(right.date))[0];
}

export function nextDateAfter(date: string, day: WarDay): string {
  const value = new Date(`${date}T12:00:00Z`);
  const delta = (WEB_WAR_DAYS.indexOf(day) - value.getUTCDay() + 7) % 7 || 7;
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}

export function warEndsAt(date: string): number {
  return new Date(`${date}T${config.nodeWarStartTime}:00+08:00`).getTime() + 60 * 60_000;
}

export function warDayForDate(date: string): WarDay {
  return WEB_WAR_DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function currentDateInTimezone(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
