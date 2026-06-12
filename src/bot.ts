import {
  ActivityType,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Interaction,
  Message,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { config } from "./config.js";
import { formatGroupBadge, formatGroupName } from "./emojis.js";
import { getNodeWarCapacity, buildNodeWarTitle } from "./nodewar-presets.js";
import { formatAnnouncementSchedule, renderEventEmbed } from "./render.js";
import { activeRosterCapacity, activeRosterSignupCount, type EventStore } from "./store.js";
import { type ScoreStore } from "./score-store.js";
import { extractScoreScreenshot } from "./score-ocr.js";
import { aggregateScoreRows, consumeScoreGeminiQuota, normalizePlayerName } from "./web/score.js";
import { type ScoreReportResult, type ScoreRow } from "./score-types.js";
import { type GroupKey, type WarDay, type WarEvent } from "./types.js";
import { prepareAthenaReport, buildAthenaReportEmbed } from "./athena-report.js";

// --- Bot modules ---
import {
  schedulerHour,
  schedulerMinute,
  announcementIsDue,
  announcementDateForEvent,
  zonedNow,
  nextWarDayAfterToday,
  nextSelectedRaidAfter,
  getGuildEvent,
  getNodeWarChannelId,
  getAnnouncementRoleIds,
  groupsForCapacity,
} from "./bot/utils.js";
import {
  requireAdministrator,
  requireOfficer,
  assertButtonGuild,
  requireButtonGuildId,
  assertListButtonOwner,
} from "./bot/permissions.js";
import {
  buildNodeWarEvent,
  postEventToChannel,
  refreshEventMessage,
  refreshOpenEventMessages,
  renderEventMessagePayload,
  eventEndsAt,
} from "./bot/posting.js";
import {
  handleSelect,
  handleRoleSelect,
  handleChannelSelect,
  handleModal,
  handleWizardButton,
  startEventWizard,
} from "./bot/creation-wizard.js";
import {
  handleEditWizardButton,
  createEditWizardState,
  renderEditWizard,
  startEditWizard,
} from "./bot/edit-wizard.js";

// Re-export symbols that index.ts, QA, or other consumers may import from here.
const SCORE_UPLOAD_TIMEOUT_MS = 5 * 60_000;
const SCORE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const SCORE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface DiscordClientOptions {
  scoreStore?: ScoreStore;
}

interface PendingScoreUpload {
  guildId: string;
  channelId: string;
  userId: string;
  warDate: string;
  result: ScoreReportResult;
  title?: string;
  expiresAt: number;
}

const pendingScoreUploads = new Map<string, PendingScoreUpload>();

function pendingScoreUploadKey(guildId: string, channelId: string, userId: string): string {
  return `${guildId}:${channelId}:${userId}`;
}
export { eventEndsAt, refreshEventMessage } from "./bot/posting.js";
export { nextWarDayFromSelection } from "./bot/utils.js";

const AUTO_SCHEDULER_USER = "nodewar-scheduler";
const SCHEDULER_INTERVAL_MS = 60_000;
const NODEWAR_DURATION_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Client wiring
// ---------------------------------------------------------------------------

/**
 * Creates the Discord client, routes supported interaction types, and starts
 * scheduler polling after the client becomes ready.
 */
export function createDiscordClient(store: EventStore, options: DiscordClientOptions = {}): Client {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Discord bot ready as ${readyClient.user.tag}`);
    readyClient.user.setPresence({
      activities: [{ name: "Meow", type: ActivityType.Listening }],
      status: "online"
    });
    await refreshOpenEventMessages(client, store).catch((error) => {
      console.warn("Could not refresh open event messages:", error);
    });
    startNodeWarScheduler(client, store).catch((error) => {
      console.error("Node War scheduler failed:", error);
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, store, client, options);
      }

      if (interaction.isStringSelectMenu()) {
        await handleSelect(interaction, store, client);
      }

      if (interaction.isRoleSelectMenu()) {
        await handleRoleSelect(interaction);
      }

      if (interaction.isChannelSelectMenu()) {
        await handleChannelSelect(interaction);
      }

      if (interaction.isButton()) {
        await handleButton(interaction, store, client);
      }

      if (interaction.isModalSubmit()) {
        await handleModal(interaction, store, client);
      }
    } catch (error) {
      await replyWithError(interaction, error);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleScoreUploadMessage(message, store, options);
    } catch (error) {
      console.error("Score screenshot upload failed:", error);
      await message.reply(`Score upload failed: ${error instanceof Error ? error.message : "Unknown error."}`).catch(() => undefined);
    }
  });

  return client;
}

// ---------------------------------------------------------------------------
// Slash-command router
// ---------------------------------------------------------------------------

/** Routes registered slash commands after applying their runtime permission checks. */
async function handleCommand(
  interaction: ChatInputCommandInteraction,
  store: EventStore,
  client: Client,
  options: DiscordClientOptions = {}
): Promise<void> {
  if (interaction.commandName === "set-nwchannel") {
    await requireAdministrator(interaction);
    await setNodeWarChannel(interaction, store);
    return;
  }

  if (interaction.commandName === "export") {
    await requireOfficer(interaction);
    if (interaction.options.getSubcommand() === "stats") {
      await exportStats(interaction, options.scoreStore);
    }
    return;
  }

  if (interaction.commandName === "score") {
    await requireAdministrator(interaction);
    const scoreSubcommand = interaction.options.getSubcommand();
    if (scoreSubcommand === "set-channel") {
      await setScoreUploadChannel(interaction, store);
      return;
    }
    if (scoreSubcommand === "upload") {
      await armScoreUpload(interaction, store, options.scoreStore);
      return;
    }
    return;
  }

  if (interaction.commandName !== "event") {
    return;
  }

  await requireAdministrator(interaction);
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "create") {
    await startEventWizard(interaction, store);
    return;
  }

  if (subcommand === "create-today") {
    await startEventWizard(interaction, store, true);
    return;
  }

  if (subcommand === "create-test") {
    await createTestEvent(interaction, store);
    return;
  }

  if (subcommand === "list") {
    await listEvents(interaction, store);
    return;
  }

  if (subcommand === "show") {
    await showEvent(interaction, store);
    return;
  }

  if (subcommand === "set-slots") {
    await setSlots(interaction, store, client);
    return;
  }

  if (subcommand === "edit") {
    await startEditWizard(interaction, store);
    return;
  }

  if (subcommand === "recurring") {
    await setRecurring(interaction, store, client);
    return;
  }

  if (subcommand === "delete") {
    await deleteEvent(interaction, store);
    return;
  }

  if (subcommand === "repost") {
    await repostEvent(interaction, store, client);
  }
}

// ---------------------------------------------------------------------------
// Simple slash-command handlers (not wizard logic, kept here for now)
// ---------------------------------------------------------------------------

async function listEvents(interaction: ChatInputCommandInteraction, store: EventStore): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    throw new Error("Use this command inside a Discord server.");
  }
  const allEvents = (await store.listEvents()).filter((event) => event.guildId === guildId && !event.closed);
  const events = allEvents.slice(0, 10);
  if (events.length === 0) {
    await interaction.reply({ content: "No open events yet.", ephemeral: true });
    return;
  }

  for (const [index, event] of events.entries()) {
    const signed = activeRosterSignupCount(event);
    await interaction[(index === 0 ? "reply" : "followUp")]({
      content: `${index + 1}. ID: \`${event.id}\` - **${event.title}** - ${event.date} ${event.time} - ${signed}/${activeRosterCapacity(event)}`,
      ephemeral: true,
    });
  }

  if (allEvents.length > events.length) {
    await interaction.followUp({
      content: `Showing the first ${events.length} of ${allEvents.length} open events.`,
      ephemeral: true
    });
  }
}

