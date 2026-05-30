import {
  ActionRowBuilder,
  ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Interaction,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  RoleSelectMenuInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { formatGroupBadge, formatGroupName, getGroupLabel } from "./emojis.js";
import {
  buildNodeWarTitle,
  getGroupsForPreset,
  getNodeWarCapacity,
  labelTier,
  labelWarDay,
  NODE_WAR_PRESETS
} from "./nodewar-presets.js";
import { renderEventAttachments, renderEventComponents, renderEventEmbed } from "./render.js";
import type { EventStore } from "./store.js";
import { type GroupKey, type NodeWarTier, type WarDay, type WarEvent } from "./types.js";

const AUTO_SCHEDULER_USER = "nodewar-scheduler";
const SCHEDULER_INTERVAL_MS = 60_000;
const WIZARD_TIMEOUT_MS = 10 * 60_000;
const WIZARD_DAYS: WarDay[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

type WizardStep = "tier" | "days" | "repeat" | "post-time" | "ping" | "slots" | "channel" | "confirm";

interface EventWizardState {
  userId: string;
  guildId: string;
  step: WizardStep;
  expiresAt: number;
  createToday: boolean;
  tier?: NodeWarTier;
  days: WarDay[];
  recurring?: boolean;
  startTime: string;
  postTime: string;
  pingRoleIds: string[];
  channelId?: string;
  slots: {
    defense: number;
    zerker: number;
    shai: number;
  };
}

const wizardStates = new Map<string, EventWizardState>();

interface EditWizardState {
  userId: string;
  guildId: string;
  eventId: string;
  expiresAt: number;
  step: "menu" | "days" | "post-time" | "slots" | "recurrence";
  days: WarDay[];
  announcementTime: string;
  recurrence: WarEvent["recurrence"];
  mainball: number;
  defense: number;
  zerker: number;
  shai: number;
}

const editWizardStates = new Map<string, EditWizardState>();

export function createDiscordClient(store: EventStore): Client {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Discord bot ready as ${readyClient.user.tag}`);
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

async function listEvents(interaction: ChatInputCommandInteraction, store: EventStore): Promise<void> {
  const guildId = requireGuildId(interaction);
  const events = (await store.listEvents()).filter((event) => event.guildId === guildId && !event.closed).slice(0, 10);

  if (events.length === 0) {
    await interaction.reply({ content: "No open events yet.", ephemeral: true });
    return;
  }

  const lines = events.map((event, index) => {
    const signed = event.signups.filter((signup) => signup.group !== "bench").length;
    return `${index + 1}. ID: \`${event.id}\` - **${event.title}** - ${event.date} ${event.time} - ${signed}/${event.totalCapacity}`;
  });
  await interaction.reply({ content: lines.join("\n"), ephemeral: true });
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
  const guildId = requireGuildId(interaction);
  const channelId = await getNodeWarChannelId(store, guildId);
  if (!channelId) {
    throw new Error("NODEWAR_CHANNEL_ID is required for /event create-test.");
  }

  const day = interaction.options.getString("day", true) as WarDay;
  const announcementTime = parseTime(interaction.options.getString("time", true));
  const announcementRoleId = interaction.options.getRole("ping-role", true).id;
  const totalCapacity = getNodeWarCapacity("tier1", day);
  const eventDate = nextWarDateInTimezone(day, config.timezone);
  const event = buildNodeWarEvent({
    tier: "tier1",
    day,
    date: eventDate,
    title: `[TEST] ${buildNodeWarTitle(day, "tier1", totalCapacity)}`,
    time: config.nodeWarStartTime,
    recurrence: "once",
    createdBy: interaction.user.id,
    guildId,
    channelId,
    announcementDate: eventDate,
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
  const event = await getGuildEvent(store, requireGuildId(interaction), id);

  if (!event) {
    throw new Error("Event not found.");
  }

  await interaction.reply({
    embeds: [renderEventEmbed(event, true)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`event-post-now:${event.id}`)
          .setLabel("Post now")
          .setStyle(ButtonStyle.Primary)
      )
    ],
    files: renderEventAttachments(),
    ephemeral: true
  });
}

async function startEventWizard(interaction: ChatInputCommandInteraction, store: EventStore, createToday = false): Promise<void> {
  const today = createToday ? currentWarDay(config.timezone) : undefined;
  const guildId = requireGuildId(interaction);
  const state: EventWizardState = {
    userId: interaction.user.id,
    guildId,
    step: "tier",
    expiresAt: Date.now() + WIZARD_TIMEOUT_MS,
    createToday,
    days: today ? [today] : [],
    recurring: createToday ? false : undefined,
    startTime: config.nodeWarStartTime,
    postTime: config.nodeWarPostTime,
    pingRoleIds: config.nodeWarRoleId ? [config.nodeWarRoleId] : [],
    channelId: await getNodeWarChannelId(store, guildId),
    slots: { defense: 5, zerker: 2, shai: 2 }
  };
  wizardStates.set(interaction.user.id, state);
  await interaction.reply({ ...renderWizard(state), ephemeral: true });
}

async function handleSelect(
  interaction: StringSelectMenuInteraction,
  _store: EventStore,
  _client: Client
): Promise<void> {
  if (interaction.customId.startsWith("editwizard-")) {
    await handleEditWizardSelect(interaction);
    return;
  }

  const parsed = parseWizardCustomId(interaction.customId);
  if (!parsed) {
    return;
  }

  const state = getWizardState(parsed.userId, interaction.user.id);
  if (parsed.action === "tier") {
    state.tier = interaction.values[0] as NodeWarTier;
    state.step = state.createToday ? "post-time" : "days";
    refreshWizardTimeout(state);
    await interaction.update(renderWizard(state));
    return;
  }

  if (parsed.action === "days") {
    state.days = interaction.values as WarDay[];
    state.step = state.createToday ? "post-time" : "repeat";
    refreshWizardTimeout(state);
    await interaction.update(renderWizard(state));
  }
}

