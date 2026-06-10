import {
  ActivityType,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Interaction,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { config } from "./config.js";
import { formatGroupBadge, formatGroupName } from "./emojis.js";
import { getNodeWarCapacity, buildNodeWarTitle } from "./nodewar-presets.js";
import { formatAnnouncementSchedule, renderEventEmbed } from "./render.js";
import { activeRosterCapacity, activeRosterSignupCount, type EventStore } from "./store.js";
import { type GroupKey, type WarDay, type WarEvent } from "./types.js";

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

// Re-export symbols that index.ts (or other consumers) may import from here.
export { refreshEventMessage } from "./bot/posting.js";

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
export function createDiscordClient(store: EventStore): Client {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
        await handleCommand(interaction, store, client);
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

  return client;
}

// ---------------------------------------------------------------------------
// Slash-command router
// ---------------------------------------------------------------------------

/** Routes registered slash commands after applying their runtime permission checks. */
async function handleCommand(
  interaction: ChatInputCommandInteraction,
  store: EventStore,
  client: Client
): Promise<void> {
  if (interaction.commandName === "set-nwchannel") {
    await requireAdministrator(interaction);
    await setNodeWarChannel(interaction, store);
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

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  } catch (replyError) {
    console.error("Failed to send interaction error response:", replyError);
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
