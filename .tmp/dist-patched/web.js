import express from "express";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { getGroupEmoji, getGroupEmojiUrl, getGroupLabel } from "./emojis.js";
import { buildNodeWarTitle, getNodeWarCapacity, labelTier, labelWarDay, NODE_WAR_PRESETS } from "./nodewar-presets.js";
import { extractScoreScreenshot } from "./score-ocr.js";
import { activeRosterCapacity, activeRosterSignupCount, isRosterGroup } from "./store.js";
import { formatClockTime } from "./time-format.js";
import { WEEKDAYS } from "./types.js";
import { createWebSessionStore } from "./web-session-store.js";
const WEB_WAR_DAYS = [...WEEKDAYS];
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
const scoreUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }
});
const scoreGeminiQuota = createScoreGeminiQuota();
function createScoreGeminiQuota() {
    return {
        userMinute: new Map(),
        guildDay: new Map()
    };
}
function consumeScoreGeminiQuota(userId, guildId) {
    if (!config.geminiApiKey)
        return { allowed: false, reason: "Gemini API key not configured; used Tesseract fallback." };
    const userLimit = Math.max(0, config.geminiUserMinuteLimit);
    const guildLimit = Math.max(0, config.geminiGuildDayLimit);
    if (userLimit === 0 || guildLimit === 0)
        return { allowed: false, reason: "Gemini quota disabled; used Tesseract fallback." };
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
    }
    else {
        userBucket.count += 1;
    }
    if (!guildBucket || guildBucket.day !== today) {
        scoreGeminiQuota.guildDay.set(guildId, { day: today, count: 1 });
    }
    else {
        guildBucket.count += 1;
    }
    return { allowed: true };
}
function getPacificDateKey(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    })
        .formatToParts(date)
        .reduce((accumulator, part) => {
        accumulator[part.type] = part.value;
        return accumulator;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}
/**
 * Creates the Express dashboard with Discord OAuth, public roster pages,
 * authenticated raid management routes, and security middleware.
 */
export function createWebApp(store, options = {}) {
    const app = express();
    const oauthStates = new Map();
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
        const [events, settings] = session ? await Promise.all([store.listEvents(), store.getSettings()]) : [[], {}];
        if (session && guild) {
            response.type("html").send(renderPage("NW Helper", renderEventList(events.filter((event) => event.guildId === guild.id), session, guildId, buildGuildDashboardSummaries(session.guilds, events, settings)), { loggedIn: !!session, path: request.path }));
            return;
        }
        response.type("html").send(renderPage("NW Helper", renderHome(events, session, settings), { loggedIn: !!session, path: request.path }));
    });
    app.get("/guilds/:guildId/raids", async (request, response) => {
        const session = await getSession(request, sessions);
        const guild = session?.guilds.find((candidate) => candidate.id === request.params.guildId);
        if (!session || !guild) {
            response.status(404).type("html").send(renderPage("Not found", renderLoginRequired(), { loggedIn: !!session, path: request.path }));
            return;
        }
        const events = await store.listEvents();
        const settings = await store.getSettings();
        response.type("html").send(renderPage(`${guild.name} raids`, renderEventList(events.filter((event) => event.guildId === guild.id), session, guild.id, buildGuildDashboardSummaries(session.guilds, events, settings)), { loggedIn: !!session, path: request.path }));
    });
    app.get("/raids", async (request, response) => {
        const session = await getSession(request, sessions);
        if (!session) {
            response.status(403).type("html").send(renderPage("Raids", renderLoginRequired(), { loggedIn: !!session, path: request.path }));
            return;
        }
        const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
        const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
        response.type("html").send(renderPage("All Raids", renderAllRaidsDashboard(session, summaries), { loggedIn: !!session, path: request.path }));
    });
    app.get("/guilds/:guildId/stats", async (request, response) => {
        await sendStatsDashboard(request, response, request.params.guildId);
    });
    app.get("/servers", async (request, response) => {
        const session = await getSession(request, sessions);
        if (!session) {
            response.status(403).type("html").send(renderPage("Servers", renderLoginRequired(), { loggedIn: !!session, path: request.path }));
            return;
        }
        const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
        response.type("html").send(renderPage("Servers", renderServersPicker(session, buildGuildDashboardSummaries(session.guilds, events, settings)), { loggedIn: !!session, path: request.path }));
    });
    app.get("/member", async (request, response) => {
        const session = await getSession(request, sessions);
        if (!session) {
            response.type("html").send(renderPage("Member View", renderMemberLogin(), { loggedIn: !!session, path: request.path }));
            return;
        }
        const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
        const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
        response.type("html").send(renderPage("Member View", renderMemberDashboard(session, summaries), { loggedIn: !!session, path: request.path }));
    });
    app.get("/stats", async (request, response) => {
        const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
        await sendStatsDashboard(request, response, guildId);
    });
    async function sendStatsDashboard(request, response, guildId) {
        const session = await getSession(request, sessions);
        const guild = session?.guilds.find((candidate) => candidate.id === guildId);
        if (!session) {
            response.status(403).type("html").send(renderPage("Stats", renderLoginRequired(), { loggedIn: !!session, path: request.path }));
            return;
        }
        const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
        const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
        if (!guild) {
            response.type("html").send(renderPage("Stats", renderStatsServerPicker(session, summaries), { loggedIn: !!session, path: request.path }));
            return;
        }
        try {
            const reports = options.scoreStore ? await options.scoreStore.listReports(guild.id) : [];
            const sortKey = parseScoreSortKey(request.query.sort);
            const notice = request.query.uploaded === "1"
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
            response.type("html").send(renderPage("Stats", renderStatsDashboard(guild, session, reports, notice, sortKey, canManageGuild(session, guild.id), summaries), { loggedIn: !!session, path: request.path }));
        }
        catch (error) {
            response.status(502).type("html").send(renderPage("Stats", renderWebError(error), { loggedIn: !!session, path: request.path }));
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
            console.info(`Score screenshot uploaded by ${uploadedBy} for guild ${guild.name} (${guild.id}); extracted ${extraction.rows.length} rows with ${extraction.engine}. ${geminiQuota.reason ?? ""}`.trim());
            response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&uploaded=1`);
        }
        catch (error) {
            response.status(400).type("html").send(renderPage("Stats upload failed", renderWebError(error), { loggedIn: !!session, path: request.path }));
        }
    });
    app.get("/stats/reports/:id/edit", async (request, response) => {
        const session = await getSession(request, sessions);
        const guildId = typeof request.query.guild === "string" ? request.query.guild : "";
        const guild = session?.guilds.find((candidate) => candidate.id === guildId);
        if (!session || !guild || !canManageGuild(session, guild.id) || !options.scoreStore) {
            response.status(403).send("Not authorized.");
            return;
        }
        try {
            const report = await options.scoreStore.getReport(guild.id, request.params.id);
            if (!report) {
                response.status(404).send("Score report not found.");
                return;
            }
            response.type("html").send(renderPage("Edit scoreboard", renderScoreReportEditor(guild, session, report), { loggedIn: !!session, path: request.path }));
        }
        catch (error) {
            response.status(400).type("html").send(renderPage("Stats edit failed", renderWebError(error), { loggedIn: !!session, path: request.path }));
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
        }
        catch (error) {
            response.status(400).type("html").send(renderPage("Stats preview failed", renderWebError(error), { loggedIn: !!session, path: request.path }));
        }
    });
    app.post("/stats/reports/:id/edit", async (request, response) => {
        const session = await getSession(request, sessions);
        const guildId = String(request.body.guildId ?? "");
        const guild = session?.guilds.find((candidate) => candidate.id === guildId);
        if (!session || !guild || !canManageGuild(session, guild.id) || !validCsrf(request, session) || !options.scoreStore) {
            response.status(403).send("Not authorized.");
            return;
        }
        try {
            const rows = parseScoreRowsFromForm(request.body);
            if (!rows.length)
                throw new Error("Keep at least one score row.");
            await options.scoreStore.updateReport(guild.id, request.params.id, {
                warDate: parseScoreDate(request.body.warDate),
                result: parseScoreResult(request.body.result),
                title: parseOptionalText(request.body.title, 120),
                rows: rows.map((row) => ({ ...row, guildId: guild.id }))
            });
            console.info(`Score report ${request.params.id} manually edited by ${formatUploader(session)} for guild ${guild.name} (${guild.id}); saved ${rows.length} rows.`);
            response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&saved=1`);
        }
        catch (error) {
            response.status(400).type("html").send(renderPage("Stats edit failed", renderWebError(error), { loggedIn: !!session, path: request.path }));
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
            if (!oldName || !newName)
                throw new Error("Enter a player name to rename.");
            const renamed = await options.scoreStore.renamePlayer(guild.id, oldName, newName);
            if (!renamed)
                throw new Error(`No score rows matched ${oldName}.`);
            console.info(`Score player ${oldName} renamed to ${newName} by ${formatUploader(session)} for guild ${guild.name} (${guild.id}); updated ${renamed} rows.`);
            response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&renamed=1`);
        }
        catch (error) {
            response.status(400).type("html").send(renderPage("Stats player rename failed", renderWebError(error), { loggedIn: !!session, path: request.path }));
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
        }
        catch (error) {
            response.status(400).type("html").send(renderPage("Stats delete failed", renderWebError(error), { loggedIn: !!session, path: request.path }));
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
            console.info(`Score report ${reportImage.report.id} rescanned by ${formatUploader(session)} for guild ${guild.name} (${guild.id}); extracted ${extraction.rows.length} rows with ${extraction.engine}. ${geminiQuota.reason ?? ""}`.trim());
            response.redirect(`/stats?guild=${encodeURIComponent(guild.id)}&rescanned=1`);
        }
        catch (error) {
            response.status(400).type("html").send(renderPage("Stats rescan failed", renderWebError(error), { loggedIn: !!session, path: request.path }));
        }
    });
    app.get("/auth/discord", (request, response) => {
        if (!config.discordClientId || !config.discordClientSecret) {
            response.status(503).send("Discord login is not configured.");
            return;
        }
        for (const [key, expiresAt] of oauthStates) {
            if (expiresAt < Date.now())
                oauthStates.delete(key);
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
                fetchDiscord("/users/@me", token),
                fetchDiscord("/users/@me/guilds", token)
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
        }
        catch {
            response.status(502).type("html").send(renderPage("Login failed", renderLoginError(), { loggedIn: false, path: request.path }));
        }
    });
    app.get("/logout", async (request, response) => {
        const sessionId = readCookie(request, sessionCookieName());
        if (sessionId)
            await sessions.delete(sessionId).catch(() => undefined);
        response.setHeader("Set-Cookie", sessionCookie("", 0));
        response.redirect("/");
    });
    app.get("/create", async (request, response) => {
        const session = await getSession(request, sessions);
        const guildId = typeof request.query.guild === "string" ? request.query.guild : undefined;
        if (!session) {
            response.status(403).type("html").send(renderPage("Create Raid", renderLoginRequired(), { loggedIn: !!session, path: request.path }));
            return;
        }
        if (!guildId) {
            const [events, settings] = await Promise.all([store.listEvents(), store.getSettings()]);
            response.type("html").send(renderPage("Create Raid", renderCreateServerPicker(session, buildGuildDashboardSummaries(session.guilds, events, settings)), { loggedIn: !!session, path: request.path }));
            return;
        }
        if (!canManageGuild(session, guildId)) {
            response.status(403).type("html").send(renderPage("Create Raid", renderLoginRequired(), { loggedIn: !!session, path: request.path }));
            return;
        }
        try {
            const [deliveryOptions, settings] = await Promise.all([fetchGuildDeliveryOptions(guildId), store.getSettings()]);
            response
                .type("html")
                .send(renderPage("Create Raid", renderCreateRaid(guildId, session.csrfToken, session, deliveryOptions, settings.nodeWarChannelIds?.[guildId] ?? config.nodeWarChannelId)));
        }
        catch (error) {
            response.status(502).type("html").send(renderPage("Create Raid", renderWebError(error), { loggedIn: !!session, path: request.path }));
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
            const event = {
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
        }
        catch (error) {
            response.status(400).type("html").send(renderPage("Create Raid", renderWebError(error), { loggedIn: !!session, path: request.path }));
        }
    });
    app.get("/events/:id", async (request, response) => {
        const event = await store.getEvent(request.params.id);
        const session = await getSession(request, sessions);
        if (!event) {
            response.status(404).type("html").send(renderPage("Not found", "<main><h1>Event not found</h1></main>", { loggedIn: !!session, path: request.path }));
            return;
        }
        const canManage = Boolean(event.guildId && session && canManageGuild(session, event.guildId));
        const deliveryOptions = event.guildId ? await fetchGuildDeliveryOptions(event.guildId).catch(() => undefined) : undefined;
        response.type("html").send(renderPage(event.title, renderEventDetail(event, canManage, session, deliveryOptions), { loggedIn: !!session, path: request.path }));
    });
    app.get("/events/:id/edit", async (request, response) => {
        const event = await store.getEvent(request.params.id);
        const session = await getSession(request, sessions);
        if (!event || !session || !canManageEvent(event, session)) {
            response.status(404).type("html").send(renderPage("Not found", "<main><h1>Event not found</h1></main>", { loggedIn: !!session, path: request.path }));
            return;
        }
        response.type("html").send(renderPage(`Edit ${event.title}`, renderEditRaid(event, session.csrfToken, session), { loggedIn: !!session, path: request.path }));
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
            const repeatDaysChanged = (recurrence === "weekly" || event.recurrence === "weekly") && repeatDays.join(",") !== previousRepeatDays.join(",");
            const scheduleChanged = date !== event.date ||
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
        }
        catch (error) {
            response.status(400).type("html").send(renderPage("Composition update failed", renderWebError(error), { loggedIn: !!session, path: request.path }));
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
        }
        catch (error) {
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
async function refreshPostedEvent(options, event) {
    if (!event.channelId || !event.messageId || !options.onEventUpdated) {
        return;
    }
    try {
        await options.onEventUpdated(event);
    }
    catch (error) {
        console.warn(`Could not refresh posted event ${event.id} after web update:`, error);
    }
}
function renderAccountControls(session, selectedGuildId) {
    if (!session) {
        return `<a class="button button-secondary" href="/auth/discord">Log in with Discord</a>`;
    }
    return `<div class="account-panel">
    <span class="account-name">${escapeHtml(session.user.global_name ?? session.user.username)}</span>
    ${selectedGuildId ? `<a href="/">Switch server</a>` : ""}
    <a href="/logout">Log out</a>
  </div>`;
}
function formatUploader(session) {
    const name = session.user.global_name ?? session.user.username;
    return `${name} (${session.user.id})`;
}
function renderLoginRequired() {
    const inner = `<main class="shell narrow-shell"><section class="empty-state"><p class="eyebrow">Private dashboard</p><h1>Discord login required</h1><p>Log in to view servers you share with NW Helper. Moderator permissions are required for edits.</p><a class="button" href="/auth/discord">Log in with Discord</a></section></main>`;
    return `${renderWindow("sudo ./login", inner, { prompt: "nwhelper@os" })}`;
}
function renderLoginError() {
    const inner = `<main class="shell narrow-shell"><section class="empty-state"><p class="eyebrow">Private dashboard</p><h1>Discord login failed</h1><p>The OAuth request could not be completed. Check the configured redirect URI and try again.</p><a class="button" href="/auth/discord">Try again</a></section></main>`;
    return `${renderWindow("error: oauth failed", inner, { prompt: "nwhelper@os" })}`;
}
async function exchangeDiscordCode(code) {
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
    const payload = (await response.json());
    if (!response.ok || !payload.access_token) {
        throw new Error("Discord token exchange failed.");
    }
    return payload.access_token;
}
async function fetchDiscord(path, token) {
    const response = await fetch(`https://discord.com/api/v10${path}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
        throw new Error("Discord profile request failed.");
    }
    return (await response.json());
}
async function fetchBotGuildIds() {
    if (!config.discordToken) {
        return new Set();
    }
    const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
        headers: { Authorization: `Bot ${config.discordToken}` }
    });
    if (!response.ok) {
        throw new Error("Discord bot guild request failed.");
    }
    const guilds = (await response.json());
    return new Set(guilds.map((guild) => guild.id));
}
async function fetchGuildDeliveryOptions(guildId) {
    const [channels, roles] = await Promise.all([
        fetchDiscordBot(`/guilds/${guildId}/channels`),
        fetchDiscordBot(`/guilds/${guildId}/roles`)
    ]);
    return {
        channels: channels
            .filter((channel) => channel.type === 0 || channel.type === 5)
            .sort((left, right) => (left.position ?? 0) - (right.position ?? 0) || left.name.localeCompare(right.name)),
        roles: roles.filter((role) => role.name !== "@everyone" && !role.managed).sort((left, right) => right.position - left.position)
    };
}
async function fetchDiscordBot(path) {
    if (!config.discordToken) {
        throw new Error("Discord bot token is not configured.");
    }
    const response = await fetch(`https://discord.com/api/v10${path}`, {
        headers: { Authorization: `Bot ${config.discordToken}` }
    });
    if (!response.ok) {
        throw new Error("Discord server channels and roles could not be loaded.");
    }
    return (await response.json());
}
function hasAnyDiscordPermission(permissions, flags) {
    let permissionBits;
    try {
        permissionBits = BigInt(permissions);
    }
    catch {
        return false;
    }
    return flags.some((flag) => (permissionBits & flag) === flag);
}
function canManageGuild(session, guildId) {
    const guild = session.guilds.find((candidate) => candidate.id === guildId);
    return Boolean(guild && hasAnyDiscordPermission(guild.permissions, WEB_MANAGE_PERMISSIONS));
}
async function getSession(request, sessions) {
    const sessionId = readCookie(request, sessionCookieName());
    if (!sessionId || !/^[a-f0-9]{64}$/.test(sessionId))
        return undefined;
    try {
        const session = await sessions.get(sessionId);
        if (!session || session.expiresAt < Date.now()) {
            await sessions.delete(sessionId).catch(() => undefined);
            return undefined;
        }
        return session;
    }
    catch (error) {
        console.warn("Could not load dashboard session:", error);
        return undefined;
    }
}
function validCsrf(request, session) {
    return typeof request.body.csrfToken === "string" && request.body.csrfToken === session.csrfToken;
}
function canManageEvent(event, session) {
    return Boolean(event.guildId && canManageGuild(session, event.guildId));
}
function readCookie(request, name) {
    const entry = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}