async function handleRoleSelect(interaction: RoleSelectMenuInteraction): Promise<void> {
  const parsed = parseWizardCustomId(interaction.customId);
  if (!parsed || parsed.action !== "ping-role") {
    return;
  }

  const state = getWizardState(parsed.userId, interaction.user.id);
  state.pingRoleIds = interaction.values;
  refreshWizardTimeout(state);
  await interaction.update(renderWizard(state));
}

async function handleChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  const parsed = parseWizardCustomId(interaction.customId);
  if (!parsed || parsed.action !== "channel") {
    return;
  }

  const state = getWizardState(parsed.userId, interaction.user.id);
  state.channelId = interaction.values[0];
  state.step = "confirm";
  refreshWizardTimeout(state);
  await interaction.update(renderWizard(state));
}

async function handleModal(
  interaction: ModalSubmitInteraction,
  _store: EventStore,
  _client: Client
): Promise<void> {
  if (interaction.customId.startsWith("editwizard-")) {
    await handleEditWizardModal(interaction);
    return;
  }

  const parsed = parseWizardCustomId(interaction.customId);
  if (!parsed) {
    return;
  }

  const state = getWizardState(parsed.userId, interaction.user.id);
  if (parsed.action === "post-time") {
    state.postTime = parseTime(interaction.fields.getTextInputValue("postTime"));
    state.step = "ping";
  } else if (parsed.action === "slots") {
    state.slots = {
      defense: parseSlotValue(interaction.fields.getTextInputValue("defense"), formatGroupBadge("defense")),
      zerker: parseSlotValue(interaction.fields.getTextInputValue("zerker"), formatGroupBadge("zerker")),
      shai: parseSlotValue(interaction.fields.getTextInputValue("shai"), formatGroupBadge("shai"))
    };
    validateWizardSlots(state);
    state.step = nextStepAfterSlots(state);
  } else {
    return;
  }

  refreshWizardTimeout(state);
  if (interaction.isFromMessage()) {
    await interaction.update(renderWizard(state));
  } else {
    await interaction.reply({ ...renderWizard(state), ephemeral: true });
  }
}

async function setSlots(
  interaction: ChatInputCommandInteraction,
  store: EventStore,
  client: Client
): Promise<void> {
  const id = await resolveEventId(store, requireGuildId(interaction), interaction.options.getString("id", true));
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

async function startEditWizard(interaction: ChatInputCommandInteraction, store: EventStore): Promise<void> {
  const id = interaction.options.getString("id", true);
  const guildId = requireGuildId(interaction);
  const event = await getGuildEvent(store, guildId, id);
  if (!event) {
    throw new Error("Event not found.");
  }

  const state: EditWizardState = {
    userId: interaction.user.id,
    guildId,
    eventId: event.id,
    expiresAt: Date.now() + WIZARD_TIMEOUT_MS,
    step: "menu",
    days: event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [],
    announcementTime: event.announcementTime ?? config.nodeWarPostTime,
    recurrence: event.recurrence,
    mainball: groupCapacity(event, "mainball", Math.max(0, event.totalCapacity - 9)),
    defense: groupCapacity(event, "defense", 5),
    zerker: groupCapacity(event, "zerker", 2),
    shai: groupCapacity(event, "shai", 2)
  };
  editWizardStates.set(interaction.user.id, state);
  await interaction.reply({ ...renderEditWizard(state, event), ephemeral: true });
}

async function handleEditWizardSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const parsed = parseEditWizardCustomId(interaction.customId);
  if (!parsed) {
    return;
  }

  const state = getEditWizardState(parsed.userId, interaction.user.id);
  if (parsed.action === "category") {
    state.step = interaction.values[0] as EditWizardState["step"];
  } else if (parsed.action === "days") {
    state.days = interaction.values as WarDay[];
  } else if (parsed.action === "recurrence") {
    state.recurrence = interaction.values[0] === "weekly" ? "weekly" : "once";
  } else {
    return;
  }

  refreshEditWizardTimeout(state);
  await interaction.update(renderEditWizard(state));
}

async function handleEditWizardModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseEditWizardCustomId(interaction.customId);
  if (!parsed) {
    return;
  }

  const state = getEditWizardState(parsed.userId, interaction.user.id);
  if (parsed.action === "post-time") {
    state.announcementTime = parseTime(interaction.fields.getTextInputValue("postTime"));
  } else if (parsed.action === "slots") {
    state.mainball = parseSlotValue(interaction.fields.getTextInputValue("mainball"), "Mainball/FFA");
    state.defense = parseSlotValue(interaction.fields.getTextInputValue("defense"), "Defense");
    state.shai = parseSlotValue(interaction.fields.getTextInputValue("shai"), "Shai");
    state.zerker = parseSlotValue(interaction.fields.getTextInputValue("zerker"), "Zerker");
  } else {
    return;
  }

  state.step = "menu";
  refreshEditWizardTimeout(state);

  if (interaction.isFromMessage()) {
    await interaction.update(renderEditWizard(state));
  } else {
    await interaction.reply({ ...renderEditWizard(state), ephemeral: true });
  }
}

