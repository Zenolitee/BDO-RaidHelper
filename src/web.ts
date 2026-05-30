import express from "express";
import { randomBytes } from "node:crypto";
import type { Request } from "express";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { getGroupEmoji, getGroupEmojiUrl, getGroupLabel } from "./emojis.js";
import { buildNodeWarTitle, getNodeWarCapacity, labelTier, labelWarDay, NODE_WAR_PRESETS } from "./nodewar-presets.js";
import { activeRosterCapacity, type EventStore } from "./store.js";
import { type GroupConfig, type GroupKey, type NodeWarTier, type WarDay, type WarEvent } from "./types.js";

interface UserProfile {
  id: string;
  username: string;
  global_name?: string;
}

interface DiscordGuild {
  id: string;
  name: string;
  permissions: string;
  icon?: string | null;
}

interface DiscordGuildChannel {
  id: string;
  name: string;
  position?: number;
  type: number;
}

interface DiscordGuildRole {
  id: string;
  name: string;
  managed: boolean;
  position: number;
}

interface GuildDeliveryOptions {
  channels: DiscordGuildChannel[];
  roles: DiscordGuildRole[];
}

interface UpcomingAnnouncement {
  date: string;
  announcementDate: string;
  announcementTime: string;
  day: WarDay;
  title: string;
  totalCapacity: number;
}

interface WebAppOptions {
  onEventUpdated?: (event: WarEvent) => Promise<void>;
}

interface WebSession {
  user: UserProfile;
  guilds: DiscordGuild[];
  csrfToken: string;
  expiresAt: number;
}

const WEB_WAR_DAYS: WarDay[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function createWebApp(store: EventStore, options: WebAppOptions = {}) {
  const app = express();
  const oauthStates = new Map<string, number>();
  const sessions = new Map<string, WebSession>();

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use("/assets", express.static("src/public"));

  app.get("/", async (request, response) => {
    const session = getSession(request, sessions);
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    const events = guild ? (await store.listEvents()).filter((event) => event.guildId === guild.id) : [];
    response.type("html").send(renderPage("NW Helper", renderEventList(events, session, guildId)));
  });

  app.get("/auth/discord", (_request, response) => {
    if (!config.discordClientId || !config.discordClientSecret) {
      response.status(503).send("Discord login is not configured.");
      return;
    }
    const state = randomBytes(24).toString("hex");
    oauthStates.set(state, Date.now() + 10 * 60_000);
    const params = new URLSearchParams({
      client_id: config.discordClientId,
      redirect_uri: config.discordRedirectUri,
      response_type: "code",
      scope: "identify guilds",
      state
    });
    response.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  });

  app.get("/auth/discord/callback", async (request, response) => {
    const code = typeof request.query.code === "string" ? request.query.code : "";
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const expiresAt = oauthStates.get(state);
    oauthStates.delete(state);
    if (!code || !expiresAt || expiresAt < Date.now() || !config.discordClientId || !config.discordClientSecret) {
      response.status(400).send("Invalid or expired Discord login.");
      return;
    }

    try {
      const token = await exchangeDiscordCode(code);
      const [user, guilds] = await Promise.all([
        fetchDiscord<UserProfile>("/users/@me", token),
        fetchDiscord<DiscordGuild[]>("/users/@me/guilds", token)
      ]);
      const botGuildIds = await fetchBotGuildIds();
      const sessionId = randomBytes(32).toString("hex");
      sessions.set(sessionId, {
        user,
        guilds: guilds.filter((guild) => hasAdministratorPermission(guild.permissions) && botGuildIds.has(guild.id)),
        csrfToken: randomBytes(24).toString("hex"),
        expiresAt: Date.now() + 24 * 60 * 60_000
      });
      response.setHeader("Set-Cookie", sessionCookie(sessionId));
      response.redirect("/");
    } catch {
      response.status(502).type("html").send(renderPage("Login failed", renderLoginError()));
    }
  });

  app.get("/logout", (request, response) => {
    const sessionId = readCookie(request, "nw_session");
    if (sessionId) sessions.delete(sessionId);
    response.setHeader("Set-Cookie", sessionCookie("", 0));
    response.redirect("/");
  });

  app.get("/create", async (request, response) => {
    const session = getSession(request, sessions);
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    if (!session || !guildId || !session.guilds.some((guild) => guild.id === guildId)) {
      response.status(403).type("html").send(renderPage("Create Raid", renderLoginRequired()));
      return;
    }
    try {
      const [deliveryOptions, settings] = await Promise.all([fetchGuildDeliveryOptions(guildId), store.getSettings()]);
      response
        .type("html")
        .send(renderPage("Create Raid", renderCreateRaid(guildId, session.csrfToken, session, deliveryOptions, settings.nodeWarChannelIds?.[guildId] ?? config.nodeWarChannelId)));
    } catch (error) {
      response.status(502).type("html").send(renderPage("Create Raid", renderWebError(error)));
    }
  });

  app.post("/create", async (request, response) => {
    const session = getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    if (!session || !session.guilds.some((guild) => guild.id === guildId) || !validCsrf(request, session)) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      const tier = parseTier(request.body.tier);
      const recurrence = request.body.recurrence === "weekly" ? "weekly" : "once";
      const repeatDays = parseRepeatDays(request.body.repeatDays);
      if (recurrence === "once" && repeatDays.length !== 1) {
        throw new Error("One-time events must use exactly one raid day.");
      }
      const deliveryOptions = await fetchGuildDeliveryOptions(guildId);
      const announcementChannelId = parseAnnouncementChannelId(request.body.announcementChannelId, deliveryOptions.channels);
      const announcementRoleIds = parseAnnouncementRoleIds(request.body.announcementRoleIds, deliveryOptions.roles);
      const announcementTime = parseClockTime(request.body.announcementTime);
      const plannedEvents = repeatDays.map((day) => {
        const date = nextDateForDay(day);
        const totalCapacity = getNodeWarCapacity(tier, day);
        return { day, date, totalCapacity, groups: parseGroupAllocation(request.body.groups, totalCapacity) };
      });
      const events = await Promise.all(
        plannedEvents.map(async ({ day, date, totalCapacity, groups }) => {
          const event: WarEvent = {
            id: nanoid(10),
            title: buildNodeWarTitle(day, tier, totalCapacity),
            kind: "nodewar",
            tier,
            day,
            repeatDays: recurrence === "weekly" ? [day] : undefined,
            date,
            time: config.nodeWarStartTime,
            timezone: config.timezone,
            recurrence,
            totalCapacity,
            groups,
            announcementDate: previousDate(date),
            announcementTime,
            announcementChannelId,
            announcementRoleIds,
            guildId,
            createdBy: `web:${session.user.id}`,
            createdAt: new Date().toISOString(),
            signups: [],
            closed: false
          };
          await store.createEvent(event);
          return event;
        })
      );
      response.redirect(`/events/${events[0].id}/edit?created=${events.length}`);
    } catch (error) {
      response.status(400).type("html").send(renderPage("Create Raid", renderWebError(error)));
    }
  });

  app.get("/events/:id", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = getSession(request, sessions);
    if (!event) {
      response.status(404).type("html").send(renderPage("Not found", "<main><h1>Event not found</h1></main>"));
      return;
    }

    const canManage = Boolean(event.guildId && session?.guilds.some((guild) => guild.id === event.guildId));
    const deliveryOptions = event.guildId ? await fetchGuildDeliveryOptions(event.guildId).catch(() => undefined) : undefined;
    response.type("html").send(renderPage(event.title, renderEventDetail(event, canManage, session, deliveryOptions)));
  });

  app.get("/events/:id/edit", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = getSession(request, sessions);
    if (!event || !session || !canManageEvent(event, session)) {
      response.status(404).type("html").send(renderPage("Not found", "<main><h1>Event not found</h1></main>"));
      return;
    }
    response.type("html").send(renderPage(`Edit ${event.title}`, renderEditRaid(event, session.csrfToken, session)));
  });

  app.post("/events/:id/composition", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = getSession(request, sessions);
    if (!event || !session || !canManageEvent(event, session) || !validCsrf(request, session)) {
      response.status(403).send("Not authorized.");
      return;
    }
    try {
      const recurrence = request.body.recurrence === "weekly" ? "weekly" : "once";
      const repeatDays = parseRepeatDays(request.body.repeatDays, event.day);
      if (recurrence === "once" && repeatDays.length !== 1) {
        throw new Error("One-time events must use exactly one raid day.");
      }
      const selectedDay = repeatDays.includes(event.day as WarDay) ? (event.day as WarDay) : repeatDays[0];
      const date = selectedDay === event.day && !event.closed ? event.date : nextDateForDay(selectedDay);
      const totalCapacity = event.tier ? getNodeWarCapacity(event.tier, selectedDay) : event.totalCapacity;
      const groups = parseGroupAllocation(request.body.groups, totalCapacity);
      const announcementTime = parseClockTime(request.body.announcementTime);
      const announcementDate = previousDate(date);
      const previousRepeatDays = event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
      const repeatDaysChanged =
        (recurrence === "weekly" || event.recurrence === "weekly") && repeatDays.join(",") !== previousRepeatDays.join(",");
      const scheduleChanged =
        date !== event.date ||
        announcementDate !== event.announcementDate ||
        announcementTime !== event.announcementTime ||
        recurrence !== event.recurrence ||
        repeatDaysChanged;
      const updated = await store.updateEventDetails(event.id, {
        groups,
        title: event.tier ? buildNodeWarTitle(selectedDay, event.tier, totalCapacity) : event.title,
        recurrence,
        repeatDays: recurrence === "weekly" ? repeatDays : undefined,
        day: selectedDay,
        date,
        totalCapacity,
        announcementDate,
        announcementTime,
        ...(scheduleChanged ? { announcedAt: undefined, closed: false } : {})
      });
      await refreshPostedEvent(options, updated);
      response.redirect(`/events/${event.id}/edit?saved=1`);
    } catch (error) {
      response.status(400).type("html").send(renderPage("Composition update failed", renderWebError(error)));
    }
  });

  app.post("/events/:id/delete", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = getSession(request, sessions);
    if (!event || !session || !canManageEvent(event, session) || !validCsrf(request, session)) {
      response.status(403).send("Not authorized.");
      return;
    }
    await store.deleteEvent(event.id);
    response.redirect(`/?guild=${encodeURIComponent(event.guildId ?? "")}`);
  });

  app.get("/api/events", async (_request, response) => {
    response.status(403).json({ error: "Server-scoped event listing requires Discord login." });
  });

  app.get("/api/events/:id", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = getSession(request, sessions);
    if (!event || !event.guildId || !session?.guilds.some((guild) => guild.id === event.guildId)) {
      response.status(404).json({ error: "Event not found." });
      return;
    }
    response.json(event);
  });

  return app;
}

