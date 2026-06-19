import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { config } from "./config.js";
import { formatGroupBadge, formatGroupName, getGroupEmoji, getGroupLabel, getSummaryEmoji } from "./emojis.js";
import { DEFAULT_BOSS_ORDER, formatBossOrderInitials, formatBossOrderNames } from "./gbr.js";
import { activeRosterCapacity, activeRosterSignupCount, groupSignupCount, isRosterGroup } from "./store.js";
import { formatClockTime } from "./time-format.js";
import { dateTimeToUnix } from "./timezone.js";
import { type WarEvent } from "./types.js";

export type EmojiResolver = (emoji: string) => string;

/** Renders the Discord roster embed for an event's current lifecycle and signup state. */
export function renderEventEmbed(event: WarEvent, _includeThumbnail = false, resolveEmoji: EmojiResolver = (emoji) => emoji): EmbedBuilder {
  const status = event.closed ? "Closed" : "Open";
  const signed = activeRosterSignupCount(event);
  const unix = eventUnixSeconds(event);
  const relativeTime = unix ? `<t:${unix}:R>` : formatEventDate(event);

  const embed = new EmbedBuilder()
    .setTitle(event.title)
    .setURL(`${config.publicBaseUrl}/events/${event.id}`)
    .setColor(0xed4245)
    .addFields(
      { name: `${getSummaryEmoji("date")} Date`, value: `**${formatEventDate(event)}**`, inline: true },
      { name: `${getSummaryEmoji("signed")} Signed`, value: `**${signed} / ${activeRosterCapacity(event)}**`, inline: true },
      { name: `${getSummaryEmoji("time")} Time`, value: `**${formatEventTime(event)}**`, inline: true },
      { name: `${getSummaryEmoji("status")} Status`, value: `**${status}**`, inline: true },
      { name: `${getSummaryEmoji("when")} When`, value: `**${relativeTime}**`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      ...renderRosterFields(event, resolveEmoji)
    )
    .setFooter({ text: `Project Athena | Event ${event.id} | If something breaks ask Zenolite` })
    .setTimestamp(new Date(event.createdAt));

  return embed;
}


/** Renders member signup, response-status, and sign-off buttons. */
export function renderEventComponents(event: WarEvent, resolveEmoji: EmojiResolver = (emoji) => emoji): Array<ActionRowBuilder<ButtonBuilder>> {
  const signupDisabled = event.closed;
  const signupButtons = orderedGroups(event)
    .filter((group) => isRosterGroup(group.key))
    .map((group) =>
      signupButton(
        event,
        group.key,
        group.key === "mainball" ? "FFA" : truncate(group.label, 32),
        group.key === "mainball" ? ButtonStyle.Primary : ButtonStyle.Secondary,
        signupDisabled,
        resolveEmoji
      )
    );
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
  for (let index = 0; index < signupButtons.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...signupButtons.slice(index, index + 5)));
  }

  return [
    ...rows,
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`event-leave:${event.id}`)
        .setLabel("Sign off")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(signupDisabled),
      signupButton(event, "tentative", "Tentative", ButtonStyle.Secondary, signupDisabled, resolveEmoji),
      signupButton(event, "absence", "Absence", ButtonStyle.Secondary, signupDisabled, resolveEmoji)
    )
  ];
}

/** Renders the Discord embed for a GBR notification event (no signup buttons). */
export function renderGBREventEmbed(event: WarEvent, resolveEmoji: EmojiResolver = (emoji) => emoji): EmbedBuilder {
  const status = event.closed ? "Closed" : "Open";
  const unix = eventUnixSeconds(event);
  const relativeTime = unix ? `<t:${unix}:R>` : formatEventDate(event);
  const bossOrder = event.bossOrder?.length ? event.bossOrder : DEFAULT_BOSS_ORDER;
  const dayLabel = event.day ? event.day.charAt(0).toUpperCase() + event.day.slice(1) : "Monday";

  const embed = new EmbedBuilder()
    .setTitle(`Guild Boss Raid - ${dayLabel}`)
    .setURL(`${config.publicBaseUrl}/events/${event.id}`)
    .setColor(0xed4245)
    .addFields(
      { name: `${getSummaryEmoji("date")} Date`, value: `**${formatEventDate(event)}**`, inline: true },
      { name: `${getSummaryEmoji("time")} Time`, value: `**${formatEventTime(event)}**`, inline: true },
      { name: "\ud83d\udce2 Announce", value: `**${event.announcementTime ? formatClockTime(event.announcementTime) : "TBD"}**`, inline: true },
      { name: `${getSummaryEmoji("status")} Status`, value: `**${status}**`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "\ud83d\udc09 BOSS ORDER", value: `\`${formatBossOrderInitials(bossOrder)}\`\n${formatBossOrderNames(bossOrder)}`, inline: false },
      { name: `${getSummaryEmoji("when")} When`, value: `**${relativeTime}**`, inline: false }
    )
    .setFooter({ text: `Project Athena | Event ${event.id}` })
    .setTimestamp(new Date(event.createdAt));

  return embed;
}

/** GBR events have no signup buttons — notification only. */
export function renderGBREventComponents(): Array<ActionRowBuilder<ButtonBuilder>> {
  return [];
}

