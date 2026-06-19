import type { Client, Collection, Guild, GuildEmoji, Snowflake } from "discord.js";

export type DiscordEmojiResolver = (emoji: string) => string;

export function createDiscordEmojiResolver(source?: Client | Guild | null): DiscordEmojiResolver {
  return (emoji) => {
    const name = emoji.trim();
    if (!name || name.startsWith("<")) {
      return emoji;
    }

    const match = findEmojiByName(source, name);
    return match ? `<${match.animated ? "a" : ""}:${match.name}:${match.id}>` : emoji;
  };
}

function findEmojiByName(source: Client | Guild | null | undefined, name: string): GuildEmoji | undefined {
  const cache = (source as { emojis?: { cache?: Collection<Snowflake, GuildEmoji> } } | null | undefined)?.emojis?.cache;
  if (!cache) {
    return undefined;
  }

  return cache.find((emoji) => emoji.name === name);
}