function sessionCookie(value, maxAge = 24 * 60 * 60) {
    const secure = config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `${sessionCookieName()}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}; Priority=High`;
}
function sessionCookieName() {
    return config.publicBaseUrl.startsWith("https://") ? "__Host-nw_session" : "nw_session";
}
function validateWebSession(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const session = value;
    if (!session.user ||
        typeof session.user.id !== "string" ||
        typeof session.user.username !== "string" ||
        !Array.isArray(session.guilds) ||
        !session.guilds.every((guild) => guild &&
            typeof guild.id === "string" &&
            typeof guild.name === "string" &&
            typeof guild.permissions === "string" &&
            (guild.icon === undefined || guild.icon === null || typeof guild.icon === "string")) ||
        typeof session.csrfToken !== "string" ||
        !/^[a-f0-9]{48}$/.test(session.csrfToken) ||
        typeof session.expiresAt !== "number") {
        return undefined;
    }
    return session;
}
function setSecurityHeaders(_request, response, next) {
    response.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' https://cdn.discordapp.com data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
}
function renderPage(title, body, opts = {}) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | nwhelper ~ pinknord</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body class="antialiased" data-path="${escapeHtml(opts.path ?? "/")}">
  <div class="os-shell">
    ${renderPolybar(title, !!opts.loggedIn)}
    <div class="os-desktop">${body}</div>
  </div>
  ${renderOsShellScript()}
</body>
</html>`;
}
function renderPolybar(currentTitle, isLoggedIn) {
    const days = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
    const now = new Date();
    const jsDay = now.getDay();
    const isoDay = jsDay === 0 ? 6 : jsDay - 1;
    const dayTags = days.map((d, i) => {
        const isToday = i === isoDay;
        const isWeekend = i >= 5;
        return `<span class="pb-day${isToday ? " today" : ""}${isWeekend && !isToday ? " weekend" : ""}" title="${d}">${isToday ? "•" : d[0]}</span>`;
    }).join("");
    const navItems = [
        { href: "/", label: "home", icon: "", tone: "bg-pink" },
        { href: "/raids", label: "raids", icon: "", tone: "bg-cyan" },
        { href: "/stats", label: "stats", icon: "", tone: "bg-magenta" },
        { href: "/servers", label: "servers", icon: "", tone: "bg-aqua" }
    ];
    if (isLoggedIn) {
        navItems.push({ href: "/member", label: "member", icon: "", tone: "bg-blue" });
        navItems.push({ href: "/create", label: "+new", icon: "", tone: "bg-yellow" });
    }
    else {
        navItems.push({ href: "/auth/discord", label: "login", icon: "", tone: "bg-green" });
    }
    const navTags = navItems.map((item) => `<a class="pb-tag ${item.tone}" data-pb-nav href="${escapeHtml(item.href)}" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</a>`).join("");
    return `<div class="polybar" role="banner" aria-label="System bar">
    <section class="pb-left">
      <a class="pb-tag bg-pink" href="/" title="Home">nw</a>
      ${navTags}
    </section>
    <section class="pb-center">
      <span class="pb-day-spacer"></span>
      <span class="pb-tag bg-cyan" title="Current window">${escapeHtml(currentTitle)}</span>
    </section>
    <section class="pb-right">
      <span class="pb-tag bg-magenta" title="Active raids"><span class="ic">●</span><span data-pb-raids>—</span></span>
      <span class="pb-tag bg-green" title="Discord bot"><span class="ic">●</span>bot</span>
      <span class="pb-tag bg-yellow" title="Theme">PinkNord</span>
      <span class="pb-day-spacer"></span>
      ${dayTags}
      <span class="pb-day-spacer"></span>
      <span class="pb-tag bg-ghost" data-pb-uptime title="Uptime">up —</span>
      <span class="pb-tag bg-white" data-pb-clock title="Clock">—</span>
      ${isLoggedIn ? `<a class="pb-tag bg-red" href="/logout" title="Sign out">⏻</a>` : ""}
    </section>
  </div>`;
}
function renderOsShellScript() {
    return `<script>
  (function () {
    try {
    if (window.__nwhelpBoot) return; window.__nwhelpBoot = true;
    console.log("[nwhelper] os shell booting…");
    var clockEl = document.querySelector("[data-pb-clock]");
    var uptimeEl = document.querySelector("[data-pb-uptime]");
    var raidsEl = document.querySelector("[data-pb-raids]");
    var boot = Date.now();
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    function fmt12(h, m) {
      var p = h >= 12 ? "PM" : "AM";
      var hh = h % 12; if (hh === 0) hh = 12;
      return pad(hh) + ":" + pad(m) + " " + p;
    }
    function tickClock() {
      if (!clockEl) return;
      var d = new Date();
      var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      clockEl.textContent = days[d.getDay()] + " " + months[d.getMonth()] + " " + d.getDate() + " " + fmt12(d.getHours(), d.getMinutes());
    }
    function tickUptime() {
      if (!uptimeEl) return;
      var s = Math.max(0, Math.floor((Date.now() - boot) / 1000));
      var h = Math.floor(s / 3600);
      var m = Math.floor((s % 3600) / 60);
      var sec = s % 60;
      uptimeEl.textContent = "up " + pad(h) + ":" + pad(m) + ":" + pad(sec);
    }
    function tickRaids() {
      if (!raidsEl || !raidsEl.dataset.static) return;
      raidsEl.textContent = raidsEl.dataset.static;
    }
    tickClock();
    tickUptime();
    tickRaids();
    setInterval(tickClock, 15000);
    setInterval(tickUptime, 1000);

    var navTags = document.querySelectorAll("[data-pb-nav]");
    var path = (document.body && document.body.getAttribute("data-path")) || (window.location.pathname || "/");
    navTags.forEach(function (tag) {
      var href = tag.getAttribute("href") || "";
      if (!href) return;
      var isExact = href === path;
      var isPrefix = !isExact && href !== "/" && path.indexOf(href + "/") === 0;
      if (isExact || isPrefix) tag.classList.add("active");
    });

    try {
      var stored = localStorage.getItem("nwhelper.bg");
      if (stored === "2" || (!stored && Math.random() < 0.5)) {
        document.body.classList.add("bg-variant-2");
      }
    } catch (e) {}

    var CARD_TERMINAL_SELECTOR = [
      ".event-card", ".server-card", ".role-table", ".schedule-panel",
      ".schedule-editor", ".delivery-editor", ".slot-editor", ".empty-state",
      ".welcome-state", ".server-picker", ".score-table-panel", ".score-edit-card",
      ".score-leader-card", ".score-mix-card", ".score-trend-card", ".stats-upload-panel",
      ".stats-analysis-panel", ".report-card", ".day-card", ".impact-panel",
      ".member-server-card", ".member-raid-card", ".preview-card", ".template-grid",
      ".eyebrow-card", ".current-roster-summary", ".stats-row", ".command-rail",
      ".readiness-panel", ".primary-war-focus", ".telemetry-module", ".fetch-panel"
    ].join(",");

    var TONE_FOR_CLASS = {
      "stats-row": "pink",
      "stats-upload-panel": "magenta",
      "stats-analysis-panel": "cyan",
      "score-table-panel": "green",
      "score-mix-card": "magenta",
      "score-leader-card": "green",
      "score-trend-card": "cyan",
      "score-edit-card": "yellow",
      "impact-panel": "orange",
      "preview-card": "cyan",
      "event-card": "pink",
      "server-card": "aqua",
      "day-card": "yellow",
      "report-card": "green",
      "member-raid-card": "pink",
      "member-server-card": "aqua",
      "schedule-panel": "magenta",
      "schedule-editor": "magenta",
      "delivery-editor": "orange",
      "role-table": "blue",
      "fetch-panel": "pink",
      "command-rail": "magenta",
      "readiness-panel": "green",
      "primary-war-focus": "pink",
      "telemetry-module": "blue"
    };

    function deriveTitle(host) {
      var eyebrow = host.querySelector(":scope > .eyebrow, :scope > header .eyebrow, :scope > header h1, :scope > header h2, :scope > header h3, :scope > h1, :scope > h2, :scope > h3");
      if (eyebrow) {
        var t = (eyebrow.textContent || "").trim();
        if (t) return t.split("\\n")[0].slice(0, 32);
      }
      var h = host.querySelector("h1, h2, h3, h4, .server-name, .card-title-text, .title, header");
      if (h) {
        var t2 = (h.textContent || "").trim();
        if (t2) return t2.split("\\n")[0].slice(0, 32);
      }
      var cls = (host.className || "").split(/\\s+/).filter(function (c) { return c && c.indexOf("data-") !== 0; })[0] || "panel";
      return cls.replace(/-/g, " ").replace(/_/g, " ");
    }

    function deriveTone(host) {
      var classes = (host.className || "").split(/\\s+/);
      for (var i = 0; i < classes.length; i++) {
        if (TONE_FOR_CLASS[classes[i]]) return TONE_FOR_CLASS[classes[i]];
      }
      return "cyan";
    }

    function wrapTerminal(host) {
      if (host.dataset.terminalReady === "1") return;
      var tone = deriveTone(host);
      var title = deriveTitle(host);
      var id = host.id || ("term-" + Math.random().toString(36).slice(2, 9));

      host.id = id;
      host.dataset.terminalReady = "1";
      host.classList.add("is-terminal");
      if (getComputedStyle(host).position === "static") {
        host.style.position = "relative";
      }

      var titlebar = document.createElement("header");
      titlebar.className = "card-titlebar t-" + tone;
      titlebar.innerHTML =
        '<span class="card-title">' + title + '</span>' +
        '<span class="card-spacer"></span>' +
        '<button type="button" class="card-min" data-card-action="min" title="minimize" aria-label="minimize">─</button>' +
        '<button type="button" class="card-close" data-card-action="close" title="close" aria-label="close">×</button>';

      host.insertBefore(titlebar, host.firstChild);
    }

    function ensureTerminals(root) {
      var nodes = (root || document).querySelectorAll(CARD_TERMINAL_SELECTOR);
      nodes.forEach(wrapTerminal);
    }

    ensureTerminals(document);

    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches(CARD_TERMINAL_SELECTOR)) wrapTerminal(n);
          if (n.querySelectorAll) ensureTerminals(n);
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    function toggleMin(host) {
      var next = host.getAttribute("data-minimized") === "true" ? "false" : "true";
      host.setAttribute("data-minimized", next);
      var btn = host.querySelector('[data-card-action="min"]');
      if (btn) {
        btn.textContent = next === "true" ? "▢" : "─";
        btn.setAttribute("title", next === "true" ? "restore" : "minimize");
        btn.setAttribute("aria-label", next === "true" ? "restore" : "minimize");
      }
    }

    function closeTerminal(host) {
      host.style.transition = "opacity .25s ease, transform .25s ease, max-height .25s ease";
      host.style.opacity = "0";
      host.style.transform = "scale(.98)";
      setTimeout(function () { host.style.display = "none"; }, 260);
    }

    document.addEventListener("click", function (e) {
      var target = e.target;
      if (!target || !target.closest) return;

      var winBtn = target.closest("[data-win-action]");
      if (winBtn) {
        var win = winBtn.closest("[data-window]");
        if (!win) return;
        var action = winBtn.getAttribute("data-win-action");
        if (action === "min") {
          var minimized = win.getAttribute("data-minimized") === "true";
          win.setAttribute("data-minimized", minimized ? "false" : "true");
          var wb = win.querySelector('[data-win-action="min"]');
          if (wb) {
            wb.textContent = minimized ? "─" : "▢";
            wb.setAttribute("title", minimized ? "minimize" : "restore");
          }
        } else if (action === "close") {
          win.style.transition = "opacity .25s ease, transform .25s ease, margin .25s ease, grid-template-rows .25s ease";
          win.style.opacity = "0";
          win.style.transform = "scale(.98)";
          setTimeout(function () { win.style.display = "none"; }, 260);
        }
        return;
      }

      var cardBtn = target.closest("[data-card-action]");
      if (cardBtn) {
        var card = cardBtn.closest(CARD_TERMINAL_SELECTOR);
        if (!card) return;
        var caction = cardBtn.getAttribute("data-card-action");
        if (caction === "min") {
          toggleMin(card);
        } else if (caction === "close") {
          closeTerminal(card);
        }
        return;
      }

      var reportBtn = target.closest("[data-report-action]");
      if (reportBtn) {
        e.preventDefault();
        var raction = reportBtn.getAttribute("data-report-action");
        var rid = reportBtn.getAttribute("data-report-id");
        var rgid = reportBtn.getAttribute("data-guild-id");
        var rcsrf = reportBtn.getAttribute("data-csrf");
        if (!raction || !rid || !rgid || !rcsrf) return;
        if (raction === "delete") {
          if (!confirm("Delete this scoreboard and uploaded image?")) return;
        }
        reportBtn.disabled = true;
        var origText = reportBtn.textContent;
        reportBtn.textContent = raction === "delete" ? "Deleting…" : "Rescanning…";
        var body = new URLSearchParams();
        body.set("csrfToken", rcsrf);
        body.set("guildId", rgid);
        fetch("/stats/reports/" + encodeURIComponent(rid) + "/" + raction, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          redirect: "follow"
        }).then(function (resp) {
          if (resp.redirected) {
            window.location.href = resp.url;
            return;
          }
          if (!resp.ok) {
            reportBtn.disabled = false;
            reportBtn.textContent = origText;
            return resp.text().then(function (t) {
              alert((raction === "delete" ? "Delete" : "Rescan") + " failed: " + (t || resp.statusText));
            });
          }
          window.location.reload();
        }).catch(function (err) {
          reportBtn.disabled = false;
          reportBtn.textContent = origText;
          alert("Network error: " + (err && err.message ? err.message : err));
        });
        return;
      }

      var cardTitlebar = target.closest(".card-titlebar");
      if (cardTitlebar) {
        var titlebarHost = cardTitlebar.parentElement;
        if (titlebarHost && titlebarHost.matches && titlebarHost.matches(CARD_TERMINAL_SELECTOR)) {
          if (target.closest("button")) return;
          toggleMin(titlebarHost);
        }
      }
    });

    (function initServerTerminal() {
      try {
      var form = document.getElementById("server-pick-form");
      var input = document.getElementById("server-pick-input");
      var output = document.getElementById("server-pick-output");
      var terminal = document.querySelector(".server-pick-terminal");
      var cursor = terminal ? terminal.querySelector(".terminal-prompt-cursor") : null;
      if (!form || !input || !output || !terminal) {
        console.warn("[nwhelper] server picker elements missing", { form: !!form, input: !!input, output: !!output, terminal: !!terminal });
        return;
      }

      var serversData = [];
      try {
        var raw = terminal.getAttribute("data-servers") || "";
        serversData = JSON.parse(raw.replace(/&quot;/g, '\\"'));
      } catch (e) { serversData = []; }

      var targetTemplate = terminal.getAttribute("data-target-template") || "/guilds/{id}/stats";
      function buildTarget(id) { return targetTemplate.replace(/\{id\}/g, encodeURIComponent(id)); }

      var history = [];
      var histIdx = 0;

      function scrollToBottom() {
        output.scrollTop = output.scrollHeight;
      }

      function line(text, kind) {
        var div = document.createElement("div");
        div.className = "terminal-line " + (kind ? "t-" + kind : "");
        div.textContent = text;
        output.appendChild(div);
        scrollToBottom();
      }

      function lineHTML(html) {
        var div = document.createElement("div");
        div.className = "terminal-line";
        div.innerHTML = html;
        output.appendChild(div);
        scrollToBottom();
      }

      function echoPrompt(text) {
        lineHTML(
          '<span class="t-success">nwhelper</span><span class="t-muted">@</span><span class="t-success">servers</span><span class="t-muted">:</span><span class="t-path">~</span><span class="t-muted">$</span> ' +
          '<span>' + escapeHTMLForTerminal(text) + '</span>'
        );
      }

      function escapeHTMLForTerminal(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function findServer(query) {
        if (!query) return null;
        var q = String(query).trim().toLowerCase();
        if (!q) return null;
        var numeric = parseInt(q, 10);
        if (!isNaN(numeric) && String(numeric) === q) {
          for (var i = 0; i < serversData.length; i++) {
            if (serversData[i].idx === numeric) return serversData[i];
          }
        }
        var candidates = [q];
        var firstWord = q.split(/\\s+/)[0];
        if (firstWord && firstWord !== q) candidates.push(firstWord);
        var noSlash = q.replace(/\\s*\\/\\s*\\S+/g, "").trim();
        if (noSlash && noSlash !== q) candidates.push(noSlash);
        for (var c = 0; c < candidates.length; c++) {
          var cq = candidates[c];
          for (var j = 0; j < serversData.length; j++) {
            if (serversData[j].lower === cq) return serversData[j];
          }
        }
        for (var k = 0; k < serversData.length; k++) {
          if (serversData[k].lower.indexOf(q) === 0) return serversData[k];
        }
        for (var l = 0; l < serversData.length; l++) {
          if (serversData[l].lower.indexOf(q) !== -1) return serversData[l];
        }
        for (var m = 0; m < serversData.length; m++) {
          for (var n = 0; n < candidates.length; n++) {
            if (serversData[m].lower.indexOf(candidates[n]) === 0) return serversData[m];
          }
        }
        for (var o = 0; o < serversData.length; o++) {
          for (var p = 0; p < candidates.length; p++) {
            if (serversData[o].lower.indexOf(candidates[p]) !== -1) return serversData[o];
          }
        }
        return null;
      }

      function highlightServer(id) {
        var items = document.querySelectorAll(".server-pick-item");
        items.forEach(function (el) {
          if (el.getAttribute("data-server-id") === id) el.classList.add("is-active");
          else el.classList.remove("is-active");
        });
      }

      function navigateTo(server) {
        line("→ connecting to " + server.name + " (/" + server.id + "/stats)", "info");
        line("✓ routing to stats dashboard for #" + server.idx + " " + server.name, "success");
        setTimeout(function () {
          window.location.href = buildTarget(server.id);
        }, 380);
      }

      function selectServer(server) {
        highlightServer(server.id);
        line("• selected #" + server.idx + "  " + server.name, "pink");
        line("  press Enter or type a command to navigate. (try: goto, cd, ls, help, clear)", "muted");
      }

      var commands = {
        help: function () {
          lineHTML(
            '<span class="t-info">Available commands</span><br>' +
            '<span class="t-key">  ls</span><span class="t-muted">, </span><span class="t-key">list</span><span class="t-muted">                 list all shared servers</span><br>' +
            '<span class="t-key">  cd &lt;name|number&gt;</span><span class="t-muted">     select a server (highlights the row)</span><br>' +
            '<span class="t-key">  goto &lt;name|number&gt;</span><span class="t-muted">   open that server stats dashboard</span><br>' +
            '<span class="t-key">  open &lt;name|number&gt;</span><span class="t-muted">   alias for goto</span><br>' +
            '<span class="t-key">  stats</span><span class="t-muted">                 open stats for the currently selected server</span><br>' +
            '<span class="t-key">  raids</span><span class="t-muted">                 open raids for the currently selected server</span><br>' +
            '<span class="t-key">  clear</span><span class="t-muted">, </span><span class="t-key">cls</span><span class="t-muted">             clear the terminal</span><br>' +
            '<span class="t-key">  whoami</span><span class="t-muted">                 show current user</span><br>' +
            '<span class="t-key">  home</span><span class="t-muted">                   return to dashboard</span><br>' +
            '<span class="t-comment">  Tip: click any server in the column on the left to select it.</span>'
          );
        },
        ls: function () {
          if (!serversData.length) {
            line("no shared servers available", "warn");
            return;
          }
          lineHTML(
            '<span class="t-muted">idx  guild                                              id</span>'
          );
          serversData.forEach(function (s) {
            var name = s.name;
            if (name.length > 38) name = name.slice(0, 35) + "...";
            lineHTML(
              '<span class="t-cyan">  ' + String(s.idx).padStart(2, " ") + ' </span>' +
              '<span class="t-info">' + escapeHTMLForTerminal(name).padEnd(48, " ") + '</span>' +
              '<span class="t-muted">' + escapeHTMLForTerminal(s.id) + '</span>'
            );
          });
          lineHTML(
            '<span class="t-muted">' + serversData.length + ' server' + (serversData.length === 1 ? "" : "s") + ' available</span>'
          );
        },
        list: function () { commands.ls(); },
        clear: function () {
          while (output.firstChild) output.removeChild(output.firstChild);
        },
        cls: function () { commands.clear(); },
        whoami: function () {
          var u = (document.body && document.body.getAttribute("data-path")) || "/";
          line("user: " + (u || "nwhelper"), "info");
        },
        home: function () {
          line("→ returning to dashboard", "info");
          setTimeout(function () { window.location.href = "/"; }, 280);
        }
      };

      function selectedServer() {
        var active = document.querySelector(".server-pick-item.is-active");
        if (!active) return null;
        var id = active.getAttribute("data-server-id");
        for (var i = 0; i < serversData.length; i++) {
          if (serversData[i].id === id) return serversData[i];
        }
        return null;
      }

      function handleSubmit(raw) {
        try {
          var text = String(raw || "").trim();
          console.log("[nwhelper] handleSubmit:", JSON.stringify(text), "servers:", serversData.length);
          echoPrompt(text);
          if (!text) return;
          history.push(text);
          histIdx = history.length;
          var parts = text.split(/\\s+/);
          var cmd = parts[0].toLowerCase();
          var arg = parts.slice(1).join(" ");

          if (commands[cmd]) {
            commands[cmd](arg);
            return;
          }
          if (cmd === "cd" || cmd === "select") {
            if (!arg) {
              var sel = selectedServer();
              if (sel) line("current selection: " + sel.name + " (#" + sel.idx + ")", "info");
              else line("usage: cd <name|number> — or click a server on the left", "warn");
              return;
            }
            var s = findServer(arg);
            if (!s) { line("no server matches '" + arg + "'", "error"); return; }
            selectServer(s);
            return;
          }
          if (cmd === "goto" || cmd === "open") {
            if (!arg) {
              var sel2 = selectedServer();
              if (sel2) { navigateTo(sel2); return; }
              line("usage: goto <name|number>", "warn");
              return;
            }
            var s2 = findServer(arg);
            if (!s2) { line("no server matches '" + arg + "'", "error"); return; }
            highlightServer(s2.id);
            navigateTo(s2);
            return;
          }
          if (cmd === "stats") {
            var sel3 = selectedServer();
            if (!sel3) { line("no server selected. type: cd <name>", "warn"); return; }
            window.location.href = buildTarget(sel3.id);
            return;
          }
          if (cmd === "raids") {
            var sel4 = selectedServer();
            if (!sel4) { line("no server selected. type: cd <name>", "warn"); return; }
            window.location.href = "/guilds/" + encodeURIComponent(sel4.id) + "/raids";
            return;
          }

          var direct = findServer(text);
          if (direct) {
            highlightServer(direct.id);
            navigateTo(direct);
            return;
          }

          line("command not found: " + cmd, "error");
          line("type 'help' for the list of commands", "muted");
        } catch (err) {
          console.error("[nwhelper] handleSubmit error:", err);
          try { line("internal error: " + (err && err.message ? err.message : String(err)), "error"); } catch (_) {}
        }
      }

      form.addEventListener("submit", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        var val = input.value;
        input.value = "";
        handleSubmit(val);
        return false;
      });

      input.addEventListener("keypress", function (e) {
        if (e.key === "Enter" || e.keyCode === 13) {
          if (e && e.preventDefault) e.preventDefault();
          var val = input.value;
          input.value = "";
          handleSubmit(val);
        }
      });

      input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowUp") {
          if (!history.length) return;
          e.preventDefault();
          histIdx = Math.max(0, histIdx - 1);
          input.value = history[histIdx];
          setTimeout(function () { input.setSelectionRange(input.value.length, input.value.length); }, 0);
        } else if (e.key === "ArrowDown") {
          if (!history.length) return;
          e.preventDefault();
          histIdx = Math.min(history.length, histIdx + 1);
          input.value = histIdx === history.length ? "" : history[histIdx];
          setTimeout(function () { input.setSelectionRange(input.value.length, input.value.length); }, 0);
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          var val = input.value;
          input.value = "";
          console.log("[nwhelper] enter:", JSON.stringify(val));
          handleSubmit(val);
          if (cursor) cursor.classList.remove("is-typing");
        }
      });

      input.addEventListener("input", function () {
        if (cursor) cursor.classList.toggle("is-typing", input.value.length > 0);
      });

      function attachItemClick() {
        document.querySelectorAll(".server-pick-item").forEach(function (item) {
          if (item.dataset.pickBound === "1") return;
          item.dataset.pickBound = "1";
          item.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            var id = item.getAttribute("data-server-id");
            var s = null;
            for (var i = 0; i < serversData.length; i++) {
              if (serversData[i].id === id) { s = serversData[i]; break; }
            }
            if (!s) { line("could not resolve clicked server", "error"); return; }
            highlightServer(s.id);
            input.value = s.name;
            line("→ connecting to #" + s.idx + " " + s.name + "  (/" + s.id + "/stats)", "info");
            setTimeout(function () {
              window.location.href = buildTarget(s.id);
            }, 220);
          });
        });
      }
      attachItemClick();

      var moPick = new MutationObserver(function () { attachItemClick(); });
      moPick.observe(document.body, { childList: true, subtree: true });

      document.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var inTerminal = t.closest(".server-pick-terminal");
        var inRail = t.closest(".server-pick-rail");
        var inItem = t.closest(".server-pick-item");
        if ((inTerminal || inRail) && !inItem) {
          setTimeout(function () { input.focus(); }, 0);
        }
      });

      setTimeout(function () { input.focus(); }, 30);

      window.__nwhelpPick = { servers: serversData, run: handleSubmit, echo: line, goto: function (id) {
        for (var i = 0; i < serversData.length; i++) {
          if (serversData[i].id === id) { handleSubmit("goto " + serversData[i].name); return; }
        }
      }};
      console.log("[nwhelper] server picker ready:", serversData.length, "server(s)");
      } catch (err) {
        console.error("[nwhelper] server picker init failed:", err);
      }
    })();
    } catch (err) {
      console.error("[nwhelper] os shell error:", err);
    }
  })();
  </script>`;
}
function renderWindow(title, body, options = {}) {
    const tone = options.tone ?? "cyan";
    const prompt = options.prompt ?? "nwhelper@os";
    const idAttr = options.id ? ` id="${escapeHtml(options.id)}" data-window-id="${escapeHtml(options.id)}"` : "";
    return `<section class="os-window" data-window${idAttr}>
    <header class="window-titlebar">
      <span class="win-tab t-${tone}"><span class="win-tab-icon">▶</span><span>${escapeHtml(title)}</span></span>
      <span class="win-spacer"></span>
      <span class="win-meta"><span class="sep">┌──(</span>${escapeHtml(prompt)}<span class="sep">)</span></span>
      <button class="win-min" type="button" data-win-action="min" title="minimize" aria-label="minimize">─</button>
      <button class="win-close" type="button" data-win-action="close" title="close" aria-label="close">×</button>
    </header>
    <div class="window-body">${body}</div>
  </section>`;
}
function renderFetchPanel(summaries, session) {
    const totalActive = summaries.reduce((sum, s) => sum + s.activeRaids, 0);
    const totalUpcoming = summaries.reduce((sum, s) => sum + s.upcomingRaids, 0);
    const totalSignups = summaries.reduce((sum, s) => sum + s.totalSignups, 0);
    const next = summaries
        .filter((s) => s.nextWarStartTime)
        .sort((a, b) => (a.nextWarStartTime ?? 0) - (b.nextWarStartTime ?? 0))[0];
    const nextAnnounce = summaries
        .filter((s) => s.nextAnnouncementTime)
        .sort((a, b) => (a.nextAnnouncementTime ?? 0) - (b.nextAnnouncementTime ?? 0))[0];
    const ready = summaries.filter((s) => s.setupWarnings.length === 0).length;
    const node = process.version;
    const uptimeHours = Math.floor(process.uptime() / 3600);
    const uptimeMin = Math.floor((process.uptime() % 3600) / 60);
    const totalGuilds = summaries.length;
    const colors = [
        { name: "bg", hex: "#2E3440" },
        { name: "pink", hex: "#FA5AA4" },
        { name: "green", hex: "#2BE491" },
        { name: "yellow", hex: "#EBCB8B" },
        { name: "cyan", hex: "#63C5EA" },
        { name: "magenta", hex: "#CF8EF4" },
        { name: "aqua", hex: "#8FBCBB" },
        { name: "white", hex: "#F9F9F9" }
    ];
    return `<aside class="fetch-panel">
    <pre class="fetch-ascii" aria-hidden="true">${"  "}     /\\
