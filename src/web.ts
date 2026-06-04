import express from "express";
import multer from "multer";
import { randomBytes } from "node:crypto";
import type { Request } from "express";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { getGroupEmoji, getGroupEmojiUrl, getGroupLabel } from "./emojis.js";
import { buildNodeWarTitle, getNodeWarCapacity, labelTier, labelWarDay, NODE_WAR_PRESETS } from "./nodewar-presets.js";
import { extractScoreScreenshot } from "./score-ocr.js";
import type { ScoreStore } from "./score-store.js";
import type { ScoreReport, ScoreReportResult, ScoreRow } from "./score-types.js";
import { activeRosterCapacity, activeRosterSignupCount, isRosterGroup, type EventStore } from "./store.js";
import { formatClockTime } from "./time-format.js";
import { WEEKDAYS, type GroupConfig, type GroupKey, type NodeWarTier, type WarDay, type WarEvent } from "./types.js";
import { createWebSessionStore, type WebSessionStore } from "./web-session-store.js";

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

interface PlayerScoreAggregate {
  familyName: string;
  participations: number;
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  damageTaken: number;
  crowdControls: number;
  hpHealed: number;
  allySupport: number;
  structureDamage: number;
  resurrections: number;
}

type ScoreSortKey = "wars" | "kills" | "damage";

interface WebAppOptions {
  onEventUpdated?: (event: WarEvent) => Promise<void>;
  scoreStore?: ScoreStore;
}

interface WebSession {
  user: UserProfile;
  guilds: DiscordGuild[];
  csrfToken: string;
  expiresAt: number;
}

const WEB_WAR_DAYS: WarDay[] = [...WEEKDAYS];
const scoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});
const scoreGeminiQuota = createScoreGeminiQuota();

interface ScoreGeminiQuotaResult {
  allowed: boolean;
  reason?: string;
}

interface ScoreGeminiQuota {
  userMinute: Map<string, { windowStart: number; count: number }>;
  guildDay: Map<string, { day: string; count: number }>;
}

function createScoreGeminiQuota(): ScoreGeminiQuota {
  return {
    userMinute: new Map(),
    guildDay: new Map()
  };
}

function consumeScoreGeminiQuota(userId: string, guildId: string): ScoreGeminiQuotaResult {
  if (!config.geminiApiKey) return { allowed: false, reason: "Gemini API key not configured; used Tesseract fallback." };

  const userLimit = Math.max(0, config.geminiUserMinuteLimit);
  const guildLimit = Math.max(0, config.geminiGuildDayLimit);
  if (userLimit === 0 || guildLimit === 0) return { allowed: false, reason: "Gemini quota disabled; used Tesseract fallback." };

  const now = Date.now();
  const userBucket = scoreGeminiQuota.userMinute.get(userId);
  if (userBucket && now - userBucket.windowStart < 60_000 && userBucket.count >= userLimit) {
    return { allowed: false, reason: `Gemini user minute limit reached (${userLimit}/minute); used Tesseract fallback.` };
  }

  const today = getPacificDateKey(new Date(now));
  const guildBucket = scoreGeminiQuota.guildDay.get(guildId);
  if (guildBucket?.day === today && guildBucket.count >= guildLimit) {
    return { allowed: false, reason: `Gemini server daily limit reached (${guildLimit}/day); used Tesseract fallback.` };
  }

  if (!userBucket || now - userBucket.windowStart >= 60_000) {
    scoreGeminiQuota.userMinute.set(userId, { windowStart: now, count: 1 });
  } else {
    userBucket.count += 1;
  }

  if (!guildBucket || guildBucket.day !== today) {
    scoreGeminiQuota.guildDay.set(guildId, { day: today, count: 1 });
  } else {
    guildBucket.count += 1;
  }

  return { allowed: true };
}

function getPacificDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
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
    const events = guild ? (await store.listEvents()).filter((event) => event.guildId === guild.id) : [];
    response.type("html").send(renderPage("NW Helper", renderEventList(events, session, guildId)));
  });

  app.get("/stats", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session) {
      response.status(403).type("html").send(renderPage("Stats", renderLoginRequired()));
      return;
    }

    if (!guild) {
      response.type("html").send(renderPage("Stats", renderStatsServerPicker(session)));
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
      response.type("html").send(renderPage("Stats", renderStatsDashboard(guild, session, reports, notice, sortKey)));
    } catch (error) {
      response.status(502).type("html").send(renderPage("Stats", renderWebError(error)));
    }
  });

  app.post("/stats/upload", scoreUpload.single("screenshot"), async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !validCsrf(request, session) || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      const file = request.file;
      if (!file || !isAllowedScoreImage(file.mimetype, file.originalname)) {
        throw new Error("Upload a PNG, JPG, or WebP scoreboard screenshot.");
      }

      const geminiQuota = consumeScoreGeminiQuota(session.user.id, guild.id);
      const extraction = await extractScoreScreenshot(file.buffer, {
        mimeType: file.mimetype,
        geminiApiKey: geminiQuota.allowed ? config.geminiApiKey : undefined,
        geminiModel: config.geminiModel,
        preferGemini: geminiQuota.allowed
      });
      const warDate = parseScoreDate(request.body.warDate);
      const result = parseScoreResult(request.body.result);
      const uploadedBy = formatUploader(session);
      await options.scoreStore.createReport({
        guildId: guild.id,
        warDate,
        result,
        title: parseOptionalText(request.body.title, 120),
        imageMimeType: file.mimetype,
        imageOriginalName: file.originalname,
        imageBuffer: file.buffer,
        ocrEngine: extraction.engine,
        rawOcrText: extraction.rawText,
        ocrConfidence: extraction.confidence,
        uploadedBy,
        rows: extraction.rows.map((row) => ({ ...row, guildId: guild.id }))
      });
      console.info(
        `Score screenshot uploaded by ${uploadedBy} for guild ${guild.name} (${guild.id}); extracted ${extraction.rows.length} rows with ${extraction.engine}. ${geminiQuota.reason ?? ""}`.trim()
      );

      response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&uploaded=1`);
    } catch (error) {
      response.status(400).type("html").send(renderPage("Stats upload failed", renderWebError(error)));
    }
  });

  app.get("/stats/reports/:id/edit", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = typeof request.query.guild === "string" ? request.query.guild : "";
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      const report = await options.scoreStore.getReport(guild.id, request.params.id);
      if (!report) {
        response.status(404).send("Score report not found.");
        return;
      }
      response.type("html").send(renderPage("Edit scoreboard", renderScoreReportEditor(guild, session, report)));
    } catch (error) {
      response.status(400).type("html").send(renderPage("Stats edit failed", renderWebError(error)));
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
      response.status(400).type("html").send(renderPage("Stats preview failed", renderWebError(error)));
    }
  });

  app.post("/stats/reports/:id/edit", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !validCsrf(request, session) || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      const rows = parseScoreRowsFromForm(request.body);
      if (!rows.length) throw new Error("Keep at least one score row.");
      await options.scoreStore.updateReport(guild.id, request.params.id, {
        warDate: parseScoreDate(request.body.warDate),
        result: parseScoreResult(request.body.result),
        title: parseOptionalText(request.body.title, 120),
        rows: rows.map((row) => ({ ...row, guildId: guild.id }))
      });
      console.info(`Score report ${request.params.id} manually edited by ${formatUploader(session)} for guild ${guild.name} (${guild.id}); saved ${rows.length} rows.`);
      response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&saved=1`);
    } catch (error) {
      response.status(400).type("html").send(renderPage("Stats edit failed", renderWebError(error)));
    }
  });

  app.post("/stats/players/rename", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !validCsrf(request, session) || !options.scoreStore) {
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
      response.status(400).type("html").send(renderPage("Stats player rename failed", renderWebError(error)));
    }
  });

  app.post("/stats/reports/:id/delete", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !validCsrf(request, session) || !options.scoreStore) {
      response.status(403).send("Not authorized.");
      return;
    }

    try {
      await options.scoreStore.deleteReport(guild.id, request.params.id);
      console.info(`Score report ${request.params.id} deleted by ${formatUploader(session)} for guild ${guild.name} (${guild.id}).`);
      response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&deleted=1`);
    } catch (error) {
      response.status(400).type("html").send(renderPage("Stats delete failed", renderWebError(error)));
    }
  });

  app.post("/stats/reports/:id/rescan", async (request, response) => {
    const session = await getSession(request, sessions);
    const guildId = String(request.body.guildId ?? "");
    const guild = session?.guilds.find((candidate) => candidate.id === guildId);
    if (!session || !guild || !validCsrf(request, session) || !options.scoreStore) {
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
      response.status(400).type("html").send(renderPage("Stats rescan failed", renderWebError(error)));
    }
  });

  app.get("/auth/discord", (_request, response) => {
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
      await sessions.set(sessionId, {
        user,
        guilds: guilds.filter((guild) => hasAdministratorPermission(guild.permissions) && botGuildIds.has(guild.id)),
        csrfToken: randomBytes(24).toString("hex"),
        expiresAt: Date.now() + 24 * 60 * 60_000
      }, Date.now() + 24 * 60 * 60_000);
      response.setHeader("Set-Cookie", sessionCookie(sessionId));
      response.redirect("/");
    } catch {
      response.status(502).type("html").send(renderPage("Login failed", renderLoginError()));
    }
  });

  app.get("/logout", async (request, response) => {
    const sessionId = readCookie(request, sessionCookieName());
    if (sessionId) await sessions.delete(sessionId).catch(() => undefined);
    response.setHeader("Set-Cookie", sessionCookie("", 0));
    response.redirect("/");
  });

  app.get("/create", async (request, response) => {
    const session = await getSession(request, sessions);
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
    const session = await getSession(request, sessions);
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
      response.status(400).type("html").send(renderPage("Create Raid", renderWebError(error)));
    }
  });

  app.get("/events/:id", async (request, response) => {
    const event = await store.getEvent(request.params.id);
    const session = await getSession(request, sessions);
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
    const session = await getSession(request, sessions);
    if (!event || !session || !canManageEvent(event, session)) {
      response.status(404).type("html").send(renderPage("Not found", "<main><h1>Event not found</h1></main>"));
      return;
    }
    response.type("html").send(renderPage(`Edit ${event.title}`, renderEditRaid(event, session.csrfToken, session)));
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
      response.status(400).type("html").send(renderPage("Composition update failed", renderWebError(error)));
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

function formatUploader(session: WebSession): string {
  const name = session.user.global_name ?? session.user.username;
  return `${name} (${session.user.id})`;
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
  return Boolean(event.guildId && session.guilds.some((guild) => guild.id === event.guildId));
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

function setSecurityHeaders(_request: Request, response: express.Response, next: express.NextFunction): void {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' https://cdn.discordapp.com data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
  );
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
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
  const visibleEvents = events.filter((event) => !event.closed || (event.recurrence === "once" && event.active === false));
  const activeEvents = visibleEvents.filter(isEventActive);
  const totalSignups = activeEvents.reduce((sum, event) => sum + activeRosterSignupCount(event), 0);
  const weeklyPosts = activeEvents.filter((event) => event.recurrence === "weekly").length;
  const nextAnnouncement = [...activeEvents]
    .filter((event) => event.announcementDate && event.announcementTime && !event.announcedAt)
    .sort((left, right) => `${left.announcementDate} ${left.announcementTime}`.localeCompare(`${right.announcementDate} ${right.announcementTime}`))[0];
  const cards = visibleEvents
    .map((event) => {
      const signed = activeRosterSignupCount(event);
      const capacity = activeRosterCapacity(event);
      const active = isEventActive(event);
      const autoRepost = event.autoRepost ?? event.recurrence === "weekly";
      return `<article class="event-card group relative overflow-hidden">
        <div class="card-top"><span class="type-pill">${event.tier ? labelTier(event.tier) : event.kind === "siege" ? "Siege" : "Node War"}</span><span class="status-pill ${active ? "status-active" : "status-inactive"}">${active ? "Active" : "Inactive"}</span></div>
        <a class="event-title" href="/events/${event.id}"><strong>${escapeHtml(scheduleTitle(event))}</strong></a>
        <small>Created ${formatDateLabel(event.createdAt.slice(0, 10))}</small>
        <small>Current roster ${escapeHtml(event.title)}</small>
        <small>Following signup post ${formatAnnouncementLabel(event)}</small>
        <small>War starts ${formatClockTime(event.time)} ${escapeHtml(config.timezone)}</small>
        <small>Schedule ${labelRecurrence(event.recurrence)} | ${formatRaidDays(event)}</small>
        <span class="card-meter"><i style="width:${capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0}%"></i></span>
        <div class="card-switches">${session ? `${renderCardToggle(event, session.csrfToken, "status", "Status", active)}${renderCardToggle(event, session.csrfToken, "auto-repost", "Auto repost", autoRepost, event.recurrence !== "weekly")}` : ""}</div>
        <div class="card-footer"><b>${signed}/${capacity} signed</b><span class="card-actions"><a href="/events/${event.id}">Open</a><a href="/events/${event.id}/edit">Manage</a>${session ? `<form method="post" action="/events/${event.id}/delete" onsubmit="return confirm('Delete this raid event?')"><input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}"><button class="link-button danger-link" type="submit">Delete</button></form>` : ""}</span></div>
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
      ${renderStat("Next announcement", nextAnnouncement ? `${formatDateLabel(nextAnnouncement.announcementDate as string)} ${formatClockTime(nextAnnouncement.announcementTime as string)}` : "None queued")}
    </section>` : ""}
    ${serverPicker}
    ${selectedGuild ? `<section class="event-grid">${cards || "<div class=\"empty-state\"><h2>No raids scheduled</h2><p>Create a roster or use the Discord wizard to get started.</p></div>"}</section>` : !session ? `<section class="empty-state welcome-state"><p class="eyebrow">Self-hosted raid planning</p><h1>Node War rosters without the clutter.</h1><p>Log in with Discord to manage shared servers, schedules, and compositions.</p><div class="button-row">${renderAccountControls()}${renderInviteButton()}</div></section>` : ""}
  </main>`;
}