async function setNodeWarChannel(interaction: ChatInputCommandInteraction, store: EventStore): Promise<void> {
  if (!interaction.guildId) {
    throw new Error("Use this command inside a server channel.");
  }

  const channel = interaction.channel;
  if (!channel || !("send" in channel)) {
    throw new Error("Use this command in a text channel where the bot can send messages.");
  }

  await store.setNodeWarChannelId(interaction.guildId, interaction.channelId);
  await interaction.reply({
    content: `Node War announcement channel set to <#${interaction.channelId}>.`,
    ephemeral: true
  });
}

async function setScoreUploadChannel(interaction: ChatInputCommandInteraction, store: EventStore): Promise<void> {
  if (!interaction.guildId) {
    throw new Error("Use this command inside a server channel.");
  }

  const channel = interaction.channel;
  if (!channel || !("send" in channel)) {
    throw new Error("Use this command in a text channel where the bot can read scoreboard screenshots.");
  }

  await store.setScoreUploadChannelId(interaction.guildId, interaction.channelId);
  await interaction.reply({
    content: `Score screenshot upload channel set to <#${interaction.channelId}>. Use \`/score upload\` before posting a screenshot.`,
    ephemeral: true
  });
}

async function armScoreUpload(
  interaction: ChatInputCommandInteraction,
  store: EventStore,
  scoreStore?: ScoreStore
): Promise<void> {
  if (!scoreStore) {
    throw new Error("Score storage is not configured.");
  }
  if (!interaction.guildId) {
    throw new Error("Use this command inside a Discord server.");
  }

  const settings = await store.getSettings();
  const configuredChannelId = settings.scoreUploadChannelIds?.[interaction.guildId];
  if (!configuredChannelId) {
    throw new Error("Set a score screenshot channel first with /score set-channel.");
  }
  if (configuredChannelId !== interaction.channelId) {
    throw new Error(`Use /score upload in the configured score screenshot channel: <#${configuredChannelId}>.`);
  }

  const warDate = parseDiscordScoreDate(interaction.options.getString("war-date", true));
  const duplicate = (await scoreStore.listReports(interaction.guildId)).find((report) => report.warDate === warDate);
  if (duplicate) {
    throw new Error(`A score report already exists for ${warDate}. Delete or edit it from the web stats page first.`);
  }

  const result = (interaction.options.getString("result") ?? "unknown") as ScoreReportResult;
  const title = cleanOptionalDiscordText(interaction.options.getString("title"), 120);
  const pending: PendingScoreUpload = {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    warDate,
    result,
    title,
    expiresAt: Date.now() + SCORE_UPLOAD_TIMEOUT_MS
  };
  pendingScoreUploads.set(pendingScoreUploadKey(pending.guildId, pending.channelId, pending.userId), pending);

  await interaction.reply({
    content: [
      `Upload armed for **${warDate}** in <#${interaction.channelId}>.`,
      "Post one PNG, JPG, or WebP scoreboard screenshot in the next 5 minutes.",
      "Only your next image in this channel will be processed."
    ].join("\n"),
    ephemeral: true
  });
}