async function refreshPostedEvent(options: WebAppOptions, event: WarEvent): Promise<void> {
  if (!event.channelId || !event.messageId || !options.onEventUpdated) {
    return;
  }
  try {
    await options.onEventUpdated(event);
  } catch (error) {
    console.warn(`Could not refresh posted event ${event.id} after web update:`, error);
  }
}

function renderAccountControls(session?: WebSession, selectedGuildId?: string): string {
  if (!session) {
    return `<a class="button button-secondary" href="/auth/discord">Log in with Discord</a>`;
  }

  return `<div class="account-panel">
    <span class="account-name">${escapeHtml(session.user.global_name ?? session.user.username)}</span>
    ${selectedGuildId ? `<a href="/">Switch server</a>` : ""}
    <a href="/logout">Log out</a>
  </div>`;
}

function renderLoginRequired(): string {
  return `${renderNav()}<main class="shell narrow-shell"><section class="empty-state"><p class="eyebrow">Private dashboard</p><h1>Discord login required</h1><p>Log in to manage servers where you are an administrator and NW Helper is installed.</p><a class="button" href="/auth/discord">Log in with Discord</a></section></main>`;
}

function renderLoginError(): string {
  return `${renderNav()}<main class="shell narrow-shell"><section class="empty-state"><p class="eyebrow">Private dashboard</p><h1>Discord login failed</h1><p>The OAuth request could not be completed. Check the configured redirect URI and try again.</p><a class="button" href="/auth/discord">Try again</a></section></main>`;
}

async function exchangeDiscordCode(code: string): Promise<string> {
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

async function fetchDiscord<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error("Discord profile request failed.");
  }
  return (await response.json()) as T;
}

