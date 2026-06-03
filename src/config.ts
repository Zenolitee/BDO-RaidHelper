import "dotenv/config";
import path from "node:path";

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
  discordGuildId: process.env.DISCORD_GUILD_ID,
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
  discordRedirectUri:
    process.env.DISCORD_REDIRECT_URI ?? `${process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"}/auth/discord/callback`,
  port: Number(process.env.PORT ?? 3000),
  dataFile: path.resolve(process.env.DATA_FILE ?? "./data/events.json"),
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  nodeWarChannelId: process.env.NODEWAR_CHANNEL_ID,
  nodeWarRoleId: process.env.NODEWAR_ROLE_ID,
  officerRoleId: process.env.OFFICER_ROLE_ID,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
  geminiUserMinuteLimit: Number(process.env.GEMINI_USER_MINUTE_LIMIT ?? 3),
  geminiGuildDayLimit: Number(process.env.GEMINI_GUILD_DAY_LIMIT ?? 50),
  timezone: process.env.TIMEZONE ?? "Asia/Singapore",
  nodeWarPostTime: process.env.NODEWAR_POST_TIME ?? "22:15",
  nodeWarStartTime: process.env.NODEWAR_START_TIME ?? "21:00"
};

/** Returns the Discord credentials required by the slash-command registration script. */
export function readDiscordConfig() {
  return {
    token: readRequired("DISCORD_TOKEN"),
    clientId: readRequired("DISCORD_CLIENT_ID"),
    guildId: readRequired("DISCORD_GUILD_ID")
  };
}