async function handleEditWizardButton(
  interaction: ButtonInteraction,
  store: EventStore,
  client: Client
): Promise<void> {
  const parsed = parseEditWizardCustomId(interaction.customId);
  if (!parsed) {
    return;
  }

  const state = getEditWizardState(parsed.userId, interaction.user.id);
  const event = await getGuildEvent(store, state.guildId, state.eventId);
  if (!event) {
    throw new Error("Event not found.");
  }

  if (parsed.action === "cancel") {
    editWizardStates.delete(state.userId);
    await interaction.update({ content: "Event edit cancelled.", components: [] });
    return;
  }

  if (parsed.action === "back") {
    state.step = "menu";
    refreshEditWizardTimeout(state);
    await interaction.update(renderEditWizard(state, event));
    return;
  }

  if (parsed.action === "slots") {
    await interaction.showModal(buildEditWizardValuesModal(state));
    return;
  }

  if (parsed.action === "post-time-custom") {
    await interaction.showModal(buildEditWizardPostTimeModal(state));
    return;
  }

  if (parsed.action === "post-time-default") {
    state.announcementTime = config.nodeWarPostTime;
    state.step = "menu";
    refreshEditWizardTimeout(state);
    await interaction.update(renderEditWizard(state, event));
    return;
  }

  if (parsed.action === "confirm") {
    const totalSlots = state.mainball + state.defense + state.zerker + state.shai;
    if (totalSlots > event.totalCapacity) {
      throw new Error(`Group slots (${totalSlots}) exceed total roster size (${event.totalCapacity}).`);
    }

    const day = state.days[0] ?? event.day ?? "sunday";
    const updated = await store.updateEventDetails(state.eventId, {
      title: event.tier ? buildNodeWarTitle(day, event.tier, event.totalCapacity) : event.title,
      day,
      repeatDays: state.recurrence === "weekly" ? state.days : undefined,
      recurrence: state.recurrence,
      date: day === event.day ? event.date : nextWarDateInTimezone(day, config.timezone),
      announcementDate: day === event.day ? event.announcementDate : announcementDateForEvent(nextWarDateInTimezone(day, config.timezone)),
      announcementTime: state.announcementTime,
      groups: [
        { key: "mainball", label: getGroupLabel("mainball"), capacity: state.mainball, editable: true },
        { key: "defense", label: getGroupLabel("defense"), capacity: state.defense, editable: true },
        { key: "zerker", label: getGroupLabel("zerker"), capacity: state.zerker, editable: true },
        { key: "shai", label: getGroupLabel("shai"), capacity: state.shai, editable: true }
      ]
    });

    await refreshEventMessage(client, updated);
    editWizardStates.delete(state.userId);
    await interaction.update({ content: `Updated ${updated.title}.`, components: [] });
  }
}

function renderEditWizard(
  state: EditWizardState,
  event?: WarEvent
): { content: string; components: Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>> } {
  const days = state.days.length ? state.days.map(labelWarDay).join(", ") : "Not selected";
  const content = [
    `Editing event: ${event?.title ?? state.eventId}`,
    "",
    `Days: ${days}`,
    `Post time: ${state.announcementTime} ${config.timezone}`,
    `Repeat: ${state.recurrence === "weekly" ? "Repeat weekly" : "One-time only"}`,
    `Slots: ${formatGroupName("mainball")} ${state.mainball}, ${formatGroupBadge("defense")} ${state.defense}, ${formatGroupBadge("shai")} ${state.shai}, ${formatGroupBadge("zerker")} ${state.zerker}`,
    "",
    state.step === "menu" ? "Choose what to edit." : editWizardPrompt(state.step)
  ].join("\n");

  if (state.step === "days") {
    return {
      content,
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`editwizard-days:${state.userId}`)
            .setPlaceholder("Select day or days")
            .setMinValues(1)
            .setMaxValues(WIZARD_DAYS.length)
            .addOptions(
              WIZARD_DAYS.map((day) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(labelWarDay(day))
                  .setValue(day)
                  .setDefault(state.days.includes(day))
              )
            )
        ),
        editWizardBackRow(state.userId)
      ]
    };
  }

  if (state.step === "post-time") {
    return {
      content,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          wizardButton(`editwizard-post-time-default:${state.userId}`, "Default 10:15 PM Singapore Time", ButtonStyle.Primary),
          wizardButton(`editwizard-post-time-custom:${state.userId}`, "Custom post time", ButtonStyle.Secondary),
          wizardButton(`editwizard-back:${state.userId}`, "Back", ButtonStyle.Secondary)
        )
      ]
    };
  }

  if (state.step === "slots") {
    return {
      content,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          wizardButton(`editwizard-slots:${state.userId}`, "Adjust composition", ButtonStyle.Primary),
          wizardButton(`editwizard-back:${state.userId}`, "Back", ButtonStyle.Secondary)
        )
      ]
    };
  }

  if (state.step === "recurrence") {
    return {
      content,
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`editwizard-recurrence:${state.userId}`)
            .setPlaceholder("Choose repeat mode")
            .addOptions(
              new StringSelectMenuOptionBuilder().setLabel("One-time only").setValue("once").setDefault(state.recurrence !== "weekly"),
              new StringSelectMenuOptionBuilder().setLabel("Repeat weekly").setValue("weekly").setDefault(state.recurrence === "weekly")
            )
        ),
        editWizardBackRow(state.userId)
      ]
    };
  }

  return {
    content,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`editwizard-category:${state.userId}`)
          .setPlaceholder("Choose what to edit")
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("Days").setValue("days"),
            new StringSelectMenuOptionBuilder().setLabel("Time to post").setValue("post-time"),
            new StringSelectMenuOptionBuilder().setLabel("Composition roles and slots").setValue("slots"),
            new StringSelectMenuOptionBuilder().setLabel("Repeat mode").setValue("recurrence")
          )
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        wizardButton(`editwizard-confirm:${state.userId}`, "Confirm Update", ButtonStyle.Success),
        wizardButton(`editwizard-cancel:${state.userId}`, "Cancel", ButtonStyle.Danger)
      )
    ]
  };
}

