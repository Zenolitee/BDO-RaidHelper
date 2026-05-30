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
}

interface WebSession {
  user: UserProfile;
  guilds: DiscordGuild[];
  csrfToken: string;
  expiresAt: number;
}

export function createWebApp(store: EventStore) {
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
      const sessionId = randomBytes(32).toString("hex");
      sessions.set(sessionId, {
        user,
        guilds: guilds.filter((guild) => hasAdministratorPermission(guild.permissions)),
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

  app.get("/create", (request, response) => {
    const session = getSession(request, sessions);
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    if (!session || !guildId || !session.guilds.some((guild) => guild.id === guildId)) {
      response.status(403).type("html").send(renderPage("Create Raid", renderLoginRequired()));
      return;
    }
    response.type("html").send(renderPage("Create Raid", renderCreateRaid(guildId, session.csrfToken)));
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
      const date = parseDate(request.body.date);
      const day = warDayForDate(date);
      const totalCapacity = getNodeWarCapacity(tier, day);
      const groups = parseGroupAllocation(request.body.groups, totalCapacity);
      const settings = await store.getSettings();
      const event: WarEvent = {
        id: nanoid(10),
        title: buildNodeWarTitle(day, tier, totalCapacity),
        kind: "nodewar",
        tier,
        day,
        repeatDays: [day],
        date,
        time: config.nodeWarStartTime,
        timezone: config.timezone,
        recurrence: "once",
        totalCapacity,
        groups,
        announcementDate: previousDate(date),
        announcementTime: config.nodeWarPostTime,
        announcementChannelId: settings.nodeWarChannelIds?.[guildId] ?? config.nodeWarChannelId,
        announcementRoleId: config.nodeWarRoleId,
        announcementRoleIds: config.nodeWarRoleId ? [config.nodeWarRoleId] : [],
        guildId,
        createdBy: `web:${session.user.id}`,
        createdAt: new Date().toISOString(),
        signups: [],
        closed: false
      };
      await store.createEvent(event);
      response.redirect(`/events/${event.id}/edit?created=1`);
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
    response.type("html").send(renderPage(event.title, renderEventDetail(event, canManage)));
  });

  app.get("/events/:id/edit", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = getSession(request, sessions);
    if (!event || !session || !canManageEvent(event, session)) {
      response.status(404).type("html").send(renderPage("Not found", "<main><h1>Event not found</h1></main>"));
      return;
    }
    response.type("html").send(renderPage(`Edit ${event.title}`, renderEditRaid(event, session.csrfToken)));
  });

  app.post("/events/:id/composition", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = getSession(request, sessions);
    if (!event || !session || !canManageEvent(event, session) || !validCsrf(request, session)) {
      response.status(403).send("Not authorized.");
      return;
    }
    try {
      const groups = parseGroupAllocation(request.body.groups, event.totalCapacity);
      await store.updateEventDetails(event.id, { groups });
      response.redirect(`/events/${event.id}/edit?saved=1`);
    } catch (error) {
      response.status(400).type("html").send(renderPage("Composition update failed", renderWebError(error)));
    }
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

function renderAccountControls(session?: WebSession, selectedGuildId?: string): string {
  if (!session) {
    return `<a class="invite-button secondary-button" href="/auth/discord">Log in with Discord</a>`;
  }

  const guildLinks = session.guilds
    .map(
      (guild) =>
        `<a class="${guild.id === selectedGuildId ? "server-link active" : "server-link"}" href="/?guild=${encodeURIComponent(guild.id)}">${escapeHtml(guild.name)}</a>`
    )
    .join("");
  return `<div class="account-panel">
    <span>${escapeHtml(session.user.global_name ?? session.user.username)}</span>
    <div class="server-links">${guildLinks || "<small>No administrator servers found.</small>"}</div>
    <a href="/logout">Log out</a>
  </div>`;
}

function renderLoginRequired(): string {
  return `<main class="shell"><section class="builder-head"><div><p class="eyebrow">Private dashboard</p><h1>Discord login required</h1><p class="summary">Log in and select a server where you have administrator permission.</p><p><a class="invite-button" href="/auth/discord">Log in with Discord</a></p></div></section></main>`;
}

function renderLoginError(): string {
  return `<main class="shell"><section class="builder-head"><div><p class="eyebrow">Private dashboard</p><h1>Discord login failed</h1><p class="summary">The OAuth request could not be completed. Check the configured redirect URI and try again.</p><p><a class="invite-button" href="/auth/discord">Try Discord login again</a></p></div></section></main>`;
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
<body>
  ${body}
</body>
</html>`;
}

function renderEventList(events: WarEvent[], session?: WebSession, guildId?: string): string {
  const selectedGuild = session?.guilds.find((guild) => guild.id === guildId);
  const cards = events
    .map((event) => {
      const signed = event.signups.filter((signup) => signup.group !== "bench").length;
      const capacity = activeRosterCapacity(event);
      return `<article class="event-card">
        <span class="type-pill">${event.tier ? labelTier(event.tier) : event.kind === "siege" ? "Siege" : "Node War"}</span>
        <a class="event-title" href="/events/${event.id}"><strong>${escapeHtml(event.title)}</strong></a>
        <small>${event.date} ${escapeHtml(event.time)}</small>
        <span class="card-meter"><i style="width:${capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0}%"></i></span>
        <div class="card-footer"><b>${signed}/${capacity} signed</b><a href="/events/${event.id}/edit">Edit slots</a></div>
      </article>`;
    })
    .join("");
  const serverPicker =
    session && !selectedGuild
      ? `<section class="server-picker"><header><p class="eyebrow">Manage server</p><h2>Select a Discord server</h2></header><div class="server-grid">${session.guilds
          .map(
            (guild) =>
              `<a class="server-card" href="/?guild=${encodeURIComponent(guild.id)}"><strong>${escapeHtml(guild.name)}</strong><span>Open roster manager</span></a>`
          )
          .join("") || "<p>No servers found where your Discord account has Administrator permission.</p>"}</div></section>`
      : "";

  return `<main class="shell">
    <section class="topbar">
      <div>
        <p class="eyebrow">Black Desert Online</p>
        <h1>War room roster</h1>
      </div>
      <div class="top-actions">
        <p class="summary">A compact operations board for Node War signups, role allocation, and repeat-day planning.</p>
        ${session && selectedGuild ? `<a class="invite-button secondary-button" href="/create?guild=${encodeURIComponent(selectedGuild.id)}">Create Raid</a>` : ""}
        ${renderInviteButton()}
        ${renderAccountControls(session, guildId)}
      </div>
    </section>
    ${selectedGuild ? `<section class="section-heading"><div><p class="eyebrow">Selected server</p><h2>${escapeHtml(selectedGuild.name)}</h2></div><a href="/">Change server</a></section>` : ""}
    ${serverPicker}
    ${selectedGuild ? `<section class="event-grid">${cards || "<p>No events are stored for this server yet.</p>"}</section>` : !session ? "<section class=\"empty-state\"><p>Log in with Discord to manage servers and roster allocations.</p></section>" : ""}
  </main>`;
}

function renderInviteButton(): string {
  const url = botInviteUrl();
  if (!url) {
    return "";
  }

  return `<a class="invite-button" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Invite to Server</a>`;
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

function renderEventDetail(event: WarEvent, canManage: boolean): string {
  const columns = orderedGroups(event)
    .map((group) => {
      const signups = event.signups.filter((signup) => signup.group === group.key);
      return `<section class="roster-column">
        <header>
          <h2>${renderGroupIcon(group.key, group.emoji)}${escapeHtml(group.label)}</h2>
          <b>${group.key === "bench" ? signups.length : `${signups.length}/${group.capacity}`}</b>
        </header>
        <div class="signup-list">
          ${signups
            .map(
              (signup, index) => `<div class="signup-row">
                  <span class="class-badge">${renderSignupIcon(event, group.key, signup.requestedGroup)}</span>
                  <span class="slot">${index + 1}</span>
                  <span class="name">${escapeHtml(signup.displayName)}</span>
                </div>`
            )
            .join("") || "<p class=\"empty\">No signups yet</p>"}
        </div>
      </section>`;
    })
    .join("");

  const signed = event.signups.filter((signup) => signup.group !== "bench").length;

  return `<main class="shell detail-shell">
    <nav class="page-nav"><a href="/">Dashboard</a>${canManage ? `<a class="invite-button secondary-button" href="/events/${event.id}/edit">Edit composition</a>` : ""}</nav>
    <section class="event-hero">
      <div>
        <p class="eyebrow">${event.tier ? `${labelTier(event.tier)} / ${NODE_WAR_PRESETS[event.tier].territoryGroup}` : event.kind === "siege" ? "Siege" : "Node War"} / ${labelWarDay(event.day)} / ${labelRecurrence(event.recurrence)}</p>
        <h1>${escapeHtml(event.title)}</h1>
        <p>${event.date} ${escapeHtml(event.time)} ${escapeHtml(event.timezone)}</p>
      </div>
      <div class="hero-count">
        <strong>${signed}/${activeRosterCapacity(event)}</strong>
        <span>signed</span>
      </div>
    </section>
    <section class="capacity-strip">
      ${orderedGroups(event)
        .map((group) => {
          const count = event.signups.filter((signup) => signup.group === group.key).length;
          return `<span><b>${renderGroupIcon(group.key, group.emoji)}${escapeHtml(group.label)}</b> ${group.key === "bench" ? count : `${count}/${group.capacity}`}</span>`;
        })
        .join("")}
    </section>
    <section class="roster-grid">${columns}</section>
  </main>`;
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

function renderCreateRaid(guildId: string, csrfToken: string): string {
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

  return `<main class="shell create-shell">
    <nav><a href="/?guild=${encodeURIComponent(guildId)}">All events</a></nav>
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
        <label>Node War date <input type="date" name="date" id="event-date" value="${defaultNextDate()}" required></label>
        <p>The event starts at ${escapeHtml(config.nodeWarStartTime)} ${escapeHtml(config.timezone)}. Its announcement is scheduled for the prior day at ${escapeHtml(config.nodeWarPostTime)}.</p>
      </section>
      <section class="template-grid" aria-label="Node War templates">
        ${templates.map((template, index) => `<button class="template-button${index === 0 ? " active" : ""}" type="button" data-capacity="${template.capacity}" data-tier="${template.tier}">
          <span>${escapeHtml(template.name)}</span><b>Preset capacity by weekday</b>
        </button>`).join("")}
      </section>
      ${renderAllocationEditor(groups)}
      <div class="editor-actions"><button type="submit">Schedule Raid</button></div>
    </form>
  </main>${renderAllocationScript(true)}`;
}

function renderEditRaid(event: WarEvent, csrfToken: string): string {
  return `<main class="shell create-shell">
    <nav class="page-nav"><a href="/events/${event.id}">Roster</a><a href="/?guild=${encodeURIComponent(event.guildId ?? "")}">Server events</a></nav>
    <section class="builder-head">
      <div><p class="eyebrow">Server roster manager</p><h1>Edit composition</h1><p class="summary">${escapeHtml(event.title)}</p></div>
      <div class="capacity-box"><span>Capacity</span><strong id="capacity-value">${event.totalCapacity}</strong></div>
    </section>
    <form method="post" action="/events/${event.id}/composition" id="allocation-form">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="groups" id="groups-value">
      ${renderAllocationEditor(event.groups.filter((group) => group.key !== "bench"))}
      <div class="editor-actions"><button type="submit">Save composition</button></div>
    </form>
  </main>${renderAllocationScript(false)}`;
}

function renderAllocationEditor(groups: GroupConfig[]): string {
  return `<section class="slot-editor">
    <header>
      <div><p class="eyebrow">Composition</p><h2>Linked slot allocation</h2></div>
      <button type="button" id="add-role">Add custom role</button>
    </header>
    <div id="role-table" class="role-table">${groups.map((group) => renderSliderRow(group)).join("")}</div>
    <p class="editor-note">Increasing a specialist role reduces Mainball / FFA. Custom roles accept a raw Discord emoji value such as <code>&lt;:name:123456789&gt;</code>.</p>
  </section>`;
}

function renderSliderRow(group: GroupConfig): string {
  const custom = !["mainball", "defense", "zerker", "shai"].includes(group.key);
  return `<div class="role-row${custom ? " custom-role" : ""}" data-key="${escapeHtml(group.key)}" data-label="${escapeHtml(group.label)}" data-emoji="${escapeHtml(group.emoji ?? "")}">
    <div class="role-name">${renderGroupIcon(group.key, group.emoji)}${
      custom
        ? `<input class="role-label-input" aria-label="Custom role name" value="${escapeHtml(group.label)}"><input class="role-emoji-input" aria-label="Custom Discord emoji" value="${escapeHtml(group.emoji ?? "")}" placeholder="&lt;:name:id&gt;"><button class="remove-role" type="button" aria-label="Remove custom role">Remove</button>`
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
      const dateInput = document.querySelector("#event-date");
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
        row.innerHTML = '<div class="role-name"><span class="role-emoji">+</span><input class="role-label-input" aria-label="Custom role name" value="Custom role"><input class="role-emoji-input" aria-label="Custom Discord emoji" placeholder="&lt;:name:id&gt;"><button class="remove-role" type="button" aria-label="Remove custom role">Remove</button></div><input aria-label="Custom role slots" type="range" min="0" max="' + capacity + '" value="0"><output>0</output>';
        table.append(row);
        bind(row);
        serialize();
      });
      ${useTemplates ? `const syncTemplateCapacity = () => {
        if (!dateInput?.value || !tierInput?.value) return;
        const day = days[new Date(dateInput.value + "T12:00:00Z").getUTCDay()];
        capacity = Number(presets[tierInput.value][day]);
        rebalance();
      };
      document.querySelectorAll(".template-button").forEach((button) => button.addEventListener("click", () => {
        document.querySelectorAll(".template-button").forEach((candidate) => candidate.classList.remove("active"));
        button.classList.add("active");
        tierInput.value = button.dataset.tier;
        syncTemplateCapacity();
      }));
      dateInput.addEventListener("change", syncTemplateCapacity);
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

function parseDate(value: unknown): string {
  const date = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) {
    throw new Error("Select a valid Node War date.");
  }
  return date;
}

function warDayForDate(date: string): WarDay {
  const days: WarDay[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function previousDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function defaultNextDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const value = new Date(`${values.year}-${values.month}-${values.day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function renderWebError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The request could not be completed.";
  return `<main class="shell"><section class="builder-head"><div><p class="eyebrow">Request failed</p><h1>Could not save raid</h1><p class="summary">${escapeHtml(message)}</p><p><a class="invite-button secondary-button" href="/">Return to dashboard</a></p></div></section></main>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
