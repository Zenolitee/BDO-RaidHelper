import type { GroupKey } from "./types.js";

export type SummaryEmojiKey = "date" | "signed" | "time" | "status" | "when";

const DEFAULT_EMOJIS: Record<string, string> = {
  mainball: "<:Striker_icon:1509992261889560626>",
  defense: "<:Warrior_icon:1509984324689334362>",
  zerker: "<:Berserker_icon:1509984343614029874>",
  shai: "<:shai:1509984302149140520>",
  bench: "\u{1F455}",
  flex: "🧭",
  cannon: "💣",
  ranger: "🏹",
  wizwitch: "✨",
  shotcaller: "📣"
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
  bench: "Bench",
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
  flex: "FLEX",
  cannon: "CANNON",
  ranger: "RANGER",
  wizwitch: "WIZ",
  shotcaller: "CALL"
};

export function getGroupEmoji(groupKey: GroupKey): string {
  const key = normalizeGroupKey(groupKey);
  return readEmojiEnv(key) ?? DEFAULT_EMOJIS[key] ?? "•";
}

export function getGroupLabel(groupKey: GroupKey): string {
  const key = normalizeGroupKey(groupKey);
  return GROUP_LABELS[key] ?? groupKey;
}

export function formatGroupName(groupKey: GroupKey): string {
  return `${getGroupEmoji(groupKey)} ${getGroupLabel(groupKey)}`;
}

export function formatGroupBadge(groupKey: GroupKey): string {
  return `${getGroupEmoji(groupKey)} ${GROUP_BADGES[normalizeGroupKey(groupKey)] ?? getGroupLabel(groupKey)}`;
}

export function getGroupEmojiUrl(groupKey: GroupKey): string | undefined {
  return discordEmojiUrl(getGroupEmoji(groupKey));
}

export function getSummaryEmoji(key: SummaryEmojiKey): string {
  return process.env[`EMOJI_${key.toUpperCase()}`]?.trim() || DEFAULT_SUMMARY_EMOJIS[key];
}

export function discordEmojiUrl(emoji: string): string | undefined {
  const match = /^<a?:[^:]+:(\d+)>$/.exec(emoji.trim());
  return match ? `https://cdn.discordapp.com/emojis/${match[1]}.webp?size=48&quality=lossless` : undefined;
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
