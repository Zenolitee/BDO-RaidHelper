export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday"
] as const;

export type GroupKey = string;

export type Recurrence = "once" | "daily" | "every_other_day" | "weekly";

export type NodeWarTier = "tier1" | "tier2" | "tier3";

export type WarDay = (typeof WEEKDAYS)[number];

export interface GroupConfig {
  key: GroupKey;
  label: string;
  capacity: number;
  editable?: boolean;
  emoji?: string;
}

export interface Signup {
  userId: string;
  displayName: string;
  group: GroupKey;
  requestedGroup?: GroupKey;
  createdAt: string;
  updatedAt: string;
}

export interface WarEvent {
  id: string;
  title: string;
  kind: "nodewar" | "siege";
  tier?: NodeWarTier;
  day?: WarDay;
  repeatDays?: WarDay[];
  date: string;
  time: string;
  timezone: string;
  recurrence: Recurrence;
  totalCapacity: number;
  groups: GroupConfig[];
  notes?: string;
  announcementDate?: string;
  announcementTime?: string;
  announcementChannelId?: string;
  announcementRoleId?: string;
  announcementRoleIds?: string[];
  announcedAt?: string;
  guildId?: string;
  channelId?: string;
  messageId?: string;
  createdBy: string;
  createdAt: string;
  signups: Signup[];
  closed: boolean;
  active?: boolean;
  autoRepost?: boolean;
}

export interface EventStoreData {
  events: WarEvent[];
  settings?: BotSettings;
}

export interface BotSettings {
  nodeWarChannelId?: string;
  nodeWarChannelIds?: Record<string, string>;
}
