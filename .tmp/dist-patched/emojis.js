const DEFAULT_EMOJIS = {
    mainball: "<:Striker_icon:1509992261889560626>",
    defense: "<:Warrior_icon:1509984324689334362>",
    zerker: "<:Berserker_icon:1509984343614029874>",
    shai: "<:shai:1509984302149140520>",
    bench: "\u{1F455}",
    tentative: "<:scale:1511395699357384785>",
    absence: "\u{274C}",
    flex: "🧭",
    cannon: "💣",
    ranger: "🏹",
    wizwitch: "✨",
    shotcaller: "📣"
};
const DEFAULT_SUMMARY_EMOJIS = {
    date: "<:calendar:1510159184380035172>",
    signed: "<:numbers:1510159121415143514>",
    time: "<:time:1510167874189135892>",
    status: "<:status:1510159143611142144>",
    when: "\u{2753}"
};
const GROUP_LABELS = {
    mainball: "Mainball/FFA",
    defense: "Defense",
    zerker: "Zerker",
    shai: "Shai",
    bench: "Benched",
    tentative: "Tentative",
    absence: "Absence",
    flex: "Flex",
    cannon: "Cannon",
    ranger: "Archer/Ranger",
    wizwitch: "Wiz/Witch",
    shotcaller: "Shotcaller"
};
const GROUP_BADGES = {
    mainball: "FFA",
    defense: "DEF",
    zerker: "ZERK",
    shai: "SHAI",
    bench: "BENCH",
    tentative: "TENTATIVE",
    absence: "ABSENCE",
    flex: "FLEX",
    cannon: "CANNON",
    ranger: "RANGER",
    wizwitch: "WIZ",
    shotcaller: "CALL"
};
/** Resolves a configured, aliased, or default emoji for a roster group. */
export function getGroupEmoji(groupKey, configuredEmoji) {
    if (configuredEmoji?.trim()) {
        return configuredEmoji.trim();
    }
    const key = normalizeGroupKey(groupKey);
    return readEmojiEnv(key) ?? DEFAULT_EMOJIS[key] ?? "•";
}
/** Returns the display label for a normalized roster group key. */
export function getGroupLabel(groupKey) {
    const key = normalizeGroupKey(groupKey);
    return GROUP_LABELS[key] ?? groupKey;
}
/** Formats an emoji and full group label for user-facing text. */
export function formatGroupName(groupKey) {
    return `${getGroupEmoji(groupKey)} ${getGroupLabel(groupKey)}`;
}
/** Formats an emoji and compact badge for Discord responses. */
export function formatGroupBadge(groupKey) {
    return `${getGroupEmoji(groupKey)} ${GROUP_BADGES[normalizeGroupKey(groupKey)] ?? getGroupLabel(groupKey)}`;
}
/** Returns the Discord CDN URL when a group emoji is a Discord custom emoji. */
export function getGroupEmojiUrl(groupKey, configuredEmoji) {
    return discordEmojiUrl(getGroupEmoji(groupKey, configuredEmoji));
}
/** Resolves the configured or default emoji for an embed summary field. */
export function getSummaryEmoji(key) {
    return process.env[`EMOJI_${key.toUpperCase()}`]?.trim() || DEFAULT_SUMMARY_EMOJIS[key];
}
/** Converts a raw Discord custom emoji value into its CDN image URL. */
export function discordEmojiUrl(emoji) {
    const match = /^<a?:[^:]+:(\d+)>$/.exec(emoji.trim());
    return match ? `https://cdn.discordapp.com/emojis/${match[1]}.webp?size=48&quality=lossless` : undefined;
}
function normalizeGroupKey(groupKey) {
    if (groupKey === "def")
        return "defense";
    if (groupKey === "zerk")
        return "zerker";
    if (groupKey === "ffa")
        return "mainball";
    return groupKey;
}
function readEmojiEnv(groupKey) {
    const aliases = {
        mainball: ["EMOJI_MAINBALL", "EMOJI_FFA"],
        defense: ["EMOJI_DEFENSE", "EMOJI_DEF"],
        zerker: ["EMOJI_ZERKER", "EMOJI_ZERK"],
        shai: ["EMOJI_SHAI"],
        bench: ["EMOJI_BENCH"],
        tentative: ["EMOJI_TENTATIVE"],
        absence: ["EMOJI_ABSENCE"],
        flex: ["EMOJI_FLEX"],
        cannon: ["EMOJI_CANNON"],
        ranger: ["EMOJI_RANGER"],
        wizwitch: ["EMOJI_WIZWITCH"],
        shotcaller: ["EMOJI_SHOTCALLER"]
    };
    for (const name of aliases[groupKey] ?? []) {
        const value = process.env[name]?.trim();
        if (value) {
            return value;
        }
    }
    return undefined;
}