${"  "}    /  \\
${"  "}   /    \\
${"  "}  /      \\
${"  "} /  /\\    \\
${"  "}/  /  \\    \\
${"  "}/  /    \\    \\
${"  "}\\  \\    /  /
${"  "} \\  \\  /  /
${"  "}  \\  \\/  /
${"  "}   \\    /
${"  "}    \\  /
${"  "}     \\/</pre>
    <dl class="fetch-info">
      <div><dt>user</dt><dd>${escapeHtml(session.user.username)}</dd></div>
      <div><dt>host</dt><dd>nwhelper-os</dd></div>
      <div><dt>shell</dt><dd>zsh 5.9</dd></div>
      <div><dt>wm</dt><dd>pinknord</dd></div>
      <div><dt>kernel</dt><dd>${escapeHtml(node)}</dd></div>
      <div><dt>uptime</dt><dd>${uptimeHours}h ${uptimeMin}m</dd></div>
      <div><dt>guilds</dt><dd>${totalGuilds}</dd></div>
      <div><dt>theme</dt><dd>PinkNord</dd></div>
      <div><dt>accent</dt><dd>#FA5AA4</dd></div>
    </dl>
    <div class="fetch-divider" aria-hidden="true"></div>
    <div class="fetch-telemetry">
      <p class="fetch-section-label">telemetry</p>
      <dl class="fetch-telemetry-grid">
        <div><dt>shared</dt><dd>${totalGuilds}</dd></div>
        <div><dt>active</dt><dd>${totalActive}</dd></div>
        <div><dt>queued</dt><dd>${totalUpcoming}</dd></div>
        <div><dt>signups</dt><dd>${totalSignups}</dd></div>
        <div><dt>ready</dt><dd>${ready}/${totalGuilds}</dd></div>
        <div><dt>announce</dt><dd>${nextAnnounce ? escapeHtml(nextAnnounce.nextAnnouncement ?? "queued") : "none"}</dd></div>
        <div><dt>war start</dt><dd>${next ? escapeHtml(next.nextWarStart ?? "queued") : "none"}</dd></div>
      </dl>
    </div>
    <div class="swatches" aria-hidden="true" style="grid-column: 1 / -1;">${colors.map((c) => `<span style="background:${c.hex}" title="${c.name} ${c.hex}"></span>`).join("")}</div>
  </aside>`;
}
function renderPromptLine(parts = {}) {
    const user = parts.user ?? "nwhelper";
    const host = parts.host ?? "os";
    const path = parts.path ?? "~";
    return `<div class="prompt-line"><span class="user">${escapeHtml(user)}</span>@<span class="host">${escapeHtml(host)}</span>:<span class="path">${escapeHtml(path)}</span><span class="arrow">$</span>${parts.suffix ? `<span class="suffix">${escapeHtml(parts.suffix)}</span>` : ""}</div>`;
}
function renderTerminal(lines) {
    return `<pre class="terminal-block">${lines.map((line) => `<span class="t-line"><span class="t-${line.kind ?? "plain"}">${escapeHtml(line.text)}</span></span>`).join("")}</pre>`;
}
function renderHome(events, session, settings = {}) {
    if (!session) {
        const heroBody = `
      <p class="eyebrow">~/welcome.md</p>
      <h1>NW Helper keeps raids, rosters, and war stats organized.</h1>
      <p class="summary">Connect Discord to manage shared servers, schedule weekly Node War signup posts, track active rosters, and review uploaded scoreboard stats from one dark dashboard.</p>
      ${renderPromptLine({ path: "~", suffix: "cat welcome.md" })}
      ${renderTerminal([
            { kind: "comment", text: "# launch the bot, then sign in with Discord to unlock" },
            { kind: "key", text: "discord.oauth " },
            { kind: "val", text: "--scopes=identify,guilds" },
            { kind: "success", text: "  // ready" }
        ])}
      <div class="button-row">${renderAccountControls()}${renderInviteButton("Invite Bot")}</div>
    `;
        return `${renderWindow("welcome", heroBody, { prompt: "nwhelper@os" })}`;
    }
    const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
    if (!summaries.length) {
        return `${renderWindow("no-shared-servers", renderNoSharedServersHome(), { prompt: "nwhelper@os" })}${renderCountdownScript()}`;
    }
    const body = `
    ${renderPromptLine({ path: "~", suffix: "./nw-helper --dashboard" })}
    <section class="war-room-layout" aria-label="NW Helper war room">
      ${renderCommandRail()}
      ${renderPrimaryWarFocus(summaries, session)}
      ${renderReadinessPanel(summaries[0])}
    </section>
    <section class="fetch-strip">${renderFetchPanel(summaries, session)}</section>
    ${renderUpcomingRaidsTimeline(summaries)}
    ${renderServerFleetSection(summaries)}
    ${renderRecentActivitySection()}
  `;
    return `${renderWindow("nw-helper --dashboard", body, { prompt: "nwhelper@os" })}${renderCountdownScript()}`;
}
function renderEventList(events, session, guildId, summaries) {
    const selectedGuild = session?.guilds.find((guild) => guild.id === guildId);
    const selectedCanManage = Boolean(session && guildId && canManageGuild(session, guildId));
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
        const canManage = Boolean(session && event.guildId && canManageGuild(session, event.guildId));
        return `<article class="event-card group relative overflow-hidden">
        <div class="card-top"><span class="type-pill">${event.tier ? labelTier(event.tier) : event.kind === "siege" ? "Siege" : "Node War"}</span><span class="status-pill ${active ? "status-active" : "status-inactive"}">${active ? "Active" : "Inactive"}</span></div>
        <a class="event-title" href="/events/${event.id}"><strong>${escapeHtml(scheduleTitle(event))}</strong></a>
        <small>Created ${formatDateLabel(event.createdAt.slice(0, 10))}</small>
        <small>Current roster ${escapeHtml(event.title)}</small>
        <small>Following signup post ${formatAnnouncementLabel(event)}</small>
        <small>War starts ${formatClockTime(event.time)} ${escapeHtml(config.timezone)}</small>
        <small>Schedule ${labelRecurrence(event.recurrence)} | ${formatRaidDays(event)}</small>
        <span class="card-meter"><i style="width:${capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0}%"></i></span>
        <div class="card-switches">${canManage && session ? `${renderCardToggle(event, session.csrfToken, "status", "Status", active)}${renderCardToggle(event, session.csrfToken, "auto-repost", "Auto repost", autoRepost, event.recurrence !== "weekly")}` : ""}</div>
        <div class="card-footer"><b>${signed}/${capacity} signed</b><span class="card-actions"><a href="/events/${event.id}">Open</a>${canManage && session ? `<a href="/events/${event.id}/edit">Manage</a><form method="post" action="/events/${event.id}/delete" onsubmit="return confirm('Delete this raid event?')"><input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}"><button class="link-button danger-link" type="submit">Delete</button></form>` : ""}</span></div>
      </article>`;
    })
        .join("");
    const inner = `<main class="shell">
    ${selectedGuild ? `<section class="dashboard-head"><div class="guild-heading">${renderGuildAvatar(selectedGuild)}<div><p class="eyebrow">Raid dashboard</p><h1>${escapeHtml(selectedGuild.name)}</h1><p>Upcoming Node War rosters and recurring schedules.</p></div></div>${selectedCanManage ? `<a class="button" href="/create?guild=${encodeURIComponent(selectedGuild.id)}">+ Create raid</a>` : ""}</section>
    <section class="stats-row">
      ${renderStat("Active raids", String(activeEvents.length))}
      ${renderStat("Weekly posts", String(weeklyPosts))}
      ${renderStat("Total signups", String(totalSignups))}
      ${renderStat("Next announcement", nextAnnouncement ? `${formatDateLabel(nextAnnouncement.announcementDate)} ${formatClockTime(nextAnnouncement.announcementTime)}` : "None queued")}
    </section>` : ""}
    ${selectedGuild ? `<section class="event-grid">${cards || `<div class="empty-state"><h2>No raids scheduled</h2><p>${selectedCanManage ? "Create a roster or use the Discord wizard to get started." : "No active raids are posted for this server yet."}</p></div>`}</section>` : ""}
  </main>`;
    return `${renderWindow(selectedGuild ? `ls /guilds/${escapeHtml(selectedGuild.name)}/raids` : "raids", inner, { prompt: "nwhelper@os" })}`;
}
function renderMemberLogin() {
    return `<main class="shell member-shell">
    <section class="member-hero member-login-hero">
      <div><p class="eyebrow">Member roster view</p><h1>Check your guild's Node War roster without admin controls.</h1><p>Log in with Discord to see only servers you share with NW Helper and the current raid rosters available to your account.</p><div class="button-row"><a class="button" href="/auth/discord">Log in with Discord</a>${renderInviteButton("Invite Bot")}</div></div>
    </section>
  </main>`;
}
function renderAllRaidsDashboard(session, summaries) {
    const raids = summaries
        .flatMap((summary) => summary.events.map((event) => ({ summary, event, sortTime: eventSortTimestamp(event) })))
        .sort((left, right) => left.sortTime - right.sortTime);
    const inner = `<main class="shell member-shell">
    <section class="member-hero">
      <div><p class="eyebrow">All raids</p><h1>Raid board across your shared servers</h1><p>Aggregated read-only raid schedule for every server you share with NW Helper.</p></div>
      <dl class="member-telemetry">
        <div><dt>Servers</dt><dd>${summaries.length}</dd></div>
        <div><dt>Total raids</dt><dd>${raids.length}</dd></div>
        <div><dt>Active</dt><dd>${raids.filter(({ event }) => isEventActive(event)).length}</dd></div>
        <div><dt>Signups</dt><dd>${summaries.reduce((sum, summary) => sum + summary.totalSignups, 0)}</dd></div>
      </dl>
    </section>
    <section class="member-section">
      <div class="section-title"><div><p class="eyebrow">Raid operations</p><h2>All visible schedules</h2></div><span>${raids.length} raids</span></div>
      <div class="member-raid-grid">${raids.map(({ summary, event }) => renderMemberRaidCard(summary, event)).join("") || `<div class="empty-state compact-empty"><h2>No raids found</h2><p>No raid schedules are available for your shared servers yet.</p></div>`}</div>
    </section>
  </main>`;
    return `${renderWindow("ls ~/raids", inner, { prompt: "nwhelper@os" })}${renderCountdownScript()}`;
}
function renderServersPicker(session, summaries, options = {}) {
    const targetTemplate = options.targetTemplate ?? "/guilds/{id}/stats";
    const title = options.title ?? "cd /servers";
    const prompt = options.prompt ?? "nwhelper@servers";
    const tone = options.tone ?? "cyan";
    const servers = summaries.map((summary, idx) => ({
        idx: idx + 1,
        id: summary.guild.id,
        name: summary.guild.name,
        icon: summary.guild.icon,
        active: summary.activeRaids,
        upcoming: summary.upcomingRaids,
        signups: summary.totalSignups,
        ready: summary.setupWarnings.length === 0,
        warnings: summary.setupWarnings
    }));
    const column = `<aside class="server-pick-rail">
    <p class="server-pick-eyebrow">fleet <span>${servers.length}</span></p>
    <ul class="server-pick-list" id="server-pick-list">${servers
        .map((s) => `<li class="server-pick-item" data-server-id="${escapeHtml(s.id)}" data-server-name="${escapeHtml(s.name.toLowerCase())}" data-server-index="${s.idx}">
          <span class="server-pick-num">${String(s.idx).padStart(2, "0")}</span>
          <span class="server-pick-name">${escapeHtml(s.name)}</span>
          <span class="server-pick-meta">
            <span class="server-pick-dot ${s.ready ? "is-ready" : "is-warn"}" title="${s.ready ? "ready" : s.warnings[0] ?? "attention"}"></span>
            <span class="server-pick-count">${s.active}·${s.upcoming}</span>
          </span>
        </li>`)
        .join("") || `<li class="server-pick-empty">no shared servers</li>`}</ul>
    <p class="server-pick-hint">click any server or type a name</p>
  </aside>`;
    const serverDataJson = JSON.stringify(servers.map((s) => ({ idx: s.idx, id: s.id, name: s.name, lower: s.name.toLowerCase() }))).replace(/"/g, "&quot;");
    const targetAttr = escapeHtml(targetTemplate);
    const terminal = `<section class="server-pick-terminal" data-servers="${serverDataJson}" data-target-template="${targetAttr}">
    <div class="terminal-output" id="server-pick-output" aria-live="polite">
      <div class="terminal-line t-info">┌── ${escapeHtml(prompt)}:~</div>
      <div class="terminal-line t-info">│ <span class="t-comment"># type </span><span class="t-key">ls</span><span class="t-comment"> to list servers, </span><span class="t-key">help</span><span class="t-comment"> for commands,</span></div>
      <div class="terminal-line t-info">│ <span class="t-comment"># or just type a server name / number to jump there.</span></div>
      <div class="terminal-line t-info">└─$ <span class="t-cursor">▮</span></div>
    </div>
    <form class="terminal-prompt-form" id="server-pick-form" action="javascript:void(0)" autocomplete="off" onsubmit="return false;">
      <span class="terminal-prompt-label">nwhelper<span class="t-muted">@</span><span class="t-success">servers</span><span class="t-muted">:</span><span class="t-path">~</span><span class="t-muted">$</span></span>
      <div class="terminal-prompt-input-wrap">
        <input type="text" id="server-pick-input" class="terminal-prompt-input" placeholder="ls | cd 1 | goto Zenolitee's server | help" autofocus spellcheck="false" autocapitalize="off" autocorrect="off" />
        <span class="t-cursor terminal-prompt-cursor" aria-hidden="true">▮</span>
      </div>
    </form>
  </section>`;
    const inner = `<main class="server-pick-shell">
    ${column}
    ${terminal}
  </main>`;
    return `${renderWindow(title, inner, { prompt: "nwhelper@os", tone })}`;
}
function renderCreateServerPicker(session, summaries) {
    const manageable = summaries.filter((summary) => canManageGuild(session, summary.guild.id));
    const inner = `<main class="shell member-shell">
    <section class="member-hero">
      <div><p class="eyebrow">Create raid</p><h1>Choose a server first</h1><p>Create permissions depend on Discord permissions. Pick the server where you want to schedule the roster.</p></div>
      <dl class="member-telemetry">
        <div><dt>Available</dt><dd>${manageable.length}</dd></div>
        <div><dt>Shared</dt><dd>${summaries.length}</dd></div>
        <div><dt>Active raids</dt><dd>${manageable.reduce((sum, summary) => sum + summary.activeRaids, 0)}</dd></div>
        <div><dt>Permission</dt><dd>Required</dd></div>
      </dl>
    </section>
    <section class="member-section">
      <div class="section-title"><div><p class="eyebrow">Server picker</p><h2>Where should this raid live?</h2></div><span>${manageable.length} manageable</span></div>
      <div class="member-server-grid">${manageable
        .map((summary) => `<article class="member-server-card">
            <div class="fleet-head">${renderGuildAvatar(summary.guild)}<div><h3>${escapeHtml(summary.guild.name)}</h3><small>${summary.activeRaids} active raids | ${escapeHtml(summary.nextAnnouncement)}</small></div></div>
            <span class="setup-pill ${summary.setupWarnings.length ? "setup-pill-warning" : "setup-pill-ready"}">${summary.setupWarnings.length ? "Setup warnings" : "Ready"}</span>
            <div class="fleet-links"><a href="/create?guild=${encodeURIComponent(summary.guild.id)}">Create Raid</a><a href="/guilds/${encodeURIComponent(summary.guild.id)}/raids">Raids</a><a href="/?guild=${encodeURIComponent(summary.guild.id)}">Dashboard</a></div>
          </article>`)
        .join("") || `<div class="empty-state compact-empty"><h2>No manageable servers</h2><p>Your Discord account needs Administrator, Manage Server, Manage Channels, Manage Roles, or Manage Messages on a shared server to create raids.</p></div>`}</div>
    </section>
  </main>`;
    return `${renderWindow("create --select-server", inner, { prompt: "nwhelper@os" })}`;
}
function renderMemberDashboard(session, summaries) {
    const events = summaries
        .flatMap((summary) => summary.events.filter(isEventActive).map((event) => ({ summary, event, sortTime: eventSortTimestamp(event) })))
        .sort((left, right) => left.sortTime - right.sortTime);
    const next = events[0];
    const totalSignups = summaries.reduce((sum, summary) => sum + summary.totalSignups, 0);
    const inner = `<main class="shell member-shell">
    ${summaries.length ? `<section class="member-hero">
      <div><p class="eyebrow">Member view</p><h1>Roster board for your shared servers</h1><p>Read-only raid schedule, signup counts, and roster composition. Admin configuration controls stay hidden here.</p></div>
      <dl class="member-telemetry">
        <div><dt>Servers</dt><dd>${summaries.length}</dd></div>
        <div><dt>Active raids</dt><dd>${events.length}</dd></div>
        <div><dt>Total signups</dt><dd>${totalSignups}</dd></div>
        <div><dt>Next</dt><dd>${next ? formatDateLabel(next.event.date) : "None"}</dd></div>
      </dl>
    </section>
    ${next ? renderMemberFeaturedRaid(next.summary, next.event) : renderMemberEmptyRaids(summaries[0].guild)}
    <section class="member-section">
      <div class="section-title"><div><p class="eyebrow">Available rosters</p><h2>Current raids</h2></div><span>${events.length} active</span></div>
      <div class="member-raid-grid">${events.map(({ summary, event }) => renderMemberRaidCard(summary, event)).join("") || `<div class="empty-state compact-empty"><h2>No active raids</h2><p>No current roster is available for your shared servers.</p></div>`}</div>
    </section>
    <section class="member-section">
      <div class="section-title"><div><p class="eyebrow">Server list</p><h2>Your NW Helper servers</h2></div><span>${summaries.length} visible</span></div>
      <div class="member-server-grid">${summaries.map(renderMemberServerCard).join("")}</div>
    </section>` : renderMemberNoServers()}
  </main>`;
    return `${renderWindow("member --roster", inner, { prompt: "nwhelper@os" })}${renderCountdownScript()}`;
}
function renderMemberFeaturedRaid(summary, event) {
    const signed = activeRosterSignupCount(event);
    const capacity = activeRosterCapacity(event);
    const percent = capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0;
    const announcement = getUpcomingAnnouncements(event, 1)[0];
    return `<section class="member-focus">
    <div class="member-focus-main">
      <p class="eyebrow">Next roster</p>
      <div class="war-focus-title">${renderGuildAvatar(summary.guild)}<div><p>${escapeHtml(summary.guild.name)}</p><h1>${escapeHtml(scheduleTitle(event))}</h1></div></div>
      <dl class="war-focus-grid">
        <div><dt>Date</dt><dd>${formatDateLabel(event.date)}</dd></div>
        <div><dt>War start</dt><dd>${formatClockTime(event.time)}</dd></div>
        <div><dt>Announcement</dt><dd>${formatAnnouncementLabel(event)}</dd></div>
        <div><dt>Countdown</dt><dd data-countdown="${announcement ? announcementTimestamp(announcement) : warStartTimestamp(event)}">${announcement ? formatAnnouncementDateTime(announcement) : formatClockTime(event.time)}</dd></div>
      </dl>
      <div class="war-progress"><div><span>Roster signed</span><b>${signed}/${capacity}</b></div><span class="card-meter"><i style="width:${percent}%"></i></span></div>
      <div class="button-row"><a class="button" href="/events/${encodeURIComponent(event.id)}">Open Roster</a><a class="button button-secondary" href="/guilds/${encodeURIComponent(summary.guild.id)}/raids">Server Raids</a></div>
    </div>
    <aside class="member-composition">${renderMemberComposition(event)}</aside>
  </section>`;
}
function renderMemberEmptyRaids(guild) {
    return `<section class="member-focus member-empty-focus"><div><p class="eyebrow">Next roster</p><h1>No active raids scheduled</h1><p>${escapeHtml(guild.name)} does not have a current member-visible roster yet.</p><a class="button button-secondary" href="/guilds/${encodeURIComponent(guild.id)}/raids">View Server Raids</a></div></section>`;
}
function renderMemberRaidCard(summary, event) {
    const signed = activeRosterSignupCount(event);
    const capacity = activeRosterCapacity(event);
    const percent = capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0;
    return `<article class="member-raid-card">
    <div class="card-top"><span>${escapeHtml(summary.guild.name)}</span><span class="status-pill ${isEventActive(event) ? "status-active" : "status-inactive"}">${isEventActive(event) ? "Active" : "Inactive"}</span></div>
    <h3>${escapeHtml(scheduleTitle(event))}</h3>
    <p>${formatDateLabel(event.date)} | ${formatClockTime(event.time)} | Announces ${formatAnnouncementLabel(event)}</p>
    <span class="card-meter"><i style="width:${percent}%"></i></span>
    <div class="featured-raid-footer"><b>${signed}/${capacity} signed</b><a href="/events/${encodeURIComponent(event.id)}">Open</a></div>
    ${renderMemberComposition(event)}
  </article>`;
}
function renderMemberComposition(event) {
    return `<dl class="member-composition-grid">${orderedGroups(event)
        .map((group) => {
        const count = event.signups.filter((signup) => signup.group === group.key).length;
        const value = isRosterGroup(group.key) ? `${count}/${group.capacity}` : String(count);
        return `<div><dt>${renderGroupIcon(group.key, group.emoji)}${escapeHtml(group.label)}</dt><dd>${value}</dd></div>`;
    })
        .join("")}</dl>`;
}
function renderMemberServerCard(summary) {
    return `<article class="member-server-card">
    <div class="fleet-head">${renderGuildAvatar(summary.guild)}<div><h3>${escapeHtml(summary.guild.name)}</h3><small>${summary.activeRaids} active raids | ${summary.totalSignups} signups</small></div></div>
    <span class="setup-pill ${summary.activeRaids ? "setup-pill-ready" : "setup-pill-warning"}">${summary.activeRaids ? "Roster live" : "No active raid"}</span>
    <div class="fleet-links"><a href="/guilds/${encodeURIComponent(summary.guild.id)}/raids">Raids</a><a href="/guilds/${encodeURIComponent(summary.guild.id)}/stats">Stats</a><a href="/?guild=${encodeURIComponent(summary.guild.id)}">Dashboard</a></div>
  </article>`;
}
function renderMemberNoServers() {
    return `<section class="member-hero member-login-hero"><div><p class="eyebrow">No shared servers</p><h1>No member rosters are available yet</h1><p>NW Helper only lists Discord servers where your account has access and the bot is installed.</p><div class="button-row">${renderInviteButton("Invite Bot")}<a class="button button-secondary" href="/auth/discord">Refresh Login</a></div></div></section>`;
}
function renderCardToggle(event, csrfToken, action, label, enabled, disabled = false) {
    const field = action === "status" ? "active" : "autoRepost";
    return `<form method="post" action="/events/${event.id}/${action}"><input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}"><input type="hidden" name="${field}" value="${enabled ? "false" : "true"}"><button class="switch-button${enabled ? " switch-on" : ""}" type="submit"${disabled ? " disabled" : ""}><span>${escapeHtml(label)}</span><i></i><b>${enabled ? "On" : "Off"}</b></button></form>`;
}
function renderNav(session, guildId, summaries) {
    const summaryList = summaries ?? (session ? buildGuildDashboardSummaries(session.guilds, []) : []);
    return `<header class="app-nav">
    <div class="nav-brand-row"><a class="brand" href="/"><span>NW</span><strong>NW Helper</strong></a></div>
    <nav>
      <a class="top-nav-link" href="/">${renderNavIcon("home")}<span>Home</span></a>
      ${session ? renderNavDropdown("Stats", "stats", summaryList, "stats") : `<a class="top-nav-link" href="/stats">${renderNavIcon("stats")}<span>Stats</span></a>`}
      ${session ? renderNavDropdown("Raids", "raids", summaryList, "raids") : `<a class="top-nav-link" href="/">${renderNavIcon("raids")}<span>Raids</span></a>`}
      ${session ? renderNavDropdown("Servers", "servers", summaryList, "servers") : ""}
    </nav>
    <div class="nav-actions">${renderAccountControls(session, guildId)}</div>
  </header>`;
}
function renderNavDropdown(label, icon, summaries, mode) {
    const items = summaries.map((summary) => renderNavGuildItem(summary, mode)).join("");
    return `<div class="nav-group nav-dropdown">
    <button class="nav-trigger" type="button" aria-haspopup="true">${renderNavIcon(icon)}<span>${escapeHtml(label)}</span><span class="nav-chevron" aria-hidden="true">${renderNavIcon("chevron")}</span></button>
    <div class="nav-menu">${items || "<span class=\"nav-empty\">No shared servers found</span>"}</div>
  </div>`;
}
function renderNavGuildItem(summary, mode) {
    const href = mode === "stats"
        ? `/guilds/${encodeURIComponent(summary.guild.id)}/stats`
        : mode === "raids"
            ? `/guilds/${encodeURIComponent(summary.guild.id)}/raids`
            : `/?guild=${encodeURIComponent(summary.guild.id)}`;
    const meta = mode === "stats"
        ? `${summary.activeRaids} active | ${summary.totalSignups} signups`
        : mode === "raids"
            ? `${summary.activeRaids} active raids`
            : `${summary.weeklyRaids ? `${summary.weeklyRaids} weekly` : "Setup ready"} | ${summary.activeRaids} active`;
    return `<a class="nav-guild-item" href="${href}">${renderGuildAvatar(summary.guild)}<span><b>${escapeHtml(summary.guild.name)}</b><small>${escapeHtml(meta)}</small></span></a>`;
}
function renderNavIcon(name) {
    const paths = {
        home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
        stats: '<path d="M4 19V5"/><path d="M4 19h17"/><path d="M8 16V9"/><path d="M13 16V6"/><path d="M18 16v-4"/>',
        raids: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/>',
        servers: '<rect x="4" y="5" width="16" height="5" rx="1.5"/><rect x="4" y="14" width="16" height="5" rx="1.5"/><path d="M8 7.5h.01"/><path d="M8 16.5h.01"/>',
        chevron: '<path d="m6 9 6 6 6-6"/>'
    };
    return `<svg class="nav-icon nav-icon-${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
function renderGuildAvatar(guild) {
    const avatar = guild.icon ? `https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=128` : undefined;
    return avatar
        ? `<img class="server-mark server-avatar" src="${escapeHtml(avatar)}" alt="">`
        : `<span class="server-mark">${escapeHtml(guild.name.slice(0, 1).toUpperCase())}</span>`;
}
function renderStat(label, value) {
    return `<article class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}