async function fetchBotGuildIds(): Promise<Set<string>> {
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

async function fetchGuildDeliveryOptions(guildId: string): Promise<GuildDeliveryOptions> {
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

async function fetchDiscordBot<T>(path: string): Promise<T> {
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

function hasAdministratorPermission(permissions: string): boolean {
  return (BigInt(permissions) & 8n) === 8n;
}

function getSession(request: Request, sessions: Map<string, WebSession>): WebSession | undefined {
  const sessionId = readCookie(request, "nw_session");
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session || session.expiresAt < Date.now()) {
    if (sessionId) sessions.delete(sessionId);
    return undefined;
  }
  return session;
}

function validCsrf(request: Request, session: WebSession): boolean {
  return typeof request.body.csrfToken === "string" && request.body.csrfToken === session.csrfToken;
}

function canManageEvent(event: WarEvent, session: WebSession): boolean {
  return Boolean(event.guildId && session.guilds.some((guild) => guild.id === event.guildId));
}

function readCookie(request: Request, name: string): string | undefined {
  const entry = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}

function sessionCookie(value: string, maxAge = 24 * 60 * 60): string {
  const secure = config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
  return `nw_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | NW Helper</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body class="antialiased selection:bg-amber-300/30 selection:text-amber-50">
  ${body}
</body>
</html>`;
}

function renderEventList(events: WarEvent[], session?: WebSession, guildId?: string): string {
  const selectedGuild = session?.guilds.find((guild) => guild.id === guildId);
  const activeEvents = events.filter((event) => !event.closed);
  const totalSignups = activeEvents.reduce((sum, event) => sum + event.signups.filter((signup) => signup.group !== "bench").length, 0);
  const weeklyPosts = activeEvents.filter((event) => event.recurrence === "weekly").length;
  const nextAnnouncement = [...activeEvents]
    .filter((event) => event.announcementDate && event.announcementTime && !event.announcedAt)
    .sort((left, right) => `${left.announcementDate} ${left.announcementTime}`.localeCompare(`${right.announcementDate} ${right.announcementTime}`))[0];
  const cards = activeEvents
    .map((event) => {
      const signed = event.signups.filter((signup) => signup.group !== "bench").length;
      const capacity = activeRosterCapacity(event);
      return `<article class="event-card group relative overflow-hidden">
        <div class="card-top"><span class="type-pill">${event.tier ? labelTier(event.tier) : event.kind === "siege" ? "Siege" : "Node War"}</span><span>${labelRecurrence(event.recurrence)}</span></div>
        <a class="event-title" href="/events/${event.id}"><strong>${escapeHtml(scheduleTitle(event))}</strong></a>
        <small>Created ${formatDateLabel(event.createdAt.slice(0, 10))}</small>
        <small>Current roster ${escapeHtml(event.title)}</small>
        <small>Following signup post ${formatAnnouncementLabel(event)}</small>
        <small>War starts ${formatTimeLabel(event.time)} ${escapeHtml(config.timezone)}</small>
        <span class="card-meter"><i style="width:${capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0}%"></i></span>
        <div class="card-footer"><b>${signed}/${capacity} signed</b><span class="card-actions"><a href="/events/${event.id}/edit">Manage</a>${session ? `<form method="post" action="/events/${event.id}/delete" onsubmit="return confirm('Delete this raid event?')"><input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}"><button class="link-button danger-link" type="submit">Delete</button></form>` : ""}</span></div>
      </article>`;
    })
    .join("");
  const serverPicker =
    session && !selectedGuild
      ? `<section class="server-picker"><header><p class="eyebrow">Your servers</p><h1>Select a server</h1><p>Only servers shared with NW Helper are listed.</p></header><div class="server-grid">${session.guilds
          .map(
            (guild) =>
              `<a class="server-card group transition duration-200 ease-out" href="/?guild=${encodeURIComponent(guild.id)}">${renderGuildAvatar(guild)}<span><strong>${escapeHtml(guild.name)}</strong><small>Open raid dashboard</small></span><b>Open</b></a>`
          )
          .join("") || "<p>No shared administrator servers found.</p>"}</div><div class="invite-row"><span>Not seeing your server?</span>${renderInviteButton("Invite the bot")}</div></section>`
      : "";

  return `${renderNav(session, guildId)}<main class="shell">
    ${selectedGuild ? `<section class="dashboard-head"><div class="guild-heading">${renderGuildAvatar(selectedGuild)}<div><p class="eyebrow">Raid dashboard</p><h1>${escapeHtml(selectedGuild.name)}</h1><p>Upcoming Node War rosters and recurring schedules.</p></div></div><a class="button" href="/create?guild=${encodeURIComponent(selectedGuild.id)}">+ Create raid</a></section>
    <section class="stats-row">
      ${renderStat("Active raids", String(activeEvents.length))}
      ${renderStat("Weekly posts", String(weeklyPosts))}
      ${renderStat("Total signups", String(totalSignups))}
      ${renderStat("Next announcement", nextAnnouncement ? `${formatDateLabel(nextAnnouncement.announcementDate as string)} ${formatTimeLabel(nextAnnouncement.announcementTime as string)}` : "None queued")}
    </section>` : ""}
    ${serverPicker}
    ${selectedGuild ? `<section class="event-grid">${cards || "<div class=\"empty-state\"><h2>No raids scheduled</h2><p>Create a roster or use the Discord wizard to get started.</p></div>"}</section>` : !session ? `<section class="empty-state welcome-state"><p class="eyebrow">Self-hosted raid planning</p><h1>Node War rosters without the clutter.</h1><p>Log in with Discord to manage shared servers, schedules, and compositions.</p><div class="button-row">${renderAccountControls()}${renderInviteButton()}</div></section>` : ""}
  </main>`;
}

function renderNav(session?: WebSession, guildId?: string): string {
  return `<aside class="app-nav"><a class="brand" href="/"><span>NW</span><strong>NW Helper</strong></a><nav>${session && guildId ? `<a href="/?guild=${encodeURIComponent(guildId)}"><i>R</i><span>Raids</span></a><a href="/create?guild=${encodeURIComponent(guildId)}"><i>+</i><span>Create raid</span></a>` : `<a href="/"><i>H</i><span>Home</span></a>`}</nav><div class="nav-actions">${renderAccountControls(session, guildId)}</div></aside>`;
}

function renderGuildAvatar(guild: DiscordGuild): string {
  const avatar = guild.icon ? `https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=128` : undefined;
  return avatar
    ? `<img class="server-mark server-avatar" src="${escapeHtml(avatar)}" alt="">`
    : `<span class="server-mark">${escapeHtml(guild.name.slice(0, 1).toUpperCase())}</span>`;
}

function renderStat(label: string, value: string): string {
  return `<article class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function renderInviteButton(label = "Invite to Server"): string {
  const url = botInviteUrl();
  if (!url) {
    return "";
  }

  return `<a class="button button-secondary" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function botInviteUrl(): string | undefined {
  if (!config.discordClientId) {
    return undefined;
  }

  const params = new URLSearchParams({
    client_id: config.discordClientId,
    permissions: "137439366144",
    integration_type: "0",
    scope: "bot applications.commands"
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function renderEventDetail(event: WarEvent, canManage: boolean, session?: WebSession, deliveryOptions?: GuildDeliveryOptions): string {
  const signed = event.signups.filter((signup) => signup.group !== "bench").length;
  const guild = session?.guilds.find((candidate) => candidate.id === event.guildId);

  return `${renderNav(session, event.guildId)}<main class="shell detail-shell">
    <section class="event-summary">
      <div>
        <p class="eyebrow">${event.tier ? `${labelTier(event.tier)} schedule` : event.kind === "siege" ? "Siege schedule" : "Node War schedule"}</p>
        <h1>${escapeHtml(scheduleTitle(event))}</h1>
        <div class="summary-meta"><span>Created ${formatDateLabel(event.createdAt.slice(0, 10))}</span><span>${formatTimeLabel(event.time)} war start</span><span>${labelRecurrence(event.recurrence)}</span></div>
      </div>
      <div class="hero-count">
        <strong>${signed}/${activeRosterCapacity(event)}</strong>
        <span>current roster signed</span>
      </div>
    </section>
    <div class="detail-actions"><a class="button button-secondary" href="/?guild=${encodeURIComponent(event.guildId ?? "")}">Dashboard</a>${canManage ? `<a class="button" href="/events/${event.id}/edit">Edit raid</a>` : ""}</div>
    ${renderDeliverySummary(event, guild, deliveryOptions)}
    ${renderCurrentRosterSummary(event)}
    ${renderUpcomingAnnouncements(event)}
    ${renderDayRail(event)}
    <section class="section-title roster-title"><div><p class="eyebrow">Current roster</p><h2>${escapeHtml(event.title)}</h2></div><span>${formatDateLabel(event.date)} | ${formatTimeLabel(event.time)}</span></section>
    <section class="roster-grid">${renderRosterColumns(event)}</section>
  </main>`;
}

function renderCurrentRosterSummary(event: WarEvent): string {
  const signed = event.signups.filter((signup) => signup.group !== "bench").length;
  const postStatus = event.announcedAt
    ? "Signup post sent"
    : event.announcementDate && event.announcementTime
      ? `Queues ${formatDateLabel(event.announcementDate)} ${formatTimeLabel(event.announcementTime)}`
      : "Not queued";
  return `<section class="current-roster-summary">
    <div><p class="eyebrow">Current live roster</p><h2>${escapeHtml(event.title)}</h2><p>This remains the active signup roster until the one-hour Node War ends.</p></div>
    <dl>
      <div><dt>War date</dt><dd>${formatDateLabel(event.date)}</dd></div>
      <div><dt>War time</dt><dd>${formatTimeLabel(event.time)}</dd></div>
      <div><dt>Signup post</dt><dd>${escapeHtml(postStatus)}</dd></div>
      <div><dt>Signed</dt><dd>${signed}/${activeRosterCapacity(event)}</dd></div>
    </dl>
  </section>`;
}

function renderDeliverySummary(event: WarEvent, guild?: DiscordGuild, options?: GuildDeliveryOptions): string {
  const channelId = event.announcementChannelId ?? event.channelId;
  const channel = options?.channels.find((candidate) => candidate.id === channelId);
  const roleIds = event.announcementRoleIds?.length ? event.announcementRoleIds : event.announcementRoleId ? [event.announcementRoleId] : [];
  const roles = roleIds.map((id) => options?.roles.find((candidate) => candidate.id === id)?.name ?? id);
  return `<section class="delivery-summary">
    <div><p class="eyebrow">Discord delivery</p><h2>Announcement route</h2></div>
    <dl>
      <div><dt>Server</dt><dd>${escapeHtml(guild?.name ?? event.guildId ?? "Not assigned")}</dd></div>
      <div><dt>Channel</dt><dd>${escapeHtml(channel ? `#${channel.name}` : channelId ?? "Not assigned")}</dd></div>
      <div><dt>Ping roles</dt><dd>${roles.length ? roles.map((role) => `@${escapeHtml(role)}`).join(", ") : "No role ping"}</dd></div>
      <div><dt>Post time</dt><dd>${formatTimeLabel(event.announcementTime ?? config.nodeWarPostTime)} ${escapeHtml(config.timezone)}</dd></div>
    </dl>
  </section>`;
}

function renderUpcomingAnnouncements(event: WarEvent): string {
  const upcoming = getUpcomingAnnouncements(event, 5);
  return `<section class="preview-section">
    <div class="section-title"><div><p class="eyebrow">After the current roster</p><h2>Future signup announcement queue</h2></div><span>Next ${upcoming.length} scheduled posts</span></div>
    <div class="preview-rail">${upcoming
      .map(
        (announcement, index) => `<article class="preview-card${index === 0 ? " preview-card-next" : ""}">
          <div class="preview-top"><span>${index === 0 ? "Next post" : labelWarDay(announcement.day)}</span><time data-countdown="${announcementTimestamp(announcement)}">${formatAnnouncementDateTime(announcement)}</time></div>
          <h3>${escapeHtml(announcement.title)}</h3>
          <dl><div><dt>War date</dt><dd>${formatDateLabel(announcement.date)}</dd></div><div><dt>Capacity</dt><dd>${announcement.totalCapacity} players</dd></div><div><dt>Announces</dt><dd>${formatAnnouncementDateTime(announcement)}</dd></div></dl>
        </article>`
      )
      .join("") || "<p class=\"empty\">No upcoming announcement is scheduled.</p>"}</div>
  </section>${renderCountdownScript()}`;
}

function renderDayRail(event: WarEvent): string {
  const days = event.recurrence === "weekly" && event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
  return `<section class="day-section"><div class="section-title"><div><p class="eyebrow">Schedule</p><h2>${event.recurrence === "weekly" ? "Weekly raid days" : "Raid day"}</h2></div><span>Announces ${formatTimeLabel(event.announcementTime ?? config.nodeWarPostTime)}</span></div><div class="day-rail">${days
    .map(
      (day) => `<article class="day-card relative overflow-hidden">
        <span>${labelWarDay(day).slice(0, 3)}</span>
        <strong>${labelWarDay(day)}</strong>
        <small>${event.tier ? NODE_WAR_PRESETS[event.tier].territoryGroup : event.kind}</small>
        <dl><div><dt>Roster</dt><dd>${day === event.day ? `${event.signups.filter((signup) => signup.group !== "bench").length}/${activeRosterCapacity(event)} signed` : "Fresh roster"}</dd></div><div><dt>War</dt><dd>${formatTimeLabel(event.time)}</dd></div><div><dt>Post</dt><dd>${formatTimeLabel(event.announcementTime ?? config.nodeWarPostTime)}</dd></div></dl>
      </article>`
    )
    .join("") || "<p>No raid days selected.</p>"}</div></section>`;
}

function renderRosterColumns(event: WarEvent): string {
  return orderedGroups(event)
    .map((group) => {
      const signups = event.signups.filter((signup) => signup.group === group.key);
      return `<section class="roster-column">
        <header><h2>${renderGroupIcon(group.key, group.emoji)}${escapeHtml(group.label)}</h2><b>${group.key === "bench" ? signups.length : `${signups.length}/${group.capacity}`}</b></header>
        <div class="signup-list">${signups
          .map(
            (signup, index) => `<div class="signup-row"><span class="class-badge">${renderSignupIcon(event, group.key, signup.requestedGroup)}</span><span class="slot">${index + 1}</span><span class="name">${escapeHtml(signup.displayName)}</span></div>`
          )
          .join("") || "<p class=\"empty\">No signups yet</p>"}</div>
      </section>`;
    })
    .join("");
}

function labelRecurrence(recurrence: WarEvent["recurrence"]): string {
  return {
    once: "Once",
    daily: "Every day",
    every_other_day: "Every other day",
    weekly: "Weekly"
  }[recurrence];
}

function orderedGroups(event: WarEvent): WarEvent["groups"] {
  const order = ["mainball", "defense", "zerker", "shai", "bench"];
  return [...event.groups].sort((a, b) => {
    const left = order.indexOf(a.key);
    const right = order.indexOf(b.key);
    return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
  });
}

function renderSignupIcon(event: WarEvent, groupKey: GroupKey, requestedGroup?: GroupKey): string {
  const visibleKey = groupKey === "bench" && requestedGroup ? requestedGroup : groupKey;
  const group = event.groups.find((candidate) => candidate.key === visibleKey);
  return renderGroupIcon(visibleKey, group?.emoji);
}

function renderGroupIcon(groupKey: GroupKey, configuredEmoji?: string): string {
  const url = getGroupEmojiUrl(groupKey, configuredEmoji);
  if (url) {
    return `<img class="role-icon" src="${escapeHtml(url)}" alt="">`;
  }

  return `<span class="role-emoji">${escapeHtml(getGroupEmoji(groupKey, configuredEmoji))}</span>`;
}

function renderCreateRaid(
  guildId: string,
  csrfToken: string,
  session: WebSession,
  deliveryOptions: GuildDeliveryOptions,
  configuredChannelId?: string
): string {
  const templates = [
    { tier: "tier1", name: "T1 Balenos / Serendia", capacity: 30 },
    { tier: "tier2", name: "T2 Calpheon / Ulukita", capacity: 40 },
    { tier: "tier3", name: "T3 Valencia / Edania", capacity: 55 }
  ];
  const groups: GroupConfig[] = [
    { key: "mainball", label: getGroupLabel("mainball"), capacity: 21 },
    { key: "defense", label: getGroupLabel("defense"), capacity: 5 },
    { key: "zerker", label: getGroupLabel("zerker"), capacity: 2 },
    { key: "shai", label: getGroupLabel("shai"), capacity: 2 }
  ];

  return `${renderNav(session, guildId)}<main class="shell create-shell">
    <div class="page-nav"><a href="/?guild=${encodeURIComponent(guildId)}">Back to raids</a></div>
    <section class="builder-head">
      <div>
        <p class="eyebrow">Node War template builder</p>
        <h1>Create Raid</h1>
        <p class="summary">Schedule one Node War roster. The bot publishes it in Discord at the configured announcement time.</p>
      </div>
      <div class="capacity-box"><span>Capacity</span><strong id="capacity-value">30</strong></div>
    </section>
    <form method="post" action="/create" id="allocation-form">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="guildId" value="${escapeHtml(guildId)}">
      <input type="hidden" name="tier" id="tier-value" value="tier1">
      <input type="hidden" name="groups" id="groups-value">
      <section class="schedule-panel">
        <label>Repeat mode<select name="recurrence" id="recurrence-value"><option value="once">One-time event</option><option value="weekly">Repeat weekly</option></select></label>
        <label>Announcement time <input type="time" name="announcementTime" value="${escapeHtml(config.nodeWarPostTime)}" required></label>
        <p>The event starts at ${escapeHtml(config.nodeWarStartTime)} ${escapeHtml(config.timezone)}. One-time raids use one day; weekly schedules can use multiple days.</p>
        <fieldset><legend>Raid days</legend><div class="day-checks">${renderDayChecks([defaultNextWarDay()])}</div></fieldset>
      </section>
      ${renderDeliveryEditor(deliveryOptions, configuredChannelId)}
      <section class="template-grid" aria-label="Node War templates">
        ${templates.map((template, index) => `<button class="template-button${index === 0 ? " active" : ""}" type="button" data-capacity="${template.capacity}" data-tier="${template.tier}">
          <span>${escapeHtml(template.name)}</span><b>Preset capacity by weekday</b>
        </button>`).join("")}
      </section>
      ${renderAllocationEditor(groups)}
      <div class="editor-actions"><button type="submit">Schedule Raid</button></div>
    </form>
  </main>${renderRecurrenceDayScript()}${renderAllocationScript(true)}`;
}

function renderDeliveryEditor(options: GuildDeliveryOptions, configuredChannelId?: string): string {
  return `<section class="delivery-editor">
    <header><div><p class="eyebrow">Discord delivery</p><h2>Announcement destination</h2></div><p>Choose where the roster posts and which roles receive the signup ping.</p></header>
    <label>Roster channel
      <select name="announcementChannelId" required>
        <option value="">Select a Discord channel</option>
        ${options.channels
          .map((channel) => `<option value="${escapeHtml(channel.id)}"${channel.id === configuredChannelId ? " selected" : ""}># ${escapeHtml(channel.name)}</option>`)
          .join("")}
      </select>
    </label>
    <fieldset>
      <legend>Ping roles <span>Optional, select any number</span></legend>
      <div class="ping-role-grid">${
        options.roles
          .map(
            (role) =>
              `<label><input type="checkbox" name="announcementRoleIds" value="${escapeHtml(role.id)}"${role.id === config.nodeWarRoleId ? " checked" : ""}><span>@${escapeHtml(role.name)}</span></label>`
          )
          .join("") || "<p class=\"empty\">No selectable server roles found.</p>"
      }</div>
    </fieldset>
  </section>`;
}

function renderEditRaid(event: WarEvent, csrfToken: string, session: WebSession): string {
  const repeatDays = event.recurrence === "weekly" && event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
  return `${renderNav(session, event.guildId)}<main class="shell create-shell">
    <nav class="page-nav"><a href="/events/${event.id}">Back to roster</a><a href="/?guild=${encodeURIComponent(event.guildId ?? "")}">Server raids</a></nav>
    <section class="builder-head">
      <div><p class="eyebrow">Raid settings</p><h1>Edit raid</h1><p class="summary">${escapeHtml(event.title)}</p></div>
      <div class="capacity-box"><span>Capacity</span><strong id="capacity-value">${event.totalCapacity}</strong></div>
    </section>
    <form method="post" action="/events/${event.id}/composition" id="allocation-form">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="groups" id="groups-value">
      <section class="schedule-editor">
        <div><p class="eyebrow">Schedule</p><h2>Announcement timing</h2></div>
        <label>Repeat mode<select name="recurrence" id="recurrence-value"><option value="once"${event.recurrence !== "weekly" ? " selected" : ""}>One-time event</option><option value="weekly"${event.recurrence === "weekly" ? " selected" : ""}>Repeat weekly</option></select></label>
        <label>Announcement time<input name="announcementTime" type="time" value="${escapeHtml(event.announcementTime ?? config.nodeWarPostTime)}" required></label>
        <fieldset><legend>Raid days</legend><div class="day-checks">${renderDayChecks(repeatDays)}</div></fieldset>
      </section>
      ${renderAllocationEditor(event.groups.filter((group) => group.key !== "bench"))}
      <div class="editor-actions"><button type="submit">Save raid settings</button></div>
    </form>
  </main>${renderRecurrenceDayScript()}${renderAllocationScript(false)}`;
}

function renderDayChecks(selectedDays: WarDay[]): string {
  return WEB_WAR_DAYS.map((day) => `<label><input type="checkbox" name="repeatDays" value="${day}"${selectedDays.includes(day) ? " checked" : ""}><span>${labelWarDay(day).slice(0, 3)}</span></label>`).join("");
}

function renderRecurrenceDayScript(): string {
  return `<script>
    (() => {
      const recurrence = document.querySelector("#recurrence-value");
      const checks = [...document.querySelectorAll('.day-checks input[name="repeatDays"]')];
      const enforce = (changed) => {
        if (recurrence.value !== "once") return;
        if (changed?.checked) checks.forEach((check) => { if (check !== changed) check.checked = false; });
        if (!checks.some((check) => check.checked)) (changed || checks[0]).checked = true;
      };
      checks.forEach((check) => check.addEventListener("change", () => enforce(check)));
      recurrence.addEventListener("change", () => enforce());
      enforce();
    })();
  </script>`;
}

function renderAllocationEditor(groups: GroupConfig[]): string {
  return `<section class="slot-editor">
    <header>
      <div><p class="eyebrow">Composition</p><h2>Linked slot allocation</h2></div>
      <button type="button" id="add-role">Add custom role</button>
    </header>
    <div id="role-table" class="role-table">${groups.map((group) => renderSliderRow(group)).join("")}</div>
    <p class="editor-note">Increasing a specialist role reduces Mainball / FFA automatically.</p>
  </section>`;
}

function renderSliderRow(group: GroupConfig): string {
  const custom = !["mainball", "defense", "zerker", "shai"].includes(group.key);
  return `<div class="role-row${custom ? " custom-role" : ""}" data-key="${escapeHtml(group.key)}" data-label="${escapeHtml(group.label)}" data-emoji="${escapeHtml(group.emoji ?? "")}">
    <div class="role-name">${renderGroupIcon(group.key, group.emoji)}${
      custom
        ? `<input class="role-label-input" aria-label="Custom role name" value="${escapeHtml(group.label)}" placeholder="Role name"><input class="role-emoji-input" aria-label="Emote for role" value="${escapeHtml(group.emoji ?? "")}" placeholder=":mage: or &lt;:mage:id&gt;"><button class="remove-role" type="button" aria-label="Remove custom role">Remove</button>`
        : `<strong>${escapeHtml(group.label)}</strong>`
    }</div>
    <input aria-label="${escapeHtml(group.label)} slots" type="range" min="0" max="100" value="${group.capacity}"${group.key === "mainball" ? " disabled" : ""}>
    <output>${group.capacity}</output>
  </div>`;
}

function renderAllocationScript(useTemplates: boolean): string {
  return `<script>
    (() => {
      const form = document.querySelector("#allocation-form");
      const table = document.querySelector("#role-table");
      const capacityLabel = document.querySelector("#capacity-value");
      const groupsValue = document.querySelector("#groups-value");
      const tierInput = document.querySelector("#tier-value");
      const presets = ${JSON.stringify(Object.fromEntries(Object.entries(NODE_WAR_PRESETS).map(([tier, preset]) => [tier, preset.maxParticipantsByDay])))};
      const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      let capacity = Number(capacityLabel.textContent);
      const rows = () => [...table.querySelectorAll(".role-row")];
      const specialists = () => rows().filter((row) => row.dataset.key !== "mainball");
      const serialize = () => {
        groupsValue.value = JSON.stringify(rows().map((row) => ({
          key: row.dataset.key,
          label: row.querySelector(".role-label-input")?.value || row.dataset.label,
          emoji: row.querySelector(".role-emoji-input")?.value || row.dataset.emoji || undefined,
          capacity: Number(row.querySelector('input[type="range"]').value)
        })));
      };
      const rebalance = () => {
        const main = table.querySelector('[data-key="mainball"]');
        const mainSlider = main.querySelector('input[type="range"]');
        specialists().forEach((row) => row.querySelector('input[type="range"]').max = String(capacity));
        const used = specialists().reduce((sum, row) => sum + Number(row.querySelector('input[type="range"]').value), 0);
        mainSlider.max = String(capacity);
        mainSlider.value = String(Math.max(0, capacity - used));
        main.querySelector("output").value = mainSlider.value;
        capacityLabel.textContent = String(capacity);
        serialize();
      };
      const bind = (row) => {
        const slider = row.querySelector('input[type="range"]');
        slider.addEventListener("input", () => {
          const others = specialists().filter((candidate) => candidate !== row)
            .reduce((sum, candidate) => sum + Number(candidate.querySelector('input[type="range"]').value), 0);
          slider.value = String(Math.min(Number(slider.value), Math.max(0, capacity - others)));
          row.querySelector("output").value = slider.value;
          rebalance();
        });
        row.querySelectorAll("input[type=text], .role-label-input, .role-emoji-input").forEach((input) => input.addEventListener("input", serialize));
        row.querySelector(".remove-role")?.addEventListener("click", () => { row.remove(); rebalance(); });
      };
      rows().forEach(bind);
      document.querySelector("#add-role").addEventListener("click", () => {
        const key = "custom-" + Date.now().toString(36);
        const row = document.createElement("div");
        row.className = "role-row custom-role";
        row.dataset.key = key;
        row.dataset.label = "Custom role";
        row.innerHTML = '<div class="role-name"><span class="role-emoji">+</span><input class="role-label-input" aria-label="Custom role name" placeholder="Role name"><input class="role-emoji-input" aria-label="Emote for role" placeholder=":mage: or &lt;:mage:id&gt;"><button class="remove-role" type="button" aria-label="Remove custom role">Remove</button></div><input aria-label="Custom role slots" type="range" min="0" max="' + capacity + '" value="0"><output>0</output>';
        table.append(row);
        bind(row);
        serialize();
      });
      ${useTemplates ? `const syncTemplateCapacity = () => {
        const day = document.querySelector('.day-checks input[name="repeatDays"]:checked')?.value;
        if (!day || !tierInput?.value) return;
        capacity = Number(presets[tierInput.value][day]);
        rebalance();
      };
      document.querySelectorAll(".template-button").forEach((button) => button.addEventListener("click", () => {
        document.querySelectorAll(".template-button").forEach((candidate) => candidate.classList.remove("active"));
        button.classList.add("active");
        tierInput.value = button.dataset.tier;
        syncTemplateCapacity();
      }));
      document.querySelectorAll('.day-checks input[name="repeatDays"]').forEach((input) => input.addEventListener("change", syncTemplateCapacity));
      syncTemplateCapacity();` : ""}
      form.addEventListener("submit", serialize);
      rebalance();
    })();
  </script>`;
}

function parseGroupAllocation(raw: unknown, totalCapacity: number): GroupConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? ""));
  } catch {
    throw new Error("Role allocation is invalid.");
  }
  if (!Array.isArray(parsed) || parsed.length > 12) {
    throw new Error("Role allocation must contain at most 12 roles.");
  }

  const coreLabels: Record<string, string> = {
    defense: getGroupLabel("defense"),
    zerker: getGroupLabel("zerker"),
    shai: getGroupLabel("shai")
  };
  const groups: GroupConfig[] = [];
  const keys = new Set<string>();
  for (const value of parsed) {
    if (!value || typeof value !== "object") {
      throw new Error("Role allocation contains an invalid role.");
    }
    const candidate = value as Record<string, unknown>;
    const key = String(candidate.key ?? "").trim().toLowerCase();
    if (key === "mainball" || key === "bench") {
      continue;
    }
    if (!/^[a-z0-9-]{1,32}$/.test(key) || keys.has(key)) {
      throw new Error("Custom role keys must be unique letters, numbers, or dashes.");
    }
    const capacity = Number(candidate.capacity);
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > totalCapacity) {
      throw new Error("Role capacity is outside the allowed roster size.");
    }
    const label = (coreLabels[key] ?? String(candidate.label ?? "")).trim();
    if (!label || label.length > 32) {
      throw new Error("Role labels must be between 1 and 32 characters.");
    }
    const emoji = String(candidate.emoji ?? "").trim();
    if (emoji && !validRoleEmoji(emoji)) {
      throw new Error("Role emoji must be a Discord custom emoji value or a short Unicode emoji.");
    }
    keys.add(key);
    groups.push({ key, label, capacity, editable: true, ...(emoji ? { emoji } : {}) });
  }

  for (const key of ["defense", "zerker", "shai"]) {
    if (!keys.has(key)) {
      groups.push({ key, label: coreLabels[key], capacity: 0, editable: true });
    }
  }
  const specialistTotal = groups.reduce((sum, group) => sum + group.capacity, 0);
  if (specialistTotal > totalCapacity) {
    throw new Error("Specialist slots cannot exceed the total roster capacity.");
  }
  return [
    { key: "mainball", label: getGroupLabel("mainball"), capacity: totalCapacity - specialistTotal, editable: true },
    ...groups,
    { key: "bench", label: getGroupLabel("bench"), capacity: 0, editable: false }
  ];
}

function validRoleEmoji(emoji: string): boolean {
  if (/^<a?:[A-Za-z0-9_]{2,32}:\d{5,25}>$/.test(emoji)) {
    return true;
  }
  return !emoji.includes("@") && !emoji.includes("<") && !emoji.includes(">") && !/[\r\n]/.test(emoji) && [...emoji].length <= 12;
}

function parseTier(value: unknown): NodeWarTier {
  if (value === "tier1" || value === "tier2" || value === "tier3") {
    return value;
  }
  throw new Error("Select a valid Node War template.");
}

function parseClockTime(value: unknown): string {
  const time = String(value ?? "").trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Announcement time must use HH:mm format.");
  }
  return time;
}

function parseAnnouncementChannelId(value: unknown, channels: DiscordGuildChannel[]): string {
  const channelId = String(value ?? "").trim();
  if (!channelId || !channels.some((channel) => channel.id === channelId)) {
    throw new Error("Select a valid Discord roster channel.");
  }
  return channelId;
}

function parseAnnouncementRoleIds(value: unknown, roles: DiscordGuildRole[]): string[] {
  const requested = Array.isArray(value) ? value : value ? [value] : [];
  const allowed = new Set(roles.map((role) => role.id));
  const roleIds = [...new Set(requested.map((roleId) => String(roleId).trim()).filter(Boolean))];
  if (roleIds.some((roleId) => !allowed.has(roleId))) {
    throw new Error("One or more selected Discord ping roles are invalid.");
  }
  return roleIds;
}

function parseRepeatDays(value: unknown, fallback?: WarDay): WarDay[] {
  const requested = Array.isArray(value) ? value : value ? [value] : fallback ? [fallback] : [];
  const days = WEB_WAR_DAYS.filter((day) => requested.includes(day));
  if (!days.length) {
    throw new Error("Select at least one raid day.");
  }
  return days;
}

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatTimeLabel(time: string): string {
  const [hourValue, minuteValue = "00"] = time.split(":");
  const hour = Number.parseInt(hourValue, 10);
  if (!Number.isInteger(hour)) {
    return time;
  }
  return `${hour % 12 || 12}:${minuteValue.padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function scheduleTitle(event: WarEvent): string {
  if (!event.tier) {
    return `${event.kind === "siege" ? "Siege" : "Node War"} [${event.id}]`;
  }
  const tier = event.tier === "tier1" ? "T1" : event.tier === "tier2" ? "T2" : "T3";
  return `${tier} ${NODE_WAR_PRESETS[event.tier].territoryGroup} War [${event.id}]`;
}

function formatAnnouncementLabel(event: WarEvent): string {
  const next = getUpcomingAnnouncements(event, 1)[0];
  if (next) {
    return formatAnnouncementDateTime(next);
  }
  return event.announcedAt ? "Already posted" : "Not queued";
}

function getUpcomingAnnouncements(event: WarEvent, limit: number): UpcomingAnnouncement[] {
  const announcementTime = event.announcementTime ?? config.nodeWarPostTime;
  if (event.recurrence !== "weekly") {
    const announcement = {
      date: event.date,
      announcementDate: event.announcementDate ?? previousDate(event.date),
      announcementTime,
      day: event.day ?? warDayForDate(event.date),
      title: event.title,
      totalCapacity: event.totalCapacity
    };
    return !event.announcedAt && announcementTimestamp(announcement) > Date.now() ? [announcement] : [];
  }

  const days = event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
  const start = new Date(`${currentDateInTimezone()}T12:00:00Z`);
  const announcements: UpcomingAnnouncement[] = [];
  for (let offset = 0; announcements.length < limit && offset < 28; offset += 1) {
    const warDate = new Date(start);
    warDate.setUTCDate(start.getUTCDate() + offset);
    const date = warDate.toISOString().slice(0, 10);
    const day = warDayForDate(date);
    if (!days.includes(day)) {
      continue;
    }
    const totalCapacity = event.tier ? getNodeWarCapacity(event.tier, day) : event.totalCapacity;
    const announcement: UpcomingAnnouncement = {
      date,
      announcementDate: previousDate(date),
      announcementTime,
      day,
      title: event.tier ? buildNodeWarTitle(day, event.tier, totalCapacity) : event.title,
      totalCapacity
    };
    if (announcementTimestamp(announcement) > Date.now()) {
      announcements.push(announcement);
    }
  }
  return announcements;
}

function formatAnnouncementDateTime(announcement: Pick<UpcomingAnnouncement, "announcementDate" | "announcementTime">): string {
  return `${formatDateLabel(announcement.announcementDate)} ${formatTimeLabel(announcement.announcementTime)}`;
}

function announcementTimestamp(announcement: Pick<UpcomingAnnouncement, "announcementDate" | "announcementTime">): number {
  return new Date(`${announcement.announcementDate}T${announcement.announcementTime}:00+08:00`).getTime();
}

function currentDateInTimezone(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderCountdownScript(): string {
  return `<script>
    (() => {
      const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
      const update = () => document.querySelectorAll("[data-countdown]").forEach((node) => {
        const remaining = Number(node.dataset.countdown) - Date.now();
        const units = Math.abs(remaining) >= 86400000 ? ["day", 86400000] : Math.abs(remaining) >= 3600000 ? ["hour", 3600000] : ["minute", 60000];
        node.textContent = formatter.format(Math.round(remaining / units[1]), units[0]);
      });
      update();
      window.setInterval(update, 60000);
    })();
  </script>`;
}

function previousDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function defaultNextWarDay(): WarDay {
  return warDayForDate(nextDateForDay());
}

function nextDateForDay(day?: WarDay): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const value = new Date(`${values.year}-${values.month}-${values.day}T12:00:00Z`);
  const currentDay = value.getUTCDay();
  const targetDay = day ? WEB_WAR_DAYS.indexOf(day) : (currentDay + 1) % 7;
  const delta = (targetDay - currentDay + 7) % 7;
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}

function warDayForDate(date: string): WarDay {
  return WEB_WAR_DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function renderWebError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The request could not be completed.";
  return `${renderNav()}<main class="shell narrow-shell"><section class="empty-state"><p class="eyebrow">Request failed</p><h1>Could not save raid</h1><p>${escapeHtml(message)}</p><a class="button button-secondary" href="/">Return to dashboard</a></section></main>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