function renderCardToggle(event: WarEvent, csrfToken: string, action: "status" | "auto-repost", label: string, enabled: boolean, disabled = false): string {
  const field = action === "status" ? "active" : "autoRepost";
  return `<form method="post" action="/events/${event.id}/${action}"><input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}"><input type="hidden" name="${field}" value="${enabled ? "false" : "true"}"><button class="switch-button${enabled ? " switch-on" : ""}" type="submit"${disabled ? " disabled" : ""}><span>${escapeHtml(label)}</span><i></i><b>${enabled ? "On" : "Off"}</b></button></form>`;
}

function renderNav(session?: WebSession, guildId?: string): string {
  const selectedGuild = session?.guilds.find((guild) => guild.id === guildId);
  const raidsHref = guildId ? `/?guild=${encodeURIComponent(guildId)}` : "/";
  const createHref = guildId ? `/create?guild=${encodeURIComponent(guildId)}` : "/create";
  const statsHref = guildId ? `/stats?guild=${encodeURIComponent(guildId)}` : "/stats";
  return `<aside class="app-nav">
    <div class="nav-brand-row"><a class="brand" href="${raidsHref}"><span>NW</span><strong>NW Helper</strong></a><button class="nav-collapse-button" type="button" aria-label="Toggle navigation" onclick="document.body.classList.toggle('nav-collapsed')"><span></span><span></span><span></span></button></div>
    <nav>
      <details class="nav-group" open><summary><i>R</i><span>Raids</span></summary><div>
        <a href="${raidsHref}"><i>R</i><span>Raid board</span></a>
        ${guildId ? `<a href="${createHref}"><i>+</i><span>Create raid</span></a>` : ""}
      </div></details>
      <a href="${statsHref}"><i>S</i><span>Stats</span></a>
      ${session ? renderServerNav(session, selectedGuild) : `<a href="/"><i>H</i><span>Home</span></a>`}
    </nav>
    <div class="nav-actions">${renderAccountControls(session, guildId)}</div>
  </aside>`;
}

