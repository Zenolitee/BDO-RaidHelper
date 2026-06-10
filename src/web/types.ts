import type { WarEvent, BotSettings, WarDay } from '../types.js';
import type { ScoreStore } from '../score-store.js';

export interface UserProfile {
  id: string;
  username: string;
  global_name?: string;
  avatar?: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  permissions: string;
  icon?: string | null;
}

export interface DiscordGuildChannel {
  id: string;
  name: string;
  position?: number;
  type: number;
}

export interface DiscordGuildRole {
  id: string;
  name: string;
  managed: boolean;
  position: number;
}

export interface GuildDeliveryOptions {
  channels: DiscordGuildChannel[];
  roles: DiscordGuildRole[];
}

export interface UpcomingAnnouncement {
  date: string;
  announcementDate: string;
  announcementTime: string;
  day: WarDay;
  title: string;
  totalCapacity: number;
}

export interface PlayerScoreAggregate {
  familyName: string;
  participations: number;
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  damageTaken: number;
  crowdControls: number;
  hpHealed: number;
  allySupport: number;
  structureDamage: number;
  resurrections: number;
}

export interface PlayerImpactScore {
  player: PlayerScoreAggregate;
  score: number;
  killsScore: number;
  assistsScore: number;
  damageScore: number;
  structureScore: number;
  objectiveScore: number;
  survivalScore: number;
}

export type ScoreSortKey = "wars" | "kills" | "damage";

export interface WebAppOptions {
  onEventUpdated?: (event: WarEvent) => Promise<void>;
  scoreStore?: ScoreStore;
}

export interface WebSession {
  user: UserProfile;
  guilds: DiscordGuild[];
  csrfToken: string;
  expiresAt: number;
}

export interface GuildDashboardSummary {
  guild: DiscordGuild;
  activeRaids: number;
  upcomingRaids: number;
  totalSignups: number;
  weeklyRaids: number;
  nextAnnouncement: string;
  nextAnnouncementTime?: number;
  nextWarStart: string;
  nextWarStartTime?: number;
  featuredRaid?: WarEvent;
  botInstalled: boolean;
  channelConfigured: boolean;
  roleConfigured: boolean;
  schedulerActive: boolean;
  setupWarnings: string[];
  events: WarEvent[];
}
