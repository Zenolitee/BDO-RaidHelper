import express from "express";
import { randomBytes } from "node:crypto";
import type { Request } from "express";
import { config } from "./config.js";
import { formatGroupName, getGroupEmoji, getGroupEmojiUrl, getGroupLabel } from "./emojis.js";
import { labelTier, labelWarDay, NODE_WAR_PRESETS } from "./nodewar-presets.js";
import { activeRosterCapacity, type EventStore } from "./store.js";
import { type GroupKey, type WarEvent } from "./types.js";

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

    const token = await exchangeDiscordCode(code);
    const [user, guilds] = await Promise.all([
      fetchDiscord<UserProfile>("/users/@me", token),
      fetchDiscord<DiscordGuild[]>("/users/@me/guilds", token)
    ]);
    const sessionId = randomBytes(32).toString("hex");
    sessions.set(sessionId, {
      user,
      guilds: guilds.filter((guild) => hasAdministratorPermission(guild.permissions)),
      expiresAt: Date.now() + 24 * 60 * 60_000
    });
    response.setHeader("Set-Cookie", sessionCookie(sessionId));
    response.redirect("/");
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
    response.type("html").send(renderPage("Create Raid", renderCreateRaid(guildId)));
  });

  app.get("/events/:id", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = getSession(request, sessions);
    if (!event || !event.guildId || !session?.guilds.some((guild) => guild.id === event.guildId)) {
      response.status(404).type("html").send(renderPage("Not found", "<main><h1>Event not found</h1></main>"));
      return;
    }

    response.type("html").send(renderPage(event.title, renderEventDetail(event)));
  });

  app.post("/events/:id/signup", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = getSession(request, sessions);
    if (!event || !event.guildId || !session?.guilds.some((guild) => guild.id === event.guildId)) {
      response.status(404).send("Event not found.");
      return;
    }

    const group = request.body.group as GroupKey;
    if (!event.groups.some((candidate) => candidate.key === group && candidate.key !== "bench")) {
      response.status(400).send("Unknown group.");
      return;
    }

    const userId = String(request.body.userId ?? "").trim();
    const displayName = String(request.body.displayName ?? "").trim();
    if (!userId || !displayName) {
      response.status(400).send("Discord ID and display name are required.");
      return;
    }

    try {
      await store.signup(request.params.id, { userId, displayName, group });
      response.redirect(`/events/${request.params.id}`);
    } catch (error) {
      response.status(400).send(error instanceof Error ? error.message : "Signup failed.");
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
  const cards = events
    .map((event) => {
      const signed = event.signups.filter((signup) => signup.group !== "bench").length;
      const capacity = activeRosterCapacity(event);
      return `<a class="event-card" href="/events/${event.id}">
        <span class="type-pill">${event.tier ? labelTier(event.tier) : event.kind === "siege" ? "Siege" : "Node War"}</span>
        <strong>${escapeHtml(event.title)}</strong>
        <small>${event.date} ${escapeHtml(event.time)}</small>
        <span class="card-meter"><i style="width:${capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0}%"></i></span>
        <b>${signed}/${capacity} signed</b>
      </a>`;
    })
    .join("");

  return `<main class="shell">
    <section class="topbar">
      <div>
        <p class="eyebrow">Black Desert Online</p>
        <h1>War room roster</h1>
      </div>
      <div class="top-actions">
        <p class="summary">A compact operations board for Node War signups, role allocation, and repeat-day planning.</p>
        ${session && guildId ? `<a class="invite-button secondary-button" href="/create?guild=${encodeURIComponent(guildId)}">Create Raid</a>` : ""}
        ${renderInviteButton()}
        ${renderAccountControls(session, guildId)}
      </div>
    </section>
    <section class="event-grid">${cards || "<p>Server event lists are private. Use Discord commands until account login is configured.</p>"}</section>
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

function renderEventDetail(event: WarEvent): string {
  const columns = orderedGroups(event)
    .map((group) => {
      const signups = event.signups.filter((signup) => signup.group === group.key);
      return `<section class="roster-column">
        <header>
          <h2>${renderGroupIcon(group.key)}${escapeHtml(getGroupLabel(group.key))}</h2>
          <b>${group.key === "bench" ? signups.length : `${signups.length}/${group.capacity}`}</b>
        </header>
        <div class="signup-list">
          ${signups
            .map(
              (signup, index) => `<div class="signup-row">
                  <span class="slot">${index + 1}</span>
                  <span class="class-badge">${renderGroupIcon(group.key === "bench" && signup.requestedGroup ? signup.requestedGroup : signup.group)}</span>
                  <span class="name">${escapeHtml(signup.displayName)}</span>
                </div>`
            )
            .join("") || "<p class=\"empty\">No signups yet</p>"}
        </div>
      </section>`;
    })
    .join("");

  const options = orderedGroups(event)
    .filter((group) => group.key !== "bench")
    .map((group) => `<option value="${group.key}">${escapeHtml(formatGroupName(group.key))}</option>`)
    .join("");
  const signed = event.signups.filter((signup) => signup.group !== "bench").length;

  return `<main class="shell detail-shell">
    <nav><a href="/">All events</a></nav>
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
          return `<span><b>${renderGroupIcon(group.key)}${escapeHtml(getGroupLabel(group.key))}</b> ${group.key === "bench" ? count : `${count}/${group.capacity}`}</span>`;
        })
        .join("")}
    </section>
    <section class="roster-grid">${columns}</section>
    <section class="signup-panel">
      <h2>Manual web signup</h2>
      <form method="post" action="/events/${event.id}/signup">
        <label>Discord ID <input name="userId" required placeholder="1234567890"></label>
        <label>Display name <input name="displayName" required placeholder="FamilyName"></label>
        <label>Group <select name="group">${options}</select></label>
        <button type="submit">Sign up</button>
      </form>
    </section>
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

