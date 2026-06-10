import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import { getGroupLabel, formatGroupName, formatGroupBadge } from '../emojis.js';
import { WEEKDAYS, type GroupKey, type NodeWarTier, type WarDay, type WarEvent } from '../types.js';
import { EventStore, activeRosterCapacity } from '../store.js';
import {
  getNodeWarCapacity,
  getGroupsForPreset,
  getResponseGroups,
  buildNodeWarTitle,
  labelWarDay,
  NODE_WAR_PRESETS,
} from '../nodewar-presets.js';
import { formatClockTime } from '../time-format.js';
import type { EditWizardState, WizardStep } from './wizard-types.js';
import { WIZARD_DAYS, WIZARD_TIMEOUT_MS } from './wizard-types.js';
import {
  editWizardStates,
  getEditWizardState,
  refreshEditWizardTimeout,
  parseEditWizardCustomId,
  parseSlotValue,
} from './wizard-state.js';
import { refreshEventMessage } from './posting.js';
import { nextWarDayFromSelection } from './utils.js';
import { nextStepAfterSlots, validateWizardSlots } from './wizard-state.js';

// ---------------------------------------------------------------------------
// Local helpers that are not yet exported from a shared module.
// ---------------------------------------------------------------------------

function wizardButton(customId: string, label: string, style: ButtonStyle, disabled = false): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
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

function parseTime(value: string): string {
  const normalized = value.trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(normalized);
  if (!match) {
    throw new Error("Time must use 24-hour HH:mm format, for example 22:15.");
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function normalizeEventIdInput(input: string): string {
  return input
    .trim()
    .replace(/^ID:\s*/i, "")
    .replace(/^`+|`+$/g, "")
    .replace(/^\(|\)$/g, "")
    .trim();
}

async function getGuildEvent(store: EventStore, guildId: string, id: string): Promise<WarEvent | undefined> {
  const event = await store.getEvent(normalizeEventIdInput(id));
  return event?.guildId === guildId ? event : undefined;
}

function groupCapacity(event: WarEvent, key: GroupKey, fallback: number): number {
  return event.groups.find((group) => group.key === key)?.capacity ?? fallback;
}

function announcementDateForEvent(eventDate: string): string {
  const date = new Date(`${eventDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Edit wizard functions — copied exactly from bot.ts.
// ---------------------------------------------------------------------------

export async function startEditWizard(interaction: ChatInputCommandInteraction, store: EventStore): Promise<void> {
  const id = interaction.options.getString("id", true);
  const { state, event } = await createEditWizardState(store, interaction.guildId ?? "", interaction.user.id, id);
  await interaction.reply({ ...renderEditWizard(state, event), ephemeral: true });
}

export async function createEditWizardState(
  store: EventStore,
  guildId: string,
  userId: string,
  id: string
): Promise<{ state: EditWizardState; event: WarEvent }> {
  const event = await getGuildEvent(store, guildId, id);
  if (!event) {
    throw new Error("Event not found.");
  }

  const state: EditWizardState = {
    userId,
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
  editWizardStates.set(userId, state);
  return { state, event };
}

export async function handleEditWizardSelect(interaction: StringSelectMenuInteraction): Promise<void> {
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

export async function handleEditWizardModal(interaction: ModalSubmitInteraction): Promise<void> {
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

export async function handleEditWizardButton(
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
    const next = nextWarDayFromSelection(state.days, config.timezone);
    const day = next.day;
    const nextDate = next.date;
    const totalCapacity = event.tier ? getNodeWarCapacity(event.tier, day) : event.totalCapacity;
    const specialistSlots = state.defense + state.zerker + state.shai;
    const mainball = totalCapacity !== event.totalCapacity && state.mainball + specialistSlots === event.totalCapacity
      ? totalCapacity - specialistSlots
      : state.mainball;
    const totalSlots = mainball + specialistSlots;
    if (totalSlots > totalCapacity) {
      throw new Error(`Group slots (${totalSlots}) exceed total roster size (${totalCapacity}).`);
    }

    const nextAnnouncementDate = announcementDateForEvent(nextDate);
    const announcementScheduleChanged =
      nextAnnouncementDate !== event.announcementDate || state.announcementTime !== event.announcementTime;
    const updated = await store.updateEventDetails(state.eventId, {
      title: event.tier ? buildNodeWarTitle(day, event.tier, totalCapacity) : event.title,
      day,
      repeatDays: state.recurrence === "weekly" ? state.days : undefined,
      recurrence: state.recurrence,
      autoRepost: state.recurrence === "weekly",
      date: nextDate,
      totalCapacity,
      announcementDate: nextAnnouncementDate,
      announcementTime: state.announcementTime,
      announcedAt: announcementScheduleChanged ? undefined : event.announcedAt,
      ...(nextDate !== event.date ? { signups: [] } : {}),
      groups: [
        { key: "mainball", label: getGroupLabel("mainball"), capacity: mainball, editable: true },
        { key: "defense", label: getGroupLabel("defense"), capacity: state.defense, editable: true },
        { key: "zerker", label: getGroupLabel("zerker"), capacity: state.zerker, editable: true },
        { key: "shai", label: getGroupLabel("shai"), capacity: state.shai, editable: true },
        { key: "bench", label: getGroupLabel("bench"), capacity: 0, editable: false }
      ]
    });

    await refreshEventMessage(client, updated);
    editWizardStates.delete(state.userId);
    await interaction.update({ content: `Updated ${updated.title}.`, components: [] });
  }
}

export function renderEditWizard(
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

export function buildEditWizardValuesModal(state: EditWizardState): ModalBuilder {
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

export function buildEditWizardPostTimeModal(state: EditWizardState): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`editwizard-post-time:${state.userId}`)
    .setTitle("Edit Announcement Time")
    .addComponents(textInputRow("postTime", "Post time (HH:mm)", state.announcementTime));
}

export function editWizardPrompt(step: EditWizardState["step"]): string {
  return {
    menu: "Choose what to edit.",
    days: "What day or days should this event use?",
    "post-time": "What time should the signup announcement post?",
    slots: "Adjust Mainball/FFA, Defense, Zerker, and Shai slots.",
    recurrence: "Should this event repeat weekly or run once?"
  }[step];
}

export function editWizardBackRow(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    wizardButton(`editwizard-back:${userId}`, "Back", ButtonStyle.Secondary),
    wizardButton(`editwizard-cancel:${userId}`, "Cancel", ButtonStyle.Danger)
  );
}
