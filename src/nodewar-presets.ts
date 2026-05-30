import { getGroupLabel } from "./emojis.js";
import type { GroupConfig, NodeWarTier, WarDay } from "./types.js";

export interface NodeWarPreset {
  tier: NodeWarTier;
  label: string;
  territoryGroup: string;
  maxParticipantsByDay: Record<WarDay, number>;
}

export const WAR_DAYS: WarDay[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];

export const OPTIONAL_ROLE_PRESETS: GroupConfig[] = [
  { key: "cannon", label: getGroupLabel("cannon"), capacity: 1, editable: true },
  { key: "shai", label: getGroupLabel("shai"), capacity: 1, editable: true },
  { key: "zerker", label: getGroupLabel("zerker"), capacity: 1, editable: true },
  { key: "ranger", label: getGroupLabel("ranger"), capacity: 1, editable: true },
  { key: "wizwitch", label: getGroupLabel("wizwitch"), capacity: 1, editable: true }
];

export const NODE_WAR_PRESETS: Record<NodeWarTier, NodeWarPreset> = {
  tier1: {
    tier: "tier1",
    label: "Tier 1",
    territoryGroup: "Balenos/Serendia",
    maxParticipantsByDay: {
      sunday: 30,
      monday: 25,
      tuesday: 30,
      wednesday: 25,
      thursday: 30,
      friday: 25,
      saturday: 25
    }
  },
  tier2: {
    tier: "tier2",
    label: "Tier 2",
    territoryGroup: "Calpheon/Ulukita",
    maxParticipantsByDay: {
      sunday: 50,
      monday: 40,
      tuesday: 40,
      wednesday: 40,
      thursday: 40,
      friday: 50,
      saturday: 40
    }
  },
  tier3: {
    tier: "tier3",
    label: "Tier 3",
    territoryGroup: "Valencia/Edania",
    maxParticipantsByDay: {
      sunday: 75,
      monday: 55,
      tuesday: 55,
      wednesday: 75,
      thursday: 55,
      friday: 75,
      saturday: 55
    }
  }
};

export function getNodeWarCapacity(tier: NodeWarTier, day: WarDay): number {
  return NODE_WAR_PRESETS[tier].maxParticipantsByDay[day];
}

export function getDefaultGroups(totalCapacity: number): GroupConfig[] {
  return getT1DefaultGroups(totalCapacity);
}

export function getT1DefaultGroups(totalCapacity: number): GroupConfig[] {
  const defense = 5;
  const zerker = 2;
  const shai = 2;
  const mainball = Math.max(0, totalCapacity - defense - zerker - shai);

  return [
    { key: "mainball", label: getGroupLabel("mainball"), capacity: mainball, editable: true },
    { key: "defense", label: getGroupLabel("defense"), capacity: defense, editable: true },
    { key: "zerker", label: getGroupLabel("zerker"), capacity: zerker, editable: true },
    { key: "shai", label: getGroupLabel("shai"), capacity: shai, editable: true },
    { key: "bench", label: getGroupLabel("bench"), capacity: 0, editable: false }
  ];
}

export function getGroupsForPreset(tier: NodeWarTier, totalCapacity: number): GroupConfig[] {
  if (tier === "tier1") {
    return getT1DefaultGroups(totalCapacity);
  }

  const defense = Math.max(3, Math.round(totalCapacity * 0.16));
  const flex = Math.max(3, Math.round(totalCapacity * 0.14));
  const mainball = Math.max(0, totalCapacity - defense - flex);

  return [
    { key: "mainball", label: getGroupLabel("mainball"), capacity: mainball, editable: true },
    { key: "defense", label: getGroupLabel("defense"), capacity: defense, editable: true },
    { key: "flex", label: getGroupLabel("flex"), capacity: flex, editable: true },
    { key: "bench", label: getGroupLabel("bench"), capacity: 0, editable: false }
  ];
}

export function buildNodeWarTitle(day: WarDay, tier: NodeWarTier, totalCapacity: number): string {
  const tierLabel = tier === "tier1" ? "T1" : labelTier(tier);
  return `${labelWarDay(day)} ${tierLabel} ${NODE_WAR_PRESETS[tier].territoryGroup} ${totalCapacity} Man`;
}

export function labelTier(tier?: NodeWarTier): string {
  return tier ? NODE_WAR_PRESETS[tier].label : "Custom";
}

export function labelWarDay(day?: WarDay): string {
  if (!day) {
    return "Custom";
  }

  return `${day[0].toUpperCase()}${day.slice(1)}`;
}