function renderServerNav(session: WebSession, selectedGuild?: DiscordGuild): string {
  const label = selectedGuild?.name ?? "Servers";
  const servers = session.guilds
    .map(
      (guild) => `<a href="/?guild=${encodeURIComponent(guild.id)}">${renderGuildAvatar(guild)}<span><b>${escapeHtml(guild.name)}</b><small>Raids</small></span></a><a href="/stats?guild=${encodeURIComponent(guild.id)}"><i>S</i><span><b>${escapeHtml(guild.name)}</b><small>Stats</small></span></a>`
    )
    .join("");
  return `<details class="nav-group server-nav" ${selectedGuild ? "open" : ""}><summary><i>V</i><span>${escapeHtml(label)}</span></summary><div>${servers || "<span class=\"nav-empty\">No servers found</span>"}</div></details>`;
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

function renderStatsServerPicker(session: WebSession): string {
  return `${renderNav(session)}<main class="shell">
    <section class="server-picker">
      <header><p class="eyebrow">War stats</p><h1>Select a server</h1><p>Open uploaded scoreboards and performance history for one Discord server.</p></header>
      <div class="server-grid">${session.guilds
        .map(
          (guild) =>
            `<a class="server-card group transition duration-200 ease-out" href="/stats?guild=${encodeURIComponent(guild.id)}">${renderGuildAvatar(guild)}<span><strong>${escapeHtml(guild.name)}</strong><small>Open stats dashboard</small></span><b>Stats</b></a>`
        )
        .join("") || "<p>No shared administrator servers found.</p>"}</div>
    </section>
  </main>`;
}

function renderStatsDashboard(
  guild: DiscordGuild,
  session: WebSession,
  reports: ScoreReport[],
  notice?: "uploaded" | "rescanned" | "saved" | "deleted" | "renamed",
  sortKey: ScoreSortKey = "wars"
): string {
  const rows = reports.flatMap((report) => report.rows);
  const players = sortScoreAggregates(aggregateScoreRows(rows), sortKey);
  const latest = reports[0];
  const topDamage = Math.max(1, ...players.map((player) => player.damageDealt));
  const totalKills = rows.reduce((sum, row) => sum + row.kills, 0);
  const totalDeaths = rows.reduce((sum, row) => sum + row.deaths, 0);

  return `${renderNav(session, guild.id)}<main class="shell stats-shell">
    <section class="dashboard-head">
      <div class="guild-heading">${renderGuildAvatar(guild)}<div><p class="eyebrow">War stats</p><h1>${escapeHtml(guild.name)}</h1><p>Uploaded scoreboards, player participation, and performance trends.</p></div></div>
      <a class="button button-secondary" href="/?guild=${encodeURIComponent(guild.id)}">Raids</a>
    </section>
    ${notice ? `<section class="notice">${renderStatsNotice(notice)}</section>` : ""}
    <section class="stats-row">
      ${renderStat("Scoreboards", String(reports.length))}
      ${renderStat("Players tracked", String(players.length))}
      ${renderStat("Total kills", formatStatNumber(totalKills))}
      ${renderStat("Team K/D", totalDeaths ? (totalKills / totalDeaths).toFixed(2) : formatStatNumber(totalKills))}
      ${renderStat("Latest war", latest ? formatDateLabel(latest.warDate) : "No uploads")}
    </section>
    <section class="stats-workspace">
      <form class="stats-upload-panel" method="post" action="/stats/upload" enctype="multipart/form-data">
        <input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}">
        <input type="hidden" name="guildId" value="${escapeHtml(guild.id)}">
        <header><p class="eyebrow">Screenshot OCR</p><h2>Upload Scoreboard</h2></header>
        <label>War date<input type="date" name="warDate" value="${new Date().toISOString().slice(0, 10)}" required></label>
        <label>Result<select name="result"><option value="unknown">Unknown</option><option value="win">Win</option><option value="loss">Loss</option></select></label>
        <label>Title<input name="title" maxlength="120" placeholder="Optional war label"></label>
        <label>Screenshot<input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp" required></label>
        <button type="submit">Upload and scan</button>
      </form>
    </section>
    <section class="stats-analysis-panel">
      <header><p class="eyebrow">Player analysis</p><h2>Participation and performance</h2></header>
      ${players.length ? `${renderScoreGraphics(players, reports)}${renderScoreTable(players, topDamage, sortKey, guild.id, session.csrfToken)}` : "<div class=\"empty-state compact-empty\"><h2>No score data yet</h2><p>Upload a scoreboard screenshot to start tracking player performance.</p></div>"}
    </section>
    <section class="section-title stats-title"><div><p class="eyebrow">Reports</p><h2>Recent scoreboards</h2></div><span>${reports.length} stored</span></section>
    <section class="report-grid">${reports.slice(0, 8).map((report) => renderReportCard(report, session.csrfToken)).join("") || "<div class=\"empty-state compact-empty\"><h2>No reports stored</h2><p>Uploaded screenshots will appear here.</p></div>"}</section>
  </main>`;
}

function renderStatsNotice(notice: "uploaded" | "rescanned" | "saved" | "deleted" | "renamed"): string {
  if (notice === "uploaded") return "Scoreboard uploaded and parsed. Review the extracted rows before using them for final calls.";
  if (notice === "rescanned") return "Scoreboard rescanned from the stored image. Review the extracted rows before using them for final calls.";
  if (notice === "saved") return "Scoreboard edits saved.";
  if (notice === "renamed") return "Player name updated across matching score rows.";
  return "Scoreboard deleted.";
}

function renderScoreGraphics(players: PlayerScoreAggregate[], reports: ScoreReport[]): string {
  const totalDamage = players.reduce((sum, player) => sum + player.damageDealt, 0);
  const totalTaken = players.reduce((sum, player) => sum + player.damageTaken, 0);
  const totalSupport = players.reduce((sum, player) => sum + player.allySupport, 0);
  const totalCc = players.reduce((sum, player) => sum + player.crowdControls, 0);
  const totalStructure = players.reduce((sum, player) => sum + player.structureDamage, 0);
  const totalKills = players.reduce((sum, player) => sum + player.kills, 0);
  const totalDeaths = players.reduce((sum, player) => sum + player.deaths, 0);
  const impactTotal = Math.max(1, totalDamage + totalSupport + totalTaken);
  const recentReports = reports.slice(0, 6).reverse();

  return `<section class="score-graphics">
    <div class="score-mix-card">
      <header><p class="eyebrow">Team profile</p><h3>War output mix</h3></header>
      <div class="score-ring" style="--damage:${Math.round((totalDamage / impactTotal) * 100)}%; --support:${Math.round((totalSupport / impactTotal) * 100)}%;"><span>${totalDeaths ? (totalKills / totalDeaths).toFixed(2) : formatStatNumber(totalKills)}</span><small>Team K/D</small></div>
      <div class="mix-bars">
        ${renderMixBar("Damage", totalDamage, impactTotal, "damage")}
        ${renderMixBar("+ Ally Support", totalSupport, impactTotal, "support")}
        ${renderMixBar("Taken", totalTaken, impactTotal, "taken")}
        ${renderMixBar("CCs", totalCc, Math.max(1, totalCc), "cc")}
        ${renderMixBar("Fort Damage", totalStructure, Math.max(1, totalStructure), "cc")}
      </div>
    </div>
    ${renderMetricLeaderboard("Damage leaders", "Pressure", players, (player) => player.damageDealt)}
    ${renderMetricLeaderboard("Support leaders", "+ Allies healed", players, (player) => player.allySupport)}
    ${renderMetricLeaderboard("Fort Damage leaders", "Structure", players, (player) => player.structureDamage)}
    ${renderMetricLeaderboard("CC leaders", "Crowd control", players, (player) => player.crowdControls)}
    <div class="score-trend-card">
      <header><p class="eyebrow">Recent wars</p><h3>Damage trend</h3></header>
      <div class="trend-bars">${recentReports
        .map((report) => {
          const damage = report.rows.reduce((sum, row) => sum + row.damageDealt, 0);
          const maxDamage = Math.max(1, ...recentReports.map((candidate) => candidate.rows.reduce((sum, row) => sum + row.damageDealt, 0)));
          return `<span title="${escapeHtml(report.title || formatDateLabel(report.warDate))}"><i style="height:${Math.max(8, Math.round((damage / maxDamage) * 100))}%"></i><small>${escapeHtml(formatDateLabel(report.warDate).split(",")[0])}</small></span>`;
        })
        .join("")}</div>
    </div>
  </section>`;
}

function renderMixBar(label: string, value: number, total: number, tone: string): string {
  return `<div class="mix-bar mix-${tone}"><span><b>${escapeHtml(label)}</b><small>${formatStatNumber(value)}</small></span><i style="width:${Math.max(3, Math.round((value / total) * 100))}%"></i></div>`;
}

function renderMetricLeaderboard(
  title: string,
  eyebrow: string,
  players: PlayerScoreAggregate[],
  metric: (player: PlayerScoreAggregate) => number
): string {
  const leaders = [...players].sort((left, right) => metric(right) - metric(left)).slice(0, 4);
  const maxValue = Math.max(1, ...leaders.map(metric));
  return `<div class="score-leader-card">
    <header><p class="eyebrow">${escapeHtml(eyebrow)}</p><h3>${escapeHtml(title)}</h3></header>
    <div class="leader-bars">${leaders
      .map((player) => {
        const value = metric(player);
        return `<div><span><b>${escapeHtml(player.familyName)}</b><small>${formatStatNumber(value)}</small></span><i style="width:${Math.max(5, Math.round((value / maxValue) * 100))}%"></i></div>`;
      })
      .join("")}</div>
  </div>`;
}

function renderScoreTable(players: PlayerScoreAggregate[], topDamage: number, sortKey: ScoreSortKey, guildId: string, csrfToken: string): string {
  return `<div class="score-table-wrap"><table class="score-table" data-score-table data-score-sort="${sortKey}">
    <thead><tr><th>${renderScoreSortButton("Player", "player", sortKey)}</th><th>${renderScoreSortButton("Wars", "wars", sortKey)}</th><th>${renderScoreSortButton("K", "kills", sortKey)}</th><th>${renderScoreSortButton("D", "deaths", sortKey)}</th><th>${renderScoreSortButton("K/D", "kd", sortKey)}</th><th>${renderScoreSortButton("Damage", "damage", sortKey)}</th><th>${renderScoreSortButton("Taken", "taken", sortKey)}</th><th>${renderScoreSortButton("CC", "cc", sortKey)}</th><th>${renderScoreSortButton("Healed", "healed", sortKey)}</th><th>${renderScoreSortButton("Structure", "structure", sortKey)}</th></tr></thead>
    <tbody>${players
      .map(
        (player) => {
          const healed = player.allySupport;
          const kd = player.deaths ? player.kills / player.deaths : player.kills;
          return `<tr data-player="${escapeHtml(player.familyName.toLowerCase())}" data-wars="${player.participations}" data-kills="${player.kills}" data-deaths="${player.deaths}" data-kd="${kd}" data-damage="${player.damageDealt}" data-taken="${player.damageTaken}" data-cc="${player.crowdControls}" data-healed="${healed}" data-structure="${player.structureDamage}">
          <td><span class="player-cell"><strong>${escapeHtml(player.familyName)}</strong>${renderPlayerRenameControl(player.familyName, guildId, csrfToken)}</span><span class="damage-bar"><i style="width:${Math.max(4, Math.round((player.damageDealt / topDamage) * 100))}%"></i></span></td>
          <td>${player.participations}</td>
          <td>${formatStatNumber(player.kills)}</td>
          <td>${formatStatNumber(player.deaths)}</td>
          <td>${player.deaths ? kd.toFixed(2) : formatStatNumber(player.kills)}</td>
          <td>${formatStatNumber(player.damageDealt)}</td>
          <td>${formatStatNumber(player.damageTaken)}</td>
          <td>${formatStatNumber(player.crowdControls)}</td>
          <td>${formatStatNumber(healed)}</td>
          <td>${formatStatNumber(player.structureDamage)}</td>
        </tr>`;
        }
      )
      .join("")}</tbody>
  </table></div>${renderScoreSortScript()}`;
}

function renderPlayerRenameControl(familyName: string, guildId: string, csrfToken: string): string {
  return `<details class="player-rename">
    <summary>Edit</summary>
    <form method="post" action="/stats/players/rename">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="guildId" value="${escapeHtml(guildId)}">
      <input type="hidden" name="oldName" value="${escapeHtml(familyName)}">
      <input name="familyName" value="${escapeHtml(familyName)}" maxlength="80" required>
      <button type="submit">Save</button>
    </form>
  </details>`;
}

function renderScoreSortButton(label: string, key: string, sortKey: ScoreSortKey): string {
  const active = key === sortKey ? " active" : "";
  return `<button class="score-sort-button${active}" type="button" data-score-sort-key="${escapeHtml(key)}" aria-label="Sort by ${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}

function renderScoreSortScript(): string {
  return `<script>
(() => {
  const table = document.querySelector("[data-score-table]");
  if (!table) return;
  const tbody = table.tBodies[0];
  const buttons = [...table.querySelectorAll("[data-score-sort-key]")];
  let activeKey = table.dataset.scoreSort || "wars";
  let direction = activeKey === "player" ? "asc" : "desc";
  const readValue = (row, key) => key === "player" ? row.dataset.player || "" : Number(row.dataset[key] || 0);
  const applySort = (key, nextDirection) => {
    const rows = [...tbody.rows];
    rows.sort((left, right) => {
      const leftValue = readValue(left, key);
      const rightValue = readValue(right, key);
      const compared = typeof leftValue === "string" ? leftValue.localeCompare(String(rightValue)) : leftValue - Number(rightValue);
      return nextDirection === "asc" ? compared : -compared;
    });
    rows.forEach((row) => tbody.appendChild(row));
    activeKey = key;
    direction = nextDirection;
    buttons.forEach((button) => {
      const active = button.dataset.scoreSortKey === activeKey;
      button.classList.toggle("active", active);
      button.setAttribute("aria-sort", active ? direction : "none");
    });
  };
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.scoreSortKey || "wars";
      const nextDirection = key === activeKey && direction === "desc" ? "asc" : key === "player" ? "asc" : "desc";
      applySort(key, nextDirection);
    });
  });
})();
</script>`;
}

function renderReportCard(report: ScoreReport, csrfToken: string): string {
  const rows = report.rows;
  const kills = rows.reduce((sum, row) => sum + row.kills, 0);
  const deaths = rows.reduce((sum, row) => sum + row.deaths, 0);
  const damage = rows.reduce((sum, row) => sum + row.damageDealt, 0);
  const killDeathPercent = deaths ? Math.round((kills / deaths) * 100) : kills ? 100 : 0;
  const kdTone = killDeathPercent >= 200 ? "good" : killDeathPercent >= 100 ? "ok" : "low";
  const confidence = report.ocrConfidence === undefined ? "n/a" : `${Math.round(report.ocrConfidence)}%`;
  return `<article class="report-card">
    <div class="report-card-head">
      <p class="eyebrow">${escapeHtml(report.result)}</p>
      <h3>${escapeHtml(report.title || formatDateLabel(report.warDate))}</h3>
      <small>${formatDateLabel(report.warDate)}</small>
      <small>${escapeHtml(report.ocrEngine)}</small>
      <small>OCR ${escapeHtml(confidence)}</small>
      <small>Uploaded by ${escapeHtml(report.uploadedBy ?? "Unknown")}</small>
    </div>
    <dl>
      <div><dt>Players</dt><dd>${rows.length}</dd></div>
      <div><dt>Kills</dt><dd>${formatStatNumber(kills)}</dd></div>
      <div><dt>Deaths</dt><dd>${formatStatNumber(deaths)}</dd></div>
      <div><dt>K/D %</dt><dd><span class="kd-pill kd-${kdTone}">${killDeathPercent}%</span></dd></div>
      <div><dt>Damage</dt><dd>${formatStatNumber(damage)}</dd></div>
    </dl>
    <div class="report-actions">
      <a class="button button-secondary" href="/stats/reports/${encodeURIComponent(report.id)}/preview?guild=${encodeURIComponent(report.guildId)}" target="_blank" rel="noopener">Preview</a>
      <a class="button button-secondary" href="/stats/reports/${encodeURIComponent(report.id)}/edit?guild=${encodeURIComponent(report.guildId)}">Edit</a>
      <form method="post" action="/stats/reports/${encodeURIComponent(report.id)}/rescan">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
        <input type="hidden" name="guildId" value="${escapeHtml(report.guildId)}">
        <button class="button button-secondary" type="submit">Rescan</button>
      </form>
      <form method="post" action="/stats/reports/${encodeURIComponent(report.id)}/delete" onsubmit="return confirm('Delete this scoreboard and uploaded image?')">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
        <input type="hidden" name="guildId" value="${escapeHtml(report.guildId)}">
        <button class="button button-secondary danger-button" type="submit">Delete</button>
      </form>
    </div>
  </article>`;
}

function renderScoreReportEditor(guild: DiscordGuild, session: WebSession, report: ScoreReport): string {
  const rows = [...report.rows, ...Array.from({ length: 3 }, () => undefined)];
  return `${renderNav(session, guild.id)}<main class="shell stats-shell">
    <section class="dashboard-head">
      <div class="guild-heading">${renderGuildAvatar(guild)}<div><p class="eyebrow">Edit scoreboard</p><h1>${escapeHtml(report.title || formatDateLabel(report.warDate))}</h1><p>Correct OCR rows and save the scoreboard totals.</p></div></div>
      <a class="button button-secondary" href="/stats?guild=${encodeURIComponent(guild.id)}">Stats</a>
    </section>
    <form class="score-edit-form" method="post" action="/stats/reports/${encodeURIComponent(report.id)}/edit">
      <input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}">
      <input type="hidden" name="guildId" value="${escapeHtml(guild.id)}">
      <section class="stats-upload-panel score-edit-meta">
        <label>War date<input type="date" name="warDate" value="${escapeHtml(report.warDate)}" required></label>
        <label>Result<select name="result">${renderScoreResultOptions(report.result)}</select></label>
        <label>Title<input name="title" maxlength="120" value="${escapeHtml(report.title ?? "")}"></label>
        <button type="submit">Save edits</button>
      </section>
      <section class="score-edit-grid">${rows.map((row, index) => renderScoreEditCard(row, index)).join("")}</section>
      <div class="detail-actions"><a class="button button-secondary" href="/stats?guild=${encodeURIComponent(guild.id)}">Cancel</a><button type="submit">Save edits</button></div>
    </form>
  </main>`;
}

function renderScoreResultOptions(selected: ScoreReportResult): string {
  return (["unknown", "win", "loss"] as ScoreReportResult[])
    .map((result) => `<option value="${result}"${selected === result ? " selected" : ""}>${result[0].toUpperCase()}${result.slice(1)}</option>`)
    .join("");
}

function renderScoreEditCard(row: ScoreRow | undefined, index: number): string {
  const title = row?.familyName || `New row ${index + 1}`;
  return `<article class="score-edit-card">
    <header><span>${escapeHtml(String(index + 1).padStart(2, "0"))}</span>${renderScoreEditField("Player", "familyName", row?.familyName ?? "", "text", "Family name")}</header>
    <div class="score-edit-group score-edit-core">
      ${renderScoreEditField("K", "kills", row?.kills ?? 0)}
      ${renderScoreEditField("D", "deaths", row?.deaths ?? 0)}
      ${renderScoreEditField("A", "assists", row?.assists ?? 0)}
    </div>
    <div class="score-edit-group">
      ${renderScoreEditField("Damage", "damageDealt", row?.damageDealt ?? 0)}
      ${renderScoreEditField("Taken", "damageTaken", row?.damageTaken ?? 0)}
      ${renderScoreEditField("Structure", "structureDamage", row?.structureDamage ?? 0)}
    </div>
    <div class="score-edit-group">
      ${renderScoreEditField("CC", "crowdControls", row?.crowdControls ?? 0)}
      ${renderScoreEditField("Healed", "hpHealed", row?.hpHealed ?? 0)}
      ${renderScoreEditField("Allies", "allySupport", row?.allySupport ?? 0)}
      ${renderScoreEditField("Revives", "resurrections", row?.resurrections ?? 0)}
    </div>
    <div class="score-edit-group">
      ${renderScoreEditField("Lynch", "lynchCannonKills", row?.lynchCannonKills ?? 0)}
      ${renderScoreEditField("Siege", "siegeAssists", row?.siegeAssists ?? 0)}
      ${renderScoreEditField("Siege D", "siegeDeaths", row?.siegeDeaths ?? 0)}
      ${renderScoreEditField("Special", "specialKills", row?.specialKills ?? 0)}
      ${renderScoreEditField("Alive", "timeAlive", row?.timeAlive ?? "", "text", "00:00")}
      ${renderScoreEditField("Total", "totalWarTime", row?.totalWarTime ?? "", "text", "00:00")}
    </div>
    <small>${escapeHtml(title)}</small>
  </article>`;
}

function renderScoreEditField(label: string, name: string, value: string | number, type = "number", placeholder = "0"): string {
  return `<label>${escapeHtml(label)}<input name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(String(value))}" placeholder="${escapeHtml(placeholder)}"${type === "number" ? " min=\"0\" step=\"1\"" : ""}></label>`;
}

function aggregateScoreRows(rows: ScoreRow[]): PlayerScoreAggregate[] {
  const byPlayer = new Map<string, PlayerScoreAggregate>();
  for (const row of rows) {
    const key = row.familyName.toLowerCase();
    const player =
      byPlayer.get(key) ??
      {
        familyName: row.familyName,
        participations: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        damageDealt: 0,
        damageTaken: 0,
        crowdControls: 0,
        hpHealed: 0,
        allySupport: 0,
        structureDamage: 0,
        resurrections: 0
      };
    player.participations += 1;
    player.kills += row.kills;
    player.deaths += row.deaths;
    player.assists += row.assists;
    player.damageDealt += row.damageDealt;
    player.damageTaken += row.damageTaken;
    player.crowdControls += row.crowdControls;
    player.hpHealed += row.hpHealed;
    player.allySupport += row.allySupport;
    player.structureDamage += row.structureDamage;
    player.resurrections += row.resurrections;
    byPlayer.set(key, player);
  }

  return [...byPlayer.values()].sort(
    (left, right) =>
      right.participations - left.participations ||
      right.damageDealt - left.damageDealt ||
      right.kills - left.kills ||
      left.familyName.localeCompare(right.familyName)
  );
}

function sortScoreAggregates(players: PlayerScoreAggregate[], sortKey: ScoreSortKey): PlayerScoreAggregate[] {
  return [...players].sort((left, right) => {
    if (sortKey === "kills") return right.kills - left.kills || right.damageDealt - left.damageDealt || left.familyName.localeCompare(right.familyName);
    if (sortKey === "damage") return right.damageDealt - left.damageDealt || right.kills - left.kills || left.familyName.localeCompare(right.familyName);
    return right.participations - left.participations || right.damageDealt - left.damageDealt || right.kills - left.kills || left.familyName.localeCompare(right.familyName);
  });
}

function parseScoreSortKey(value: unknown): ScoreSortKey {
  return value === "kills" || value === "damage" ? value : "wars";
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
  const signed = activeRosterSignupCount(event);
  const guild = session?.guilds.find((candidate) => candidate.id === event.guildId);

  return `${renderNav(session, event.guildId)}<main class="shell detail-shell">
    <section class="event-summary">
      <div>
        <p class="eyebrow">${event.tier ? `${labelTier(event.tier)} schedule` : event.kind === "siege" ? "Siege schedule" : "Node War schedule"}</p>
        <h1>${escapeHtml(scheduleTitle(event))}</h1>
        <div class="summary-meta"><span>Created ${formatDateLabel(event.createdAt.slice(0, 10))}</span><span>${formatClockTime(event.time)} war start</span><span>${labelRecurrence(event.recurrence)}</span><span>Status: ${isEventActive(event) ? "Active" : "Inactive"}</span><span>Auto repost: ${(event.autoRepost ?? event.recurrence === "weekly") ? "On" : "Off"}</span></div>
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
    <section class="section-title roster-title"><div><p class="eyebrow">Current roster</p><h2>${escapeHtml(event.title)}</h2></div><span>${formatDateLabel(event.date)} | ${formatClockTime(event.time)}</span></section>
    <section class="roster-grid">${renderRosterColumns(event, canManage)}</section>
  </main>${canManage && session ? renderRosterMoveScript(event.id, session.csrfToken) : ""}`;
}

function renderCurrentRosterSummary(event: WarEvent): string {
  const signed = activeRosterSignupCount(event);
  const postStatus = event.announcedAt
    ? "Signup post sent"
    : event.announcementDate && event.announcementTime
      ? `Queues ${formatDateLabel(event.announcementDate)} ${formatClockTime(event.announcementTime)}`
      : "Not queued";
  return `<section class="current-roster-summary">
    <div><p class="eyebrow">Current live roster</p><h2>${escapeHtml(event.title)}</h2><p>This remains the active signup roster until the one-hour Node War ends.</p></div>
    <dl>
      <div><dt>War date</dt><dd>${formatDateLabel(event.date)}</dd></div>
      <div><dt>War time</dt><dd>${formatClockTime(event.time)}</dd></div>
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
      <div><dt>Post time</dt><dd>${formatClockTime(event.announcementTime ?? config.nodeWarPostTime)} ${escapeHtml(config.timezone)}</dd></div>
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
  return `<section class="day-section"><div class="section-title"><div><p class="eyebrow">Schedule</p><h2>${event.recurrence === "weekly" ? "Weekly raid days" : "Raid day"}</h2></div><span>Announces ${formatClockTime(event.announcementTime ?? config.nodeWarPostTime)}</span></div><div class="day-rail">${days
    .map(
      (day) => `<article class="day-card relative overflow-hidden">
        <span>${labelWarDay(day).slice(0, 3)}</span>
        <strong>${labelWarDay(day)}</strong>
        <small>${event.tier ? NODE_WAR_PRESETS[event.tier].territoryGroup : event.kind}</small>
        <dl><div><dt>Roster</dt><dd>${day === event.day ? `${activeRosterSignupCount(event)}/${activeRosterCapacity(event)} signed` : "Fresh roster"}</dd></div><div><dt>War</dt><dd>${formatClockTime(event.time)}</dd></div><div><dt>Post</dt><dd>${formatClockTime(event.announcementTime ?? config.nodeWarPostTime)}</dd></div></dl>
      </article>`
    )
    .join("") || "<p>No raid days selected.</p>"}</div></section>`;
}

