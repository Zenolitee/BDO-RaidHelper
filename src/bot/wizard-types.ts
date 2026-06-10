import {
  WEEKDAYS,
  type NodeWarTier,
  type WarDay,
  type WarEvent,
} from '../types.js';

export type WizardStep = 'tier' | 'days' | 'repeat' | 'post-time' | 'ping' | 'slots' | 'channel' | 'confirm';

export interface EventWizardState {
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

export interface EditWizardState {
  userId: string;
  guildId: string;
  eventId: string;
  expiresAt: number;
  step: 'menu' | 'days' | 'post-time' | 'slots' | 'recurrence';
  days: WarDay[];
  announcementTime: string;
  recurrence: WarEvent['recurrence'];
  mainball: number;
  defense: number;
  zerker: number;
  shai: number;
}

export const WIZARD_DAYS: WarDay[] = [...WEEKDAYS];
export const WIZARD_TIMEOUT_MS = 10 * 60_000;
