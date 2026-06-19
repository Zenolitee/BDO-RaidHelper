import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelSelectMenuBuilder, ChannelSelectMenuInteraction, ChannelType, ChatInputCommandInteraction, Client, ModalBuilder, ModalSubmitInteraction, RoleSelectMenuBuilder, RoleSelectMenuInteraction, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { config } from '../config.js';
import type { NodeWarTier, WarDay, WarEvent } from '../types.js';
import { EventStore } from '../store.js';
import { getNodeWarCapacity, buildNodeWarTitle, labelWarDay, NODE_WAR_PRESETS } from '../nodewar-presets.js';
import type { EventKind, EventWizardState, WizardStep } from './wizard-types.js';
import { WIZARD_DAYS, WIZARD_TIMEOUT_MS, GBR_BOSS_KEYS, DEFAULT_GBR_ORDER } from './wizard-types.js';
import { getWizardStateFromStore, refreshWizardTimeout, saveWizardState, deleteWizardStateFromStore, parseWizardCustomId, parseSlotValue, validateWizardSlots, nextStepAfterSlots } from './wizard-state.js';
import { formatGroupBadge, formatGroupName, getGroupLabel } from '../emojis.js';
import { labelTier } from '../nodewar-presets.js';
import { parseTime, currentWarDay, zonedNow, announcementDateForEvent, todayWarDayFromSelection, nextWarDayFromSelection, getNodeWarChannelId, requireGuildId } from './utils.js';
import { buildNodeWarEvent } from './posting.js';
import { handleEditWizardSelect, handleEditWizardModal } from './edit-wizard.js';
import { GBR_BOSSES, buildGBRTitle } from '../gbr.js';
import { nanoid } from 'nanoid';

const AUTO_SCHEDULER_USER = 'nodewar-scheduler';
const NODEWAR_DURATION_MS = 60 * 60 * 1000;

async function startEventWizard(interaction: ChatInputCommandInteraction, store: EventStore, createToday = false): Promise<void> {
  const today = createToday ? currentWarDay(config.timezone) : undefined;
  const guildId = requireGuildId(interaction);
  const state: EventWizardState = {
    userId: interaction.user.id,
    guildId,
    step: "kind",
    expiresAt: Date.now() + WIZARD_TIMEOUT_MS,
    eventKind: "nodewar",
    createToday,
    days: today ? [today] : [],
    recurring: createToday ? false : undefined,
    startTime: config.nodeWarStartTime,
    eventTime: "21:00",
    postTime: config.nodeWarPostTime,
    pingRoleIds: config.nodeWarRoleId ? [config.nodeWarRoleId] : [],
    channelId: await getNodeWarChannelId(store, guildId),
    slots: { defense: 5, zerker: 2, shai: 2 },
    bossOrder: [...DEFAULT_GBR_ORDER],
    customTitle: "",
    customDescription: ""
  };
  await saveWizardState(store, state);
  await interaction.reply({ ...renderWizard(state), ephemeral: true });
}

/** Applies creation-wizard and edit-wizard select-menu changes. */
async function handleSelect(
  interaction: StringSelectMenuInteraction,
  store: EventStore,
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

  console.log(`[Wizard] handleSelect called: action=${parsed.action}, userId=${parsed.userId}, interactionUser=${interaction.user.id}`);
  const state = await getWizardStateFromStore(store, parsed.userId, interaction.user.id);

  if (parsed.action === "kind") {
    state.eventKind = interaction.values[0] as EventKind;
    if (state.eventKind === "nodewar") {
      state.step = "tier";
    } else if (state.eventKind === "gbr") {
      state.step = state.createToday ? "boss-order" : "days";
    } else {
      state.step = "title";
    }
    await refreshWizardTimeout(store, state);
    console.log(`[Wizard] Calling interaction.update() for kind action`);
    await interaction.update(renderWizard(state));
    console.log(`[Wizard] interaction.update() completed successfully`);
    return;
  }

  if (parsed.action === "tier") {
    state.tier = interaction.values[0] as NodeWarTier;
    state.step = state.createToday ? "post-time" : "days";
    await refreshWizardTimeout(store, state);
    await interaction.update(renderWizard(state));
    return;
  }

  if (parsed.action === "days") {
    state.days = interaction.values as WarDay[];
    if (state.eventKind === "gbr") {
      state.step = "boss-order";
    } else if (state.eventKind === "custom") {
      state.step = "event-time";
    } else {
      state.step = "repeat";
    }
    await refreshWizardTimeout(store, state);
    await interaction.update(renderWizard(state));
    return;
  }

  if (parsed.action === "boss-order") {
    state.bossOrder = interaction.values;
    await refreshWizardTimeout(store, state);
    await interaction.update(renderWizard(state));
    return;
  }
}