function renderGroupIcon(groupKey: GroupKey): string {
  const url = getGroupEmojiUrl(groupKey);
  if (url) {
    return `<img class="role-icon" src="${escapeHtml(url)}" alt="">`;
  }

  return `<span class="role-emoji">${escapeHtml(getGroupEmoji(groupKey))}</span>`;
}

function renderCreateRaid(guildId: string): string {
  const templates = [
    { tier: "tier1", name: "T1 Balenos / Serendia", capacity: 30 },
    { tier: "tier2", name: "T2 Calpheon / Ulukita", capacity: 40 },
    { tier: "tier3", name: "T3 Valencia / Edania", capacity: 55 }
  ];
  const roles = [
    { key: "mainball", label: "Mainball / FFA", value: 21 },
    { key: "defense", label: "Defense", value: 5 },
    { key: "zerker", label: "Zerker", value: 2 },
    { key: "shai", label: "Shai", value: 2 }
  ];

  return `<main class="shell create-shell">
    <nav><a href="/?guild=${encodeURIComponent(guildId)}">All events</a></nav>
    <section class="builder-head">
      <div>
        <p class="eyebrow">Node War template builder</p>
        <h1>Create Raid</h1>
        <p class="summary">Plan a roster template with linked slots. Publishing stays in Discord until website admin authentication is enabled.</p>
      </div>
      <div class="capacity-box"><span>Capacity</span><strong id="capacity-value">30</strong></div>
    </section>
    <section class="template-grid" aria-label="Node War templates">
      ${templates.map((template, index) => `<button class="template-button${index === 0 ? " active" : ""}" type="button" data-capacity="${template.capacity}" data-tier="${template.tier}">
        <span>${escapeHtml(template.name)}</span><b>${template.capacity} slots</b>
      </button>`).join("")}
    </section>
    <section class="slot-editor">
      <header>
        <div><p class="eyebrow">Composition</p><h2>Linked slot allocation</h2></div>
        <button type="button" id="add-role">Add custom role</button>
      </header>
      <div id="role-table" class="role-table">
        ${roles.map((role) => renderSliderRow(role.key, role.label, role.value, role.key === "mainball")).join("")}
      </div>
      <p class="editor-note">Increasing any specialist role automatically reduces Mainball / FFA. Custom role icons accept raw Discord emoji values such as <code>&lt;:shai:123456789&gt;</code>.</p>
    </section>
  </main>
  <script>
    (() => {
      const table = document.querySelector("#role-table");
      const capacityLabel = document.querySelector("#capacity-value");
      let capacity = 30;
      const rebalance = () => {
        const main = table.querySelector('[data-key="mainball"] input[type="range"]');
        const specialists = [...table.querySelectorAll('.role-row:not([data-key="mainball"]) input[type="range"]')];
        specialists.forEach((input) => input.max = String(capacity));
        const used = specialists.reduce((sum, input) => sum + Number(input.value), 0);
        main.max = String(capacity);
        main.value = String(Math.max(0, capacity - used));
        table.querySelector('[data-key="mainball"] output').value = main.value;
      };
      const bind = (row) => {
        const slider = row.querySelector('input[type="range"]');
        const output = row.querySelector("output");
        slider.addEventListener("input", () => {
          if (row.dataset.key !== "mainball") {
            const others = [...table.querySelectorAll('.role-row:not([data-key="mainball"]) input[type="range"]')]
              .filter((input) => input !== slider)
              .reduce((sum, input) => sum + Number(input.value), 0);
            slider.value = String(Math.min(Number(slider.value), Math.max(0, capacity - others)));
          }
          output.value = slider.value;
          if (row.dataset.key !== "mainball") rebalance();
        });
      };
      table.querySelectorAll(".role-row").forEach(bind);
      document.querySelectorAll(".template-button").forEach((button) => button.addEventListener("click", () => {
        document.querySelectorAll(".template-button").forEach((candidate) => candidate.classList.remove("active"));
        button.classList.add("active");
        capacity = Number(button.dataset.capacity);
        capacityLabel.textContent = String(capacity);
        rebalance();
      }));
      document.querySelector("#add-role").addEventListener("click", () => {
        const index = table.querySelectorAll(".custom-role").length + 1;
        const row = document.createElement("div");
        row.className = "role-row custom-role";
        row.dataset.key = "custom-" + index;
        row.innerHTML = '<div class="role-name"><span class="role-emoji">+</span><input aria-label="Custom role name" value="Custom role ' + index + '"><input aria-label="Custom Discord emoji" placeholder="<:name:id>"></div><input aria-label="Custom role slots" type="range" min="0" max="30" value="0"><output>0</output>';
        table.append(row);
        bind(row);
      });
      rebalance();
    })();
  </script>`;
}

function renderSliderRow(key: GroupKey, label: string, value: number, readonly: boolean): string {
  return `<div class="role-row" data-key="${escapeHtml(key)}">
    <div class="role-name">${renderGroupIcon(key)}<strong>${escapeHtml(label)}</strong></div>
    <input aria-label="${escapeHtml(label)} slots" type="range" min="0" max="30" value="${value}"${readonly ? " disabled" : ""}>
    <output>${value}</output>
  </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