function buildEditWizardValuesModal(state: EditWizardState): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`editwizard-slots:${state.userId}`)
    .setTitle("Edit Event Slots")
    .addComponents(
      textInputRow("mainball", "Mainball/FFA slots", String(state.mainball)),
      textInputRow("defense", "Defense slots", String(state.defense)),
      textInputRow("shai", "Shai slots", String(state.shai)),
      textInputRow("zerker", "Zerker slots", String(state.zerker))
    );
}

function buildEditWizardPostTimeModal(state: EditWizardState): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`editwizard-post-time:${state.userId}`)
    .setTitle("Edit Announcement Time")
    .addComponents(textInputRow("postTime", "Post time (HH:mm)", state.announcementTime));
}

function editWizardPrompt(step: EditWizardState["step"]): string {
  return {
    menu: "Choose what to edit.",
    days: "What day or days should this event use?",
    "post-time": "What time should the signup announcement post?",
    slots: "Adjust Mainball/FFA, Defense, Zerker, and Shai slots.",
    recurrence: "Should this event repeat weekly or run once?"
  }[step];
}

function editWizardBackRow(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    wizardButton(`editwizard-back:${userId}`, "Back", ButtonStyle.Secondary),
    wizardButton(`editwizard-cancel:${userId}`, "Cancel", ButtonStyle.Danger)
  );
}

function parseEditWizardCustomId(customId: string): { action: string; userId: string } | undefined {
  const [rawAction, userId] = customId.split(":");
  if (!rawAction?.startsWith("editwizard-") || !userId) {
    return undefined;
  }

  return { action: rawAction.slice("editwizard-".length), userId };
}

function getEditWizardState(userId: string, actorId: string): EditWizardState {
  if (userId !== actorId) {
    throw new Error("Only the user who started this edit wizard can use it.");
  }

  const state = editWizardStates.get(userId);
  if (!state || state.expiresAt < Date.now()) {
    editWizardStates.delete(userId);
    throw new Error("This edit wizard expired. Run /event edit again.");
  }

  return state;
}

function refreshEditWizardTimeout(state: EditWizardState): void {
  state.expiresAt = Date.now() + WIZARD_TIMEOUT_MS;
}

async function setRecurring(
  interaction: ChatInputCommandInteraction,
  store: EventStore,
  client: Client
): Promise<void> {
  const id = interaction.options.getString("id", true);
  const event = await getGuildEvent(store, requireGuildId(interaction), id);
  if (!event) {
    throw new Error("Event not found.");
  }

  const enabled = interaction.options.getBoolean("enabled", true);
  const updated = await store.updateEventDetails(id, {
    recurrence: enabled ? "weekly" : "once",
    repeatDays: enabled && event.day ? [event.day] : undefined
  });

  await refreshEventMessage(client, updated);
  await interaction.reply({
    content: `${updated.title} is now ${enabled ? "weekly recurring" : "one-time only"}.`,
    ephemeral: true
  });
}

async function deleteEvent(interaction: ChatInputCommandInteraction, store: EventStore): Promise<void> {
  const id = await resolveEventId(store, requireGuildId(interaction), interaction.options.getString("id", true));
  await store.deleteEvent(id);
  await interaction.reply({ content: `Deleted event ${id}.`, ephemeral: true });
}

