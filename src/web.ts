import express, { type Request } from "express";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { buildNodeWarTitle, getNodeWarCapacity } from "./nodewar-presets.js";
import { extractScoreScreenshot } from "./score-ocr.js";
import type { EventStore } from "./store.js";
import type { BotSettings, WarEvent } from "./types.js";
import { createWebSessionStore } from "./web-session-store.js";

import type { DiscordGuild, UserProfile, WebAppOptions, WebSession } from "./web/types.js";
import { buildGuildDashboardSummaries, nextScheduledRaid, previousDate } from "./web/utils.js";
export { nextScheduledRaid } from "./web/utils.js";
import {
  parseAnnouncementChannelId,
  parseAnnouncementRoleIds,
  parseClockTime,
  parseGroupAllocation,
  parseOptionalText,
  parseRepeatDays,
  parseScoreDate,
  parseScoreResult,
  parseScoreRowsFromForm,
  parseTier,
  isAllowedScoreImage,
} from "./web/parsers.js";
import {
  exchangeDiscordCode,
  fetchBotGuildIds,
  fetchDiscord,
  fetchGuildDeliveryOptions,
} from "./web/discord-rest.js";
import {
  canManageEvent,
  canManageGuild,
  getSession,
  readCookie,
  sessionCookie,
  sessionCookieName,
  validCsrf,
  validateWebSession,
} from "./web/sessions.js";
import { setSecurityHeaders } from "./web/middleware.js";
import { consumeScoreGeminiQuota, parseScoreSortKey } from "./web/score.js";
import { renderWebError } from "./web/templates/helpers.js";
import { renderHome } from "./web/templates/home.js";
import {
  renderDashboardPage,
  renderRaidsPage,
  renderEventDetailPage,
  renderServersPage,
  renderMemberLoginPage,
  renderMemberDashboardPage,
  renderLoginRequiredPage,
  renderLoginPage,
} from "./web/templates/raids-page.js";
import { renderStatsServerPickerPage, renderStatsPage, renderScoreReportEditorPage } from "./web/templates/stats-page.js";
import { renderScoreHistoryPage } from "./web/templates/score-history.js";
import { renderGuildActivityPage } from "./web/templates/guild-activity.js";
import { renderGuildPerformancePage } from "./web/templates/guild-performance.js";
import { renderAttendancePage } from "./web/templates/attendance.js";
import { renderPlayerSearchPage } from "./web/templates/player-search.js";
import { getAsiaGuild, searchAsiaGuilds, searchAsiaPlayers } from "./integrations/bdo-asia.js";
import { renderDocsPage } from "./web/templates/docs.js";
import { getBdoGuild, searchBdoGuilds, searchBdoAdventurers, getBdoAdventurer, type BdoGuildProfile } from "./integrations/bdo-community.js";
import { renderCreateServerPickerPage, renderCreateRaidPage, renderEditRaidPage } from "./web/templates/create-edit-page.js";
import type { ScoreReport } from "./score-types.js";
import { normalizePlayerName } from "./web/score.js";

const scoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

// Cache for preview screenshots — keyed by session user + guild, expires after 10 minutes
const previewImageCache = new Map<string, { buffer: Buffer; mimeType: string; name: string; ts: number }>();
function setPreviewImage(key: string, buffer: Buffer, mimeType: string, name: string) {
  previewImageCache.set(key, { buffer, mimeType, name, ts: Date.now() });
  // Evict stale entries
  for (const [k, v] of previewImageCache) {
    if (Date.now() - v.ts > 10 * 60 * 1000) previewImageCache.delete(k);
  }
}
function getPreviewImage(key: string): { buffer: Buffer; mimeType: string; name: string } | undefined {
  const entry = previewImageCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > 10 * 60 * 1000) { previewImageCache.delete(key); return undefined; }
  return entry;
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

function formatUploader(session: WebSession): string {
  const name = session.user.global_name ?? session.user.username;
  return `${name} (${session.user.id})`;
}


/**
 * Creates the Express dashboard with Discord OAuth, public roster pages,
 * authenticated raid management routes, and security middleware.
 */