function renderRosterColumns(event: WarEvent, canManage = false): string {
  return orderedGroups(event)
    .map((group) => {
      const signups = event.signups.filter((signup) => signup.group === group.key);
      return `<section class="roster-column${canManage ? " roster-dropzone" : ""}" data-group="${escapeHtml(group.key)}">
        <header><h2>${renderGroupIcon(group.key, group.emoji)}${escapeHtml(group.label)}</h2><b>${isRosterGroup(group.key) ? `${signups.length}/${group.capacity}` : signups.length}</b></header>
        <div class="signup-list">${signups
          .map(
            (signup, index) => `<div class="signup-row${canManage ? " draggable-signup" : ""}" data-user-id="${escapeHtml(signup.userId)}" data-group="${escapeHtml(group.key)}"${canManage ? " draggable=\"true\" title=\"Drag to move role\"" : ""}><span class="class-badge">${renderSignupIcon(event, group.key, signup.requestedGroup)}</span><span class="slot">${index + 1}</span><span class="name">${escapeHtml(signup.displayName)}</span></div>`
          )
          .join("") || "<p class=\"empty\">No signups yet</p>"}</div>
      </section>`;
    })
    .join("");
}

function renderRosterMoveScript(eventId: string, csrfToken: string): string {
  return `<script>
    (() => {
      const eventId = ${JSON.stringify(eventId)};
      const csrfToken = ${JSON.stringify(csrfToken)};
      let draggedRow;

      document.querySelectorAll(".draggable-signup").forEach((row) => {
        row.addEventListener("dragstart", (event) => {
          draggedRow = row;
          if (!draggedRow || !event.dataTransfer) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", draggedRow.dataset.userId || "");
          draggedRow.classList.add("is-dragging");
        });

        row.addEventListener("dragend", () => {
          draggedRow?.classList.remove("is-dragging");
          document.querySelectorAll(".roster-dropzone.is-drag-over").forEach((zone) => zone.classList.remove("is-drag-over"));
          draggedRow = undefined;
        });
      });

      document.querySelectorAll(".roster-dropzone").forEach((zone) => {
        zone.addEventListener("dragover", (event) => {
          if (!draggedRow || draggedRow.dataset.group === zone.dataset.group) return;
          event.preventDefault();
          zone.classList.add("is-drag-over");
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        });

        zone.addEventListener("dragleave", (event) => {
          if (!zone.contains(event.relatedTarget)) {
            zone.classList.remove("is-drag-over");
          }
        });

        zone.addEventListener("drop", async (event) => {
          event.preventDefault();
          zone.classList.remove("is-drag-over");
          const userId = event.dataTransfer?.getData("text/plain") || draggedRow?.dataset.userId;
          const group = zone.dataset.group;
          if (!userId || !group || draggedRow?.dataset.group === group) return;

          zone.classList.add("is-saving");
          try {
            const response = await fetch(\`/events/\${eventId}/signups/move\`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ csrfToken, userId, group })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || "Could not move signup.");
            window.location.reload();
          } catch (error) {
            alert(error instanceof Error ? error.message : "Could not move signup.");
          } finally {
            zone.classList.remove("is-saving");
          }
        });
      });
    })();
  </script>`;
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
  const order = ["mainball", "defense", "zerker", "shai", "bench", "tentative", "absence"];
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
      ${renderAllocationEditor(event.groups.filter((group) => isRosterGroup(group.key)))}
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

function parseScoreDate(value: unknown): string {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) {
    throw new Error("Select a valid war date.");
  }
  return date;
}

