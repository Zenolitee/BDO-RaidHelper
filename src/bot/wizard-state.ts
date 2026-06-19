import { type EventWizardState, type EditWizardState, type WizardStep, WIZARD_TIMEOUT_MS } from './wizard-types.js';
import type { WarDay, WizardStateData } from '../types.js';
import { config } from '../config.js';
import { formatGroupBadge } from '../emojis.js';
import { getNodeWarCapacity, labelWarDay } from '../nodewar-presets.js';
import type { EventStore } from '../store.js';

// Edit wizard states remain in-memory (short-lived, per-session)
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

/**
 * Retrieves a wizard state from the persistent store.
 * Falls back to in-memory cache for performance, but always validates against store.
 */
async function getWizardStateFromStore(store: EventStore, userId: string, actorId: string): Promise<EventWizardState> {
  if (userId !== actorId) {
    throw new Error("Only the user who started this wizard can use it.");
  }

  console.log(`[Wizard] Looking up state for user ${userId}`);
  const stored = await store.getWizardState(userId);
  if (!stored) {
    console.log(`[Wizard] No state found for user ${userId} - expired or missing`);
    throw new Error("This setup wizard expired. Run /event create again.");
  }
  console.log(`[Wizard] Found state for user ${userId}, step=${stored.step}`);

  // Convert stored data back to full EventWizardState
  return {
    userId: stored.userId,
    guildId: stored.guildId,
    step: stored.step as WizardStep,
    expiresAt: stored.expiresAt,
    eventKind: stored.eventKind as any,
    createToday: stored.createToday,
    tier: stored.tier as any,
    days: stored.days as WarDay[],
    recurring: stored.recurring,
    startTime: stored.startTime,
    eventTime: stored.eventTime,
    postTime: stored.postTime,
    pingRoleIds: stored.pingRoleIds,
    channelId: stored.channelId,
    slots: stored.slots,
    bossOrder: stored.bossOrder,
    customTitle: stored.customTitle,
    customDescription: stored.customDescription
  };
}

async function refreshWizardTimeout(store: EventStore, state: EventWizardState): Promise<void> {
  state.expiresAt = Date.now() + WIZARD_TIMEOUT_MS;
  await saveWizardState(store, state);
}

/** Converts an EventWizardState to storable data. */
function toWizardStateData(state: EventWizardState): WizardStateData {
  return {
    userId: state.userId,
    guildId: state.guildId,
    step: state.step,
    expiresAt: state.expiresAt,
    eventKind: state.eventKind,
    createToday: state.createToday,
    tier: state.tier,
    days: state.days,
    recurring: state.recurring,
    startTime: state.startTime,
    eventTime: state.eventTime,
    postTime: state.postTime,
    pingRoleIds: state.pingRoleIds,
    channelId: state.channelId,
    slots: state.slots,
    bossOrder: state.bossOrder,
    customTitle: state.customTitle,
    customDescription: state.customDescription
  };
}

/** Persists wizard state to store. */
async function saveWizardState(store: EventStore, state: EventWizardState): Promise<void> {
  console.log(`[Wizard] Saving state for user ${state.userId}, step=${state.step}`);
  await store.setWizardState(state.userId, toWizardStateData(state));
  console.log(`[Wizard] State saved successfully for user ${state.userId}`);
}

/** Deletes wizard state from store. */
async function deleteWizardStateFromStore(store: EventStore, userId: string): Promise<void> {
  await store.deleteWizardState(userId);
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
  editWizardStates,
  parseEditWizardCustomId,
  getEditWizardState,
  refreshEditWizardTimeout,
  parseWizardCustomId,
  getWizardStateFromStore,
  refreshWizardTimeout,
  saveWizardState,
  deleteWizardStateFromStore,
  parseSlotValue,
  validateWizardSlots,
  nextStepAfterSlots,
};