function renderGlobalStatsStrip(summaries) {
    const activeRaids = summaries.reduce((sum, summary) => sum + summary.activeRaids, 0);
    const upcomingRaids = summaries.reduce((sum, summary) => sum + summary.upcomingRaids, 0);
    const totalSignups = summaries.reduce((sum, summary) => sum + summary.totalSignups, 0);
    const nextAnnouncement = summaries.filter((summary) => summary.nextAnnouncementTime).sort((left, right) => (left.nextAnnouncementTime ?? 0) - (right.nextAnnouncementTime ?? 0))[0];
    const nextWar = summaries.filter((summary) => summary.nextWarStartTime).sort((left, right) => (left.nextWarStartTime ?? 0) - (right.nextWarStartTime ?? 0))[0];
    return `<section class="ops-telemetry" aria-label="Global operations telemetry">
    ${renderHomeStat("Servers", String(summaries.length), "Shared")}
    ${renderHomeStat("Active", String(activeRaids), "Raids")}
    ${renderHomeStat("Upcoming", String(upcomingRaids), "Queue")}
    ${renderHomeStat("Signups", String(totalSignups), "Roster")}
    ${renderHomeStat("Announce", nextAnnouncement?.nextAnnouncement ?? "None queued", "Next")}
    ${renderHomeStat("War start", nextWar?.nextWarStart ?? "No war queued", "Next")}
  </section>`;
}
function renderHomeStat(label, value, eyebrow) {
    return `<article class="telemetry-module"><span>${escapeHtml(eyebrow)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></article>`;
}
function renderCommandRail() {
    return `<aside class="command-rail" aria-label="Command actions">
    <p class="eyebrow">Command rail</p>
    ${renderCommandRailAction("Create Raid", "/create", "Choose server")}
    ${renderCommandRailAction("View All Raids", "/raids", "All shared servers")}
    ${renderCommandRailAction("View Stats", "/stats", "Choose server")}
    ${renderCommandRailAction("Manage Servers", "/servers", "Choose server")}
    ${botInviteUrl() ? renderCommandRailAction("Invite Bot", botInviteUrl(), "Expand fleet", true) : ""}
  </aside>`;
}
function renderCommandRailAction(label, href, meta, external = false) {
    return `<a class="command-action" href="${escapeHtml(href)}"${external ? " target=\"_blank\" rel=\"noreferrer\"" : ""}><strong>${escapeHtml(label)}</strong><span>${escapeHtml(meta)}</span></a>`;
}
function renderPrimaryWarFocus(summaries, session) {
    const focused = summaries
        .flatMap((summary) => summary.events.map((event) => ({ summary, event, sortTime: eventSortTimestamp(event) })))
        .sort((left, right) => left.sortTime - right.sortTime)[0];
    if (!focused) {
        const guild = summaries[0].guild;
        return `<section class="primary-war-focus empty-war-focus">
      <p class="eyebrow">Next node war</p>
      <h1>No raids scheduled yet</h1>
      <p>Start by creating a Node War schedule for ${escapeHtml(guild.name)}.</p>
      <div class="button-row"><a class="button" href="/create?guild=${encodeURIComponent(guild.id)}">Create Raid</a><a class="button button-secondary" href="/guilds/${encodeURIComponent(guild.id)}/raids">View Raids</a></div>
    </section>`;
    }
    const { summary, event } = focused;
    const signed = activeRosterSignupCount(event);
    const capacity = activeRosterCapacity(event);
    const percent = capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0;
    const territory = event.tier ? NODE_WAR_PRESETS[event.tier].territoryGroup : event.kind;
    const announcement = getUpcomingAnnouncements(event, 1)[0];
    const manageHref = canManageGuild(session, summary.guild.id) ? `/events/${encodeURIComponent(event.id)}/edit` : `/?guild=${encodeURIComponent(summary.guild.id)}`;
    return `<section class="primary-war-focus">
    <div class="war-focus-kicker"><span>NEXT ${announcement ? "ANNOUNCEMENT" : "NODE WAR"}</span><b data-countdown="${announcement ? announcementTimestamp(announcement) : warStartTimestamp(event)}">${announcement ? formatAnnouncementDateTime(announcement) : `${formatDateLabel(event.date)} ${formatClockTime(event.time)}`}</b></div>
    <div class="war-focus-title">
      ${renderGuildAvatar(summary.guild)}
      <div><p>${escapeHtml(summary.guild.name)}</p><h1>${escapeHtml(scheduleTitle(event))}</h1></div>
    </div>
    <dl class="war-focus-grid">
      <div><dt>Territory</dt><dd>${escapeHtml(territory)}</dd></div>
      <div><dt>Date</dt><dd>${formatDateLabel(event.date)}</dd></div>
      <div><dt>War start</dt><dd>${formatClockTime(event.time)}</dd></div>
      <div><dt>Announcement</dt><dd>${formatAnnouncementLabel(event)}</dd></div>
    </dl>
    <div class="war-progress"><div><span>Roster commitment</span><b>${signed}/${capacity}</b></div><span class="card-meter"><i style="width:${percent}%"></i></span></div>
    <div class="button-row"><a class="button" href="/events/${encodeURIComponent(event.id)}">Open Raid</a><a class="button button-secondary" href="${manageHref}">Manage</a></div>
  </section>`;
}
function renderReadinessPanel(summary) {
    return `<aside class="readiness-panel">
    <div class="readiness-head">${renderGuildAvatar(summary.guild)}<div><p class="eyebrow">Server readiness</p><h2>${escapeHtml(summary.guild.name)}</h2></div></div>
    <dl class="readiness-metrics">
      <div><dt>Active raids</dt><dd>${summary.activeRaids}</dd></div>
      <div><dt>Upcoming</dt><dd>${summary.upcomingRaids}</dd></div>
      <div><dt>Signups</dt><dd>${summary.totalSignups}</dd></div>
    </dl>
    <ul class="readiness-list">
      ${renderSetupLine(summary.botInstalled, "Bot Installed", "Bot unavailable")}
      ${renderSetupLine(summary.channelConfigured, "Channel Configured", "Channel not configured")}
      ${renderSetupLine(summary.roleConfigured, "Role Configured", "Role not configured")}
      ${renderSetupLine(summary.schedulerActive, "Scheduler Active", "No active schedule")}
    </ul>
  </aside>`;
}
function renderUpcomingRaidsTimeline(summaries) {
    const raids = summaries
        .flatMap((summary) => summary.events.map((event) => ({ summary, event, sortTime: eventSortTimestamp(event) })))
        .sort((left, right) => left.sortTime - right.sortTime)
        .slice(0, 6);
    return `<section class="timeline-section">
    <div class="section-title"><div><p class="eyebrow">Mission timeline</p><h2>Upcoming raids</h2></div><a href="/raids">View all raids</a></div>
    <div class="raid-timeline">${raids
        .map(({ summary, event }) => {
        const signed = activeRosterSignupCount(event);
        const capacity = activeRosterCapacity(event);
        return `<article class="timeline-item">
          <time>${formatDateLabel(event.date)}</time>
          <span class="timeline-node"></span>
          <div><div class="card-top"><b>${escapeHtml(summary.guild.name)}</b><span class="status-pill ${isEventActive(event) ? "status-active" : "status-inactive"}">${isEventActive(event) ? "Active" : "Inactive"}</span></div><h3>${escapeHtml(scheduleTitle(event))}</h3><p>${signed}/${capacity} signed | Announces ${formatAnnouncementLabel(event)} | War ${formatClockTime(event.time)}</p></div>
        </article>`;
    })
        .join("") || `<article class="empty-state compact-empty"><h2>No upcoming raids</h2><p>Create a raid from the command rail to start building the schedule.</p></article>`}</div>
  </section>`;
}
function renderServerFleetSection(summaries) {
    return `<section class="fleet-section">
    <div class="section-title"><div><p class="eyebrow">Server fleet</p><h2>Shared Discord servers</h2></div><span>${summaries.filter((summary) => !summary.setupWarnings.length).length}/${summaries.length} ready</span></div>
    <div class="server-fleet-grid">${summaries
        .map((summary) => `<article class="fleet-card">
          <div class="fleet-head">${renderGuildAvatar(summary.guild)}<div><h3>${escapeHtml(summary.guild.name)}</h3><small>${summary.activeRaids} active | ${escapeHtml(summary.nextAnnouncement)}</small></div></div>
          <span class="setup-pill ${summary.setupWarnings.length ? "setup-pill-warning" : "setup-pill-ready"}">${summary.setupWarnings.length ? "Attention" : "Ready"}</span>
          <div class="fleet-links"><a href="/guilds/${encodeURIComponent(summary.guild.id)}/raids">Raids</a><a href="/guilds/${encodeURIComponent(summary.guild.id)}/stats">Stats</a><a href="/?guild=${encodeURIComponent(summary.guild.id)}">Manage</a></div>
        </article>`)
        .join("")}</div>
  </section>`;
}
function renderSetupLine(ok, ready, warning) {
    return `<li class="${ok ? "is-ready" : "is-warning"}"><span>${ok ? "OK" : "!"}</span>${escapeHtml(ok ? ready : warning)}</li>`;
}
function renderRecentActivitySection() {
    return `<section class="activity-section">
    <div><p class="eyebrow">Recent activity</p><h2>Latest dashboard changes</h2></div>
    <p>No recent activity yet</p>
  </section>`;
}
function renderNoSharedServersHome() {
    return `<section class="home-hero logged-out-hero command-hero">
    <div><p class="eyebrow">No shared servers</p><h1>No Discord servers are available yet</h1><p>NW Helper only lists servers where your Discord account has access and the bot is installed. Invite the bot, then log in again to refresh your session.</p><div class="button-row">${renderInviteButton("Invite Bot")}<a class="button button-secondary" href="/auth/discord">Refresh Login</a></div></div>
  </section>`;
}
function buildGuildDashboardSummaries(guilds, events, settings = {}) {
    return guilds.map((guild) => {
        const visibleEvents = events.filter((event) => event.guildId === guild.id && (!event.closed || (event.recurrence === "once" && event.active === false)));
        const activeEvents = visibleEvents.filter(isEventActive);
        const announcements = activeEvents.flatMap((event) => getUpcomingAnnouncements(event, 1)).sort((left, right) => announcementTimestamp(left) - announcementTimestamp(right));
        const featuredRaid = [...activeEvents].sort((left, right) => eventSortTimestamp(left) - eventSortTimestamp(right))[0];
        const nextWar = featuredRaid ? warStartTimestamp(featuredRaid) : undefined;
        const channelConfigured = Boolean(settings.nodeWarChannelIds?.[guild.id] || settings.nodeWarChannelId || activeEvents.some((event) => event.announcementChannelId || event.channelId));
        const roleConfigured = activeEvents.some((event) => Boolean(event.announcementRoleIds?.length || event.announcementRoleId));
        const schedulerActive = activeEvents.some((event) => event.autoRepost !== false || event.announcementDate || event.recurrence === "weekly");
        const setupWarnings = [
            ...(channelConfigured ? [] : ["Channel not configured"]),
            ...(roleConfigured ? [] : ["Role not configured"]),
            ...(schedulerActive ? [] : ["No active schedule"])
        ];
        return {
            guild,
            activeRaids: activeEvents.length,
            upcomingRaids: announcements.length,
            totalSignups: activeEvents.reduce((sum, event) => sum + activeRosterSignupCount(event), 0),
            weeklyRaids: activeEvents.filter((event) => event.recurrence === "weekly").length,
            nextAnnouncement: announcements[0] ? formatAnnouncementDateTime(announcements[0]) : "None queued",
            nextAnnouncementTime: announcements[0] ? announcementTimestamp(announcements[0]) : undefined,
            nextWarStart: featuredRaid ? `${formatDateLabel(featuredRaid.date)} ${formatClockTime(featuredRaid.time)}` : "No war queued",
            nextWarStartTime: nextWar,
            featuredRaid,
            botInstalled: true,
            channelConfigured,
            roleConfigured,
            schedulerActive,
            setupWarnings,
            events: visibleEvents
        };
    });
}
function eventSortTimestamp(event) {
    const announcement = getUpcomingAnnouncements(event, 1)[0];
    return announcement ? announcementTimestamp(announcement) : warStartTimestamp(event);
}
function warStartTimestamp(event) {
    return new Date(`${event.date}T${event.time}:00+08:00`).getTime();
}
function renderStatsServerPicker(session, summaries) {
    const list = summaries ?? buildGuildDashboardSummaries(session.guilds, [], {});
    return renderServersPicker(session, list, {
        title: "cat /stats/index",
        prompt: "nwhelper@stats",
        tone: "magenta",
        targetTemplate: "/stats?guild={id}"
    });
}
function renderStatsDashboard(guild, session, reports, notice, sortKey = "wars", canManage = false, summaries) {
    const rows = reports.flatMap((report) => report.rows);
    const players = sortScoreAggregates(aggregateScoreRows(rows), sortKey);
    const latest = reports[0];
    const topDamage = Math.max(1, ...players.map((player) => player.damageDealt));
    const totalKills = rows.reduce((sum, row) => sum + row.kills, 0);
    const totalDeaths = rows.reduce((sum, row) => sum + row.deaths, 0);
    return `<main class="shell stats-shell">
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
    ${canManage ? `<section class="stats-workspace">
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
    </section>` : ""}
    <section class="stats-analysis-panel">
      <header><p class="eyebrow">Player analysis</p><h2>Participation and performance</h2></header>
      ${players.length ? `${renderScoreGraphics(players, reports)}${renderScoreTables(players, topDamage, sortKey, guild.id, session.csrfToken, canManage)}` : `<div class="empty-state compact-empty"><h2>No score data yet</h2><p>${canManage ? "Upload a scoreboard screenshot to start tracking player performance." : "No score data has been uploaded for this server yet."}</p></div>`}
    </section>
    <section class="section-title stats-title"><div><p class="eyebrow">Reports</p><h2>Recent scoreboards</h2></div><span>${reports.length} stored</span></section>
    ${renderReportsTerminal(reports, session.csrfToken, canManage)}
  </main>`;
}
function renderStatsNotice(notice) {
    if (notice === "uploaded")
        return "Scoreboard uploaded and parsed. Review the extracted rows before using them for final calls.";
    if (notice === "rescanned")
        return "Scoreboard rescanned from the stored image. Review the extracted rows before using them for final calls.";
    if (notice === "saved")
        return "Scoreboard edits saved.";
    if (notice === "renamed")
        return "Player name updated across matching score rows.";
    return "Scoreboard deleted.";
}
function renderScoreGraphics(players, reports) {
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
    ${renderMetricLeaderboard("Attendance leaders", "Wars joined", players, (player) => player.participations)}
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
function renderMixBar(label, value, total, tone) {
    return `<div class="mix-bar mix-${tone}"><span><b>${escapeHtml(label)}</b><small>${formatStatNumber(value)}</small></span><i style="width:${Math.max(3, Math.round((value / total) * 100))}%"></i></div>`;
}
function renderMetricLeaderboard(title, eyebrow, players, metric) {
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
function renderScoreTables(players, topDamage, sortKey, guildId, csrfToken, canManage) {
    const impactScores = calculateImpactScores(players);
    return `<section class="score-table-tabs" data-score-tabs>
    <div class="score-tab-bar" role="tablist">
      <button type="button" class="score-tab is-active" data-tab-target="scoreboard-totals" role="tab" aria-selected="true">▸ Scoreboard totals</button>
      <button type="button" class="score-tab" data-tab-target="impact-formula" role="tab" aria-selected="false">▸ Impact formula</button>
      <span class="score-tab-meta">Kills 20% · Assists 10% · Damage 20% · Fort 30% · Obj 10% · Survive 10%</span>
    </div>
    <div class="score-table-panel score-table-panel-main score-tab-panel is-active" data-tab-panel="scoreboard-totals" role="tabpanel">
      <header><h3>Raw stats</h3><small>Sort each column to inspect volume, pressure, and support.</small></header>
      ${renderScoreTable(players, topDamage, sortKey, guildId, csrfToken, canManage)}
    </div>
    <div class="score-table-panel impact-panel score-tab-panel" data-tab-panel="impact-formula" role="tabpanel" hidden>
      <header><p class="eyebrow">Impact formula</p><h3>Impact ranking</h3><small>Weighted score: Kills 20% | Assists 10% | Damage 20% | Fort 30% | Objectives 10% | Survival 10%</small></header>
      ${renderImpactTable(impactScores)}
    </div>
  </section>${renderScoreSortScript()}${renderScoreTabsScript()}`;
}
function renderScoreTabsScript() {
    return `<script>
(() => {
  function bind() {
    document.querySelectorAll("[data-score-tabs]").forEach(function (root) {
      if (root.dataset.tabsBound === "1") return;
      root.dataset.tabsBound = "1";
      var buttons = root.querySelectorAll("[data-tab-target]");
      var panels = root.querySelectorAll("[data-tab-panel]");
      buttons.forEach(function (btn) {
        btn.addEventListener("click", function () {
          var target = btn.getAttribute("data-tab-target");
          buttons.forEach(function (b) {
            var on = b === btn;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-selected", on ? "true" : "false");
          });
          panels.forEach(function (p) {
            var on = p.getAttribute("data-tab-panel") === target;
            p.classList.toggle("is-active", on);
            if (on) { p.removeAttribute("hidden"); } else { p.setAttribute("hidden", ""); }
          });
        });
      });
    });
  }
  bind();
  try { new MutationObserver(bind).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
})();
</script>`;
}
function renderScoreTable(players, topDamage, sortKey, guildId, csrfToken, canManage) {
    return `<div class="score-table-wrap"><table class="score-table" data-score-table data-score-sort="${sortKey}">
    <thead><tr><th>${renderScoreSortButton("Player", "player", sortKey)}</th><th>${renderScoreSortButton("Wars", "wars", sortKey)}</th><th>${renderScoreSortButton("K", "kills", sortKey)}</th><th>${renderScoreSortButton("D", "deaths", sortKey)}</th><th>${renderScoreSortButton("K/D", "kd", sortKey)}</th><th>${renderScoreSortButton("Damage", "damage", sortKey)}</th><th>${renderScoreSortButton("Taken", "taken", sortKey)}</th><th>${renderScoreSortButton("CC", "cc", sortKey)}</th><th>${renderScoreSortButton("Healed", "healed", sortKey)}</th><th>${renderScoreSortButton("Structure", "structure", sortKey)}</th></tr></thead>
    <tbody>${players
        .map((player) => {
        const healed = player.allySupport;
        const kd = player.deaths ? player.kills / player.deaths : player.kills;
        return `<tr data-player="${escapeHtml(player.familyName.toLowerCase())}" data-wars="${player.participations}" data-kills="${player.kills}" data-deaths="${player.deaths}" data-kd="${kd}" data-damage="${player.damageDealt}" data-taken="${player.damageTaken}" data-cc="${player.crowdControls}" data-healed="${healed}" data-structure="${player.structureDamage}">
          <td><span class="player-cell"><strong>${escapeHtml(player.familyName)}</strong>${canManage ? renderPlayerRenameControl(player.familyName, guildId, csrfToken) : ""}</span><span class="damage-bar"><i style="width:${Math.max(4, Math.round((player.damageDealt / topDamage) * 100))}%"></i></span></td>
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
    })
        .join("")}</tbody>
  </table></div>`;
}
function renderImpactTable(impactScores) {
    const topScore = Math.max(1, ...impactScores.map((impact) => impact.score));
    return `<div class="impact-summary">
    <span><b>${impactScores.length}</b><small>ranked players</small></span>
    <span><b>${impactScores[0] ? impactScores[0].score.toFixed(1) : "0.0"}</b><small>top impact</small></span>
  </div>
  <div class="score-table-wrap impact-table-wrap"><table class="score-table impact-table" data-score-table data-score-sort="impact">
    <thead><tr><th>${renderScoreSortButton("Player", "player", "impact")}</th><th>${renderScoreSortButton("Impact", "impact", "impact")}</th><th>${renderScoreSortButton("Fort", "structure", "impact")}</th><th>${renderScoreSortButton("Obj", "objective", "impact")}</th><th>${renderScoreSortButton("Surv", "survival", "impact")}</th></tr></thead>
    <tbody>${impactScores
        .map((impact, index) => {
        const player = impact.player;
        const topClass = index < 3 ? ` impact-rank-top impact-rank-${index + 1}` : "";
        return `<tr class="${topClass}" data-player="${escapeHtml(player.familyName.toLowerCase())}" data-impact="${impact.score}" data-structure="${impact.structureScore}" data-objective="${impact.objectiveScore}" data-survival="${impact.survivalScore}">
          <td><span class="impact-player"><b>${index + 1}</b><strong>${escapeHtml(player.familyName)}</strong></span><span class="impact-bar"><i style="width:${Math.max(4, Math.round((impact.score / topScore) * 100))}%"></i></span></td>
          <td><strong>${impact.score.toFixed(1)}</strong></td>
          <td>${impact.structureScore.toFixed(0)}</td>
          <td>${impact.objectiveScore.toFixed(0)}</td>
          <td>${impact.survivalScore.toFixed(0)}</td>
        </tr>
        <tr class="impact-breakdown" data-player="${escapeHtml(player.familyName.toLowerCase())}" data-impact="${impact.score}" data-structure="${impact.structureScore}" data-objective="${impact.objectiveScore}" data-survival="${impact.survivalScore}">
          <td colspan="5">
            <div>
              ${renderImpactChip("K", impact.killsScore, "kills")}
              ${renderImpactChip("A", impact.assistsScore, "assists")}
              ${renderImpactChip("DMG", impact.damageScore, "damage")}
              ${renderImpactChip("FORT", impact.structureScore, "structure")}
              ${renderImpactChip("OBJ", impact.objectiveScore, "objective")}
              ${renderImpactChip("LIFE", impact.survivalScore, "survival")}
            </div>
          </td>
        </tr>`;
    })
        .join("")}</tbody>
  </table></div>`;
}
function renderImpactChip(label, score, tone) {
    return `<span class="impact-chip impact-chip-${escapeHtml(tone)}"><b>${escapeHtml(label)}</b><small>${score.toFixed(0)}</small></span>`;
}
function renderPlayerRenameControl(familyName, guildId, csrfToken) {
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
function renderScoreSortButton(label, key, sortKey) {
    const active = key === sortKey ? " active" : "";
    return `<button class="score-sort-button${active}" type="button" data-score-sort-key="${escapeHtml(key)}" aria-label="Sort by ${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}