/** Captures selected announcement roles for the active creation wizard. */
async function handleRoleSelect(interaction: RoleSelectMenuInteraction, store: EventStore): Promise<void> {
  const parsed = parseWizardCustomId(interaction.customId);
  if (!parsed || parsed.action !== "ping-role") {
    return;
  }

  const state = await getWizardStateFromStore(store, parsed.userId, interaction.user.id);
  state.pingRoleIds = interaction.values;
  await refreshWizardTimeout(store, state);
  await interaction.update(renderWizard(state));
}

/** Captures the selected delivery channel for the active creation wizard. */
async function handleChannelSelect(interaction: ChannelSelectMenuInteraction, store: EventStore): Promise<void> {
  const parsed = parseWizardCustomId(interaction.customId);
  if (!parsed || parsed.action !== "channel") {
    return;
  }

  const state = await getWizardStateFromStore(store, parsed.userId, interaction.user.id);
  state.channelId = interaction.values[0];
  state.step = "confirm";
  await refreshWizardTimeout(store, state);
  await interaction.update(renderWizard(state));
}

/** Applies custom time and slot values submitted from creation or edit modals. */
async function handleModal(
  interaction: ModalSubmitInteraction,
  store: EventStore,
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

  const state = await getWizardStateFromStore(store, parsed.userId, interaction.user.id);
  if (parsed.action === "post-time") {
    state.postTime = parseTime(interaction.fields.getTextInputValue("postTime"));
    state.step = "ping";
  } else if (parsed.action === "title") {
    state.customTitle = interaction.fields.getTextInputValue("title").trim() || "Custom Event";
    state.customDescription = interaction.fields.getTextInputValue("description").trim();
    state.step = state.createToday ? "event-time" : "days";
  } else if (parsed.action === "event-time") {
    state.eventTime = parseTime(interaction.fields.getTextInputValue("eventTime"));
    state.step = state.createToday ? "ping" : "repeat";
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

  await refreshWizardTimeout(store, state);
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

  const state = await getWizardStateFromStore(store, parsed.userId, interaction.user.id);
  const value = parsed.value;

  if (parsed.action === "cancel") {
    await deleteWizardStateFromStore(store, state.userId);
    await interaction.update({ content: "Event setup cancelled.", components: [] });
    return;
  }

  if (parsed.action === "boss-order-confirm") {
    state.step = "event-time";
    await refreshWizardTimeout(store, state);
    await interaction.update(renderWizard(state));
    return;
  }

  if (parsed.action === "title") {
    await interaction.showModal(buildWizardTitleModal(state.userId));
    return;
  }

  if (parsed.action === "repeat") {
    state.recurring = value === "weekly";
    if (state.eventKind === "nodewar") {
      state.startTime = config.nodeWarStartTime;
      state.step = "post-time";
    } else {
      state.step = "ping";
    }
    await refreshWizardTimeout(store, state);
    await interaction.update(renderWizard(state));
    return;
  }

  if (parsed.action === "event-time") {
    if (value === "custom") {
      await interaction.showModal(buildWizardEventTimeModal(state.userId));
      return;
    }
    state.eventTime = "21:00";
    state.step = state.createToday ? "ping" : "repeat";
    await refreshWizardTimeout(store, state);
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
    await refreshWizardTimeout(store, state);
    await interaction.update(renderWizard(state));
    return;
  }

  if (parsed.action === "ping") {
    if (value === "default") {
      state.pingRoleIds = config.nodeWarRoleId ? [config.nodeWarRoleId] : [];
    } else if (value === "none") {
      state.pingRoleIds = [];
    }
    // Non-nodewar events skip slots
    state.step = state.eventKind === "nodewar" ? "slots" : nextStepAfterSlots(state);
    await refreshWizardTimeout(store, state);
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
    await refreshWizardTimeout(store, state);
    await interaction.update(renderWizard(state));
    return;
  }

  if (parsed.action === "confirm") {
    if (value === "cancel") {
      await deleteWizardStateFromStore(store, state.userId);
      await interaction.update({ content: "Event setup cancelled.", components: [] });
      return;
    }
    const created = await confirmWizard(state, store, interaction.user.id);
    await deleteWizardStateFromStore(store, state.userId);
    const channelId = created[0]?.channelId;
    await interaction.update({
      content: `Scheduled ${created.length} event${created.length === 1 ? "" : "s"}${channelId ? ` for <#${channelId}>` : ""}. The bot will post at the announcement time:\n${created
        .map((event) => `- ${event.title} (${event.id}) - ${event.announcementDate} ${event.announcementTime}`)
        .join("\n")}${config.publicBaseUrl ? `\n\n🌐 Manage events: <${config.publicBaseUrl}>` : ''}`,
      components: []
    });
  }
}

function renderWizard(state: EventWizardState): {
  content: string;
  components: Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder | RoleSelectMenuBuilder | ChannelSelectMenuBuilder>>;
} {
  const siteUrl = config.publicBaseUrl;

  // Show intro message for the first step (kind selection)
  if (state.step === "kind") {
    const content = [
      "# 📋 Create Event",
      "",
      "Choose an event type below to get started.",
      "",
      "### Event Types",
      "",
      "**🎮 Node War**",
      `> Standard Node War roster with role slots and signups.${siteUrl ? `\n> 💡 *Tip: Use the web dashboard for easier setup!*` : ''}`,
      "",
      "**🐉 Guild Boss Raid (GBR)**",
      "> Boss raid notification with configurable kill order. Posts as an announcement with a countdown.",
      "",
      "**📝 Custom Event**",
      "> Create any event with a custom title and description.",
      "",
      "---",
      "*Select an event type below to continue.*",
    ].join("\n");
    return { content, components: [...wizardStepComponents(state), cancelRow(state.userId)] };
  }

  // For GBR events, show formatted step-by-step wizard
  if (state.eventKind === "gbr") {
    return renderGBRWizard(state, siteUrl);
  }

  // For other event types, show the summary and prompt
  const summary = renderWizardSummary(state);
  const kindLabel = state.eventKind === "custom" ? "Custom Event" : "Node War";
  const content = `${state.createToday ? `Today's ${kindLabel} setup` : `${kindLabel} event setup`}\n\n${summary}\n\n${wizardPrompt(state)}`;
  return { content, components: [...wizardStepComponents(state), cancelRow(state.userId)] };
}

/** Renders a formatted step-by-step wizard for GBR events. */
function renderGBRWizard(state: EventWizardState, siteUrl?: string): {
  content: string;
  components: Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder | RoleSelectMenuBuilder | ChannelSelectMenuBuilder>>;
} {
  const steps = [
    { key: "days", icon: "📅", label: "Select Day" },
    { key: "repeat", icon: "🔄", label: "Repeat" },
    { key: "boss-order", icon: "🐉", label: "Boss Order" },
    { key: "event-time", icon: "⏰", label: "Event Time" },
    { key: "ping", icon: "📢", label: "Role Pings" },
    { key: "confirm", icon: "✅", label: "Confirm" },
  ];
  const currentStepIndex = steps.findIndex((s) => s.key === state.step);
  const bossNames = state.bossOrder.map((key) => GBR_BOSSES.find((b) => b.key === key)?.name ?? key).join(" \u2192 ");

  // Build vertical progress indicator
  const progressLines = steps.map((step, i) => {
    const isCompleted = i < currentStepIndex;
    const isCurrent = i === currentStepIndex;
    
    if (isCompleted) return `~~${step.icon} ${step.label}~~`;
    if (isCurrent) return `**${step.icon} ${step.label}**`;
    return `${step.icon} ${step.label}`;
  });
  const progress = progressLines.join("\n");

  // Build step-specific content
  let stepContent = "";
  const dayLabel = state.days.length ? state.days.map(labelWarDay).join(", ") : "Not selected";
  const announceTime = state.eventTime ? calculateAnnouncementTime(state.eventTime) : "TBD";
  const ping = state.pingRoleIds.length ? state.pingRoleIds.map((roleId) => `<@&${roleId}>`).join(", ") : "None";

  switch (state.step) {
    case "days":
      stepContent = [
        "### 📅 Select Event Day",
        "",
        "Choose which day(s) this Guild Boss Raid will occur.",
        "",
        `> **Days:** ${state.days.length ? dayLabel : "*None selected*"}`,
        "",
        state.createToday ? "*Select today's day to continue.*" : "*Select one or more days.*",
      ].join("\n");
      break;
    case "repeat":
      stepContent = [
        "### 🔄 Repeat Mode",
        "",
        "Should this raid repeat weekly or be a one-time event?",
        "",
        "> **Days:** " + dayLabel,
        "> **Repeat:** " + (state.recurring === undefined ? "*Not selected*" : state.recurring ? "Weekly" : "One-time"),
        "",
        "*Choose one-time or repeat weekly.*",
      ].join("\n");
      break;
    case "boss-order":
      stepContent = [
        "### 🐉 Boss Kill Order",
        "",
        "Arrange the bosses in the order you want them defeated.",
        "",
        "> **Current order:**",
        state.bossOrder.length
          ? "> " + state.bossOrder.map((key) => {
              const boss = GBR_BOSSES.find((b) => b.key === key);
              return boss ? `**${boss.name}**` : key;
            }).join(" \u2192 ")
          : "> *No bosses selected*",
        "",
        "*Select all 5 bosses in your desired kill order.*",
      ].join("\n");
      break;
    case "event-time":
      stepContent = [
        "### ⏰ Event Time",
        "",
        "Set the time when the Guild Boss Raid will start.",
        "",
        "> **Event time:** `" + (state.eventTime || "Not set") + "`",
        "> **Pings at:** `" + announceTime + "` *(5 min before)*",
        "",
        "*Choose default (9:00 PM) or set a custom time.*",
      ].join("\n");
      break;
    case "ping":
      stepContent = [
        "### 📢 Role Pings",
        "",
        "Choose which roles to notify when the raid is about to start.",
        "",
        "> **Ping roles:** " + (state.pingRoleIds.length ? ping : "*No roles selected*"),
        "",
        "*Select roles or choose a default option below.*",
      ].join("\n");
      break;
    case "confirm":
      stepContent = [
        "### ✅ Confirm & Create",
        "",
        "Review your Guild Boss Raid setup:",
        "",
        "> **📅 Day(s):** " + dayLabel,
        "> **🔄 Repeat:** " + (state.recurring ? "Weekly" : "One-time"),
        "> **🐉 Boss Order:** " + (bossNames || "Not set"),
        "> **⏰ Time:** `" + (state.eventTime || "Not set") + "`",
        "> **📢 Ping:** " + ping,
        "",
        state.createToday ? "*This raid will be created for today.*" : "*Click **Confirm** to create this raid.*",
      ].join("\n");
      break;
    default:
      stepContent = `### ${getStepLabel(state.step)}\n\n${wizardPrompt(state)}`;
  }

  const content = [
    "# 🐉 Guild Boss Raid Setup",
    "",
    "\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509",
    progress,
    "\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509\u2509",
    "",
    stepContent,
    siteUrl ? `\n\n🌐 **Web Dashboard:** <${siteUrl}>` : "",
  ].join("\n");

  return { content, components: [...wizardStepComponents(state), cancelRow(state.userId)] };
}

function getStepLabel(step: string): string {
  const labels: Record<string, string> = {
    "days": "Select Day",
    "repeat": "Repeat",
    "boss-order": "Boss Order",
    "event-time": "Event Time",
    "ping": "Role Pings",
    "confirm": "Confirm"
  };
  return labels[step] || step;
}

function wizardPrompt(state: EventWizardState): string {
  const prompts: Record<WizardStep, string> = {
    kind: "Step 1: choose the event type.",
    tier: "Step 2: choose event tier.",
    days: state.createToday ? "Step: choose what day today is." : "Step: choose one or more event days.",
    "boss-order": "Step: select the boss kill order.",
    title: "Step: enter the event title and description.",
    repeat: "Step: choose repeat mode.",
    "post-time": "Step: choose announcement posting time.",
    "event-time": "Step: choose when the event starts. The bot announces 5 minutes before.",
    ping: "Step: choose role ping behavior.",
    slots: state.eventKind === "nodewar" ? "Step: choose slot setup." : undefined as unknown as string,
    channel: "Step: choose where to post the roster.",
    confirm: "Final step: confirm event creation."
  };
  return prompts[state.step] ?? "";
}

function wizardStepComponents(
  state: EventWizardState
): Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder | RoleSelectMenuBuilder | ChannelSelectMenuBuilder>> {
  if (state.step === "kind") {
    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizard-kind:${state.userId}`)
          .setPlaceholder("Select event type")
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("Node War").setValue("nodewar").setDescription("Standard Node War roster event"),
            new StringSelectMenuOptionBuilder().setLabel("Guild Boss Raid (GBR)").setValue("gbr").setDescription("Guild Boss Raid with configurable boss order"),
            new StringSelectMenuOptionBuilder().setLabel("Custom Event").setValue("custom").setDescription("Custom event with free-form title and description")
          )
      )
    ];
  }

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
    const dayLabel = state.eventKind === "gbr" ? "GBR day" : state.eventKind === "custom" ? "event day" : "Node War day";
    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizard-days:${state.userId}`)
          .setPlaceholder(state.createToday ? `Select today's ${dayLabel}` : `Select ${dayLabel} or days`)
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

  if (state.step === "boss-order") {
    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizard-boss-order:${state.userId}`)
          .setPlaceholder("Select boss kill order")
          .setMinValues(GBR_BOSS_KEYS.length)
          .setMaxValues(GBR_BOSS_KEYS.length)
          .addOptions(
            GBR_BOSSES.map((boss) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(boss.name)
                .setValue(boss.key)
                .setDefault(state.bossOrder.includes(boss.key))
            )
          )
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        wizardButton(`wizard-boss-order-confirm:${state.userId}:continue`, "Continue", ButtonStyle.Success, state.bossOrder.length < GBR_BOSS_KEYS.length)
      )
    ];
  }

  // title step uses a modal, no persistent components — show a button to open it
  if (state.step === "title") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        wizardButton(`wizard-title:${state.userId}:open`, "Enter Title & Description", ButtonStyle.Primary)
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
  if (state.step === "event-time") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        wizardButton(`wizard-event-time:${state.userId}:default`, "Default 9:00 PM", ButtonStyle.Primary),
        wizardButton(`wizard-event-time:${state.userId}:custom`, "Custom event time", ButtonStyle.Secondary)
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
  const ping = state.pingRoleIds.length ? state.pingRoleIds.map((roleId) => `<@&${roleId}>`).join(", ") : "No ping";
  const channel = state.channelId ? `<#${state.channelId}>` : config.nodeWarChannelId ? `<#${config.nodeWarChannelId}>` : "Select during setup";

  const timeLine = state.eventKind === "nodewar"
    ? `Post time: ${state.postTime} ${config.timezone}`
    : `Event time: ${state.eventTime || "Not selected"} ${config.timezone}`;

  const announceLine = state.eventKind !== "nodewar" && state.eventTime
    ? `Bot announces: ${calculateAnnouncementTime(state.eventTime)} ${config.timezone} (5 min before)`
    : undefined;

  const common = [
    `${state.createToday ? "Today" : "Days"}: ${days}`,
    `Repeat: ${state.recurring === undefined ? "Not selected" : state.recurring ? "Repeat weekly" : "One-time only"}`,
    timeLine,
    announceLine,
    `Ping roles: ${ping}`,
    `Post channel: ${channel}`
  ].filter(Boolean);

  if (state.eventKind === "nodewar") {
    const tier = state.tier ? labelTier(state.tier) : "Not selected";
    const territory = state.tier ? NODE_WAR_PRESETS[state.tier].territoryGroup : "Not selected";
    const capacities = state.tier && state.days.length
      ? state.days.map((day) => `${labelWarDay(day)} ${getNodeWarCapacity(state.tier as NodeWarTier, day)}`).join(", ")
      : "Not selected";
    const slotLine = `${formatGroupBadge("defense")} ${state.slots.defense}, ${formatGroupBadge("zerker")} ${state.slots.zerker}, ${formatGroupBadge("shai")} ${state.slots.shai}, ${formatGroupName("mainball")} auto`;
    return [
      `**Type:** Node War`,
      `Tier: ${tier}`,
      `Territory: ${territory}`,
      ...common,
      `Slots: ${slotLine}`,
      `Capacity per day: ${capacities}`
    ].join("\n");
  }

  if (state.eventKind === "gbr") {
    const bossNames = state.bossOrder.map((key) => GBR_BOSSES.find((b) => b.key === key)?.name ?? key).join(" → ");
    return [
      `**Type:** Guild Boss Raid`,
      ...common,
      `Boss order: ${bossNames || "Not selected"}`
    ].join("\n");
  }

  // custom
  const title = state.customTitle || "Not entered";
  const desc = state.customDescription || "No description";
  return [
    `**Type:** Custom Event`,
    `Title: ${title}`,
    `Description: ${desc}`,
    ...common
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

function buildWizardTitleModal(userId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`wizard-title:${userId}`)
    .setTitle("Custom Event Details")
    .addComponents(
      textInputRow("title", "Event title", "Custom Event"),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Description (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder("Optional event description")
      )
    );
}

function buildWizardPostTimeModal(userId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`wizard-post-time:${userId}`)
    .setTitle("Custom Post Time")
    .addComponents(textInputRow("postTime", "Post time (HH:mm)", config.nodeWarPostTime));
}
function calculateAnnouncementTime(eventTime: string): string {
  const [h, m] = eventTime.split(':').map(Number);
  let totalMin = h * 60 + m - 5;
  if (totalMin < 0) totalMin += 24 * 60;
  const hours = Math.floor(totalMin / 60) % 24;
  const mins = totalMin % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function buildWizardEventTimeModal(userId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`wizard-event-time:${userId}`)
    .setTitle("Custom Event Time")
    .addComponents(textInputRow("eventTime", "Event time (HH:mm)", "21:00"));
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

  if (state.days.length === 0 || state.recurring === undefined) {
    throw new Error("Wizard is incomplete.");
  }
  if (!channelId) {
    throw new Error("Choose a channel before creating the event.");
  }

  const created: WarEvent[] = [];
  const next = state.createToday ? todayWarDayFromSelection(state.days, config.timezone) : nextWarDayFromSelection(state.days, config.timezone);
  const recurrence = state.createToday ? "once" : state.recurring ? "weekly" : "once";
  const announcementDate = state.createToday ? zonedNow(config.timezone).date : announcementDateForEvent(next.date);

  let event: WarEvent;

  if (state.eventKind === "nodewar") {
    if (!state.tier) {
      throw new Error("Node War tier is required.");
    }
    validateWizardSlots(state);
    const totalCapacity = getNodeWarCapacity(state.tier, next.day);
    event = buildNodeWarEvent({
      tier: state.tier,
      day: next.day,
      date: next.date,
      title: buildNodeWarTitle(next.day, state.tier, totalCapacity),
      time: state.startTime,
      recurrence,
      createdBy,
      guildId: state.guildId,
      channelId,
      announcementDate,
      announcementTime: state.postTime,
      announcementChannelId: channelId,
      announcementRoleIds: state.pingRoleIds,
      notes: `Announcement: ${state.postTime} ${config.timezone}`
    });
    event.repeatDays = !state.createToday && state.recurring ? state.days : undefined;
    event.active = true;
    event.autoRepost = !state.createToday && state.recurring;
    event.groups = buildWizardGroups(state, totalCapacity);
  } else if (state.eventKind === "gbr") {
    const announcementTime = calculateAnnouncementTime(state.eventTime);
    event = {
      id: nanoid(10),
      title: buildGBRTitle(next.day),
      kind: "gbr",
      day: next.day,
      repeatDays: !state.createToday && state.recurring ? state.days : undefined,
      date: next.date,
      time: state.eventTime,
      timezone: config.timezone,
      recurrence,
      totalCapacity: 0,
      groups: [],
      bossOrder: state.bossOrder,
      announcementDate,
      announcementTime,
      announcementChannelId: channelId,
      announcementRoleIds: state.pingRoleIds,
      guildId: state.guildId,
      channelId,
      createdBy,
      createdAt: new Date().toISOString(),
      signups: [],
      closed: false,
      active: true,
      autoRepost: !state.createToday && state.recurring
    };
  } else {
    // custom
    const announcementTime = calculateAnnouncementTime(state.eventTime);
    event = {
      id: nanoid(10),
      title: state.customTitle || "Custom Event",
      kind: "custom",
      day: next.day,
      repeatDays: !state.createToday && state.recurring ? state.days : undefined,
      date: next.date,
      time: state.eventTime,
      timezone: config.timezone,
      recurrence,
      totalCapacity: 0,
      groups: [],
      description: state.customDescription,
      announcementDate,
      announcementTime,
      announcementChannelId: channelId,
      announcementRoleIds: state.pingRoleIds,
      guildId: state.guildId,
      channelId,
      createdBy,
      createdAt: new Date().toISOString(),
      signups: [],
      closed: false,
      active: true,
      autoRepost: !state.createToday && state.recurring
    };
  }

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
  buildWizardTitleModal,
  buildWizardPostTimeModal,
  buildWizardEventTimeModal,
  buildWizardSlotsModal,
  textInputRow,
  confirmWizard,
  nextStepAfterSlots,
  buildWizardGroups,
};