async function exportStats(interaction: ChatInputCommandInteraction, scoreStore?: ScoreStore): Promise<void> {
  if (!scoreStore) {
    throw new Error("Score storage is not configured.");
  }
  if (!interaction.guildId) {
    throw new Error("Use this command inside a Discord server.");
  }

  await interaction.deferReply();
  const reports = await scoreStore.listReports(interaction.guildId);
  if (!reports.length) {
    await interaction.editReply("No score reports have been uploaded for this server yet.");
    return;
  }

  const rows = reports.flatMap((report) => report.rows);
  const players = aggregateScoreRows(rows);
  const totalKills = rows.reduce((sum, row) => sum + row.kills, 0);
  const totalDeaths = rows.reduce((sum, row) => sum + row.deaths, 0);

  const report = prepareAthenaReport({ players, reports, totalKills, totalDeaths });
  const embed = buildAthenaReportEmbed(report);
  await interaction.editReply({ embeds: [embed] });
}


async function createTestEvent(interaction: ChatInputCommandInteraction, store: EventStore): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    throw new Error("Use this command inside a Discord server.");
  }
  const channelId = await getNodeWarChannelId(store, guildId);
  if (!channelId) {
    throw new Error("NODEWAR_CHANNEL_ID is required for /event create-test.");
  }

  const day = interaction.options.getString("day", true) as WarDay;
  const announcementTime = parseTime(interaction.options.getString("time", true));
  const announcementRoleId = interaction.options.getRole("ping-role", true).id;
  const totalCapacity = getNodeWarCapacity("tier1", day);
  const event = buildNodeWarEvent({
    tier: "tier1",
    day,
    date: nextWarDateInTimezone(day, config.timezone),
    title: `[TEST] ${buildNodeWarTitle(day, "tier1", totalCapacity)}`,
    time: config.nodeWarStartTime,
    recurrence: "once",
    createdBy: interaction.user.id,
    guildId,
    channelId,
    announcementDate: nextWarDateInTimezone(day as never, config.timezone),
    announcementTime,
    announcementChannelId: channelId,
    announcementRoleId,
    notes: `Test announcement: ${announcementTime} ${config.timezone}`
  });

  await store.createEvent(event);
  await interaction.reply({
    content: `Created test event ${event.title} (${event.id}). It will post in <#${channelId}> at ${event.announcementDate} ${announcementTime} ${config.timezone}.`,
    ephemeral: true
  });
}