function renderScoreSortScript() {
    return `<script>
(() => {
  document.querySelectorAll("[data-score-table]").forEach((table) => {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const buttons = [...table.querySelectorAll("[data-score-sort-key]")];
    let activeKey = table.dataset.scoreSort || "wars";
    let direction = activeKey === "player" ? "asc" : "desc";
    const readValue = (row, key) => key === "player" ? row.dataset.player || "" : Number(row.dataset[key] || 0);
    const rowGroups = () => {
      const groups = [];
      for (let index = 0; index < tbody.rows.length; index += 1) {
        const row = tbody.rows[index];
        const nextRow = tbody.rows[index + 1];
        if (nextRow && nextRow.classList.contains("impact-breakdown")) {
          groups.push([row, nextRow]);
          index += 1;
        } else {
          groups.push([row]);
        }
      }
      return groups;
    };
    const applySort = (key, nextDirection) => {
      const groups = rowGroups();
      groups.sort((leftGroup, rightGroup) => {
        const left = leftGroup[0];
        const right = rightGroup[0];
        const leftValue = readValue(left, key);
        const rightValue = readValue(right, key);
        const compared = typeof leftValue === "string" ? leftValue.localeCompare(String(rightValue)) : leftValue - Number(rightValue);
        return nextDirection === "asc" ? compared : -compared;
      });
      groups.flat().forEach((row) => tbody.appendChild(row));
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
  });
})();
</script>`;
}
function renderReportCard(report, csrfToken, canManage) {
    const rows = report.rows;
    const kills = rows.reduce((sum, row) => sum + row.kills, 0);
    const deaths = rows.reduce((sum, row) => sum + row.deaths, 0);
    const damage = rows.reduce((sum, row) => sum + row.damageDealt, 0);
    const killDeathPercent = deaths ? Math.round((kills / deaths) * 100) : kills ? 100 : 0;
    const kdTone = killDeathPercent >= 200 ? "good" : killDeathPercent >= 100 ? "ok" : "low";
    const confidence = report.ocrConfidence === undefined ? "n/a" : `${Math.round(report.ocrConfidence)}%`;
    const resultTone = report.result === "win" ? "win" : report.result === "loss" ? "loss" : "unknown";
    const truncatedEngine = report.ocrEngine.length > 18 ? report.ocrEngine.slice(0, 15) + "…" : report.ocrEngine;
    return `<article class="report-card">
    <div class="report-card-head">
      <p class="eyebrow report-result report-result-${resultTone}">${escapeHtml(report.result)}</p>
      <h3>${escapeHtml(report.title || formatDateLabel(report.warDate))}</h3>
      <div class="report-card-meta">
        <span class="report-meta-row"><span class="t-muted">date</span><b>${formatDateLabel(report.warDate)}</b></span>
        <span class="report-meta-row"><span class="t-muted">ocr</span><b title="${escapeHtml(report.ocrEngine)}">${escapeHtml(truncatedEngine)}</b></span>
        <span class="report-meta-row"><span class="t-muted">conf</span><b>${escapeHtml(confidence)}</b></span>
        <span class="report-meta-row"><span class="t-muted">by</span><b>${escapeHtml((report.uploadedBy ?? "Unknown").slice(0, 14))}</b></span>
      </div>
    </div>
    <dl>
      <div><dt>Players</dt><dd>${rows.length}</dd></div>
      <div><dt>Kills</dt><dd>${formatStatNumber(kills)}</dd></div>
      <div><dt>Deaths</dt><dd>${formatStatNumber(deaths)}</dd></div>
      <div><dt>K/D %</dt><dd><span class="kd-pill kd-${kdTone}">${killDeathPercent}%</span></dd></div>
      <div><dt>Damage</dt><dd>${formatStatNumber(damage)}</dd></div>
    </dl>
    <div class="report-actions${canManage ? " report-actions-manage" : " report-actions-view"}">
      <span class="report-actions-prompt">nwhelper<span class="t-muted">@</span>reports<span class="t-muted">:</span><span class="t-path">~</span><span class="t-muted">$</span></span>
      <a class="report-action" href="/stats/reports/${encodeURIComponent(report.id)}/preview?guild=${encodeURIComponent(report.guildId)}" target="_blank" rel="noopener"><span class="report-action-prompt">&gt;</span> preview</a>
      ${canManage ? `<a class="report-action" href="/stats/reports/${encodeURIComponent(report.id)}/edit?guild=${encodeURIComponent(report.guildId)}"><span class="report-action-prompt">&gt;</span> edit</a>
      <button class="report-action" type="button" data-report-action="rescan" data-report-id="${escapeHtml(report.id)}" data-guild-id="${escapeHtml(report.guildId)}" data-csrf="${escapeHtml(csrfToken)}"><span class="report-action-prompt">&gt;</span> rescan</button>
      <button class="report-action report-action-danger" type="button" data-report-action="delete" data-report-id="${escapeHtml(report.id)}" data-guild-id="${escapeHtml(report.guildId)}" data-csrf="${escapeHtml(csrfToken)}"><span class="report-action-prompt">&gt;</span> delete</button>` : ""}
    </div>
  </article>`;
}
function renderReportsTerminal(reports, csrfToken, canManage) {
    if (!reports.length) {
        return `<div class="empty-state compact-empty"><h2>No reports stored</h2><p>Uploaded screenshots will appear here.</p></div>`;
    }
    const sorted = [...reports].sort((a, b) => b.warDate.localeCompare(a.warDate));
    const reportsJson = JSON.stringify(sorted.map((r) => ({
        id: r.id,
        guildId: r.guildId,
        title: r.title || formatDateLabel(r.warDate),
        warDate: formatDateLabel(r.warDate),
        ocrEngine: r.ocrEngine,
        confidence: r.ocrConfidence === undefined ? "n/a" : `${Math.round(r.ocrConfidence)}%`,
        uploadedBy: r.uploadedBy ?? "Unknown",
        result: r.result,
        rows: r.rows,
        csrfToken
    }))).replace(/'/g, "&#39;").replace(/"/g, "&quot;");
    const rail = `<aside class="report-terminal-rail">
    <p class="report-terminal-eyebrow">scoreboards <span>${sorted.length}</span></p>
    <ul class="report-terminal-list" id="report-terminal-list">${sorted.map((r, idx) => {
        const kills = r.rows.reduce((s, row) => s + row.kills, 0);
        const deaths = r.rows.reduce((s, row) => s + row.deaths, 0);
        const resultTone = r.result === "win" ? "win" : r.result === "loss" ? "loss" : "unknown";
        return `<li class="report-terminal-item${idx === 0 ? " is-active" : ""}" data-report-idx="${idx}">
        <span class="report-terminal-pill report-result-${resultTone}">${escapeHtml(r.result)}</span>
        <span class="report-terminal-date">${escapeHtml(formatDateLabel(r.warDate))}</span>
        <span class="report-terminal-counts">${r.rows.length}p · ${formatStatNumber(kills)}k</span>
      </li>`;
    }).join("")}</ul>
    <p class="report-terminal-hint">click to select, then type a command</p>
  </aside>`;
    const panel = `<section class="report-terminal-panel" data-reports="${reportsJson}">
    <div class="report-terminal-output" id="report-terminal-output">
      <div class="terminal-line t-info">┌── nwhelper@reports:~</div>
      <div class="terminal-line t-info">│ <span class="t-comment"># click a scoreboard on the left, then type a command below.</span></div>
      <div class="terminal-line t-info">│ <span class="t-comment"># </span><span class="t-key">preview</span><span class="t-comment"> / </span><span class="t-key">edit</span><span class="t-comment"> / </span><span class="t-key">rescan</span><span class="t-comment"> / </span><span class="t-key">delete</span><span class="t-comment"> act on the selected one.</span></div>
      <div class="terminal-line t-info">│ <span class="t-comment"># add a number to target a different one, e.g. </span><span class="t-key">preview 2</span><span class="t-comment">.</span></div>
      <div class="terminal-line t-info">└─$ <span class="t-cursor">▮</span></div>
    </div>
    <form class="terminal-prompt-form report-terminal-prompt" id="report-terminal-form" action="javascript:void(0)" autocomplete="off" onsubmit="return false;">
      <span class="terminal-prompt-label">nwhelper<span class="t-muted">@</span>reports<span class="t-muted">:</span><span class="t-path">~</span><span class="t-muted">$</span></span>
      <div class="terminal-prompt-input-wrap">
        <input type="text" id="report-terminal-input" class="terminal-prompt-input" placeholder="preview | edit | rescan | delete | ls | help | clear" spellcheck="false" autocapitalize="off" autocorrect="off" />
        <span class="t-cursor terminal-prompt-cursor" aria-hidden="true">▮</span>
      </div>
    </form>
  </section>`;
    return `<section class="report-terminal-shell" data-report-terminal>
    ${rail}
    ${panel}
  </section>${renderReportsTerminalScript()}`;
}
function renderReportsTerminalScript() {
    return `<script>
(() => {
  function bind() {
    document.querySelectorAll("[data-report-terminal]").forEach(function (root) {
      if (root.dataset.terminalBound === "1") return;
      root.dataset.terminalBound = "1";
      var panel = root.querySelector(".report-terminal-panel");
      var output = root.querySelector("#report-terminal-output");
      var items = root.querySelectorAll(".report-terminal-item");
      var form = root.querySelector("#report-terminal-form");
      var input = root.querySelector("#report-terminal-input");
      if (!panel || !output || !items.length || !form || !input) return;

      var reports = [];
      try { reports = JSON.parse((panel.getAttribute("data-reports") || "").replace(/&quot;/g, '"').replace(/&#39;/g, "'")); } catch (e) { reports = []; }

      function escapeHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      }
      function clearOutput() {
        while (output.firstChild) output.removeChild(output.firstChild);
      }
      function line(text, kind) {
        var div = document.createElement("div");
        div.className = "terminal-line " + (kind ? "t-" + kind : "");
        div.textContent = text;
        output.appendChild(div);
        output.scrollTop = output.scrollHeight;
      }
      function lineHTML(html) {
        var div = document.createElement("div");
        div.className = "terminal-line";
        div.innerHTML = html;
        output.appendChild(div);
        output.scrollTop = output.scrollHeight;
      }
      function echoPrompt(text) {
        lineHTML(
          '<span class="t-success">nwhelper</span><span class="t-muted">@</span><span class="t-success">reports</span><span class="t-muted">:</span><span class="t-path">~</span><span class="t-muted">$</span> ' +
          '<span>' + escapeHtml(text) + '</span>'
        );
      }
      function findReport(query) {
        if (!query) return -1;
        var q = String(query).trim();
        var numeric = parseInt(q, 10);
        if (!isNaN(numeric) && String(numeric) === q) {
          if (numeric >= 1 && numeric <= reports.length) return numeric - 1;
        }
        var ql = q.toLowerCase();
        for (var i = 0; i < reports.length; i++) {
          if ((reports[i].title || "").toLowerCase() === ql) return i;
          if ((reports[i].warDate || "").toLowerCase() === ql) return i;
        }
        for (var j = 0; j < reports.length; j++) {
          if ((reports[j].title || "").toLowerCase().indexOf(ql) === 0) return j;
        }
        for (var k = 0; k < reports.length; k++) {
          if ((reports[k].title || "").toLowerCase().indexOf(ql) !== -1) return k;
        }
        return -1;
      }

      function showReport(idx) {
        var r = reports[idx];
        if (!r) return;
        clearOutput();
        items.forEach(function (el) { el.classList.toggle("is-active", Number(el.getAttribute("data-report-idx")) === idx); });
        var totalKills = r.rows.reduce(function (s, row) { return s + (row.kills || 0); }, 0);
        var totalDeaths = r.rows.reduce(function (s, row) { return s + (row.deaths || 0); }, 0);
        var totalDamage = r.rows.reduce(function (s, row) { return s + (row.damageDealt || 0); }, 0);
        var kd = totalDeaths ? Math.round((totalKills / totalDeaths) * 100) : (totalKills ? 100 : 0);
        line("━━ " + r.warDate + "  " + r.title + " ━━", "cyan");
        line("  result     " + r.result, r.result === "win" ? "success" : r.result === "loss" ? "error" : "muted");
        line("  ocr        " + r.ocrEngine + " (conf " + r.confidence + ")", "muted");
        line("  uploaded   " + r.uploadedBy, "muted");
        line("  players    " + r.rows.length, "info");
        line("  kills      " + totalKills.toLocaleString(), "info");
        line("  deaths     " + totalDeaths.toLocaleString(), "info");
        line("  k/d %      " + kd + "%", kd >= 200 ? "success" : kd >= 100 ? "warn" : "error");
        line("  damage     " + totalDamage.toLocaleString(), "info");
        line("", null);
        lineHTML(
          '<span class="t-comment">› selected · type one of:</span><br>' +
          '<span class="t-key">  preview</span><span class="t-muted">  ·  open the screenshot</span><br>' +
          '<span class="t-key">  edit</span><span class="t-muted">     ·  open the scoreboard editor</span><br>' +
          '<span class="t-key">  rescan</span><span class="t-muted">   ·  re-run OCR on the screenshot</span><br>' +
          '<span class="t-error">  delete</span><span class="t-muted">   ·  remove this scoreboard (asks first)</span>'
        );
        line("", null);
        line("> tip: click another scoreboard on the left, or add a number to target a different one (e.g. preview 2).", "muted");
      }

      function selectedReport() {
        var active = root.querySelector(".report-terminal-item.is-active");
        if (!active) return -1;
        return Number(active.getAttribute("data-report-idx"));
      }

      function runCommand(text) {
        var t = String(text || "").trim();
        echoPrompt(text);
        if (!t) return;
        var parts = t.split(/\\s+/);
        var cmd = parts[0].toLowerCase();
        var arg = parts.slice(1).join(" ");

        if (cmd === "help" || cmd === "?") {
          lineHTML(
            '<span class="t-info">Available commands</span><br>' +
            '<span class="t-comment">  click a scoreboard on the left to select it, then:</span><br>' +
            '<span class="t-key">  preview</span><span class="t-muted">          open the screenshot for the selected scoreboard</span><br>' +
            '<span class="t-key">  edit</span><span class="t-muted">             open the scoreboard editor</span><br>' +
            '<span class="t-key">  rescan</span><span class="t-muted">           re-run OCR on the screenshot</span><br>' +
            '<span class="t-error">  delete</span><span class="t-muted">           remove the selected scoreboard (asks first)</span><br>' +
            '<span class="t-key">  open &lt;n&gt;</span><span class="t-muted">       show details for scoreboard #n (alias: select, view)</span><br>' +
            '<span class="t-key">  preview &lt;n&gt; | edit &lt;n&gt; | rescan &lt;n&gt; | delete &lt;n&gt;</span><br>' +
            '<span class="t-muted">                       target a specific scoreboard by number, title, or date</span><br>' +
            '<span class="t-key">  ls</span><span class="t-muted">                 list scoreboards (alias: list)</span><br>' +
            '<span class="t-key">  clear</span><span class="t-muted">              clear the terminal (alias: cls)</span>'
          );
          return;
        }
        if (cmd === "ls" || cmd === "list") {
          line("idx  result  date            title                          players", "muted");
          reports.forEach(function (r, i) {
            line(
              String(i + 1).padStart(2, " ") + "   " +
              r.result.padEnd(7, " ") + "  " +
              (r.warDate || "").padEnd(15, " ") + "  " +
              (r.title || "").slice(0, 30).padEnd(30, " ") + "  " +
              r.rows.length + "p",
              "info"
            );
          });
          line(reports.length + " scoreboard" + (reports.length === 1 ? "" : "s"), "muted");
          return;
        }
        if (cmd === "clear" || cmd === "cls") {
          clearOutput();
          return;
        }
        var targetIdx = -1;
        if (cmd === "open" || cmd === "select" || cmd === "view") {
          targetIdx = arg ? findReport(arg) : selectedReport();
        } else if (cmd === "preview" || cmd === "edit" || cmd === "rescan" || cmd === "delete") {
          targetIdx = arg ? findReport(arg) : selectedReport();
        }
        if (["open", "select", "view", "preview", "edit", "rescan", "delete"].indexOf(cmd) !== -1) {
          if (targetIdx < 0) { line("no scoreboard matches '" + (arg || "current") + "'", "error"); return; }
          var r = reports[targetIdx];
          if (!r) { line("scoreboard not found", "error"); return; }
          if (cmd === "open" || cmd === "select" || cmd === "view") {
            showReport(targetIdx);
            return;
          }
          if (cmd === "preview") { window.location.href = "/stats/reports/" + r.id + "/preview"; return; }
          if (cmd === "edit") { window.location.href = "/stats/reports/" + r.id + "/edit"; return; }
          if (cmd === "delete") {
            if (!confirm("Delete scoreboard " + r.title + "?")) { line("delete cancelled", "muted"); return; }
            var formEl = document.createElement("form");
            formEl.method = "post";
            formEl.action = "/stats/reports/" + r.id + "/delete";
            var csrf = document.createElement("input");
            csrf.type = "hidden";
            csrf.name = "csrfToken";
            csrf.value = r.csrfToken || "";
            formEl.appendChild(csrf);
            var gid = document.createElement("input");
            gid.type = "hidden";
            gid.name = "guildId";
            gid.value = r.guildId || "";
            formEl.appendChild(gid);
            document.body.appendChild(formEl);
            formEl.submit();
            return;
          }
          if (cmd === "rescan") {
            var formEl2 = document.createElement("form");
            formEl2.method = "post";
            formEl2.action = "/stats/reports/" + r.id + "/rescan";
            var csrf2 = document.createElement("input");
            csrf2.type = "hidden";
            csrf2.name = "csrfToken";
            csrf2.value = r.csrfToken || "";
            formEl2.appendChild(csrf2);
            var gid2 = document.createElement("input");
            gid2.type = "hidden";
            gid2.name = "guildId";
            gid2.value = r.guildId || "";
            formEl2.appendChild(gid2);
            document.body.appendChild(formEl2);
            formEl2.submit();
            return;
          }
        }

        var direct = findReport(t);
        if (direct >= 0) { showReport(direct); return; }

        line("command not found: " + cmd, "error");
        line("type 'help' for the list of commands", "muted");
      }

      items.forEach(function (item) {
        item.addEventListener("click", function () {
          showReport(Number(item.getAttribute("data-report-idx")));
        });
      });

      form.addEventListener("submit", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        var val = input.value;
        input.value = "";
        runCommand(val);
        return false;
      });

      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          var val = input.value;
          input.value = "";
          runCommand(val);
        }
      });

      // Show first report by default
      showReport(0);
    });
  }
  bind();
  try { new MutationObserver(bind).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
})();
</script>`;
}
function renderScoreReportEditor(guild, session, report) {
    const rows = [...report.rows, ...Array.from({ length: 3 }, () => undefined)];
    const inner = `<main class="shell stats-shell">
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
    return `${renderWindow(`vim /stats/reports/${escapeHtml(report.id)}`, inner, { prompt: "nwhelper@os" })}`;
}
function renderScoreResultOptions(selected) {
    return ["unknown", "win", "loss"]
        .map((result) => `<option value="${result}"${selected === result ? " selected" : ""}>${result[0].toUpperCase()}${result.slice(1)}</option>`)
        .join("");
}
function renderScoreEditCard(row, index) {
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
function renderScoreEditField(label, name, value, type = "number", placeholder = "0") {
    return `<label>${escapeHtml(label)}<input name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(String(value))}" placeholder="${escapeHtml(placeholder)}"${type === "number" ? " min=\"0\" step=\"1\"" : ""}></label>`;
}
function aggregateScoreRows(rows) {
    const byPlayer = new Map();
    for (const row of rows) {
        const key = row.familyName.toLowerCase();
        const player = byPlayer.get(key) ??
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
    return [...byPlayer.values()].sort((left, right) => right.participations - left.participations ||
        right.damageDealt - left.damageDealt ||
        right.kills - left.kills ||
        left.familyName.localeCompare(right.familyName));
}
function calculateImpactScores(players) {
    const maxKills = Math.max(1, ...players.map((player) => player.kills));
    const maxAssists = Math.max(1, ...players.map((player) => player.assists));
    const maxDamage = Math.max(1, ...players.map((player) => player.damageDealt));
    const maxStructure = Math.max(1, ...players.map((player) => player.structureDamage));
    const objectiveRaw = (player) => player.crowdControls + player.resurrections * 5 + Math.round((player.hpHealed + player.allySupport) / 100_000);
    const maxObjective = Math.max(1, ...players.map(objectiveRaw));
    const normalized = (value, maxValue) => Math.min(100, (value / maxValue) * 100);
    return players
        .map((player) => {
        const killsScore = normalized(player.kills, maxKills);
        const assistsScore = normalized(player.assists, maxAssists);
        const damageScore = normalized(player.damageDealt, maxDamage);
        const structureScore = normalized(player.structureDamage, maxStructure);
        const rawObjective = objectiveRaw(player);
        const objectiveScore = normalized(rawObjective, maxObjective);
        const deathsPerWar = player.participations ? player.deaths / player.participations : player.deaths;
        const survivalScore = Math.max(0, Math.min(100, 100 - deathsPerWar * 12));
        const score = killsScore * 0.2 + assistsScore * 0.1 + damageScore * 0.2 + structureScore * 0.3 + objectiveScore * 0.1 + survivalScore * 0.1;
        return {
            player,
            score,
            killsScore,
            assistsScore,
            damageScore,
            structureScore,
            objectiveScore,
            survivalScore
        };
    })
        .sort((left, right) => right.score - left.score || right.player.structureDamage - left.player.structureDamage || right.player.damageDealt - left.player.damageDealt || left.player.familyName.localeCompare(right.player.familyName));
}
function sortScoreAggregates(players, sortKey) {
    return [...players].sort((left, right) => {
        if (sortKey === "kills")
            return right.kills - left.kills || right.damageDealt - left.damageDealt || left.familyName.localeCompare(right.familyName);
        if (sortKey === "damage")
            return right.damageDealt - left.damageDealt || right.kills - left.kills || left.familyName.localeCompare(right.familyName);
        return right.participations - left.participations || right.damageDealt - left.damageDealt || right.kills - left.kills || left.familyName.localeCompare(right.familyName);
    });
}
function parseScoreSortKey(value) {
    return value === "kills" || value === "damage" ? value : "wars";
}
function renderInviteButton(label = "Invite to Server") {
    const url = botInviteUrl();
    if (!url) {
        return "";
    }
    return `<a class="button button-secondary" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}
