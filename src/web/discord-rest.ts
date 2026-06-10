import { config } from '../config.js';
import type { DiscordGuildChannel, DiscordGuildRole, GuildDeliveryOptions } from './types.js';

export async function exchangeDiscordCode(code: string): Promise<string> {
  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.discordClientId ?? "",
      client_secret: config.discordClientSecret ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: config.discordRedirectUri
    })
  });
  const payload = (await response.json()) as { access_token?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error("Discord token exchange failed.");
  }
  return payload.access_token;
}

export async function fetchDiscord<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error("Discord profile request failed.");
  }
  return (await response.json()) as T;
}

export async function fetchBotGuildIds(): Promise<Set<string>> {
  if (!config.discordToken) {
    return new Set();
  }
  const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
    headers: { Authorization: `Bot ${config.discordToken}` }
  });
  if (!response.ok) {
    throw new Error("Discord bot guild request failed.");
  }
  const guilds = (await response.json()) as Array<{ id: string }>;
  return new Set(guilds.map((guild) => guild.id));
}

export async function fetchGuildDeliveryOptions(guildId: string): Promise<GuildDeliveryOptions> {
  const [channels, roles] = await Promise.all([
    fetchDiscordBot<DiscordGuildChannel[]>(`/guilds/${guildId}/channels`),
    fetchDiscordBot<DiscordGuildRole[]>(`/guilds/${guildId}/roles`)
  ]);
  return {
    channels: channels
      .filter((channel) => channel.type === 0 || channel.type === 5)
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0) || left.name.localeCompare(right.name)),
    roles: roles.filter((role) => role.name !== "@everyone" && !role.managed).sort((left, right) => right.position - left.position)
  };
}

export async function fetchDiscordBot<T>(path: string): Promise<T> {
  if (!config.discordToken) {
    throw new Error("Discord bot token is not configured.");
  }
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${config.discordToken}` }
  });
  if (!response.ok) {
    throw new Error("Discord server channels and roles could not be loaded.");
  }
  return (await response.json()) as T;
}