async function showEvent(interaction: ChatInputCommandInteraction, store: EventStore): Promise<void> {
  const id = interaction.options.getString("id", true);
  const event = await getGuildEvent(store, interaction.guildId ?? "", id);

  if (!event) {
    throw new Error("Event not found.");
  }

  await interaction.reply({
    content: `Announcement: ${formatAnnouncementSchedule(event)}`,
    embeds: [renderEventEmbed(event, true)],
    ephemeral: true
  });
}

async function setSlots(
  interaction: ChatInputCommandInteraction,
  store: EventStore,
  client: Client
): Promise<void> {
  const id = await resolveEventIdFromStore(store, interaction.guildId ?? "", interaction.options.getString("id", true));
  const event = await store.setBalancedGroups(id, {
    defense: interaction.options.getInteger("def", true),
    zerker: interaction.options.getInteger("zerk", true),
    shai: interaction.options.getInteger("shai", true)
  });

  await refreshEventMessage(client, event);
  const mainball = event.groups.find((group) => group.key === "mainball")?.capacity ?? 0;
  await interaction.reply({
    content: `Updated ${event.title}: ${formatGroupName("mainball")} ${mainball}, ${formatGroupBadge("defense")} ${interaction.options.getInteger("def", true)}, ${formatGroupBadge("zerker")} ${interaction.options.getInteger("zerk", true)}, ${formatGroupBadge("shai")} ${interaction.options.getInteger("shai", true)}.`,
    ephemeral: true
  });
}

async function setRecurring(
  interaction: ChatInputCommandInteraction,
  store: EventStore,
  client: Client
): Promise<void> {
  const id = interaction.options.getString("id", true);
  const event = await getGuildEvent(store, interaction.guildId ?? "", id);
  if (!event) {
    throw new Error("Event not found.");
  }

  const enabled = interaction.options.getBoolean("enabled", true);
  const updated = await store.updateEventDetails(id, {
    recurrence: enabled ? "weekly" : "once",
    repeatDays: enabled ? event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : undefined : undefined,
    autoRepost: enabled
  });

  await refreshEventMessage(client, updated);
  await interaction.reply({
    content: `${updated.title} is now ${enabled ? "weekly recurring" : "one-time only"}.`,
    ephemeral: true
  });
}

async function deleteEvent(interaction: ChatInputCommandInteraction, store: EventStore): Promise<void> {
  const id = await resolveEventIdFromStore(store, interaction.guildId ?? "", interaction.options.getString("id", true));
  await store.deleteEvent(id);
  await interaction.reply({ content: `Deleted event ${id}.`, ephemeral: true });
}

async function repostEvent(
  interaction: ChatInputCommandInteraction,
  store: EventStore,
  client: Client
): Promise<void> {
  const id = interaction.options.getString("id", true);
  const event = await getGuildEvent(store, interaction.guildId ?? "", id);
  if (!event) {
    throw new Error("Event not found.");
  }

  const channelId = await getNodeWarChannelId(store, interaction.guildId ?? "");
  if (!channelId) {
    throw new Error("Set a Node War channel first with /set-nwchannel.");
  }

  const message = await postEventToChannel(client, channelId, event);
  await store.markEventAnnounced(event.id, {
    guildId: message.guildId ?? interaction.guildId ?? "",
    channelId: message.channelId,
    messageId: message.id
  });
  await interaction.reply({ content: `Reposted ${event.title}.`, ephemeral: true });
}