async function repostEvent(
  interaction: ChatInputCommandInteraction,
  store: EventStore,
  client: Client
): Promise<void> {
  const id = interaction.options.getString("id", true);
  const event = await getGuildEvent(store, requireGuildId(interaction), id);
  if (!event) {
    throw new Error("Event not found.");
  }

  const channelId = await getNodeWarChannelId(store, requireGuildId(interaction));
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

async function handleButton(interaction: ButtonInteraction, store: EventStore, client: Client): Promise<void> {
  if (interaction.customId.startsWith("editwizard-")) {
    await handleEditWizardButton(interaction, store, client);
    return;
  }

  if (interaction.customId.startsWith("wizard-")) {
    await handleWizardButton(interaction, store, client);
    return;
  }

  const [action, eventId, groupKey] = interaction.customId.split(":");
  if (!eventId) {
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

async function handleWizardButton(interaction: ButtonInteraction, store: EventStore, client: Client): Promise<void> {
  const parsed = parseWizardCustomId(interaction.customId);
  if (!parsed) {
    return;
  }

  const state = getWizardState(parsed.userId, interaction.user.id);
  const value = parsed.value;

  if (parsed.action === "cancel") {
    wizardStates.delete(state.userId);
    await interaction.update({ content: "Event setup cancelled.", components: [] });
    return;
  }

  if (parsed.action === "repeat") {
    state.recurring = value === "weekly";
    state.startTime = config.nodeWarStartTime;
    state.step = "post-time";
    refreshWizardTimeout(state);
    await interaction.update(renderWizard(state));
    return;
  }

  if (parsed.action === "post-time") {
    if (value === "custom") {
      await interaction.showModal(buildWizardPostTimeModal(state.userId));
      return;
    }
    state.postTime = config.nodeWarPostTime;
    state.step = "ping";
    refreshWizardTimeout(state);
    await interaction.update(renderWizard(state));
    return;
  }

  if (parsed.action === "ping") {
    if (value === "default") {
      state.pingRoleIds = config.nodeWarRoleId ? [config.nodeWarRoleId] : [];
    } else if (value === "none") {
      state.pingRoleIds = [];
    }
    state.step = "slots";
    refreshWizardTimeout(state);
    await interaction.update(renderWizard(state));
    return;
  }

  if (parsed.action === "slots") {
    if (value === "custom") {
      await interaction.showModal(buildWizardSlotsModal(state));
      return;
    }
    state.slots = { defense: 5, zerker: 2, shai: 2 };
    validateWizardSlots(state);
    state.step = nextStepAfterSlots(state);
    refreshWizardTimeout(state);
    await interaction.update(renderWizard(state));
    return;
  }

  if (parsed.action === "confirm") {
    if (value === "cancel") {
      wizardStates.delete(state.userId);
      await interaction.update({ content: "Event setup cancelled.", components: [] });
      return;
    }
    const created = await confirmWizard(state, store, interaction.user.id);
    wizardStates.delete(state.userId);
    const channelId = created[0]?.channelId;
    await interaction.update({
      content: `Scheduled ${created.length} event${created.length === 1 ? "" : "s"}${channelId ? ` for <#${channelId}>` : ""}. The bot will post at the announcement time:\n${created
        .map((event) => `- ${event.title} (${event.id}) - ${event.announcementDate} ${event.announcementTime}`)
        .join("\n")}`,
      components: []
    });
  }
}

function renderWizard(state: EventWizardState): {
  content: string;
  components: Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder | RoleSelectMenuBuilder | ChannelSelectMenuBuilder>>;
} {
  const summary = renderWizardSummary(state);
  const content = `${state.createToday ? "Today's Node War setup" : "Node War event setup"}\n\n${summary}\n\n${wizardPrompt(state)}`;
  return { content, components: [...wizardStepComponents(state), cancelRow(state.userId)] };
}

function wizardPrompt(state: EventWizardState): string {
  return {
    tier: "Step 1: choose event tier.",
    days: state.createToday ? "Step 2: choose what Node War day today is." : "Step 2: choose one or more Node War days.",
    repeat: "Step 3: choose repeat mode.",
    "post-time": state.createToday ? "Step 3: choose announcement posting time." : "Step 4: choose announcement posting time.",
    ping: state.createToday ? "Step 4: choose role ping behavior." : "Step 5: choose role ping behavior.",
    slots: state.createToday ? "Step 5: choose slot setup." : "Step 6: choose slot setup.",
    channel: state.createToday ? "Step 6: choose where to post the roster." : "Step 7: choose where to post the roster.",
    confirm: "Final step: confirm event creation."
  }[state.step];
}

function wizardStepComponents(
  state: EventWizardState
): Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder | RoleSelectMenuBuilder | ChannelSelectMenuBuilder>> {
  if (state.step === "tier") {
    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizard-tier:${state.userId}`)
          .setPlaceholder("Select Node War tier")
          .addOptions(
            tierOption("Tier 1 - Balenos/Serendia", "tier1", state.tier),
            tierOption("Tier 2 - Calpheon/Ulukita", "tier2", state.tier),
            tierOption("Tier 3 - Valencia/Edania", "tier3", state.tier)
          )
      )
    ];
  }

  if (state.step === "days") {
    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizard-days:${state.userId}`)
          .setPlaceholder(state.createToday ? "Select today's Node War day" : "Select day or days")
          .setMinValues(1)
          .setMaxValues(state.createToday ? 1 : WIZARD_DAYS.length)
          .addOptions(
            WIZARD_DAYS.map((day) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(labelWarDay(day))
                .setValue(day)
                .setDefault(state.days.includes(day))
            )
          )
      )
    ];
  }

  if (state.step === "repeat") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        wizardButton(`wizard-repeat:${state.userId}:once`, "One-time only", ButtonStyle.Secondary),
        wizardButton(`wizard-repeat:${state.userId}:weekly`, "Repeat weekly", ButtonStyle.Primary)
      )
    ];
  }

  if (state.step === "post-time") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        wizardButton(`wizard-post-time:${state.userId}:default`, "Default 10:15 PM Singapore Time", ButtonStyle.Primary),
        wizardButton(`wizard-post-time:${state.userId}:custom`, "Custom post time", ButtonStyle.Secondary)
      )
    ];
  }

  if (state.step === "ping") {
    return [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`wizard-ping-role:${state.userId}`)
          .setPlaceholder("Select one or more ping roles")
          .setMinValues(1)
          .setMaxValues(25)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        wizardButton(`wizard-ping:${state.userId}:default`, "Use default NODEWAR_ROLE_ID", ButtonStyle.Primary, !config.nodeWarRoleId),
        wizardButton(`wizard-ping:${state.userId}:none`, "No ping", ButtonStyle.Secondary),
        wizardButton(`wizard-ping:${state.userId}:continue`, "Continue with selected roles", ButtonStyle.Success, state.pingRoleIds.length === 0)
      )
    ];
  }

  if (state.step === "slots") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        wizardButton(`wizard-slots:${state.userId}:default`, "Use default slots", ButtonStyle.Primary),
        wizardButton(`wizard-slots:${state.userId}:custom`, "Customize slots", ButtonStyle.Secondary)
      )
    ];
  }

  if (state.step === "channel") {
    return [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`wizard-channel:${state.userId}`)
          .setPlaceholder("Select roster post channel")
          .setMinValues(1)
          .setMaxValues(1)
          .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
    ];
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      wizardButton(`wizard-confirm:${state.userId}:confirm`, "Confirm Create", ButtonStyle.Success),
      wizardButton(`wizard-confirm:${state.userId}:cancel`, "Cancel", ButtonStyle.Danger)
    )
  ];
}

function renderWizardSummary(state: EventWizardState): string {
  const days = state.days.length ? state.days.map(labelWarDay).join(", ") : "Not selected";
  const tier = state.tier ? labelTier(state.tier) : "Not selected";
  const territory = state.tier ? NODE_WAR_PRESETS[state.tier].territoryGroup : "Not selected";
  const capacities = state.tier && state.days.length
    ? state.days.map((day) => `${labelWarDay(day)} ${getNodeWarCapacity(state.tier as NodeWarTier, day)}`).join(", ")
    : "Not selected";
  const ping = state.pingRoleIds.length ? state.pingRoleIds.map((roleId) => `<@&${roleId}>`).join(", ") : "No ping";
  const channel = state.channelId ? `<#${state.channelId}>` : config.nodeWarChannelId ? `<#${config.nodeWarChannelId}>` : "Select during setup";
  const slotLine = `${formatGroupBadge("defense")} ${state.slots.defense}, ${formatGroupBadge("zerker")} ${state.slots.zerker}, ${formatGroupBadge("shai")} ${state.slots.shai}, ${formatGroupName("mainball")} auto`;

  return [
    `Tier: ${tier}`,
    `Territory: ${territory}`,
    `${state.createToday ? "Today" : "Days"}: ${days}`,
    `Repeat: ${state.recurring === undefined ? "Not selected" : state.recurring ? "Repeat weekly" : "One-time only"}`,
    `Start time: 9:00 PM GMT+8`,
    `Post time: ${state.postTime} ${config.timezone}`,
    `Ping roles: ${ping}`,
    `Post channel: ${channel}`,
    `Slots: ${slotLine}`,
    `Capacity per day: ${capacities}`
  ].join("\n");
}

function tierOption(label: string, value: NodeWarTier, selected?: NodeWarTier): StringSelectMenuOptionBuilder {
  return new StringSelectMenuOptionBuilder().setLabel(label).setValue(value).setDefault(selected === value);
}

function wizardButton(customId: string, label: string, style: ButtonStyle, disabled = false): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}

function cancelRow(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    wizardButton(`wizard-cancel:${userId}`, "Cancel", ButtonStyle.Danger)
  );
}

