import { Client, TextChannel } from 'discord.js';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { getGroupEmoji } from '../emojis.js';
import { buildNodeWarTitle, getNodeWarCapacity, getGroupsForPreset, getResponseGroups, getT1DefaultGroups, OPTIONAL_ROLE_PRESETS } from '../nodewar-presets.js';
import { renderEventEmbed, renderEventComponents } from '../render.js';
import { type EventStore } from '../store.js';
import { WEEKDAYS, type GroupKey, type NodeWarTier, type WarDay, type WarEvent } from '../types.js';
import { formatClockTime } from '../time-format.js';

const NODEWAR_DURATION_MS = 60 * 60 * 1000;

function parseTime(value: string): string {
  const normalized = value.trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(normalized);
  if (!match) {
    throw new Error("Time must use 24-hour HH:mm format, for example 22:15.");
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function getAnnouncementRoleIds(event: WarEvent): string[] {
  if (event.announcementRoleIds) {
    return [...new Set(event.announcementRoleIds)];
  }
  const roleId = event.announcementRoleId ?? config.nodeWarRoleId;
  return roleId ? [roleId] : [];
}

/** Returns the fixed one-hour Node War end timestamp for an event. */
export function eventEndsAt(event: WarEvent): number {
  const parsed = new Date(`${event.date}T${event.time}:00+08:00`).getTime();
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed + NODEWAR_DURATION_MS;
}

export function buildNodeWarEvent(input: {
  tier: NodeWarTier;
  day: WarDay;
  date: string;
  title: string;
  time: string;
  recurrence: WarEvent["recurrence"];
  createdBy: string;
  notes?: string;
  announcementDate?: string;
  announcementTime?: string;
  announcementChannelId?: string;
  announcementRoleId?: string;
  announcementRoleIds?: string[];
  guildId?: string;
  channelId?: string;
}): WarEvent {
  const totalCapacity = getNodeWarCapacity(input.tier, input.day);
  const now = new Date().toISOString();

  return {
    id: nanoid(10),
    title: input.title,
    kind: "nodewar",
    tier: input.tier,
    day: input.day,
    date: input.date,
    time: parseTime(input.time),
    timezone: config.timezone,
    recurrence: input.recurrence,
    totalCapacity,
    groups: getGroupsForPreset(input.tier, totalCapacity),
    notes: input.notes,
    announcementDate: input.announcementDate,
    announcementTime: input.announcementTime,
    announcementChannelId: input.announcementChannelId,
    announcementRoleId: input.announcementRoleId,
    announcementRoleIds: input.announcementRoleIds,
    guildId: input.guildId,
    channelId: input.channelId,
    createdBy: input.createdBy,
    createdAt: now,
    signups: [],
    closed: false,
    active: true,
    autoRepost: input.recurrence === "weekly"
  };
}

export async function postEventToChannel(
  client: Client,
  channelId: string,
  event: WarEvent,
  roleIds = getAnnouncementRoleIds(event)
) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !("send" in channel)) {
    throw new Error("Selected Node War channel is not a text channel.");
  }

  const content = roleIds.length ? roleIds.map((roleId) => `<@&${roleId}>`).join(" ") : undefined;
  return channel.send({
    content,
    ...renderEventMessagePayload(event),
    allowedMentions: roleIds.length ? { roles: roleIds } : undefined
  });
}

/** Edits the currently tracked Discord message when an event has already been posted. */
export async function refreshEventMessage(client: Client, event: WarEvent): Promise<void> {
  if (!event.channelId || !event.messageId) {
    return;
  }

  const channel = await client.channels.fetch(event.channelId);
  if (!channel || !("messages" in channel)) {
    return;
  }

  const message = await channel.messages.fetch(event.messageId);
  await message.edit(renderEventMessagePayload(event));
}

/** Updates tracked open roster posts after deployment without modifying signup data. */
export async function refreshOpenEventMessages(client: Client, store: EventStore): Promise<void> {
  const events = (await store.listEvents()).filter((event) => !event.closed && event.channelId && event.messageId);
  for (const event of events) {
    await refreshEventMessage(client, event).catch((error) => {
      console.warn(`Could not refresh open event message ${event.id}:`, error);
    });
  }
}

export function renderEventMessagePayload(event: WarEvent) {
  return {
    embeds: [renderEventEmbed(event, true)],
    components: renderEventComponents(event),
    attachments: []
  };
}