// ---------------------------------------------------------------------------
// Button router
// ---------------------------------------------------------------------------

/** Routes wizard, roster-signup, list-management, and posted-roster control buttons. */
async function handleButton(interaction: ButtonInteraction, store: EventStore, client: Client): Promise<void> {
  if (interaction.customId.startsWith("editwizard-")) {
    await handleEditWizardButton(interaction, store, client);
    return;
  }

  if (interaction.customId.startsWith("wizard-")) {
    await handleWizardButton(interaction, store);
    return;
  }

  const [action, eventId, groupKey] = interaction.customId.split(":");
  if (!eventId) {
    return;
  }

  if (action === "event-list-edit") {
    await requireAdministrator(interaction);
    assertListButtonOwner(interaction, groupKey);
    const guildId = requireButtonGuildId(interaction);
    const { state, event } = await createEditWizardState(store, guildId, interaction.user.id, eventId);
    await interaction.update(renderEditWizard(state, event));
    return;
  }

  if (action === "event-list-delete") {
    await requireAdministrator(interaction);
    assertListButtonOwner(interaction, groupKey);
    const guildId = requireButtonGuildId(interaction);
    const event = await getGuildEvent(store, guildId, eventId);
    if (!event) {
      throw new Error("Event not found.");
    }
    await store.deleteEvent(event.id);
    await interaction.update({ content: `Deleted ${event.title}.`, components: [] });
    return;
  }

  if (action === "event-show-edit") {
    await requireAdministrator(interaction);
    const guildId = requireButtonGuildId(interaction);
    const { state, event } = await createEditWizardState(store, guildId, interaction.user.id, eventId);
    await interaction.update(renderEditWizard(state, event));
    return;
  }

  if (action === "event-show-delete") {
    await requireAdministrator(interaction);
    const guildId = requireButtonGuildId(interaction);
    const event = await getGuildEvent(store, guildId, eventId);
    if (!event) {
      throw new Error("Event not found.");
    }
    await store.deleteEvent(event.id);
    await interaction.update({ content: `Deleted ${event.title}.`, embeds: [], components: [], attachments: [] });
    return;
  }

  if (action === "event-signup" && groupKey) {
    await assertButtonGuild(store, interaction, eventId);
    const event = await store.signup(eventId, {
      userId: interaction.user.id,
      displayName: interaction.member && "displayName" in interaction.member ? interaction.member.displayName : interaction.user.username,
      group: groupKey as GroupKey
    });
    await interaction.update(renderEventMessagePayload(event));
    return;
  }

  if (action === "event-leave") {
    await assertButtonGuild(store, interaction, eventId);
    const event = await store.removeSignup(eventId, interaction.user.id);
    await interaction.update(renderEventMessagePayload(event));
    return;
  }

  if (action === "event-post-now") {
    await interaction.deferReply({ ephemeral: true });
    await requireOfficer(interaction);
    await assertButtonGuild(store, interaction, eventId);
    const event = await store.getEvent(eventId);
    if (!event) {
      throw new Error("Event not found.");
    }
    const channelId = event.announcementChannelId ?? event.channelId ?? (await getNodeWarChannelId(store, interaction.guildId as string));
    if (!channelId) {
      throw new Error("Set a Node War channel first with /set-nwchannel.");
    }
    const roleIds = getAnnouncementRoleIds(event);
    const message = await postEventToChannel(client, channelId, event, roleIds);
    await store.markEventAnnounced(event.id, {
      guildId: message.guildId ?? interaction.guildId as string,
      channelId: message.channelId,
      messageId: message.id
    });
    if (event.recurrence === "once") {
      await store.updateEventDetails(event.id, { active: false });
    }
    await interaction.editReply({ content: `Posted ${event.title} in <#${message.channelId}>.` });
    return;
  }

  if (action === "event-refresh") {
    await requireOfficer(interaction);
    const event = await store.getEvent(eventId);
    if (!event) {
      throw new Error("Event not found.");
    }
    await interaction.update(renderEventMessagePayload(event));
    return;
  }

  if (action === "event-close") {
    await interaction.deferReply({ ephemeral: true });
    await requireOfficer(interaction);
    const event = await store.closeEvent(eventId);
    await refreshEventMessage(client, event);
    await interaction.editReply({ content: `Closed ${event.title}.` });
  }
}

