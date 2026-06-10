import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { config } from "./config.js";
import { formatGroupBadge, formatGroupName, getGroupEmoji, getGroupLabel, getSummaryEmoji } from "./emojis.js";
import { activeRosterCapacity, activeRosterSignupCount, groupSignupCount, isRosterGroup } from "./store.js";
import { formatClockTime } from "./time-format.js";
/** Renders the Discord roster embed for an event's current lifecycle and signup state. */
export function renderEventEmbed(event, _includeThumbnail = false) {
    const status = event.closed ? "Closed" : "Open";
    const signed = activeRosterSignupCount(event);
    const unix = eventUnixSeconds(event);
    const relativeTime = unix ? `<t:${unix}:R>` : formatEventDate(event);
    const embed = new EmbedBuilder()
        .setTitle(event.title)
        .setURL(`${config.publicBaseUrl}/events/${event.id}`)
        .setColor(0xed4245)
        .addFields({ name: `${getSummaryEmoji("date")} Date`, value: `**${formatEventDate(event)}**`, inline: true }, { name: `${getSummaryEmoji("signed")} Signed`, value: `**${signed} / ${activeRosterCapacity(event)}**`, inline: true }, { name: `${getSummaryEmoji("time")} Time`, value: `**${formatEventTime(event)}**`, inline: true }, { name: `${getSummaryEmoji("status")} Status`, value: `**${status}**`, inline: true }, { name: `${getSummaryEmoji("when")} When`, value: `**${relativeTime}**`, inline: true }, { name: "\u200b", value: "\u200b", inline: true }, ...renderRosterFields(event))
        .setFooter({ text: `NW Helper | Event ${event.id} | If something breaks ask Zenolite` })
        .setTimestamp(new Date(event.createdAt));
    return embed;
}
/** Returns event message attachments. Kept as an extension point for future artwork. */
export function renderEventAttachments() {
    return [];
}
/** Renders member signup, response-status, and sign-off buttons. */
export function renderEventComponents(event) {
    const signupDisabled = event.closed;
    return [
        new ActionRowBuilder().addComponents(signupButton(event, "mainball", "FFA", ButtonStyle.Primary, signupDisabled), signupButton(event, "defense", "DEF", ButtonStyle.Secondary, signupDisabled), signupButton(event, "zerker", "ZERK", ButtonStyle.Secondary, signupDisabled), signupButton(event, "shai", "SHAI", ButtonStyle.Secondary, signupDisabled), new ButtonBuilder()
            .setCustomId(`event-leave:${event.id}`)
            .setLabel("Sign off")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(signupDisabled)),
        new ActionRowBuilder().addComponents(signupButton(event, "tentative", "Tentative", ButtonStyle.Secondary, signupDisabled), signupButton(event, "absence", "Absence", ButtonStyle.Secondary, signupDisabled))
    ];
}
function signupButton(event, group, label, style, disabled) {
    const button = new ButtonBuilder()
        .setCustomId(`event-signup:${event.id}:${group}`)
        .setLabel(label)
        .setEmoji(getGroupEmoji(group))
        .setStyle(style)
        .setDisabled(disabled || !event.groups.some((candidate) => candidate.key === group));
    return button;
}
function truncate(value, max) {
    return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}
function renderRosterFields(event) {
    return orderedGroups(event).map((group) => {
        const signups = event.signups.filter((signup) => signup.group === group.key);
        const visible = signups.slice(0, 18);
        const more = signups.length - visible.length;
        const names = visible.map((signup, index) => {
            const requestedGroup = event.groups.find((candidate) => candidate.key === signup.requestedGroup);
            const signupEmoji = group.key === "bench" && signup.requestedGroup
                ? getGroupEmoji(signup.requestedGroup, requestedGroup?.emoji)
                : getGroupEmoji(group.key, group.emoji);
            return `${signupEmoji} \`${index + 1}\` **${truncate(signup.displayName, 32)}**`;
        });
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
function renderGroupTitle(event, group) {
    const count = groupSignupCount(event, group.key);
    const label = group.label;
    const emoji = getGroupEmoji(group.key, group.emoji);
    const countText = isRosterGroup(group.key) ? `${count}/${group.capacity}` : String(count);
    return `${emoji} ${label} - (${countText})`;
}
function orderedGroups(event) {
    const order = ["mainball", "defense", "zerker", "shai", "bench", "tentative", "absence"];
    return [...event.groups].sort((a, b) => {
        const left = order.indexOf(a.key);
        const right = order.indexOf(b.key);
        return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
    });
}
function formatLongDate(date, timezone) {
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
function formatEventDate(event) {
    const unix = eventUnixSeconds(event);
    return unix ? `<t:${unix}:D>` : formatLongDate(event.date, event.timezone);
}
function formatEventTime(event) {
    const unix = eventUnixSeconds(event);
    return unix ? `<t:${unix}:t>` : `${formatClockTime(event.time)} GMT+8`;
}
function eventUnixSeconds(event) {
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
/** Formats an event announcement schedule for Discord previews. */
export function formatAnnouncementSchedule(event) {
    if (!event.announcementDate || !event.announcementTime) {
        return "Not scheduled";
    }
    const unix = unixSeconds(event.announcementDate, event.announcementTime);
    return unix
        ? `<t:${unix}:F> (<t:${unix}:R>)`
        : `${event.announcementDate} ${formatClockTime(event.announcementTime)} GMT+8`;
}
function unixSeconds(date, time) {
    const parsed = new Date(`${date}T${time}:00+08:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : Math.floor(parsed.getTime() / 1000);
}
export { formatGroupBadge, formatGroupName, getGroupEmoji, getGroupLabel };