function parseScoreResult(value: unknown): ScoreReportResult {
  return value === "win" || value === "loss" ? value : "unknown";
}

function parseScoreRowsFromForm(body: Record<string, unknown>): Omit<ScoreRow, "guildId">[] {
  const familyNames = readFormArray(body.familyName);
  return familyNames
    .map((familyName, index) => {
      const cleanName = familyName.trim().slice(0, 80);
      if (!cleanName) return undefined;
      return {
        familyName: cleanName,
        kills: parseScoreInteger(body.kills, index),
        deaths: parseScoreInteger(body.deaths, index),
        assists: parseScoreInteger(body.assists, index),
        damageDealt: parseScoreInteger(body.damageDealt, index),
        damageTaken: parseScoreInteger(body.damageTaken, index),
        crowdControls: parseScoreInteger(body.crowdControls, index),
        hpHealed: parseScoreInteger(body.hpHealed, index),
        allySupport: parseScoreInteger(body.allySupport, index),
        structureDamage: parseScoreInteger(body.structureDamage, index),
        lynchCannonKills: parseScoreInteger(body.lynchCannonKills, index),
        siegeAssists: parseScoreInteger(body.siegeAssists, index),
        resurrections: parseScoreInteger(body.resurrections, index),
        siegeDeaths: parseScoreInteger(body.siegeDeaths, index),
        specialKills: parseScoreInteger(body.specialKills, index),
        timeAlive: parseScoreTime(body.timeAlive, index),
        totalWarTime: parseScoreTime(body.totalWarTime, index)
      };
    })
    .filter((row): row is Omit<ScoreRow, "guildId"> => Boolean(row));
}

function readFormArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? ""));
  return value === undefined ? [] : [String(value)];
}

function parseScoreInteger(value: unknown, index: number): number {
  const raw = readFormArray(value)[index]?.replace(/,/g, "").trim() ?? "";
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Score fields must be zero or positive numbers.");
  return Math.round(parsed);
}

function parseScoreTime(value: unknown, index: number): string {
  const raw = readFormArray(value)[index]?.trim() ?? "";
  if (!raw) return "";
  if (!/^\d{1,2}:?\d{2}(?::\d{2})?$/.test(raw)) throw new Error("Time fields must use MM:SS or HH:MM:SS format.");
  return raw.includes(":") ? raw : raw.length === 4 ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw;
}

function parseOptionalText(value: unknown, maxLength: number): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function isAllowedScoreImage(mimeType: string, originalName: string): boolean {
  const extension = originalName.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ["image/png", "image/jpeg", "image/webp"].includes(mimeType) && Boolean(extension && [".png", ".jpg", ".jpeg", ".webp"].includes(extension));
}

function formatStatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(absolute >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(value));
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

function scheduleTitle(event: WarEvent): string {
  if (!event.tier) {
    return `${event.kind === "siege" ? "Siege" : "Node War"} [${event.id}]`;
  }
  const tier = event.tier === "tier1" ? "T1" : event.tier === "tier2" ? "T2" : "T3";
  return `${tier} ${NODE_WAR_PRESETS[event.tier].territoryGroup} War [${event.id}]`;
}