async function handleScoreUploadMessage(
  message: Message,
  _store: EventStore,
  options: DiscordClientOptions
): Promise<void> {
  if (message.author.bot || !message.guildId || !options.scoreStore) {
    return;
  }

  const key = pendingScoreUploadKey(message.guildId, message.channelId, message.author.id);
  const pending = pendingScoreUploads.get(key);
  if (!pending) {
    return;
  }

  if (Date.now() > pending.expiresAt) {
    pendingScoreUploads.delete(key);
    await message.reply("Your score upload window expired. Run `/score upload` again before posting the screenshot.");
    return;
  }

  const attachment = message.attachments.find((candidate) => isScoreImageAttachment(candidate.contentType, candidate.name, candidate.size));
  if (!attachment) {
    return;
  }

  pendingScoreUploads.delete(key);
  await message.reply("Scoreboard screenshot received. Extracting rows now...");

  const imageResponse = await fetch(attachment.url);
  if (!imageResponse.ok) {
    throw new Error(`Discord attachment download failed (${imageResponse.status}).`);
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  if (imageBuffer.byteLength > SCORE_IMAGE_MAX_BYTES) {
    throw new Error("Score screenshot is too large. Upload an image under 10 MB.");
  }

  const duplicate = (await options.scoreStore.listReports(pending.guildId)).find((report) => report.warDate === pending.warDate);
  if (duplicate) {
    throw new Error(`A score report already exists for ${pending.warDate}. Delete or edit it from the web stats page first.`);
  }

  const geminiQuota = consumeScoreGeminiQuota(pending.userId, pending.guildId);
  const mimeType = attachment.contentType ?? inferScoreImageMimeType(attachment.name) ?? "image/png";
  const extraction = await extractScoreScreenshot(imageBuffer, {
    mimeType,
    geminiApiKey: geminiQuota.allowed ? config.geminiApiKey : undefined,
    geminiModel: config.geminiModel,
    preferGemini: geminiQuota.allowed
  });

  const rows = extraction.rows.map((row) => ({
    ...row,
    familyName: normalizePlayerName(row.familyName),
    guildId: pending.guildId
  })) as ScoreRow[];
  if (!rows.length) {
    throw new Error("No scoreboard rows were extracted. Try a clearer screenshot or upload from the web stats page for manual review.");
  }

  const report = await options.scoreStore.createReport({
    guildId: pending.guildId,
    warDate: pending.warDate,
    result: pending.result,
    title: pending.title,
    imageMimeType: mimeType,
    imageOriginalName: attachment.name ?? "discord-scoreboard.png",
    imageBuffer,
    ocrEngine: extraction.engine,
    rawOcrText: extraction.rawText,
    ocrConfidence: extraction.confidence,
    uploadedBy: `${message.author.username} (${message.author.id})`,
    rows
  });

  await message.reply([
    `Saved score report **${report.title ?? report.warDate}**.`,
    `Extracted **${rows.length}** player row${rows.length === 1 ? "" : "s"} using \`${extraction.engine}\`.`,
    `View it in Project Athena: http://localhost:${config.port}/stats?guild=${encodeURIComponent(pending.guildId)}`
  ].join("\n"));
}

function parseDiscordScoreDate(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Use war-date in YYYY-MM-DD format.");
  }
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new Error("Use a valid calendar date for war-date.");
  }
  return trimmed;
}

