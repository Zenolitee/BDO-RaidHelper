import {
  WEEKDAYS,
  type NodeWarTier,
  type WarDay,
  type WarEvent,
} from '../types.js';
import { GBR_BOSSES, DEFAULT_BOSS_ORDER } from '../gbr.js';

export type EventKind = 'nodewar' | 'gbr' | 'custom';
export type WizardStep = 'kind' | 'tier' | 'days' | 'boss-order' | 'title' | 'repeat' | 'post-time' | 'ping' | 'slots' | 'channel' | 'confirm';

export interface EventWizardState {
  userId: string;
  guildId: string;
  step: WizardStep;
  expiresAt: number;
  eventKind: EventKind;
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
  /** GBR boss order (array of boss keys) */
  bossOrder: string[];
  /** Custom event title */
  customTitle: string;
  /** Custom event description */
  customDescription: string;
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
export const GBR_BOSS_KEYS = GBR_BOSSES.map((b) => b.key);
export const DEFAULT_GBR_ORDER = [...DEFAULT_BOSS_ORDER];