function buildWizardPostTimeModal(userId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`wizard-post-time:${userId}`)
    .setTitle("Custom Post Time")
    .addComponents(textInputRow("postTime", "Post time (HH:mm)", config.nodeWarPostTime));
}

function buildWizardSlotsModal(state: EventWizardState): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`wizard-slots:${state.userId}`)
    .setTitle("Customize Slots")
    .addComponents(
      textInputRow("defense", "Defense slots", String(state.slots.defense)),
      textInputRow("zerker", "Zerker slots", String(state.slots.zerker)),
      textInputRow("shai", "Shai slots", String(state.slots.shai))
    );
}

function textInputRow(id: string, label: string, value: string): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(value.slice(0, 4000))
  );
}

async function confirmWizard(state: EventWizardState, store: EventStore, createdBy: string): Promise<WarEvent[]> {
  const channelId = state.channelId ?? (await getNodeWarChannelId(store, state.guildId));

  if (!state.tier || state.days.length === 0 || state.recurring === undefined) {
    throw new Error("Wizard is incomplete.");
  }
  if (!channelId) {
    throw new Error("Choose a channel before creating the event.");
  }

  validateWizardSlots(state);
  const created: WarEvent[] = [];
  const next = state.createToday ? todayWarDayFromSelection(state.days, config.timezone) : nextWarDayFromSelection(state.days, config.timezone);
  const totalCapacity = getNodeWarCapacity(state.tier, next.day);
  const event = buildNodeWarEvent({
    tier: state.tier,
    day: next.day,
    date: next.date,
    title: buildNodeWarTitle(next.day, state.tier, totalCapacity),
    time: state.startTime,
    recurrence: state.createToday ? "once" : state.recurring ? "weekly" : "once",
    createdBy,
    guildId: state.guildId,
    channelId,
    announcementDate: state.createToday ? zonedNow(config.timezone).date : announcementDateForEvent(next.date),
    announcementTime: state.postTime,
    announcementChannelId: channelId,
    announcementRoleIds: state.pingRoleIds,
    notes: `Announcement: ${state.postTime} ${config.timezone}`
  });
  event.repeatDays = !state.createToday && state.recurring ? [next.day] : undefined;
  event.groups = buildWizardGroups(state, totalCapacity);

  await store.createEvent(event);
  created.push(event);

  return created;
}

function nextStepAfterSlots(state: EventWizardState): WizardStep {
  return state.channelId || config.nodeWarChannelId ? "confirm" : "channel";
}

function buildWizardGroups(state: EventWizardState, totalCapacity: number): WarEvent["groups"] {
  const mainball = totalCapacity - state.slots.defense - state.slots.zerker - state.slots.shai;
  if (mainball < 0) {
    throw new Error(`${formatGroupBadge("defense")}/${formatGroupBadge("zerker")}/${formatGroupBadge("shai")} slots exceed total roster size (${totalCapacity}).`);
  }

  return [
    { key: "mainball", label: getGroupLabel("mainball"), capacity: mainball, editable: true },
    { key: "defense", label: getGroupLabel("defense"), capacity: state.slots.defense, editable: true },
    { key: "zerker", label: getGroupLabel("zerker"), capacity: state.slots.zerker, editable: true },
    { key: "shai", label: getGroupLabel("shai"), capacity: state.slots.shai, editable: true }
  ];
}