function isEventActive(event: WarEvent): boolean {
  return event.active ?? !event.closed;
}

function formatRaidDays(event: WarEvent): string {
  const days = event.recurrence === "weekly" && event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
  return days.map((day) => labelWarDay(day).slice(0, 3)).join(", ") || "No days selected";
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
  return `${formatDateLabel(announcement.announcementDate)} ${formatClockTime(announcement.announcementTime)}`;
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

/** Returns today's selected raid before war end or the nearest selected future date. */
export function nextScheduledRaid(days: WarDay[], today = currentDateInTimezone(), now = Date.now()): { day: WarDay; date: string } {
  const todayDay = warDayForDate(today);
  if (days.includes(todayDay) && now < warEndsAt(today)) {
    return { day: todayDay, date: today };
  }
  return days
    .map((day) => ({ day, date: nextDateAfter(today, day) }))
    .sort((left, right) => left.date.localeCompare(right.date))[0];
}

function nextDateAfter(date: string, day: WarDay): string {
  const value = new Date(`${date}T12:00:00Z`);
  const delta = (WEB_WAR_DAYS.indexOf(day) - value.getUTCDay() + 7) % 7 || 7;
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}

function warEndsAt(date: string): number {
  return new Date(`${date}T${config.nodeWarStartTime}:00+08:00`).getTime() + 60 * 60_000;
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
