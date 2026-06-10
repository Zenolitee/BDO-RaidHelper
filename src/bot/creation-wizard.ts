import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelSelectMenuBuilder, ChannelSelectMenuInteraction, ChannelType, ChatInputCommandInteraction, Client, ModalBuilder, ModalSubmitInteraction, RoleSelectMenuBuilder, RoleSelectMenuInteraction, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { config } from '../config.js';
import type { NodeWarTier, WarDay, WarEvent } from '../types.js';
import { EventStore } from '../store.js';
import { getNodeWarCapacity, buildNodeWarTitle, labelWarDay, NODE_WAR_PRESETS } from '../nodewar-presets.js';
import type { EventWizardState, WizardStep } from './wizard-types.js';
import { WIZARD_DAYS, WIZARD_TIMEOUT_MS } from './wizard-types.js';
import { wizardStates, getWizardState, refreshWizardTimeout, parseWizardCustomId, parseSlotValue, validateWizardSlots, nextStepAfterSlots } from './wizard-state.js';
import { formatGroupBadge, formatGroupName, getGroupLabel } from '../emojis.js';
import { labelTier } from '../nodewar-presets.js';
import { parseTime, currentWarDay, zonedNow, announcementDateForEvent, todayWarDayFromSelection, nextWarDayFromSelection, getNodeWarChannelId, requireGuildId } from './utils.js';
import { buildNodeWarEvent } from './posting.js';
import { handleEditWizardSelect, handleEditWizardModal } from './edit-wizard.js';

const AUTO_SCHEDULER_USER = 'nodewar-scheduler';
const NODEWAR_DURATION_MS = 60 * 60 * 1000;

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

/** Applies creation-wizard and edit-wizard select-menu changes. */
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

/** Captures selected announcement roles for the active creation wizard. */
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

/** Captures the selected delivery channel for the active creation wizard. */
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

/** Applies custom time and slot values submitted from creation or edit modals. */
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

/** Advances or confirms the in-memory event-creation wizard. */
async function handleWizardButton(interaction: ButtonInteraction, store: EventStore): Promise<void> {
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
  event.repeatDays = !state.createToday && state.recurring ? state.days : undefined;
  event.active = true;
  event.autoRepost = !state.createToday && state.recurring;
  event.groups = buildWizardGroups(state, totalCapacity);

  await store.createEvent(event);
  created.push(event);

  return created;
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
    { key: "shai", label: getGroupLabel("shai"), capacity: state.slots.shai, editable: true },
    { key: "bench", label: getGroupLabel("bench"), capacity: 0, editable: false }
  ];
}

export {
  startEventWizard,
  handleSelect,
  handleRoleSelect,
  handleChannelSelect,
  handleModal,
  handleWizardButton,
  renderWizard,
  wizardPrompt,
  wizardStepComponents,
  renderWizardSummary,
  tierOption,
  wizardButton,
  cancelRow,
  buildWizardPostTimeModal,
  buildWizardSlotsModal,
  textInputRow,
  confirmWizard,
  nextStepAfterSlots,
  buildWizardGroups,
};
