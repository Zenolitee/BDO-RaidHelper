import { getGroupLabel } from '../emojis.js';
import type { NodeWarTier, WarDay, GroupConfig } from '../types.js';
import { WEEKDAYS } from '../types.js';
import type { ScoreRow, ScoreReportResult } from '../score-types.js';
import type { DiscordGuildChannel, DiscordGuildRole } from './types.js';

/** Copies the constant from web.ts; avoids a circular import on utils. */
const WEB_WAR_DAYS: WarDay[] = [...WEEKDAYS];

export function parseGroupAllocation(raw: unknown, totalCapacity: number): GroupConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? ""));
  } catch {
    throw new Error("Role allocation is invalid.");
  }
  if (!Array.isArray(parsed) || parsed.length > 12) {
    throw new Error("Role allocation must contain at most 12 roles.");
  }

  const coreLabels: Record<string, string> = {
    defense: getGroupLabel("defense"),
    zerker: getGroupLabel("zerker"),
    shai: getGroupLabel("shai")
  };
  const groups: GroupConfig[] = [];
  const keys = new Set<string>();
  for (const value of parsed) {
    if (!value || typeof value !== "object") {
      throw new Error("Role allocation contains an invalid role.");
    }
    const candidate = value as Record<string, unknown>;
    const key = String(candidate.key ?? "").trim().toLowerCase();
    if (key === "mainball" || key === "bench") {
      continue;
    }
    if (!/^[a-z0-9-]{1,32}$/.test(key) || keys.has(key)) {
      throw new Error("Custom role keys must be unique letters, numbers, or dashes.");
    }
    const capacity = Number(candidate.capacity);
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > totalCapacity) {
      throw new Error("Role capacity is outside the allowed roster size.");
    }
    const label = (coreLabels[key] ?? String(candidate.label ?? "")).trim();
    if (!label || label.length > 32) {
      throw new Error("Role labels must be between 1 and 32 characters.");
    }
    const emoji = String(candidate.emoji ?? "").trim();
    if (emoji && !validRoleEmoji(emoji)) {
      throw new Error("Role emoji must be a Discord custom emoji value or a short Unicode emoji.");
    }
    keys.add(key);
    groups.push({ key, label, capacity, editable: true, ...(emoji ? { emoji } : {}) });
  }

  for (const key of ["defense", "zerker", "shai"]) {
    if (!keys.has(key)) {
      groups.push({ key, label: coreLabels[key], capacity: 0, editable: true });
    }
  }
  const specialistTotal = groups.reduce((sum, group) => sum + group.capacity, 0);
  if (specialistTotal > totalCapacity) {
    throw new Error("Specialist slots cannot exceed the total roster capacity.");
  }
  return [
    { key: "mainball", label: getGroupLabel("mainball"), capacity: totalCapacity - specialistTotal, editable: true },
    ...groups,
    { key: "bench", label: getGroupLabel("bench"), capacity: 0, editable: false }
  ];
}

export function validRoleEmoji(emoji: string): boolean {
  if (/^<a?:[A-Za-z0-9_]{2,32}:\d{5,25}>$/.test(emoji)) {
    return true;
  }
  return !emoji.includes("@") && !emoji.includes("<") && !emoji.includes(">") && !/[\r\n]/.test(emoji) && [...emoji].length <= 12;
}

export function parseTier(value: unknown): NodeWarTier {
  if (value === "tier1" || value === "tier2" || value === "tier3") {
    return value;
  }
  throw new Error("Select a valid Node War template.");
}

export function parseClockTime(value: unknown): string {
  const time = String(value ?? "").trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Announcement time must use HH:mm format.");
  }
  return time;
}

export function parseAnnouncementChannelId(value: unknown, channels: DiscordGuildChannel[]): string {
  const channelId = String(value ?? "").trim();
  if (!channelId || !channels.some((channel) => channel.id === channelId)) {
    throw new Error("Select a valid Discord roster channel.");
  }
  return channelId;
}

export function parseAnnouncementRoleIds(value: unknown, roles: DiscordGuildRole[]): string[] {
  const requested = Array.isArray(value) ? value : value ? [value] : [];
  const allowed = new Set(roles.map((role) => role.id));
  const roleIds = [...new Set(requested.map((roleId) => String(roleId).trim()).filter(Boolean))];
  if (roleIds.some((roleId) => !allowed.has(roleId))) {
    throw new Error("One or more selected Discord ping roles are invalid.");
  }
  return roleIds;
}

export function parseScoreDate(value: unknown): string {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) {
    throw new Error("Select a valid war date.");
  }
  return date;
}

export function parseScoreResult(value: unknown): ScoreReportResult {
  return value === "win" || value === "loss" ? value : "unknown";
}

export function parseScoreRowsFromForm(body: Record<string, unknown>): Omit<ScoreRow, "guildId">[] {
  const familyNames = readFormArray(body.familyName);
  return familyNames
    .map((familyName, index) => {
      const cleanName = familyName.trim().slice(0, 80);
      if (!cleanName) return undefined;
      return {
        familyName: cleanName,
        kills: parseScoreInteger(body.kills, index),
        deaths: parseScoreInteger(body.deaths, index),
        assists: parseScoreInteger(body.assists, index),
        damageDealt: parseScoreInteger(body.damageDealt, index),
        damageTaken: parseScoreInteger(body.damageTaken, index),
        crowdControls: parseScoreInteger(body.crowdControls, index),
        hpHealed: parseScoreInteger(body.hpHealed, index),
        allySupport: parseScoreInteger(body.allySupport, index),
        structureDamage: parseScoreInteger(body.structureDamage, index),
        lynchCannonKills: parseScoreInteger(body.lynchCannonKills, index),
        siegeAssists: parseScoreInteger(body.siegeAssists, index),
        resurrections: parseScoreInteger(body.resurrections, index),
        siegeDeaths: parseScoreInteger(body.siegeDeaths, index),
        specialKills: parseScoreInteger(body.specialKills, index),
        timeAlive: parseScoreTime(body.timeAlive, index),
        totalWarTime: parseScoreTime(body.totalWarTime, index)
      };
    })
    .filter((row): row is Omit<ScoreRow, "guildId"> => Boolean(row));
}

export function readFormArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? ""));
  return value === undefined ? [] : [String(value)];
}

export function parseScoreInteger(value: unknown, index: number): number {
  const raw = readFormArray(value)[index]?.replace(/,/g, "").trim() ?? "";
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Score fields must be zero or positive numbers.");
  return Math.round(parsed);
}

export function parseScoreTime(value: unknown, index: number): string {
  const raw = readFormArray(value)[index]?.trim() ?? "";
  if (!raw) return "";
  if (!/^\d{1,2}:?\d{2}(?::\d{2})?$/.test(raw)) throw new Error("Time fields must use MM:SS or HH:MM:SS format.");
  return raw.includes(":") ? raw : raw.length === 4 ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw;
}

export function parseOptionalText(value: unknown, maxLength: number): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : undefined;
}

export function isAllowedScoreImage(mimeType: string, originalName: string): boolean {
  const extension = originalName.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ["image/png", "image/jpeg", "image/webp"].includes(mimeType) && Boolean(extension && [".png", ".jpg", ".jpeg", ".webp"].includes(extension));
}

export function parseRepeatDays(value: unknown, fallback?: WarDay): WarDay[] {
  const requested = Array.isArray(value) ? value : value ? [value] : fallback ? [fallback] : [];
  const days = WEB_WAR_DAYS.filter((day) => requested.includes(day));
  if (!days.length) {
    throw new Error("Select at least one raid day.");
  }
  return days;
}
