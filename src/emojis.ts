import type { GroupKey } from "./types.js";

export type SummaryEmojiKey = "date" | "signed" | "time" | "status" | "when";

const DEFAULT_EMOJIS: Record<string, string> = {
  mainball: "pa_mb",
  defense: "pa_def",
  zerker: "pa_berserker",
  shai: "pa_shai",
  bench: "\u{1FA91}",
  tentative: "<:scale:1511395699357384785>",
  absence: "\u{274C}",
  flex: "🧭",
  cannon: "💣",
  ranger: "🏹",
  wizwitch: "✨",
  shotcaller: "📣"
};

const LOCAL_EMOJI_ASSETS: Record<string, string> = {
  pa_mb: "/assets/pa_mb.png",
  pa_def: "/assets/pa_def.png",
  pa_archer: "/images/classes/pa_archer.png",
  pa_berserker: "/images/classes/pa_berserker.png",
  pa_corsair: "/images/classes/pa_corsair.png",
  pa_darkknight: "/images/classes/pa_darkknight.png",
  pa_deadeye: "/images/classes/pa_deadeye.png",
  pa_drakania: "/images/classes/pa_drakania.png",
  pa_dusa: "/images/classes/pa_dusa.png",
  pa_guardian: "/images/classes/pa_guardian.png",
  pa_hashashin: "/images/classes/pa_hashashin.png",
  pa_kunoichi: "/images/classes/pa_kunoichi.png",
  pa_lahn: "/images/classes/pa_lahn.png",
  pa_maegu: "/images/classes/pa_maegu.png",
  pa_maehwa: "/images/classes/pa_maehwa.png",
  pa_musa: "/images/classes/pa_musa.png",
  pa_mystic: "/images/classes/pa_mystic.png",
  pa_ninja: "/images/classes/pa_ninja.png",
  pa_nova: "/images/classes/pa_nova.png",
  pa_ranger: "/images/classes/pa_ranger.png",
  pa_sage: "/images/classes/pa_sage.png",
  pa_scholar: "/images/classes/pa_scholar.png",
  pa_seraph: "/images/classes/pa_seraph.png",
  pa_shai: "/images/classes/pa_shai.png",
  pa_sorceress: "/images/classes/pa_sorceress.png",
  pa_striker: "/images/classes/pa_striker.png",
  pa_tamer: "/images/classes/pa_tamer.png",
  pa_valkyrie: "/images/classes/pa_valkyrie.png",
  pa_warrior: "/images/classes/pa_warrior.png",
  pa_witch: "/images/classes/pa_witch.png",
  pa_wizard: "/images/classes/pa_wizard.png",
  pa_woosa: "/images/classes/pa_woosa.png",
  pa_wukong: "/images/classes/pa_wukong.png"
};

const DEFAULT_SUMMARY_EMOJIS: Record<SummaryEmojiKey, string> = {
  date: "<:calendar:1510159184380035172>",
  signed: "<:numbers:1510159121415143514>",
  time: "<:time:1510167874189135892>",
  status: "<:status:1510159143611142144>",
  when: "\u{2753}"
};

const GROUP_LABELS: Record<string, string> = {
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

const GROUP_BADGES: Record<string, string> = {
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
export function getGroupEmoji(groupKey: GroupKey, configuredEmoji?: string): string {
  if (configuredEmoji?.trim()) {
    return configuredEmoji.trim();
  }

  const key = normalizeGroupKey(groupKey);
  return readEmojiEnv(key) ?? DEFAULT_EMOJIS[key] ?? "•";
}

/** Returns the display label for a normalized roster group key. */
export function getGroupLabel(groupKey: GroupKey): string {
  const key = normalizeGroupKey(groupKey);
  return GROUP_LABELS[key] ?? groupKey;
}

/** Formats an emoji and full group label for user-facing text. */
export function formatGroupName(groupKey: GroupKey, formatEmoji: (emoji: string) => string = (emoji) => emoji): string {
  return `${formatEmoji(getGroupEmoji(groupKey))} ${getGroupLabel(groupKey)}`;
}

/** Formats an emoji and compact badge for Discord responses. */
export function formatGroupBadge(groupKey: GroupKey, formatEmoji: (emoji: string) => string = (emoji) => emoji): string {
  return `${formatEmoji(getGroupEmoji(groupKey))} ${GROUP_BADGES[normalizeGroupKey(groupKey)] ?? getGroupLabel(groupKey)}`;
}

/** Returns the Discord CDN URL when a group emoji is a Discord custom emoji. */
export function getGroupEmojiUrl(groupKey: GroupKey, configuredEmoji?: string): string | undefined {
  return emojiImageUrl(getGroupEmoji(groupKey, configuredEmoji));
}

/** Resolves the configured or default emoji for an embed summary field. */
export function getSummaryEmoji(key: SummaryEmojiKey): string {
  return process.env[`EMOJI_${key.toUpperCase()}`]?.trim() || DEFAULT_SUMMARY_EMOJIS[key];
}

/** Converts a raw Discord custom emoji value into its CDN image URL. */
export function discordEmojiUrl(emoji: string): string | undefined {
  const match = /^<a?:[^:]+:(\d+)>$/.exec(emoji.trim());
  return match ? `https://cdn.discordapp.com/emojis/${match[1]}.webp?size=48&quality=lossless` : undefined;
}

/** Returns a browser-renderable image URL for Discord custom emojis or local named emoji assets. */
export function emojiImageUrl(emoji: string): string | undefined {
  const normalized = emoji.trim();
  return discordEmojiUrl(normalized) ?? LOCAL_EMOJI_ASSETS[normalized];
}

function normalizeGroupKey(groupKey: GroupKey): string {
  if (groupKey === "def") return "defense";
  if (groupKey === "zerk") return "zerker";
  if (groupKey === "ffa") return "mainball";
  return groupKey;
}

function readEmojiEnv(groupKey: string): string | undefined {
  const aliases: Record<string, string[]> = {
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
