import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { config } from "./config.js";
import { formatGroupBadge, formatGroupName, getGroupEmoji, getGroupLabel, getSummaryEmoji } from "./emojis.js";
import { groupSignupCount } from "./store.js";
import { type WarEvent } from "./types.js";

export function renderEventEmbed(event: WarEvent, _includeThumbnail = false): EmbedBuilder {
  const status = event.closed ? "Closed" : "Open";
  const signed = event.signups.filter((signup) => signup.group !== "bench").length;
  const unix = eventUnixSeconds(event);
  const relativeTime = unix ? `<t:${unix}:R>` : formatEventDate(event);

  const embed = new EmbedBuilder()
    .setTitle(event.title)
    .setURL(`${config.publicBaseUrl}/events/${event.id}`)
    .setColor(0xed4245)
    .addFields(
      { name: `${getSummaryEmoji("date")} Date`, value: `**${formatEventDate(event)}**`, inline: true },
      { name: `${getSummaryEmoji("signed")} Signed`, value: `**${signed} / ${event.totalCapacity}**`, inline: true },
      { name: `${getSummaryEmoji("time")} Time`, value: `**${formatEventTime(event)}**`, inline: true },
      { name: `${getSummaryEmoji("status")} Status`, value: `**${status}**`, inline: true },
      { name: `${getSummaryEmoji("when")} When`, value: `**${relativeTime}**`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "\u200b", value: "------------------------------------------------------------", inline: false },
      ...renderRosterFields(event)
    )
    .setFooter({ text: `NW Helper | Event ${event.id} | If something breaks ask Zenolite` })
    .setTimestamp(new Date(event.createdAt));

  return embed;
}

export function renderEventAttachments(): AttachmentBuilder[] {
  return [];
}

export function renderEventComponents(event: WarEvent): Array<ActionRowBuilder<ButtonBuilder>> {
  const signupDisabled = event.closed;

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      signupButton(event, "mainball", "FFA", ButtonStyle.Primary, signupDisabled),
      signupButton(event, "defense", "DEF", ButtonStyle.Secondary, signupDisabled),
      signupButton(event, "zerker", "ZERK", ButtonStyle.Secondary, signupDisabled),
      signupButton(event, "shai", "SHAI", ButtonStyle.Secondary, signupDisabled),
      new ButtonBuilder()
        .setCustomId(`event-leave:${event.id}`)
        .setLabel("Sign off")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(signupDisabled)
    )
  ];
}

export const renderSignupMenu = renderEventComponents;

function signupButton(
  event: WarEvent,
  group: string,
  label: string,
  style: ButtonStyle,
  disabled: boolean
): ButtonBuilder {
  const button = new ButtonBuilder()
    .setCustomId(`event-signup:${event.id}:${group}`)
    .setLabel(label)
    .setEmoji(getGroupEmoji(group))
    .setStyle(style)
    .setDisabled(disabled || !event.groups.some((candidate) => candidate.key === group));
  return button;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function renderRosterFields(event: WarEvent): Array<{ name: string; value: string; inline: boolean }> {
  return orderedGroups(event).filter((group) => group.key !== "bench").map((group) => {
    const signups = event.signups.filter((signup) => signup.group === group.key);
    const visible = signups.slice(0, 18);
    const more = signups.length - visible.length;
    const names = visible.map((signup, index) => `\`${index + 1}\` **${truncate(signup.displayName, 32)}**`);
    if (more > 0) {
      names.push(`+${more} more`);
    }

    return {
      name: `__**${renderGroupTitle(event, group)}**__`,
      value: names.join("\n") || "No signups yet.",
      inline: true
    };
  });
}

function renderGroupTitle(event: WarEvent, group: WarEvent["groups"][number]): string {
  const count = groupSignupCount(event, group.key);
  const label = getGroupLabel(group.key);
  const emoji = getGroupEmoji(group.key);
  const countText = group.key === "bench" ? String(count) : `${count}/${group.capacity}`;
  return `${emoji} ${label} - ${countText}`;
}

function orderedGroups(event: WarEvent): WarEvent["groups"] {
  const order = ["mainball", "defense", "zerker", "shai", "bench"];
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

function formatTime(time: string): string {
  const [hourValue, minute = "00"] = time.split(":");
  const hour = Number.parseInt(hourValue, 10);
  if (!Number.isInteger(hour)) {
    return time;
  }

  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minute.padStart(2, "0")} ${suffix}`;
}

function formatEventDate(event: WarEvent): string {
  const unix = eventUnixSeconds(event);
  return unix ? `<t:${unix}:D>` : formatLongDate(event.date, event.timezone);
}

function formatEventTime(event: WarEvent): string {
  const unix = eventUnixSeconds(event);
  return unix ? `<t:${unix}:t>` : `${formatTime(event.time)} GMT+8`;
}

function eventUnixSeconds(event: WarEvent): number | undefined {
  const [hourValue, minuteValue = "00"] = event.time.split(":");
  const hour = Number.parseInt(hourValue, 10);
  const minute = Number.parseInt(minuteValue, 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return undefined;
  }

  const parsed = new Date(`${event.date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return Math.floor(parsed.getTime() / 1000);
}

export { formatGroupBadge, formatGroupName, getGroupEmoji, getGroupLabel };
