import { type EventWizardState, type EditWizardState, type WizardStep, WIZARD_TIMEOUT_MS } from './wizard-types.js';
import type { WarDay } from '../types.js';
import { config } from '../config.js';
import { formatGroupBadge } from '../emojis.js';
import { getNodeWarCapacity, labelWarDay } from '../nodewar-presets.js';

const wizardStates = new Map<string, EventWizardState>();

const editWizardStates = new Map<string, EditWizardState>();

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

function nextStepAfterSlots(state: EventWizardState): WizardStep {
  return state.channelId || config.nodeWarChannelId ? "confirm" : "channel";
}
export {
  wizardStates,
  editWizardStates,
  parseEditWizardCustomId,
  getEditWizardState,
  refreshEditWizardTimeout,
  parseWizardCustomId,
  getWizardState,
  refreshWizardTimeout,
  parseSlotValue,
  validateWizardSlots,
  nextStepAfterSlots,
};
