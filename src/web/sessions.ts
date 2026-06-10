import type { Request } from "express";
import { config } from "../config.js";
import type { WebSessionStore } from "../web-session-store.js";
import type { WarEvent } from "../types.js";
import type { DiscordGuild, WebSession } from "./types.js";

const DISCORD_PERMISSION_ADMINISTRATOR = 8n;
const DISCORD_PERMISSION_MANAGE_CHANNELS = 16n;
const DISCORD_PERMISSION_MANAGE_GUILD = 32n;
const DISCORD_PERMISSION_MANAGE_ROLES = 268435456n;
const DISCORD_PERMISSION_MANAGE_MESSAGES = 8192n;

const WEB_MANAGE_PERMISSIONS = [
  DISCORD_PERMISSION_ADMINISTRATOR,
  DISCORD_PERMISSION_MANAGE_CHANNELS,
  DISCORD_PERMISSION_MANAGE_GUILD,
  DISCORD_PERMISSION_MANAGE_ROLES,
  DISCORD_PERMISSION_MANAGE_MESSAGES
];

function hasAnyDiscordPermission(permissions: string, flags: bigint[]): boolean {
  let permissionBits: bigint;
  try {
    permissionBits = BigInt(permissions);
  } catch {
    return false;
  }
  return flags.some((flag) => (permissionBits & flag) === flag);
}

function canManageGuild(session: WebSession, guildId: string): boolean {
  const guild = session.guilds.find((candidate) => candidate.id === guildId);
  return Boolean(guild && hasAnyDiscordPermission(guild.permissions, WEB_MANAGE_PERMISSIONS));
}

async function getSession(request: Request, sessions: WebSessionStore<WebSession>): Promise<WebSession | undefined> {
  const sessionId = readCookie(request, sessionCookieName());
  if (!sessionId || !/^[a-f0-9]{64}$/.test(sessionId)) return undefined;
  try {
    const session = await sessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      await sessions.delete(sessionId).catch(() => undefined);
      return undefined;
    }
    return session;
  } catch (error) {
    console.warn("Could not load dashboard session:", error);
    return undefined;
  }
}

function validCsrf(request: Request, session: WebSession): boolean {
  return typeof request.body.csrfToken === "string" && request.body.csrfToken === session.csrfToken;
}

function canManageEvent(event: WarEvent, session: WebSession): boolean {
  return Boolean(event.guildId && canManageGuild(session, event.guildId));
}

function readCookie(request: Request, name: string): string | undefined {
  const entry = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}

function sessionCookie(value: string, maxAge = 24 * 60 * 60): string {
  const secure = config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
  return `${sessionCookieName()}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}; Priority=High`;
}

function sessionCookieName(): string {
  return config.publicBaseUrl.startsWith("https://") ? "__Host-nw_session" : "nw_session";
}

function validateWebSession(value: unknown): WebSession | undefined {
  if (!value || typeof value !== "object") return undefined;
  const session = value as Partial<WebSession>;
  if (
    !session.user ||
    typeof session.user.id !== "string" ||
    typeof session.user.username !== "string" ||
    !Array.isArray(session.guilds) ||
    !session.guilds.every(
      (guild) =>
        guild &&
        typeof guild.id === "string" &&
        typeof guild.name === "string" &&
        typeof guild.permissions === "string" &&
        (guild.icon === undefined || guild.icon === null || typeof guild.icon === "string")
    ) ||
    typeof session.csrfToken !== "string" ||
    !/^[a-f0-9]{48}$/.test(session.csrfToken) ||
    typeof session.expiresAt !== "number"
  ) {
    return undefined;
  }
  return session as WebSession;
}

export {
  WEB_MANAGE_PERMISSIONS,
  hasAnyDiscordPermission,
  canManageGuild,
  canManageEvent,
  getSession,
  validCsrf,
  readCookie,
  sessionCookie,
  sessionCookieName,
  validateWebSession
};