function botInviteUrl() {
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
function renderEventDetail(event, canManage, session, deliveryOptions) {
    const signed = activeRosterSignupCount(event);
    const guild = session?.guilds.find((candidate) => candidate.id === event.guildId);
    const inner = `<main class="shell detail-shell">
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
  </main>`;
    return `${renderWindow(`cat /events/${escapeHtml(event.id)}`, inner, { prompt: "nwhelper@os" })}${canManage && session ? renderRosterMoveScript(event.id, session.csrfToken) : ""}`;
}
function renderCurrentRosterSummary(event) {
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
function renderDeliverySummary(event, guild, options) {
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
function renderUpcomingAnnouncements(event) {
    const upcoming = getUpcomingAnnouncements(event, 5);
    return `<section class="preview-section">
    <div class="section-title"><div><p class="eyebrow">After the current roster</p><h2>Future signup announcement queue</h2></div><span>Next ${upcoming.length} scheduled posts</span></div>
    <div class="preview-rail">${upcoming
        .map((announcement, index) => `<article class="preview-card${index === 0 ? " preview-card-next" : ""}">
          <div class="preview-top"><span>${index === 0 ? "Next post" : labelWarDay(announcement.day)}</span><time data-countdown="${announcementTimestamp(announcement)}">${formatAnnouncementDateTime(announcement)}</time></div>
          <h3>${escapeHtml(announcement.title)}</h3>
          <dl><div><dt>War date</dt><dd>${formatDateLabel(announcement.date)}</dd></div><div><dt>Capacity</dt><dd>${announcement.totalCapacity} players</dd></div><div><dt>Announces</dt><dd>${formatAnnouncementDateTime(announcement)}</dd></div></dl>
        </article>`)
        .join("") || "<p class=\"empty\">No upcoming announcement is scheduled.</p>"}</div>
  </section>${renderCountdownScript()}`;
}
function renderDayRail(event) {
    const days = event.recurrence === "weekly" && event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
    return `<section class="day-section"><div class="section-title"><div><p class="eyebrow">Schedule</p><h2>${event.recurrence === "weekly" ? "Weekly raid days" : "Raid day"}</h2></div><span>Announces ${formatClockTime(event.announcementTime ?? config.nodeWarPostTime)}</span></div><div class="day-rail">${days
        .map((day) => `<article class="day-card relative overflow-hidden">
        <span>${labelWarDay(day).slice(0, 3)}</span>
        <strong>${labelWarDay(day)}</strong>
        <small>${event.tier ? NODE_WAR_PRESETS[event.tier].territoryGroup : event.kind}</small>
        <dl><div><dt>Roster</dt><dd>${day === event.day ? `${activeRosterSignupCount(event)}/${activeRosterCapacity(event)} signed` : "Fresh roster"}</dd></div><div><dt>War</dt><dd>${formatClockTime(event.time)}</dd></div><div><dt>Post</dt><dd>${formatClockTime(event.announcementTime ?? config.nodeWarPostTime)}</dd></div></dl>
      </article>`)
        .join("") || "<p>No raid days selected.</p>"}</div></section>`;
}
function renderRosterColumns(event, canManage = false) {
    return orderedGroups(event)
        .map((group) => {
        const signups = event.signups.filter((signup) => signup.group === group.key);
        return `<section class="roster-column${canManage ? " roster-dropzone" : ""}" data-group="${escapeHtml(group.key)}">
        <header><h2>${renderGroupIcon(group.key, group.emoji)}${escapeHtml(group.label)}</h2><b>${isRosterGroup(group.key) ? `${signups.length}/${group.capacity}` : signups.length}</b></header>
        <div class="signup-list">${signups
            .map((signup, index) => `<div class="signup-row${canManage ? " draggable-signup" : ""}" data-user-id="${escapeHtml(signup.userId)}" data-group="${escapeHtml(group.key)}"${canManage ? " draggable=\"true\" title=\"Drag to move role\"" : ""}><span class="class-badge">${renderSignupIcon(event, group.key, signup.requestedGroup)}</span><span class="slot">${index + 1}</span><span class="name">${escapeHtml(signup.displayName)}</span></div>`)
            .join("") || "<p class=\"empty\">No signups yet</p>"}</div>
      </section>`;
    })
        .join("");
}
function renderRosterMoveScript(eventId, csrfToken) {
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
function labelRecurrence(recurrence) {
    return {
        once: "Once",
        daily: "Every day",
        every_other_day: "Every other day",
        weekly: "Weekly"
    }[recurrence];
}
function orderedGroups(event) {
    const order = ["mainball", "defense", "zerker", "shai", "bench", "tentative", "absence"];
    return [...event.groups].sort((a, b) => {
        const left = order.indexOf(a.key);
        const right = order.indexOf(b.key);
        return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
    });
}
function renderSignupIcon(event, groupKey, requestedGroup) {
    const visibleKey = groupKey === "bench" && requestedGroup ? requestedGroup : groupKey;
    const group = event.groups.find((candidate) => candidate.key === visibleKey);
    return renderGroupIcon(visibleKey, group?.emoji);
}
function renderGroupIcon(groupKey, configuredEmoji) {
    const url = getGroupEmojiUrl(groupKey, configuredEmoji);
    if (url) {
        return `<img class="role-icon" src="${escapeHtml(url)}" alt="">`;
    }
    return `<span class="role-emoji">${escapeHtml(getGroupEmoji(groupKey, configuredEmoji))}</span>`;
}
function renderCreateRaid(guildId, csrfToken, session, deliveryOptions, configuredChannelId) {
    const templates = [
        { tier: "tier1", name: "T1 Balenos / Serendia", capacity: 30 },
        { tier: "tier2", name: "T2 Calpheon / Ulukita", capacity: 40 },
        { tier: "tier3", name: "T3 Valencia / Edania", capacity: 55 }
    ];
    const groups = [
        { key: "mainball", label: getGroupLabel("mainball"), capacity: 21 },
        { key: "defense", label: getGroupLabel("defense"), capacity: 5 },
        { key: "zerker", label: getGroupLabel("zerker"), capacity: 2 },
        { key: "shai", label: getGroupLabel("shai"), capacity: 2 }
    ];
    const inner = `<main class="shell create-shell">
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
  </main>`;
    return `${renderWindow("create --new-raid", inner, { prompt: "nwhelper@os" })}${renderRecurrenceDayScript()}${renderAllocationScript(true)}`;
}
function renderDeliveryEditor(options, configuredChannelId) {
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
      <div class="ping-role-grid">${options.roles
        .map((role) => `<label><input type="checkbox" name="announcementRoleIds" value="${escapeHtml(role.id)}"${role.id === config.nodeWarRoleId ? " checked" : ""}><span>@${escapeHtml(role.name)}</span></label>`)
        .join("") || "<p class=\"empty\">No selectable server roles found.</p>"}</div>
    </fieldset>
  </section>`;
}
function renderEditRaid(event, csrfToken, session) {
    const repeatDays = event.recurrence === "weekly" && event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
    const inner = `<main class="shell create-shell">
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
  </main>`;
    return `${renderWindow(`edit /events/${escapeHtml(event.id)}`, inner, { prompt: "nwhelper@os" })}${renderRecurrenceDayScript()}${renderAllocationScript(false)}`;
}
function renderDayChecks(selectedDays) {
    return WEB_WAR_DAYS.map((day) => `<label><input type="checkbox" name="repeatDays" value="${day}"${selectedDays.includes(day) ? " checked" : ""}><span>${labelWarDay(day).slice(0, 3)}</span></label>`).join("");
}
function renderRecurrenceDayScript() {
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
function renderAllocationEditor(groups) {
    return `<section class="slot-editor">
    <header>
      <div><p class="eyebrow">Composition</p><h2>Linked slot allocation</h2></div>
      <button type="button" id="add-role">Add custom role</button>
    </header>
    <div id="role-table" class="role-table">${groups.map((group) => renderSliderRow(group)).join("")}</div>
    <p class="editor-note">Increasing a specialist role reduces Mainball / FFA automatically.</p>
  </section>`;
}
function renderSliderRow(group) {
    const custom = !["mainball", "defense", "zerker", "shai"].includes(group.key);
    return `<div class="role-row${custom ? " custom-role" : ""}" data-key="${escapeHtml(group.key)}" data-label="${escapeHtml(group.label)}" data-emoji="${escapeHtml(group.emoji ?? "")}">
    <div class="role-name">${renderGroupIcon(group.key, group.emoji)}${custom
        ? `<input class="role-label-input" aria-label="Custom role name" value="${escapeHtml(group.label)}" placeholder="Role name"><input class="role-emoji-input" aria-label="Emote for role" value="${escapeHtml(group.emoji ?? "")}" placeholder=":mage: or &lt;:mage:id&gt;"><button class="remove-role" type="button" aria-label="Remove custom role">Remove</button>`
        : `<strong>${escapeHtml(group.label)}</strong>`}</div>
    <input aria-label="${escapeHtml(group.label)} slots" type="range" min="0" max="100" value="${group.capacity}"${group.key === "mainball" ? " disabled" : ""}>
    <output>${group.capacity}</output>
  </div>`;
}
function renderAllocationScript(useTemplates) {
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
function parseGroupAllocation(raw, totalCapacity) {
    let parsed;
    try {
        parsed = JSON.parse(String(raw ?? ""));
    }
    catch {
        throw new Error("Role allocation is invalid.");
    }
    if (!Array.isArray(parsed) || parsed.length > 12) {
        throw new Error("Role allocation must contain at most 12 roles.");
    }
    const coreLabels = {
        defense: getGroupLabel("defense"),
        zerker: getGroupLabel("zerker"),
        shai: getGroupLabel("shai")
    };
    const groups = [];
    const keys = new Set();
    for (const value of parsed) {
        if (!value || typeof value !== "object") {
            throw new Error("Role allocation contains an invalid role.");
        }
        const candidate = value;
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
function validRoleEmoji(emoji) {
    if (/^<a?:[A-Za-z0-9_]{2,32}:\d{5,25}>$/.test(emoji)) {
        return true;
    }
    return !emoji.includes("@") && !emoji.includes("<") && !emoji.includes(">") && !/[\r\n]/.test(emoji) && [...emoji].length <= 12;
}
function parseTier(value) {
    if (value === "tier1" || value === "tier2" || value === "tier3") {
        return value;
    }
    throw new Error("Select a valid Node War template.");
}
function parseClockTime(value) {
    const time = String(value ?? "").trim();
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        throw new Error("Announcement time must use HH:mm format.");
    }
    return time;
}
function parseAnnouncementChannelId(value, channels) {
    const channelId = String(value ?? "").trim();
    if (!channelId || !channels.some((channel) => channel.id === channelId)) {
        throw new Error("Select a valid Discord roster channel.");
    }
    return channelId;
}
function parseAnnouncementRoleIds(value, roles) {
    const requested = Array.isArray(value) ? value : value ? [value] : [];
    const allowed = new Set(roles.map((role) => role.id));
    const roleIds = [...new Set(requested.map((roleId) => String(roleId).trim()).filter(Boolean))];
    if (roleIds.some((roleId) => !allowed.has(roleId))) {
        throw new Error("One or more selected Discord ping roles are invalid.");
    }
    return roleIds;
}
function parseScoreDate(value) {
    const date = String(value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) {
        throw new Error("Select a valid war date.");
    }
    return date;
}
function parseScoreResult(value) {
    return value === "win" || value === "loss" ? value : "unknown";
}
function parseScoreRowsFromForm(body) {
    const familyNames = readFormArray(body.familyName);
    return familyNames
        .map((familyName, index) => {
        const cleanName = familyName.trim().slice(0, 80);
        if (!cleanName)
            return undefined;
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
        .filter((row) => Boolean(row));
}
function readFormArray(value) {
    if (Array.isArray(value))
        return value.map((item) => String(item ?? ""));
    return value === undefined ? [] : [String(value)];
}
function parseScoreInteger(value, index) {
    const raw = readFormArray(value)[index]?.replace(/,/g, "").trim() ?? "";
    if (!raw)
        return 0;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0)
        throw new Error("Score fields must be zero or positive numbers.");
    return Math.round(parsed);
}
function parseScoreTime(value, index) {
    const raw = readFormArray(value)[index]?.trim() ?? "";
    if (!raw)
        return "";
    if (!/^\d{1,2}:?\d{2}(?::\d{2})?$/.test(raw))
        throw new Error("Time fields must use MM:SS or HH:MM:SS format.");
    return raw.includes(":") ? raw : raw.length === 4 ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw;
}
function parseOptionalText(value, maxLength) {
    const text = String(value ?? "").trim();
    return text ? text.slice(0, maxLength) : undefined;
}
function isAllowedScoreImage(mimeType, originalName) {
    const extension = originalName.toLowerCase().match(/\.[^.]+$/)?.[0];
    return ["image/png", "image/jpeg", "image/webp"].includes(mimeType) && Boolean(extension && [".png", ".jpg", ".jpeg", ".webp"].includes(extension));
}
function formatStatNumber(value) {
    if (!Number.isFinite(value))
        return "0";
    const absolute = Math.abs(value);
    if (absolute >= 1_000_000)
        return `${(value / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`;
    if (absolute >= 1_000)
        return `${(value / 1_000).toFixed(absolute >= 10_000 ? 0 : 1)}K`;
    return String(Math.round(value));
}
function parseRepeatDays(value, fallback) {
    const requested = Array.isArray(value) ? value : value ? [value] : fallback ? [fallback] : [];
    const days = WEB_WAR_DAYS.filter((day) => requested.includes(day));
    if (!days.length) {
        throw new Error("Select at least one raid day.");
    }
    return days;
}
function formatDateLabel(date) {
    const parsed = parseDateOnlyAsUtc(date);
    return Number.isNaN(parsed.getTime())
        ? date
        : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}
function parseDateOnlyAsUtc(date) {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match)
        return new Date(Number.NaN);
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}
function scheduleTitle(event) {
    if (!event.tier) {
        return `${event.kind === "siege" ? "Siege" : "Node War"} [${event.id}]`;
    }
    const tier = event.tier === "tier1" ? "T1" : event.tier === "tier2" ? "T2" : "T3";
    return `${tier} ${NODE_WAR_PRESETS[event.tier].territoryGroup} War [${event.id}]`;
}
function isEventActive(event) {
    return event.active ?? !event.closed;
}
function formatRaidDays(event) {
    const days = event.recurrence === "weekly" && event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
    return days.map((day) => labelWarDay(day).slice(0, 3)).join(", ") || "No days selected";
}
function formatAnnouncementLabel(event) {
    const next = getUpcomingAnnouncements(event, 1)[0];
    if (next) {
        return formatAnnouncementDateTime(next);
    }
    return event.announcedAt ? "Already posted" : "Not queued";
}
function getUpcomingAnnouncements(event, limit) {
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
    const announcements = [];
    for (let offset = 0; announcements.length < limit && offset < 28; offset += 1) {
        const warDate = new Date(start);
        warDate.setUTCDate(start.getUTCDate() + offset);
        const date = warDate.toISOString().slice(0, 10);
        const day = warDayForDate(date);
        if (!days.includes(day)) {
            continue;
        }
        const totalCapacity = event.tier ? getNodeWarCapacity(event.tier, day) : event.totalCapacity;
        const announcement = {
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
function formatAnnouncementDateTime(announcement) {
    return `${formatDateLabel(announcement.announcementDate)} ${formatClockTime(announcement.announcementTime)}`;
}
function announcementTimestamp(announcement) {
    return new Date(`${announcement.announcementDate}T${announcement.announcementTime}:00+08:00`).getTime();
}
function currentDateInTimezone() {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: config.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}
function renderCountdownScript() {
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
function previousDate(date) {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
}
function defaultNextWarDay() {
    return warDayForDate(nextDateForDay());
}
function nextDateForDay(day) {
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
export function nextScheduledRaid(days, today = currentDateInTimezone(), now = Date.now()) {
    const todayDay = warDayForDate(today);
    if (days.includes(todayDay) && now < warEndsAt(today)) {
        return { day: todayDay, date: today };
    }
    return days
        .map((day) => ({ day, date: nextDateAfter(today, day) }))
        .sort((left, right) => left.date.localeCompare(right.date))[0];
}
function nextDateAfter(date, day) {
    const value = new Date(`${date}T12:00:00Z`);
    const delta = (WEB_WAR_DAYS.indexOf(day) - value.getUTCDay() + 7) % 7 || 7;
    value.setUTCDate(value.getUTCDate() + delta);
    return value.toISOString().slice(0, 10);
}
function warEndsAt(date) {
    return new Date(`${date}T${config.nodeWarStartTime}:00+08:00`).getTime() + 60 * 60_000;
}
function warDayForDate(date) {
    return WEB_WAR_DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}
function renderWebError(error) {
    const message = error instanceof Error ? error.message : "The request could not be completed.";
    const inner = `<main class="shell narrow-shell"><section class="empty-state"><p class="eyebrow">Request failed</p><h1>Could not save raid</h1><p>${escapeHtml(message)}</p><a class="button button-secondary" href="/">Return to dashboard</a></section></main>`;
    return `${renderWindow("error", inner, { prompt: "nwhelper@os" })}`;
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