function parseWizardCustomId(customId: string): { action: string; userId: string; value?: string } | undefined {
  const [rawAction, userId, value] = customId.split(":");
  if (!rawAction?.startsWith("wizard-") || !userId) {
    return undefined;
  }

  return { action: rawAction.slice("wizard-".length), userId, value };
}

function getWizardState(userId: string, actorId: string): EventWizardState {
  if (userId !== actorId) {
    throw new Error("Only the user who started this wizard can use it.");
  }

  const state = wizardStates.get(userId);
  if (!state || state.expiresAt < Date.now()) {
    wizardStates.delete(userId);
    throw new Error("This setup wizard expired. Run /event create again.");
  }

  return state;
}

function refreshWizardTimeout(state: EventWizardState): void {
  state.expiresAt = Date.now() + WIZARD_TIMEOUT_MS;
}

function parseSlotValue(value: string, label: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 200) {
    throw new Error(`${label} slots must be a whole number from 0 to 200.`);
  }
  return parsed;
}

async function resolveEventId(store: EventStore, guildId: string, input: string): Promise<string> {
  const normalized = normalizeEventIdInput(input);
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

function requireGuildId(interaction: ChatInputCommandInteraction): string {
  if (!interaction.guildId) {
    throw new Error("Use this command inside a Discord server.");
  }
  return interaction.guildId;
}

async function getGuildEvent(store: EventStore, guildId: string, id: string): Promise<WarEvent | undefined> {
  const event = await store.getEvent(normalizeEventIdInput(id));
  return event?.guildId === guildId ? event : undefined;
}

async function assertButtonGuild(store: EventStore, interaction: ButtonInteraction, eventId: string): Promise<void> {
  const event = await store.getEvent(eventId);
  if (!event || !interaction.guildId || event.guildId !== interaction.guildId) {
    throw new Error("This event does not belong to this server.");
  }
}

function normalizeEventIdInput(input: string): string {
  return input
    .trim()
    .replace(/^ID:\s*/i, "")
    .replace(/^`+|`+$/g, "")
    .replace(/^\(|\)$/g, "")
    .trim();
}

function validateWizardSlots(state: EventWizardState): void {
  if (!state.tier || state.days.length === 0) {
    return;
  }

  const fixedSlots = state.slots.defense + state.slots.zerker + state.slots.shai;
  for (const day of state.days) {
    const capacity = getNodeWarCapacity(state.tier, day);
    if (fixedSlots > capacity) {
      throw new Error(`${formatGroupBadge("defense")}/${formatGroupBadge("zerker")}/${formatGroupBadge("shai")} slots (${fixedSlots}) exceed ${labelWarDay(day)} capacity (${capacity}).`);
    }
  }
}

async function startNodeWarScheduler(client: Client, store: EventStore): Promise<void> {
  await runNodeWarScheduler(client, store);
  setInterval(() => {
    runNodeWarScheduler(client, store).catch((error) => {
      console.error("Node War scheduler failed:", error);
    });
  }, SCHEDULER_INTERVAL_MS);
}

async function runNodeWarScheduler(client: Client, store: EventStore): Promise<void> {
  const now = zonedNow(config.timezone);
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
    }
  }
}

async function postDueScheduledEvents(
  client: Client,
  store: EventStore,
  now: { date: string; hour: number; minute: number; weekday: string }
): Promise<void> {
  const events = await store.listEvents();
  for (const event of events) {
    if (event.closed || event.messageId || !event.announcementDate || !event.announcementTime) {
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
    }
  }
}

function buildNodeWarEvent(input: {
  tier: NodeWarTier;
  day: WarDay;
  date: string;
  title: string;
  time: string;
  recurrence: WarEvent["recurrence"];
  createdBy: string;
  notes?: string;
  announcementDate?: string;
  announcementTime?: string;
  announcementChannelId?: string;
  announcementRoleId?: string;
  announcementRoleIds?: string[];
  guildId?: string;
  channelId?: string;
}): WarEvent {
  const totalCapacity = getNodeWarCapacity(input.tier, input.day);
  const now = new Date().toISOString();

  return {
    id: nanoid(10),
    title: input.title,
    kind: "nodewar",
    tier: input.tier,
    day: input.day,
    date: input.date,
    time: parseTime(input.time),
    timezone: config.timezone,
    recurrence: input.recurrence,
    totalCapacity,
    groups: getGroupsForPreset(input.tier, totalCapacity),
    notes: input.notes,
    announcementDate: input.announcementDate,
    announcementTime: input.announcementTime,
    announcementChannelId: input.announcementChannelId,
    announcementRoleId: input.announcementRoleId,
    announcementRoleIds: input.announcementRoleIds,
    guildId: input.guildId,
    channelId: input.channelId,
    createdBy: input.createdBy,
    createdAt: now,
    signups: [],
    closed: false
  };
}

function groupCapacity(event: WarEvent, key: GroupKey, fallback: number): number {
  return event.groups.find((group) => group.key === key)?.capacity ?? fallback;
}

async function getNodeWarChannelId(store: EventStore, guildId: string): Promise<string | undefined> {
  const settings = await store.getSettings();
  return (
    settings.nodeWarChannelIds?.[guildId] ??
    (guildId === config.discordGuildId ? settings.nodeWarChannelId ?? config.nodeWarChannelId : undefined)
  );
}