function cleanOptionalDiscordText(value: string | null, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function isScoreImageAttachment(contentType: string | null | undefined, name: string | null | undefined, size: number): boolean {
  if (size > SCORE_IMAGE_MAX_BYTES) return false;
  if (contentType && SCORE_IMAGE_MIME_TYPES.has(contentType.toLowerCase())) return true;
  return Boolean(inferScoreImageMimeType(name));
}

function inferScoreImageMimeType(name: string | null | undefined): string | undefined {
  const lowerName = name?.toLowerCase() ?? "";
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
  if (lowerName.endsWith(".webp")) return "image/webp";
  return undefined;
}


// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/** Runs scheduler recovery immediately and starts minute-based lifecycle polling. */
async function startNodeWarScheduler(client: Client, store: EventStore): Promise<void> {
  await runNodeWarScheduler(client, store);
  setInterval(() => {
    runNodeWarScheduler(client, store).catch((error) => {
      console.error("Node War scheduler failed:", error);
    });
  }, SCHEDULER_INTERVAL_MS);
}

/**
 * Processes expired events, weekly rollover, due announcements, and the
 * configured automatic Tier 1 announcement path for the current minute.
 */
async function runNodeWarScheduler(client: Client, store: EventStore): Promise<void> {
  const now = zonedNow(config.timezone);
  await closeExpiredOneTimeEvents(client, store);
  await rollCompletedWeeklyEvents(client, store, now);
  await postDueScheduledEvents(client, store, now);

  if (now.hour !== schedulerHour() || now.minute !== schedulerMinute()) {
    return;
  }

  const next = nextWarDayAfterToday(config.timezone);
  if (!next) {
    return;
  }

  const settings = await store.getSettings();
  const channelIds = { ...(settings.nodeWarChannelIds ?? {}) };
  if (config.discordGuildId && !channelIds[config.discordGuildId]) {
    const legacyChannelId = settings.nodeWarChannelId ?? config.nodeWarChannelId;
    if (legacyChannelId) {
      channelIds[config.discordGuildId] = legacyChannelId;
    }
  }
  for (const [guildId, nodeWarChannelId] of Object.entries(channelIds)) {
    const totalCapacity = getNodeWarCapacity("tier1", next.day);
    const event = buildNodeWarEvent({
      tier: "tier1",
      day: next.day,
      date: next.date,
      title: buildNodeWarTitle(next.day, "tier1", totalCapacity),
      time: config.nodeWarStartTime,
      recurrence: "once",
      createdBy: AUTO_SCHEDULER_USER,
      guildId,
      channelId: nodeWarChannelId,
      announcementDate: now.date,
      announcementTime: config.nodeWarPostTime,
      announcementChannelId: nodeWarChannelId,
      announcementRoleId: config.nodeWarRoleId
    });
    const result = await store.createEventIfMissing(event);
    if (result.event.messageId) {
      continue;
    }

    const message = await postEventToChannel(client, nodeWarChannelId, result.event);
    if (message.guildId) {
      await store.markEventAnnounced(result.event.id, {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id
      });
      await store.updateEventDetails(result.event.id, { active: false });
    }
  }
}

/** Rotates completed weekly raids in place so one schedule keeps one persistent event ID. */
export async function rollCompletedWeeklyEvents(
  client: Client,
  store: EventStore,
  now: { date: string; hour: number; minute: number; weekday: string }
): Promise<void> {
  const events = await store.listEvents();
  for (const event of events) {
    if (event.closed || event.active === false || event.recurrence !== "weekly" || eventEndsAt(event) > Date.now()) {
      continue;
    }

    const completed = { ...event, closed: true };
    await refreshEventMessage(client, completed).catch((error) => {
      console.warn(`Could not refresh completed weekly event ${event.id}:`, error);
    });
    if (event.autoRepost === false) {
      await store.updateEventDetails(event.id, { active: false });
      continue;
    }

    const next = nextSelectedRaidAfter(now.date, event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : []);
    if (!next) {
      await store.updateEventDetails(event.id, { closed: true, active: false });
      continue;
    }
    const totalCapacity = event.tier ? getNodeWarCapacity(event.tier, next.day) : event.totalCapacity;
    try {
      await store.updateEventDetails(event.id, {
        title: event.tier ? buildNodeWarTitle(next.day, event.tier, totalCapacity) : event.title,
        day: next.day,
        date: next.date,
        totalCapacity,
        groups: groupsForCapacity(event.groups, totalCapacity),
        announcementDate: announcementDateForEvent(next.date),
        announcedAt: undefined,
        channelId: undefined,
        messageId: undefined,
        signups: [],
        closed: false,
        active: true
      });
    } catch (error) {
      console.warn(`Could not roll weekly event ${event.id} into ${next.day}:`, error);
    }
  }
}

/** Closes one-time raids after their one-hour war window and refreshes posted messages. */
async function closeExpiredOneTimeEvents(client: Client, store: EventStore): Promise<void> {
  const events = await store.listEvents();
  const now = Date.now();
  for (const event of events) {
    if (event.closed || event.recurrence !== "once" || eventEndsAt(event) > now) {
      continue;
    }

    const closed = await store.closeEvent(event.id);
    await refreshEventMessage(client, closed).catch((error) => {
      console.warn(`Could not refresh expired event ${event.id}:`, error);
    });
  }
}

/** Posts active due or overdue events once, using persisted `announcedAt` as the guard. */
async function postDueScheduledEvents(
  client: Client,
  store: EventStore,
  now: { date: string; hour: number; minute: number; weekday: string }
): Promise<void> {
  const events = await store.listEvents();
  for (const event of events) {
    if (event.closed || event.active === false || event.announcedAt || !event.announcementDate || !event.announcementTime) {
      continue;
    }
    if (!announcementIsDue(event.announcementDate, event.announcementTime, now)) {
      continue;
    }

    const channelId =
      event.announcementChannelId ?? event.channelId ?? (event.guildId ? await getNodeWarChannelId(store, event.guildId) : undefined);
    if (!channelId) {
      console.warn(`Skipping due event ${event.id}: no announcement channel configured.`);
      continue;
    }

    const roleIds = getAnnouncementRoleIds(event);
    const message = await postEventToChannel(client, channelId, event, roleIds);
    if (message.guildId) {
      await store.markEventAnnounced(event.id, {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id
      });
      if (event.recurrence === "once") {
        await store.updateEventDetails(event.id, { active: false });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers kept in this file
// ---------------------------------------------------------------------------

async function replyWithError(interaction: Interaction, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  if (!interaction.isRepliable()) {
    return;
  }

  const payload = { content: message, ephemeral: true };
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (firstError: unknown) {
    // If the interaction was already acknowledged (flag stale or race),
    // try followUp as a fallback before giving up.
    const alreadyAcknowledged =
      firstError instanceof Error && /already acknowledged/i.test(firstError.message);
    if (alreadyAcknowledged) {
      try {
        await interaction.followUp(payload);
      } catch (followUpError) {
        console.error("Failed to send interaction error response:", followUpError);
      }
    } else {
      console.error("Failed to send interaction error response:", firstError);
    }
  }
}

function parseTime(value: string): string {
  const normalized = value.trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(normalized);
  if (!match) {
    throw new Error("Time must use 24-hour HH:mm format, for example 22:15.");
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function nextWarDateInTimezone(day: string, timezone: string): string {
  const now = zonedNow(timezone);
  const date = new Date(`${now.date}T00:00:00Z`);
  const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const todayIndex = WEEKDAY_NAMES.indexOf(now.weekday);
  const targetIndex = WEEKDAY_NAMES.indexOf(day.toLowerCase());
  const delta = (targetIndex - todayIndex + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Local copy of resolveEventId so simple command handlers don't depend on the utils export. */
async function resolveEventIdFromStore(store: EventStore, guildId: string, input: string): Promise<string> {
  const normalized = input.trim().replace(/^ID:\s*/i, "").replace(/^`+|`+$/g, "").replace(/^\(|\)$/g, "").trim();
  const event = (await store.listEvents()).find(
    (candidate) =>
      candidate.guildId === guildId &&
      (candidate.id === normalized || candidate.id.toLowerCase() === normalized.toLowerCase())
  );
  if (!event) {
    throw new Error(`Event not found for ID "${normalized}". Use /event list and copy the ID after "ID:".`);
  }
  return event.id;
}