export function createWebApp(store: EventStore, options: WebAppOptions = {}) {
  const app = express();
  const oauthStates = new Map<string, number>();
  const sessions = createWebSessionStore(config.supabaseUrl, config.supabaseServiceRoleKey, validateWebSession);

  app.disable("x-powered-by");
  app.use(setSecurityHeaders);
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use("/assets", express.static("src/public"));
  app.use("/images/classes", express.static("images/classes"));
  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
    next();
  });

  app.get("/", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    const [events, settings] = session ? await Promise.all([store.listEvents(), store.getSettings()]) : [[], {} as BotSettings];
    if (session && guild) {
      response.redirect(302, `/events?guild=${encodeURIComponent(guild.id)}`);
      return;
    }
    response.type("html").send(renderHome(events, session, settings));
  });

  app.get("/dashboard", async (request, response) => {
    const session = await getSession(request, sessions);
    if (!session) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    const guild = session.guilds.find((candidate) => candidate.id === guildId);
    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    response.type("html").send(renderDashboardPage(guild ? events.filter((event) => event.guildId === guild.id) : events, session, guild?.id, summaries));
  });

  app.get("/guilds/:guildId/events", async (request, response) => {
    const session = await getSession(request, sessions);
    const guild = session?.guilds.find((candidate) => candidate.id === request.params.guildId);
    if (!session || !guild) {
      response.type("html").send(renderLoginRequiredPage());
      return;
    }
    const events = await store.listEvents();
    const settings = await store.getSettings();
    response.type("html").send(renderRaidsPage(events.filter((event) => event.guildId === guild.id), session, guild.id, buildGuildDashboardSummaries(session.guilds, events, settings)));
  });

  app.get("/events", async (request, response) => {
    const session = await getSession(request, sessions);
    if (!session) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    const guild = session.guilds.find((candidate) => candidate.id === guildId);
    if (!guild) {
      response.redirect(302, "/servers");
      return;
    }
    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    response.type("html").send(renderRaidsPage(events.filter((event) => event.guildId === guild.id), session, guild.id, summaries));
  });

  app.get("/raids", (_request, response) => {
    response.redirect(301, "/dashboard");
  });

  app.get("/guilds/:guildId/raids", (request, response) => {
    response.redirect(301, `/guilds/${encodeURIComponent(request.params.guildId)}/events`);
  });

  app.get("/guilds/:guildId/stats", async (request, response) => {
    await sendStatsDashboard(request, response, request.params.guildId);
  });
  // ── Guild Activity (BDO community API) ───────────────────────
  app.get("/guilds/:guildId/activity", async (request, response) => {
    const session = await getSession(request, sessions);
    const guild = session?.guilds.find((candidate) => candidate.id === request.params.guildId);
    if (!session || !guild) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    const configuredName = settings.bdoGuildNames?.[guild.id] ?? null;
    const configuredRegion = settings.bdoGuildRegions?.[guild.id] ?? null;
    let bdoProfile: BdoGuildProfile | null = null;
    if (configuredName) {
      try {
        if (configuredRegion === "ASIA") {
          bdoProfile = await getAsiaGuild(configuredName);
        } else {
          bdoProfile = await getBdoGuild(configuredName, configuredRegion as "EU" | "NA" | "SA" | "KR" | undefined);
        }
      } catch {
        // Guild not found or API error — show the form with the configured name
      }
    }
    response.type("html").send(renderGuildActivityPage(guild, session, bdoProfile, configuredName, configuredRegion, summaries));
  });

  app.post("/guilds/:guildId/activity", async (request, response) => {
    const session = await getSession(request, sessions);
    const guild = session?.guilds.find((candidate) => candidate.id === request.params.guildId);
    if (!session || !guild || !canManageGuild(session, guild.id) || !validCsrf(request, session)) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    const bdoGuildName = typeof request.body.bdoGuildName === "string" ? request.body.bdoGuildName.trim() : "";
    const region = typeof request.body.region === "string" ? request.body.region.toUpperCase() : "EU";
    if (!bdoGuildName) {
      response.redirect(302, `/guilds/${encodeURIComponent(guild.id)}/activity`);
      return;
    }
    // Validate the guild exists via the API before saving
    try {
      if (region === "ASIA") {
        const profile = await getAsiaGuild(bdoGuildName);
        if (!profile) {
          response.redirect(302, `/guilds/${encodeURIComponent(guild.id)}/activity`);
          return;
        }
      } else {
        await getBdoGuild(bdoGuildName, region as "EU" | "NA" | "SA" | "KR");
      }
    } catch {
      response.redirect(302, `/guilds/${encodeURIComponent(guild.id)}/activity`);
      return;
    }
    await store.setBdoGuildName(guild.id, bdoGuildName);
    await store.setBdoGuildRegion(guild.id, region);
    response.redirect(302, `/guilds/${encodeURIComponent(guild.id)}/activity`);
  });
  // ── Guild Performance ────────────────────────────────────────
  app.get("/guilds/:guildId/performance", async (request, response) => {
    const session = await getSession(request, sessions);
    const guild = session?.guilds.find((candidate) => candidate.id === request.params.guildId);
    if (!session || !guild) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    const reports = options.scoreStore ? await options.scoreStore.listReports(guild.id) : [];
    response.type("html").send(renderGuildPerformancePage(guild, session, reports, summaries));
  });

  // ── Attendance ────────────────────────────────────────────────
  app.get("/guilds/:guildId/attendance", async (request, response) => {
    const session = await getSession(request, sessions);
    const guild = session?.guilds.find((candidate) => candidate.id === request.params.guildId);
    if (!session || !guild) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    const reports = options.scoreStore ? await options.scoreStore.listReports(guild.id) : [];
    response.type("html").send(renderAttendancePage(guild, session, events.filter((e) => e.guildId === guild.id), reports, summaries));
  });

  // ── Documentation ─────────────────────────────────────────────
  app.get("/docs", async (request, response) => {
    const session = await getSession(request, sessions);
    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = session ? buildGuildDashboardSummaries(session.guilds, events, settings) : undefined;
    response.type("html").send(renderDocsPage(session ?? { user: { id: '', username: 'Guest' }, guilds: [], csrfToken: '', expiresAt: 0 }, summaries));
  });


  app.get("/member", async (request, response) => {
    const session = await getSession(request, sessions);
    if (!session) {
      response.type("html").send(renderMemberLoginPage());
      return;
    }

    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    response.type("html").send(renderMemberDashboardPage(session, summaries));
  });

  app.get("/stats", async (request, response) => {
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    await sendStatsDashboard(request, response, guildId);
  });

  app.get("/stats/history", async (request, response) => {
    const session = await getSession(request, sessions);
    const isTestMode = request.query.test === "1";
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;

    if (isTestMode) {
      const mockGuild = { id: guildId ?? "test-guild", name: "Test Server", icon: null } as DiscordGuild;
      const mockSession: WebSession = { user: { id: "000000000000000000", username: "testuser", global_name: "Test User" }, guilds: [mockGuild], csrfToken: "test-csrf", expiresAt: Date.now() + 3600_000 };
      const mockReports = options.scoreStore ? await options.scoreStore.listReports(mockGuild.id) : [];
      response.type("html").send(renderScoreHistoryPage(mockGuild, mockSession, mockReports, true));
      return;
    }

    if (!session) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    const guild = session.guilds.find((candidate) => candidate.id === guildId);
    if (!guild || !options.scoreStore) {
      response.status(404).type("html").send(renderWebError(new Error("Server not found or score store unavailable.")));
      return;
    }
    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    const reports = await options.scoreStore.listReports(guild.id);
    response.type("html").send(renderScoreHistoryPage(guild, session, reports, canManageGuild(session, guild.id), summaries));
  });
  // Player detail page
  app.get("/stats/players/:name", async (request, response) => {
    const session = await getSession(request, sessions);
    const isTestMode = request.query.test === "1";
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    const playerName = decodeURIComponent(request.params.name);

    if (isTestMode) {
      const mockGuild = { id: guildId ?? "test-guild", name: "Test Server", icon: null } as DiscordGuild;
      const mockSession: WebSession = { user: { id: "000000000000000000", username: "testuser", global_name: "Test User" }, guilds: [mockGuild], csrfToken: "test-csrf", expiresAt: Date.now() + 3600_000 };
      const mockReports = options.scoreStore ? await options.scoreStore.listReports(mockGuild.id) : [];
      const { renderPlayerDetailPage } = await import("./web/templates/player-detail.js");
      response.type("html").send(renderPlayerDetailPage(mockGuild, mockSession, playerName, mockReports));
      return;
    }

    if (!session) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    const guild = session.guilds.find((candidate) => candidate.id === guildId);
    if (!guild || !options.scoreStore) {
      response.status(404).type("html").send(renderWebError(new Error("Server not found or score store unavailable.")));
      return;
    }
    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    const [reports, playerClass] = await Promise.all([
      options.scoreStore.listReports(guild.id),
      options.scoreStore.getPlayerClass(guild.id, playerName)
    ]);
    const { renderPlayerDetailPage } = await import("./web/templates/player-detail.js");
    response.type("html").send(renderPlayerDetailPage(guild, session, playerName, reports, summaries, playerClass));
  });

  // Player class API
  app.get("/api/players/:name/class", async (request, response) => {
    const session = await getSession(request, sessions);
    if (!session) { response.status(403).json({ error: "Login required" }); return; }
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    const playerName = decodeURIComponent(request.params.name);
    const guild = session.guilds.find((c) => c.id === guildId);
    if (!guild || !options.scoreStore) { response.status(404).json({ error: "Not found" }); return; }
    const classKey = await options.scoreStore.getPlayerClass(guild.id, playerName);
    response.json({ classKey });
  });

  app.post("/api/players/:name/class", async (request, response) => {
    const session = await getSession(request, sessions);
    if (!session) { response.status(403).json({ error: "Login required" }); return; }
    const guildId = typeof request.body.guild === "string" ? request.body.guild : undefined;
    const playerName = decodeURIComponent(request.params.name);
    const classKey = typeof request.body.classKey === "string" ? request.body.classKey : null;
    const guild = session.guilds.find((c) => c.id === guildId);
    if (!guild || !options.scoreStore) { response.status(404).json({ error: "Not found" }); return; }
    await options.scoreStore.setPlayerClass(guild.id, playerName, classKey);
    response.json({ ok: true });
  });

  app.get("/api/guilds/:guildId/player-classes", async (request, response) => {
    const session = await getSession(request, sessions);
    if (!session) { response.status(403).json({ error: "Login required" }); return; }
    const guild = session.guilds.find((c) => c.id === request.params.guildId);
    if (!guild || !options.scoreStore) { response.status(404).json({ error: "Not found" }); return; }
    const classes = await options.scoreStore.getPlayerClasses(guild.id);
    response.json(classes);
  });

  // BDO Guild search API
  app.get("/api/bdo/guilds/search", async (request, response) => {
    const session = await getSession(request, sessions);
    if (!session) { response.status(403).json({ error: "Login required" }); return; }
    const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
    const region = typeof request.query.region === "string" ? request.query.region.toUpperCase() : "NA";
    if (!query || query.length < 2) { response.json([]); return; }
    try {
      if (region === "ASIA") {
        const results = await searchAsiaGuilds(query);
        response.json(results.map((g) => ({ name: g.name, region: "ASIA", master: g.master?.familyName ?? null, population: g.population ?? 0, createdOn: g.createdOn ?? null })));
      } else {
        const results = await searchBdoGuilds(query, region as "EU" | "NA" | "SA" | "KR");
        response.json(results.map((g) => ({ name: g.name, region: g.region, master: g.master?.familyName ?? null, population: g.population ?? 0, createdOn: g.createdOn ?? null })));
      }
    } catch {
      response.json([]);
    }
  });

  // BDO Player search API
  app.get("/api/bdo/players/search", async (request, response) => {
    const session = await getSession(request, sessions);
    if (!session) { response.status(403).json({ error: "Login required" }); return; }
    const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
    const region = typeof request.query.region === "string" ? request.query.region.toUpperCase() : "NA";
    const type = typeof request.query.type === "string" && request.query.type === "characterName" ? "characterName" : "familyName";
    if (!query || query.length < 2) { response.json([]); return; }
    try {
      if (region === "ASIA") {
        const results = await searchAsiaPlayers(query, type);
        response.json(results.map((p) => ({ familyName: p.familyName, guild: p.guildName, mainCharacter: p.mainCharacter, profileTarget: p.profileTarget, region: "ASIA" })));
      } else {
        const results = await searchBdoAdventurers(query, region as "EU" | "NA" | "SA" | "KR", type);
        response.json(results.map((p) => ({ familyName: p.familyName, guild: p.guild?.name ?? null, mainCharacter: null, profileTarget: p.profileTarget, region: p.region })));
      }
    } catch {
      response.json([]);
    }
  });

  // BDO Player profile API
  app.get("/api/bdo/players/:profileTarget", async (request, response) => {
    const session = await getSession(request, sessions);
    if (!session) { response.status(403).json({ error: "Login required" }); return; }
    const region = typeof request.query.region === "string" ? request.query.region.toUpperCase() : "NA";
    const profileTarget = decodeURIComponent(request.params.profileTarget);
    // For ASIA, profileTarget is actually the family name (since the real profileTarget is an encrypted blob)
    const familyNameOrTarget = typeof request.query.name === "string" ? request.query.name : profileTarget;
    try {
      if (region === "ASIA") {
        const { searchAsiaPlayers } = await import("./integrations/bdo-asia.js");
        const results = await searchAsiaPlayers(familyNameOrTarget, "familyName");
        const match = results.find((p) => p.familyName.toLowerCase() === familyNameOrTarget.toLowerCase()) ?? results[0];
        if (match) {
          response.json({ familyName: match.familyName, guild: match.guildName, mainCharacter: match.mainCharacter, profileTarget: match.profileTarget, region: "ASIA", characters: [] });
        } else {
          response.status(404).json({ error: "Player not found" });
        }
      } else {
        const profile = await getBdoAdventurer(profileTarget, region as "EU" | "NA" | "SA" | "KR");
        response.json({
          familyName: profile.familyName,
          guild: profile.guild?.name ?? null,
          mainCharacter: profile.characters.find((c) => c.main)?.name ?? profile.characters[0]?.name ?? null,
          characters: profile.characters,
          contributionPoints: profile.contributionPoints,
          lifeFame: profile.lifeFame,
          combatFame: profile.combatFame,
          energy: profile.energy,
          gs: profile.gs,
          createdOn: profile.createdOn,
          region: profile.region,
          profileTarget,
        });
      }
    } catch {
      response.status(404).json({ error: "Player not found" });
    }
  });

  // War comparison page
  app.get("/stats/compare", async (request, response) => {
    const session = await getSession(request, sessions);
    const isTestMode = request.query.test === "1";
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    const warAId = typeof request.query.warA === "string" ? request.query.warA : undefined;
    const warBId = typeof request.query.warB === "string" ? request.query.warB : undefined;

    if (isTestMode) {
      const mockGuild = { id: guildId ?? "test-guild", name: "Test Server", icon: null } as DiscordGuild;
      const mockSession: WebSession = { user: { id: "000000000000000000", username: "testuser", global_name: "Test User" }, guilds: [mockGuild], csrfToken: "test-csrf", expiresAt: Date.now() + 3600_000 };
      const mockReports = options.scoreStore ? await options.scoreStore.listReports(mockGuild.id) : [];
      const { renderWarComparePage } = await import("./web/templates/war-compare.js");
      response.type("html").send(renderWarComparePage(mockGuild, mockSession, mockReports, warAId, warBId));
      return;
    }

    if (!session) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    const guild = session.guilds.find((candidate) => candidate.id === guildId);
    if (!guild || !options.scoreStore) {
      response.status(404).type("html").send(renderWebError(new Error("Server not found or score store unavailable.")));
      return;
    }
    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    const reports = await options.scoreStore.listReports(guild.id);
    const { renderWarComparePage } = await import("./web/templates/war-compare.js");
    response.type("html").send(renderWarComparePage(guild, session, reports, warAId, warBId, summaries));
  });

  // Player search page
  app.get("/stats/players/search", async (request, response) => {
    const session = await getSession(request, sessions);
    const isTestMode = request.query.test === "1";
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;

    if (isTestMode) {
      const mockGuild = { id: guildId ?? "test-guild", name: "Test Server", icon: null } as DiscordGuild;
      const mockSession: WebSession = { user: { id: "000000000000000000", username: "testuser", global_name: "Test User" }, guilds: [mockGuild], csrfToken: "test-csrf", expiresAt: Date.now() + 3600_000 };
      response.type("html").send(renderPlayerSearchPage(mockGuild, mockSession));
      return;
    }

    if (!session) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    const guild = session.guilds.find((candidate) => candidate.id === guildId);
    if (!guild) {
      response.status(404).type("html").send(renderWebError(new Error("Server not found.")));
      return;
    }
    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    response.type("html").send(renderPlayerSearchPage(guild, session, summaries));
  });

  // CSV export endpoint
  app.get("/stats/export.csv", async (request, response) => {
    const session = await getSession(request, sessions);
    const isTestMode = request.query.test === "1";
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;

    let reports: ScoreReport[];
    let guildName: string;

    if (isTestMode) {
      const mockGuild = { id: guildId ?? "test-guild", name: "Test Server", icon: null } as DiscordGuild;
      reports = options.scoreStore ? await options.scoreStore.listReports(mockGuild.id) : [];
      guildName = mockGuild.name;
    } else {
      if (!session) { response.status(403).send("Not authorized."); return; }
      const guild = session.guilds.find((candidate) => candidate.id === guildId);
      if (!guild || !options.scoreStore) { response.status(404).send("Server not found."); return; }
      reports = await options.scoreStore.listReports(guild.id);
      guildName = guild.name;
    }

    // Aggregate all player data
    const { aggregateScoreRows } = await import("./web/score.js");
    const allRows = reports.flatMap((r) => r.rows);
    const players = aggregateScoreRows(allRows);

    // Build CSV
    const header = "Player,Wars,Kills,Deaths,K/D,Damage,CC,Fort,Streak,Healed,Resurrections";
    const csvRows = players.map((p) => {
      const kd = p.deaths ? (p.kills / p.deaths).toFixed(2) : String(p.kills);
      return [
        `"${p.familyName.replace(/"/g, '""')}"`,
        p.participations,
        p.kills,
        p.deaths,
        kd,
        p.damageDealt,
        p.crowdControls,
        p.structureDamage,
        p.assists,
        p.hpHealed + p.allySupport,
        p.resurrections,
      ].join(",");
    }).join("\n");

    const csv = `${header}\n${csvRows}`;
    response.setHeader("Content-Type", "text/csv");
    response.setHeader("Content-Disposition", `attachment; filename="${guildName.replace(/[^a-zA-Z0-9]/g, "_")}_scoreboard.csv"`);
    response.send(csv);
  });

  async function sendStatsDashboard(request: Request, response: express.Response, guildId?: string): Promise<void> {
    const session = await getSession(request, sessions);
    const isTestMode = request.query.test === "1";
    if (isTestMode) {
      const mockGuild = { id: guildId ?? "test-guild", name: "Test Server", icon: null } as DiscordGuild;
      const mockSession: WebSession = { user: { id: "000000000000000000", username: "testuser", global_name: "Test User" }, guilds: [mockGuild], csrfToken: "test-csrf", expiresAt: Date.now() + 3600_000 };
      const mockReports = [
        { id: "r1", guildId: mockGuild.id, warDate: "2026-06-01", result: "win" as const, title: "Node War - Sunday", uploadedBy: "testuser", imageBucket: "", imagePath: "", imageMimeType: "", ocrEngine: "test", ocrConfidence: 95, rawOcrText: "", createdAt: new Date().toISOString(), rows: [
          { guildId: mockGuild.id, familyName: "DynastyRedSuns", kills: 45, deaths: 12, assists: 30, damageDealt: 4200000, damageTaken: 1800000, crowdControls: 85, hpHealed: 0, allySupport: 1200000, structureDamage: 350000, lynchCannonKills: 0, siegeAssists: 2, resurrections: 0, siegeDeaths: 0, specialKills: 1, timeAlive: "25:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "Umihotaru", kills: 38, deaths: 8, assists: 25, damageDealt: 3100000, damageTaken: 900000, crowdControls: 60, hpHealed: 0, allySupport: 800000, structureDamage: 200000, lynchCannonKills: 0, siegeAssists: 1, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "28:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "ValkyrieQueen", kills: 32, deaths: 15, assists: 40, damageDealt: 2800000, damageTaken: 2100000, crowdControls: 95, hpHealed: 500000, allySupport: 2000000, structureDamage: 150000, lynchCannonKills: 0, siegeAssists: 3, resurrections: 2, siegeDeaths: 0, specialKills: 0, timeAlive: "22:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "ShadowBlade", kills: 28, deaths: 20, assists: 18, damageDealt: 2200000, damageTaken: 2500000, crowdControls: 40, hpHealed: 0, allySupport: 500000, structureDamage: 400000, lynchCannonKills: 1, siegeAssists: 0, resurrections: 0, siegeDeaths: 1, specialKills: 2, timeAlive: "20:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "IronWall", kills: 15, deaths: 5, assists: 50, damageDealt: 1500000, damageTaken: 3200000, crowdControls: 120, hpHealed: 2000000, allySupport: 3000000, structureDamage: 100000, lynchCannonKills: 0, siegeAssists: 5, resurrections: 4, siegeDeaths: 0, specialKills: 0, timeAlive: "29:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "StormCaller", kills: 22, deaths: 18, assists: 35, damageDealt: 1900000, damageTaken: 1700000, crowdControls: 75, hpHealed: 300000, allySupport: 1500000, structureDamage: 250000, lynchCannonKills: 0, siegeAssists: 2, resurrections: 1, siegeDeaths: 0, specialKills: 0, timeAlive: "21:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "FrostByte", kills: 30, deaths: 10, assists: 20, damageDealt: 2600000, damageTaken: 1100000, crowdControls: 55, hpHealed: 100000, allySupport: 900000, structureDamage: 180000, lynchCannonKills: 0, siegeAssists: 1, resurrections: 0, siegeDeaths: 0, specialKills: 1, timeAlive: "26:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "BlazeFist", kills: 25, deaths: 22, assists: 15, damageDealt: 1800000, damageTaken: 2800000, crowdControls: 30, hpHealed: 0, allySupport: 300000, structureDamage: 300000, lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 2, specialKills: 0, timeAlive: "18:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "WindWalker", kills: 18, deaths: 14, assists: 45, damageDealt: 1400000, damageTaken: 1500000, crowdControls: 70, hpHealed: 800000, allySupport: 1800000, structureDamage: 120000, lynchCannonKills: 0, siegeAssists: 4, resurrections: 3, siegeDeaths: 0, specialKills: 0, timeAlive: "23:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "EarthShaker", kills: 20, deaths: 16, assists: 30, damageDealt: 1600000, damageTaken: 2000000, crowdControls: 90, hpHealed: 400000, allySupport: 1200000, structureDamage: 500000, lynchCannonKills: 0, siegeAssists: 3, resurrections: 1, siegeDeaths: 0, specialKills: 0, timeAlive: "22:00", totalWarTime: "30:00" },
        ]},
        { id: "r2", guildId: mockGuild.id, warDate: "2026-05-28", result: "loss" as const, title: "Node War - Thursday", uploadedBy: "testuser", imageBucket: "", imagePath: "", imageMimeType: "", ocrEngine: "test", ocrConfidence: 90, rawOcrText: "", createdAt: new Date().toISOString(), rows: [
          { guildId: mockGuild.id, familyName: "DynastyRedSuns", kills: 35, deaths: 18, assists: 20, damageDealt: 3500000, damageTaken: 2200000, crowdControls: 70, hpHealed: 0, allySupport: 900000, structureDamage: 200000, lynchCannonKills: 0, siegeAssists: 1, resurrections: 0, siegeDeaths: 1, specialKills: 0, timeAlive: "22:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "Umihotaru", kills: 30, deaths: 12, assists: 22, damageDealt: 2800000, damageTaken: 1200000, crowdControls: 50, hpHealed: 0, allySupport: 700000, structureDamage: 150000, lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "25:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "ValkyrieQueen", kills: 28, deaths: 20, assists: 35, damageDealt: 2400000, damageTaken: 2800000, crowdControls: 80, hpHealed: 400000, allySupport: 1800000, structureDamage: 100000, lynchCannonKills: 0, siegeAssists: 2, resurrections: 1, siegeDeaths: 0, specialKills: 0, timeAlive: "19:00", totalWarTime: "30:00" },
        ]},
        { id: "r3", guildId: mockGuild.id, warDate: "2026-05-25", result: "win" as const, title: "Node War - Sunday", uploadedBy: "testuser", imageBucket: "", imagePath: "", imageMimeType: "", ocrEngine: "test", ocrConfidence: 88, rawOcrText: "", createdAt: new Date().toISOString(), rows: [
          { guildId: mockGuild.id, familyName: "DynastyRedSuns", kills: 50, deaths: 8, assists: 35, damageDealt: 5000000, damageTaken: 1000000, crowdControls: 100, hpHealed: 0, allySupport: 1500000, structureDamage: 400000, lynchCannonKills: 1, siegeAssists: 3, resurrections: 0, siegeDeaths: 0, specialKills: 2, timeAlive: "29:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "Umihotaru", kills: 42, deaths: 5, assists: 28, damageDealt: 3800000, damageTaken: 600000, crowdControls: 65, hpHealed: 0, allySupport: 1000000, structureDamage: 250000, lynchCannonKills: 0, siegeAssists: 2, resurrections: 0, siegeDeaths: 0, specialKills: 1, timeAlive: "29:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "ValkyrieQueen", kills: 36, deaths: 10, assists: 45, damageDealt: 3200000, damageTaken: 1500000, crowdControls: 110, hpHealed: 600000, allySupport: 2500000, structureDamage: 180000, lynchCannonKills: 0, siegeAssists: 4, resurrections: 3, siegeDeaths: 0, specialKills: 0, timeAlive: "25:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "ShadowBlade", kills: 32, deaths: 14, assists: 20, damageDealt: 2600000, damageTaken: 1800000, crowdControls: 45, hpHealed: 0, allySupport: 600000, structureDamage: 350000, lynchCannonKills: 0, siegeAssists: 1, resurrections: 0, siegeDeaths: 1, specialKills: 1, timeAlive: "23:00", totalWarTime: "30:00" },
          { guildId: mockGuild.id, familyName: "IronWall", kills: 18, deaths: 3, assists: 55, damageDealt: 1800000, damageTaken: 3500000, crowdControls: 130, hpHealed: 3000000, allySupport: 3500000, structureDamage: 80000, lynchCannonKills: 0, siegeAssists: 6, resurrections: 5, siegeDeaths: 0, specialKills: 0, timeAlive: "29:00", totalWarTime: "30:00" },
        ]},
      ];
      const sortKey = parseScoreSortKey(request.query.sort);
      response.type("html").send(renderStatsPage(mockGuild, mockSession, mockReports, undefined, sortKey, true));
      return;
    }

    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }

    const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    if (!guild) {
      response.type("html").send(renderStatsServerPickerPage(session, summaries));
      return;
    }

    try {
      const reports = options.scoreStore ? await options.scoreStore.listReports(guild.id) : [];
      const sortKey = parseScoreSortKey(request.query.sort);
      const notice =
        request.query.uploaded === "1"
          ? "uploaded"
          : request.query.rescanned === "1"
            ? "rescanned"
            : request.query.saved === "1"
              ? "saved"
              : request.query.deleted === "1"
                ? "deleted"
                : request.query.renamed === "1"
                  ? "renamed"
                  : undefined;
      const playerClasses = options.scoreStore ? await options.scoreStore.getPlayerClasses(guild.id) : {};
      response.type("html").send(renderStatsPage(guild, session, reports, notice, sortKey, canManageGuild(session, guild.id), summaries, playerClasses));
    } catch (error) {
      response.status(502).type("html").send(renderWebError(error));
    }
  }

  app.post("/stats/upload", scoreUpload.single("screenshot"), async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !canManageGuild(session, guild.id) || !validCsrf(request, session) || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      const warDate = parseScoreDate(request.body.warDate);
      const result = parseScoreResult(request.body.result);
      const uploadedBy = formatUploader(session);

      // Duplicate check: see if a report already exists for this war date
      const existingReports = await options.scoreStore.listReports(guild.id);
      const duplicate = existingReports.find(r => r.warDate === warDate);
      const isOverwrite = request.query.overwrite === "1";
      if (duplicate && !isOverwrite) {
        response.status(200).type("json").send(JSON.stringify({
          error: "duplicate",
          existingId: duplicate.id,
          existingDate: duplicate.warDate,
          existingResult: duplicate.result,
          existingPlayers: duplicate.rows.length
        }));
        return;
      }
      if (duplicate && isOverwrite) {
        await options.scoreStore.deleteReport(guild.id, duplicate.id);
      }
      // Check if rows are provided directly (preview flow) or need OCR extraction
      let rows: Array<Omit<import("./score-types.js").ScoreRow, "guildId"> | import("./score-types.js").ScoreRow>;
      let ocrEngine: string;
      let rawOcrText: string;
      let ocrConfidence: number | undefined;
      let imageMimeType: string;
      let imageOriginalName: string;
      let imageBuffer: Buffer;

      if (request.body.rows) {
        // Preview flow: rows already extracted and potentially edited by user
        rows = JSON.parse(request.body.rows);
        ocrEngine = "preview";
        rawOcrText = "";
        ocrConfidence = undefined;
        // Retrieve the cached screenshot from the preview step
        const cacheKey = `${session.user.id}:${guildId}`;
        const cached = getPreviewImage(cacheKey);
        if (cached) {
          imageMimeType = cached.mimeType;
          imageOriginalName = cached.name;
          imageBuffer = cached.buffer;
          previewImageCache.delete(cacheKey); // One-time use
        } else {
          // Fallback: use uploaded file or placeholder
          const file = request.file;
          if (file && isAllowedScoreImage(file.mimetype, file.originalname)) {
            imageMimeType = file.mimetype;
            imageOriginalName = file.originalname;
            imageBuffer = file.buffer;
          } else {
            imageMimeType = "image/png";
            imageOriginalName = "preview-upload.png";
            imageBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
          }
        }
      } else {
        // Traditional flow: extract from screenshot
        const file = request.file;
        if (!file || !isAllowedScoreImage(file.mimetype, file.originalname)) {
          throw new Error("Upload a PNG, JPG, or WebP scoreboard screenshot.");
        }
        imageMimeType = file.mimetype;
        imageOriginalName = file.originalname;
        imageBuffer = file.buffer;
        const geminiQuota = consumeScoreGeminiQuota(session.user.id, guild.id);
        const extraction = await extractScoreScreenshot(file.buffer, {
          mimeType: file.mimetype,
          geminiApiKey: geminiQuota.allowed ? config.geminiApiKey : undefined,
          geminiModel: config.geminiModel,
          preferGemini: geminiQuota.allowed
        });
        rows = extraction.rows;
        ocrEngine = extraction.engine;
        rawOcrText = extraction.rawText;
        ocrConfidence = extraction.confidence;
      }

      await options.scoreStore.createReport({
        guildId: guild.id,
        warDate,
        result,
        title: parseOptionalText(request.body.title, 120),
        imageMimeType,
        imageOriginalName,
        imageBuffer,
        ocrEngine,
        rawOcrText,
        ocrConfidence,
        uploadedBy,
        rows: rows.map((row) => ({ ...row, familyName: normalizePlayerName(row.familyName), guildId: guild.id }))
      });
      // Validate and warn about suspicious data
      const { validateScoreRows, detectDuplicatePlayers } = await import("./web/score.js");
      const validationWarnings = validateScoreRows(rows as import("./score-types.js").ScoreRow[]);
      const duplicateGroups = detectDuplicatePlayers(rows as import("./score-types.js").ScoreRow[]);
      if (validationWarnings.length || duplicateGroups.size) {
        const warnMsg = [
          ...validationWarnings.map((w) => `${w.player}: ${w.message}`),
          ...[...duplicateGroups.entries()].map(([, names]) => `Possible duplicate: ${names.join(" / ")}`)
        ].join("; ");
        console.warn(`Score validation warnings for ${guild.name}: ${warnMsg}`);
      }
      console.info(
        `Score uploaded by ${uploadedBy} for guild ${guild.name} (${guild.id}): ${rows.length} rows via ${ocrEngine}. ${ocrConfidence !== undefined ? `Confidence: ${ocrConfidence}%` : ""}`.trim()
      );

      response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&uploaded=1`);
    } catch (error) {
      response.status(400).type("html").send(renderWebError(error));
    }
  });
  // Upload preview endpoint — returns extracted rows as JSON before saving
  app.post("/stats/upload/preview", scoreUpload.single("screenshot"), async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const isTestMode = request.body.testMode === "true" || request.query.test === "1";

    if (!isTestMode) {
      const guild = session?.guilds.find((candidate) => candidate.id === guildId);
      if (!session || !guild || !canManageGuild(session, guild.id) || !validCsrf(request, session)) {
        response.status(403).json({ error: "Not authorized." });
        return;
      }
    }

    try {
      const file = request.file;
      if (!file || !isAllowedScoreImage(file.mimetype, file.originalname)) {
        throw new Error("Upload a PNG, JPG, or WebP scoreboard screenshot.");
      }

      const geminiQuota = isTestMode
        ? { allowed: false, reason: "test mode" }
        : consumeScoreGeminiQuota(session!.user.id, guildId);
      const extraction = await extractScoreScreenshot(file.buffer, {
        mimeType: file.mimetype,
        geminiApiKey: geminiQuota.allowed ? config.geminiApiKey : undefined,
        geminiModel: config.geminiModel,
        preferGemini: geminiQuota.allowed
      });

      // Cache the image so the save flow can use the real screenshot
      const cacheKey = `${isTestMode ? "test" : session!.user.id}:${guildId}`;
      setPreviewImage(cacheKey, file.buffer, file.mimetype, file.originalname);

      // Normalize names
      const { normalizePlayerName } = await import("./web/score.js");
      const rows = extraction.rows.map((row) => ({
        ...row,
        familyName: normalizePlayerName(row.familyName)
      }));

      response.json({
        engine: extraction.engine,
        confidence: extraction.confidence,
        rowCount: rows.length,
        rows
      });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Extraction failed." });
    }
  });
  // Extract screenshot → JSON in manual entry format
  app.post("/stats/extract-json", scoreUpload.single("screenshot"), async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = typeof request.body.guildId === "string" ? request.body.guildId : undefined;
    const isTestMode = request.body.testMode === "true";

    if (!isTestMode) {
      const guild = session?.guilds.find((candidate) => candidate.id === guildId);
      if (!session || !guild || !canManageGuild(session, guild.id) || !validCsrf(request, session)) {
        response.status(403).json({ error: "Not authorized." });
        return;
      }
    }

    try {
      const file = request.file;
      if (!file || !isAllowedScoreImage(file.mimetype, file.originalname)) {
        throw new Error("Upload a PNG, JPG, or WebP scoreboard screenshot.");
      }

      const geminiQuota = isTestMode
        ? { allowed: false, reason: "test mode" }
        : consumeScoreGeminiQuota(session!.user.id, guildId!);
      const extraction = await extractScoreScreenshot(file.buffer, {
        mimeType: file.mimetype,
        geminiApiKey: geminiQuota.allowed ? config.geminiApiKey : undefined,
        geminiModel: config.geminiModel,
        preferGemini: geminiQuota.allowed
      });

      // Convert to manual entry JSON format
      const { normalizePlayerName } = await import("./web/score.js");
      const players = extraction.rows.map((row) => ({
        name: normalizePlayerName(row.familyName),
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        damage: row.damageDealt,
        taken: row.damageTaken,
        cc: row.crowdControls,
        healed: row.hpHealed,
        support: row.allySupport,
        fort: row.structureDamage
      }));

      const warDate = new Date().toISOString().slice(0, 10);
      const resultJson = JSON.stringify({
        warDate,
        result: "unknown",
        title: "",
        players
      }, null, 2);

      response.json({
        engine: extraction.engine,
        confidence: extraction.confidence,
        rowCount: players.length,
        json: resultJson
      });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Extraction failed." });
    }
  });
  app.post("/stats/manual", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !canManageGuild(session, guild.id) || !validCsrf(request, session) || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      const scoreData = String(request.body.scoreData ?? "");
      if (!scoreData.trim()) throw new Error("Score data is required.");

      const isJson = request.body.format === "json";
      let rows: Omit<import("./score-types.js").ScoreRow, "guildId">[] = [];
      let warDate: string;
      let result: import("./score-types.js").ScoreReportResult;
      let title: string | undefined;

      if (isJson) {
        // JSON format
        let parsed: unknown;
        try { parsed = JSON.parse(scoreData); } catch { throw new Error("Invalid JSON. Please paste valid JSON data."); }
        const data = parsed as Record<string, unknown>;
        if (!data.warDate || typeof data.warDate !== "string") throw new Error("JSON must include a \"warDate\" field (YYYY-MM-DD).");
        if (!data.players || !Array.isArray(data.players)) throw new Error("JSON must include a \"players\" array.");
        warDate = data.warDate as string;
        result = (data.result === "win" || data.result === "loss" || data.result === "unknown") ? data.result as import("./score-types.js").ScoreReportResult : "unknown";
        title = typeof data.title === "string" ? data.title : undefined;
        for (const p of data.players as Record<string, unknown>[]) {
          const name = typeof p.name === "string" ? p.name.trim() : "";
          if (!name) continue;
          const num = (field: string) => { const v = Number(p[field]); return Number.isFinite(v) && v >= 0 ? Math.round(v) : 0; };
          rows.push({
            familyName: normalizePlayerName(name.slice(0, 80)),
            kills: num("kills"),
            deaths: num("deaths"),
            assists: num("streak") || num("assists"),
            damageDealt: num("damage"),
            damageTaken: num("taken"),
            crowdControls: num("cc"),
            hpHealed: num("healed"),
            allySupport: num("support"),
            structureDamage: num("fort"),
            lynchCannonKills: 0,
            siegeAssists: 0,
            resurrections: 0,
            siegeDeaths: 0,
            specialKills: 0,
            timeAlive: "",
            totalWarTime: ""
          });
        }
      } else {
        // Legacy tab-separated format
        const lines = scoreData.trim().split("\n").filter((l) => l.trim());
        for (const line of lines) {
          const cols = line.split("\t").map((c) => c.trim());
          if (cols.length < 6) throw new Error(`Each line needs at least 6 tab-separated columns (Name, K, D, Streak, DMG, CC). Got ${cols.length} on: "${line.slice(0, 60)}"`);
          const num = (i: number) => { const v = (cols[i] ?? "").replace(/,/g, ""); const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; };
          rows.push({
            familyName: normalizePlayerName(cols[0].slice(0, 80)),
            kills: num(1),
            deaths: num(2),
            assists: num(3),
            damageDealt: num(4),
            damageTaken: num(5),
            crowdControls: num(6),
            hpHealed: num(7),
            allySupport: num(8),
            structureDamage: num(9),
            lynchCannonKills: 0,
            siegeAssists: 0,
            resurrections: 0,
            siegeDeaths: 0,
            specialKills: 0,
            timeAlive: "",
            totalWarTime: ""
          });
        }
        warDate = parseScoreDate(request.body.warDate);
        result = parseScoreResult(request.body.result);
        title = parseOptionalText(request.body.title, 120);
      }

      if (!rows.length) throw new Error("No valid score rows found.");

      if (!isJson) {
        warDate = parseScoreDate(request.body.warDate);
        result = parseScoreResult(request.body.result);
      }
      const uploadedBy = formatUploader(session);

      // Create a placeholder 1x1 PNG for the image requirement
      const placeholderPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

      await options.scoreStore.createReport({
        guildId: guild.id,
        warDate,
        title: title ?? (isJson ? undefined : parseOptionalText(request.body.title, 120)),
        result,
        imageMimeType: "image/png",
        imageOriginalName: "manual-entry.png",
        imageBuffer: placeholderPng,
        ocrEngine: "manual",
        rawOcrText: scoreData,
        ocrConfidence: 100,
        uploadedBy,
        rows: rows.map((row) => ({ ...row, guildId: guild.id }))
      });

      console.info(`Manual score entry by ${uploadedBy} for guild ${guild.name} (${guild.id}): ${rows.length} rows.`);
      response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&uploaded=1`);
    } catch (error) {
      response.status(400).type("html").send(renderWebError(error));
    }
  });

  app.get("/stats/reports/:id/edit", async (request, response) => {
    const reportId = String(request.params.id);
    const session = await getSession(request, sessions);
    const isTestMode = request.query.test === "1";
    const guildId = typeof request.query.guild === "string" ? request.query.guild : "";

    if (isTestMode) {
      const mockGuild = { id: guildId ?? "test-guild", name: "Test Server", icon: null } as DiscordGuild;
      const mockSession: WebSession = { user: { id: "000000000000000000", username: "testuser", global_name: "Test User" }, guilds: [mockGuild], csrfToken: "test-csrf", expiresAt: Date.now() + 3600_000 };
      if (!options.scoreStore) { response.status(404).send("No score store."); return; }
      const [report, allReports] = await Promise.all([
        options.scoreStore.getReport(mockGuild.id, reportId),
        options.scoreStore.listReports(mockGuild.id)
      ]);
      if (!report) { response.status(404).send("Score report not found."); return; }
      response.type("html").send(renderScoreReportEditorPage(mockGuild, mockSession, report, allReports));
      return;
    }

    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !canManageGuild(session, guild.id) || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      const [report, allReports] = await Promise.all([
        options.scoreStore.getReport(guild.id, reportId),
        options.scoreStore.listReports(guild.id)
      ]);
      if (!report) {
        response.status(404).send("Score report not found.");
        return;
      }
      response.type("html").send(renderScoreReportEditorPage(guild, session, report, allReports));
    } catch (error) {
      response.status(400).type("html").send(renderWebError(error));
    }
  });

  app.get("/stats/reports/:id/preview", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = typeof request.query.guild === "string" ? request.query.guild : "";
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      const reportImage = await options.scoreStore.readReportImage(guild.id, request.params.id);
      if (!reportImage) {
        response.status(404).send("Score report not found.");
        return;
      }

      response
        .setHeader("Content-Type", reportImage.report.imageMimeType)
        .setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(reportImage.report.id)}"`)
        .setHeader("Cache-Control", "private, max-age=300")
        .send(reportImage.imageBuffer);
    } catch (error) {
      response.status(400).type("html").send(renderWebError(error));
    }
  });

  app.post("/stats/reports/:id/edit", scoreUpload.single("newScreenshot"), async (request, response) => {
    const reportId = String(request.params.id);
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !canManageGuild(session, guild.id) || !validCsrf(request, session) || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      const rows = parseScoreRowsFromForm(request.body);
      await options.scoreStore.updateReport(guild.id, reportId, {
        warDate: parseScoreDate(request.body.warDate),
        result: parseScoreResult(request.body.result),
        title: parseOptionalText(request.body.title, 120),
        rows: rows.map((row) => ({ ...row, guildId: guild.id }))
      });

      // If a new screenshot was uploaded, replace the placeholder image
      const file = request.file;
      if (file && isAllowedScoreImage(file.mimetype, file.originalname)) {
        const report = await options.scoreStore.getReport(guild.id, reportId);
        if (report) {
          // Delete old image and upload new one
          try {
            await options.scoreStore.readReportImage(guild.id, reportId);
          } catch { /* ignore if old image doesn't exist */ }
          // Upload new image to storage
          const supabase = (options.scoreStore as any).supabase;
          if (supabase) {
            const newPath = `${guild.id}/${report.id}.${file.originalname.split(".").pop() || "png"}`;
            await supabase.storage.from("score-screenshots").remove([report.imagePath]).catch(() => {});
            await supabase.storage.from("score-screenshots").upload(newPath, file.buffer, { contentType: file.mimetype, upsert: true });
            await supabase.from("score_reports").update({ image_path: newPath, image_mime_type: file.mimetype }).eq("id", report.id).eq("guild_id", guild.id);
            console.info(`Screenshot attached to report ${report.id} by ${formatUploader(session)} for guild ${guild.name}.`);
          }
        }
      }

      console.info(`Score report ${request.params.id} manually edited by ${formatUploader(session)} for guild ${guild.name} (${guild.id}); saved ${rows.length} rows.`);
      response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&saved=1`);
    } catch (error) {
      response.status(400).type("html").send(renderWebError(error));
    }
  });

  app.post("/stats/players/rename", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !canManageGuild(session, guild.id) || !validCsrf(request, session) || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      const oldName = parseOptionalText(request.body.oldName, 80);
      const newName = parseOptionalText(request.body.familyName, 80);
      if (!oldName || !newName) throw new Error("Enter a player name to rename.");
      const renamed = await options.scoreStore.renamePlayer(guild.id, oldName, newName);
      if (!renamed) throw new Error(`No score rows matched ${oldName}.`);
      console.info(`Score player ${oldName} renamed to ${newName} by ${formatUploader(session)} for guild ${guild.name} (${guild.id}); updated ${renamed} rows.`);
      response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&renamed=1`);
    } catch (error) {
      response.status(400).type("html").send(renderWebError(error));
    }
  });

  app.post("/stats/reports/:id/delete", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !canManageGuild(session, guild.id) || !validCsrf(request, session) || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      await options.scoreStore.deleteReport(guild.id, request.params.id);
      console.info(`Score report ${request.params.id} deleted by ${formatUploader(session)} for guild ${guild.name} (${guild.id}).`);
      response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&deleted=1`);
    } catch (error) {
      response.status(400).type("html").send(renderWebError(error));
    }
  });

  app.post("/stats/reports/:id/rescan", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !canManageGuild(session, guild.id) || !validCsrf(request, session) || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      const reportImage = await options.scoreStore.readReportImage(guild.id, request.params.id);
      if (!reportImage) {
        response.status(404).send("Score report not found.");
        return;
      }

      const geminiQuota = consumeScoreGeminiQuota(session.user.id, guild.id);
      const extraction = await extractScoreScreenshot(reportImage.imageBuffer, {
        mimeType: reportImage.report.imageMimeType,
        geminiApiKey: geminiQuota.allowed ? config.geminiApiKey : undefined,
        geminiModel: config.geminiModel,
        preferGemini: geminiQuota.allowed
      });
      await options.scoreStore.replaceReportExtraction(guild.id, reportImage.report.id, {
        ocrEngine: extraction.engine,
        rawOcrText: extraction.rawText,
        ocrConfidence: extraction.confidence,
        rows: extraction.rows.map((row) => ({ ...row, guildId: guild.id }))
      });
      console.info(
        `Score report ${reportImage.report.id} rescanned by ${formatUploader(session)} for guild ${guild.name} (${guild.id}); extracted ${extraction.rows.length} rows with ${extraction.engine}. ${geminiQuota.reason ?? ""}`.trim()
      );
      response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&rescanned=1`);
    } catch (error) {
      response.status(400).type("html").send(renderWebError(error));
    }
  });

  app.get("/auth/discord", (request, response) => {
    if (!config.discordClientId || !config.discordClientSecret) {
      response.status(503).send("Discord login is not configured.");
      return;
    }
    for (const [key, expiresAt] of oauthStates) {
      if (expiresAt < Date.now()) oauthStates.delete(key);
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
    if (!code || !expiresAt || expiresAt < Date.now()) {
      response.status(400).send("Invalid or expired Discord login.");
      return;
    }

    if (!config.discordClientId || !config.discordClientSecret) {
      response.status(400).send("Discord login is not configured.");
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
      await sessions.set(sessionId, {
        user,
        guilds: guilds.filter((guild) => botGuildIds.has(guild.id)),
        csrfToken: randomBytes(24).toString("hex"),
        expiresAt: Date.now() + 24 * 60 * 60_000
      }, Date.now() + 24 * 60 * 60_000);
      response.setHeader("Set-Cookie", sessionCookie(sessionId));
      response.redirect("/");
    } catch {
      response.status(502).type("html").send(renderLoginPage());
    }
  });

  app.get("/logout", async (request, response) => {
    const sessionId = readCookie(request, sessionCookieName());
    if (sessionId) await sessions.delete(sessionId).catch(() => undefined);
    response.setHeader("Set-Cookie", sessionCookie("", 0));
    response.redirect(request.query.next === "/auth/discord" ? "/auth/discord" : "/");
  });

  app.get("/create", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    if (!session) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    if (!guildId) {
      const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
      response.type("html").send(renderCreateServerPickerPage(session, buildGuildDashboardSummaries(session.guilds, events, settings)));
      return;
    }
    if (!canManageGuild(session, guildId)) {
      response.status(403).type("html").send(renderLoginRequiredPage());
      return;
    }
    try {
      const [deliveryOptions, settings] = await Promise.all([fetchGuildDeliveryOptions(guildId), store.getSettings()]);
      response
        .type("html")
        .send(renderCreateRaidPage(guildId, session.csrfToken, session, deliveryOptions, settings.nodeWarChannelIds?.[guildId] ?? config.nodeWarChannelId));
    } catch (error) {
      response.status(502).type("html").send(renderWebError(error));
    }
  });

  app.post("/create", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    if (!session || !canManageGuild(session, guildId) || !validCsrf(request, session)) {
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
      const next = nextScheduledRaid(repeatDays);
      const totalCapacity = getNodeWarCapacity(tier, next.day);
      const event: WarEvent = {
        id: nanoid(10),
        title: buildNodeWarTitle(next.day, tier, totalCapacity),
        kind: "nodewar",
        tier,
        day: next.day,
        repeatDays: recurrence === "weekly" ? repeatDays : undefined,
        date: next.date,
        time: config.nodeWarStartTime,
        timezone: config.timezone,
        recurrence,
        totalCapacity,
        groups: parseGroupAllocation(request.body.groups, totalCapacity),
        announcementDate: previousDate(next.date),
        announcementTime,
        announcementChannelId,
        announcementRoleIds,
        guildId,
        createdBy: `web:${session.user.id}`,
        createdAt: new Date().toISOString(),
        signups: [],
        closed: false,
        active: true,
        autoRepost: recurrence === "weekly"
      };
      await store.createEvent(event);
      response.redirect(`/events/${event.id}/edit?created=1`);
    } catch (error) {
      response.status(400).type("html").send(renderWebError(error));
    }
  });

  app.get("/events/:id", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = await getSession(request, sessions);
    if (!event) {
      response.status(404).type("html").send(renderWebError(new Error("Event not found.")));
      return;
    }

    const canManage = Boolean(event.guildId && session && canManageGuild(session, event.guildId));
    const deliveryOptions = event.guildId ? await fetchGuildDeliveryOptions(event.guildId).catch(() => undefined) : undefined;
    response.type("html").send(renderEventDetailPage(event, canManage, session, deliveryOptions));
  });

  app.get("/events/:id/edit", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = await getSession(request, sessions);
    if (!event || !session || !canManageEvent(event, session)) {
      response.status(404).type("html").send(renderWebError(new Error("Event not found.")));
      return;
    }
    response.type("html").send(renderEditRaidPage(event, session.csrfToken, session));
  });

  app.post("/events/:id/composition", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = await getSession(request, sessions);
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
      const next = nextScheduledRaid(repeatDays);
      const selectedDay = next.day;
      const date = next.date;
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
        autoRepost: recurrence === "weekly" ? event.autoRepost !== false : false,
        repeatDays: recurrence === "weekly" ? repeatDays : undefined,
        day: selectedDay,
        date,
        totalCapacity,
        announcementDate,
        announcementTime,
        ...(date !== event.date ? { signups: [] } : {}),
        ...(scheduleChanged ? { announcedAt: undefined, closed: false } : {})
      });
      await refreshPostedEvent(options, updated);
      response.redirect(`/events/${event.id}/edit?saved=1`);
    } catch (error) {
      response.status(400).type("html").send(renderWebError(error));
    }
  });

  app.post("/events/:id/delete", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = await getSession(request, sessions);
    if (!event || !session || !canManageEvent(event, session) || !validCsrf(request, session)) {
      response.status(403).send("Not authorized.");
      return;
    }
    await store.deleteEvent(event.id);
    response.redirect(`/?guild=${encodeURIComponent(event.guildId ?? "")}`);
  });

  app.post("/events/:id/status", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = await getSession(request, sessions);
    if (!event || !session || !canManageEvent(event, session) || !validCsrf(request, session)) {
      response.status(403).send("Not authorized.");
      return;
    }
    const active = request.body.active === "true";
    await store.updateEventDetails(event.id, {
      active,
      ...(active && event.recurrence === "once" ? { announcedAt: undefined, closed: false } : {})
    });
    response.redirect(`/?guild=${encodeURIComponent(event.guildId ?? "")}`);
  });

  app.post("/events/:id/auto-repost", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = await getSession(request, sessions);
    if (!event || !session || !canManageEvent(event, session) || !validCsrf(request, session)) {
      response.status(403).send("Not authorized.");
      return;
    }
    await store.updateEventDetails(event.id, { autoRepost: request.body.autoRepost === "true" });
    response.redirect(`/?guild=${encodeURIComponent(event.guildId ?? "")}`);
  });

  app.post("/events/:id/signups/move", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = await getSession(request, sessions);
    if (!event || !session || !canManageEvent(event, session) || !validCsrf(request, session)) {
      response.status(403).json({ error: "Not authorized." });
      return;
    }

    try {
      const userId = typeof request.body.userId === "string" ? request.body.userId : "";
      const group = typeof request.body.group === "string" ? request.body.group : "";
      const updatedEvent = await store.moveSignup(event.id, userId, group);
      await refreshPostedEvent(options, updatedEvent);
      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Could not move signup." });
    }
  });

  app.get("/api/events", async (_request, response) => {
    response.status(403).json({ error: "Server-scoped event listing requires Discord login." });
  });

  app.get("/api/events/:id", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = await getSession(request, sessions);
    if (!event || !event.guildId || !session?.guilds.some((guild) => guild.id === event.guildId)) {
      response.status(404).json({ error: "Event not found." });
      return;
    }
    response.json(event);
  });

  return app;
}