/** Renders the Discord embed for a custom notification event (no signup buttons). */
export function renderCustomEventEmbed(event: WarEvent, resolveEmoji: EmojiResolver = (emoji) => emoji): EmbedBuilder {
  const status = event.closed ? "Closed" : "Open";
  const unix = eventUnixSeconds(event);
  const relativeTime = unix ? `<t:${unix}:R>` : formatEventDate(event);
  const dayLabel = event.day ? event.day.charAt(0).toUpperCase() + event.day.slice(1) : "Monday";

  const embed = new EmbedBuilder()
    .setTitle(event.title || "Custom Event")
    .setURL(`${config.publicBaseUrl}/events/${event.id}`)
    .setColor(0x5865f2)
    .addFields(
      { name: `${getSummaryEmoji("date")} Date`, value: `**${formatEventDate(event)}**`, inline: true },
      { name: `${getSummaryEmoji("time")} Time`, value: `**${formatEventTime(event)}**`, inline: true },
      { name: "\ud83d\udce2 Announce", value: `**${event.announcementTime ? formatClockTime(event.announcementTime) : "TBD"}**`, inline: true },
      { name: `${getSummaryEmoji("status")} Status`, value: `**${status}**`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: `${getSummaryEmoji("when")} When`, value: `**${relativeTime}**`, inline: true }
    )
    .setFooter({ text: `Project Athena | Event ${event.id}` })
    .setTimestamp(new Date(event.createdAt));

  // Add description if present
  if (event.description) {
    embed.addFields(
      { name: "\ud83d\udcdd DESCRIPTION", value: event.description, inline: false }
    );
  }

  return embed;
}

/** Custom events have no signup buttons — notification only. */
export function renderCustomEventComponents(): Array<ActionRowBuilder<ButtonBuilder>> {
  return [];
}

function signupButton(
  event: WarEvent,
  group: string,
  label: string,
  style: ButtonStyle,
  disabled: boolean,
  resolveEmoji: EmojiResolver
): ButtonBuilder {
  const button = new ButtonBuilder()
    .setCustomId(`event-signup:${event.id}:${group}`)
    .setLabel(label)
    .setEmoji(resolveEmoji(getGroupEmoji(group)))
    .setStyle(style)
    .setDisabled(disabled || !event.groups.some((candidate) => candidate.key === group));
  return button;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function renderRosterFields(event: WarEvent, resolveEmoji: EmojiResolver): Array<{ name: string; value: string; inline: boolean }> {
  return orderedGroups(event).map((group) => {
    const signups = event.signups.filter((signup) => signup.group === group.key);
    const visible = signups.slice(0, 18);
    const more = signups.length - visible.length;
    const names = visible.map((signup, index) => {
      const requestedGroup = event.groups.find((candidate) => candidate.key === signup.requestedGroup);
      const signupEmoji =
        group.key === "bench" && signup.requestedGroup
          ? resolveEmoji(getGroupEmoji(signup.requestedGroup, requestedGroup?.emoji))
          : resolveEmoji(getGroupEmoji(group.key, group.emoji));
      return `${signupEmoji} \`${index + 1}\` **${truncate(signup.displayName, 32)}**`;
    });
    if (more > 0) {
      names.push(`+${more} more`);
    }

    return {
      name: `__**${renderGroupTitle(event, group, resolveEmoji)}**__`,
      value: names.join("\n") || "No signups yet.",
      inline: true
    };
  });
}

function renderGroupTitle(event: WarEvent, group: WarEvent["groups"][number], resolveEmoji: EmojiResolver): string {
  const count = groupSignupCount(event, group.key);
  const label = group.label;
  const emoji = resolveEmoji(getGroupEmoji(group.key, group.emoji));
  const countText = isRosterGroup(group.key) ? `${count}/${group.capacity}` : String(count);
  return `${emoji} ${label} - (${countText})`;
}

function orderedGroups(event: WarEvent): WarEvent["groups"] {
  const order = ["mainball", "defense", "zerker", "shai", "bench", "tentative", "absence"];
  return [...event.groups].sort((a, b) => {
    const left = order.indexOf(a.key);
    const right = order.indexOf(b.key);
    return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
  });
}

function formatLongDate(date: string, timezone: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone === "server time" ? config.timezone : timezone,
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(parsed);
}

function formatEventDate(event: WarEvent): string {
  const unix = eventUnixSeconds(event);
  return unix ? `<t:${unix}:D>` : formatLongDate(event.date, event.timezone);
}

function formatEventTime(event: WarEvent): string {
  const unix = eventUnixSeconds(event);
  return unix ? `<t:${unix}:t>` : `${formatClockTime(event.time)} GMT+8`;
}

function eventUnixSeconds(event: WarEvent): number | undefined {
  return dateTimeToUnix(event.date, event.time, event.timezone);
}

/** Formats an event announcement schedule for Discord previews. */
export function formatAnnouncementSchedule(event: WarEvent): string {
  if (!event.announcementDate || !event.announcementTime) {
    return "Not scheduled";
  }

  const timezone = event.timezone ?? config.timezone;
  const unix = dateTimeToUnix(event.announcementDate, event.announcementTime, timezone);
  return unix
    ? `<t:${unix}:F> (<t:${unix}:R>)`
    : `${event.announcementDate} ${formatClockTime(event.announcementTime)} ${timezone}`;
}

export { formatGroupBadge, formatGroupName, getGroupEmoji, getGroupLabel };