async function postEventToChannel(
  client: Client,
  channelId: string,
  event: WarEvent,
  roleIds = getAnnouncementRoleIds(event)
) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !("send" in channel)) {
    throw new Error("Selected Node War channel is not a text channel.");
  }

  const content = roleIds.length ? roleIds.map((roleId) => `<@&${roleId}>`).join(" ") : undefined;
  return channel.send({
    content,
    ...renderEventMessagePayload(event),
    allowedMentions: roleIds.length ? { roles: roleIds } : undefined
  });
}

function getAnnouncementRoleIds(event: WarEvent): string[] {
  if (event.announcementRoleIds) {
    return [...new Set(event.announcementRoleIds)];
  }
  const roleId = event.announcementRoleId ?? config.nodeWarRoleId;
  return roleId ? [roleId] : [];
}

async function refreshEventMessage(client: Client, event: WarEvent): Promise<void> {
  if (!event.channelId || !event.messageId) {
    return;
  }

  const channel = await client.channels.fetch(event.channelId);
  if (!channel || !("messages" in channel)) {
    return;
  }

  const message = await channel.messages.fetch(event.messageId);
  await message.edit(renderEventMessagePayload(event));
}

function renderEventMessagePayload(event: WarEvent) {
  return {
    embeds: [renderEventEmbed(event, true)],
    components: renderEventComponents(event),
    files: renderEventAttachments(),
    attachments: []
  };
}

async function requireAdministrator(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return;
  }

  throw new Error("Only server Administrators can use bot commands.");
}

async function requireOfficer(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return;
  }

  if (config.officerRoleId && memberHasRole(interaction, config.officerRoleId)) {
    return;
  }

  throw new Error("Only Administrators or configured officers can do that.");
}

function memberHasRole(interaction: ChatInputCommandInteraction | ButtonInteraction, roleId: string): boolean {
  const roles = interaction.member?.roles;
  if (Array.isArray(roles)) {
    return roles.includes(roleId);
  }

  if (roles && typeof roles === "object" && "cache" in roles) {
    return roles.cache.has(roleId);
  }

  return false;
}

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

function schedulerHour(): number {
  return Number.parseInt(config.nodeWarPostTime.split(":")[0] ?? "22", 10);
}

function schedulerMinute(): number {
  return Number.parseInt(config.nodeWarPostTime.split(":")[1] ?? "10", 10);
}

function timeMatches(time: string, hour: number, minute: number): boolean {
  const [hourValue, minuteValue = "00"] = time.split(":");
  return Number.parseInt(hourValue, 10) === hour && Number.parseInt(minuteValue, 10) === minute;
}

function announcementIsDue(
  date: string,
  time: string,
  now: { date: string; hour: number; minute: number }
): boolean {
  if (date < now.date) {
    return true;
  }
  if (date > now.date) {
    return false;
  }
  return minutesSinceMidnight(time) <= now.hour * 60 + now.minute;
}

function announcementDateForEvent(eventDate: string): string {
  const date = new Date(`${eventDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function minutesSinceMidnight(time: string): number {
  const [hourValue, minuteValue = "00"] = time.split(":");
  return Number.parseInt(hourValue, 10) * 60 + Number.parseInt(minuteValue, 10);
}

function zonedNow(timezone: string): { date: string; hour: number; minute: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number.parseInt(value("hour"), 10),
    minute: Number.parseInt(value("minute"), 10),
    weekday: value("weekday").toLowerCase()
  };
}

function nextWarDateInTimezone(day: WarDay, timezone: string): string {
  const now = zonedNow(timezone);
  const todayIndex = weekdayIndex(now.weekday);
  const targetIndex = weekdayIndex(day);
  const delta = (targetIndex - todayIndex + 7) % 7;
  const date = new Date(`${now.date}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function todayWarDayFromSelection(days: WarDay[], timezone: string): { day: WarDay; date: string } {
  const day = days[0];
  if (!day) {
    throw new Error("Choose today's Node War day.");
  }

  return { day, date: zonedNow(timezone).date };
}

function currentWarDay(timezone: string): WarDay {
  const day = warDayFromWeekday(zonedNow(timezone).weekday);
  if (!day) {
    throw new Error("There is no configured Node War preset for today.");
  }
  return day;
}

function nextWarDayFromSelection(days: WarDay[], timezone: string): { day: WarDay; date: string } {
  const allowedDays = days.length ? days : WIZARD_DAYS;
  const next = nextWarDayAfterToday(timezone, allowedDays);
  if (!next) {
    throw new Error("No valid future Node War day selected.");
  }
  return next;
}

function nextWarDayAfterToday(timezone: string, allowedDays: WarDay[] = WIZARD_DAYS): { day: WarDay; date: string } | undefined {
  const now = zonedNow(timezone);
  const todayIndex = weekdayIndex(now.weekday);
  const baseDate = new Date(`${now.date}T00:00:00Z`);

  for (let offset = 1; offset <= 7; offset += 1) {
    const index = (todayIndex + offset) % 7;
    const day = warDayFromWeekday(WEEKDAYS[index] ?? "");
    if (!day || !allowedDays.includes(day)) {
      continue;
    }

    const date = new Date(baseDate);
    date.setUTCDate(date.getUTCDate() + offset);
    return { day, date: date.toISOString().slice(0, 10) };
  }

  return undefined;
}

function warDayFromWeekday(weekday: string): WarDay | undefined {
  const normalized = weekday.toLowerCase();
  if (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday"].includes(normalized)) {
    return normalized as WarDay;
  }
  return undefined;
}

function weekdayIndex(day: string): number {
  return WEEKDAYS.indexOf(day);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
