export interface GbrBoss {
  key: string;
  name: string;
  image: string;
  initial: string;
}

export const GBR_BOSSES: GbrBoss[] = [
  { key: "khan", name: "Khan", image: "/assets/gbr/khan.jpg", initial: "K" },
  { key: "ferrid", name: "Ferrid", image: "/assets/gbr/ferrid.png", initial: "F" },
  { key: "mudster", name: "Mudster", image: "/assets/gbr/mudster.png", initial: "MU" },
  { key: "moghulis", name: "Moghulis", image: "/assets/gbr/moghulis.jpg", initial: "MO" },
  { key: "org", name: "Org", image: "/assets/gbr/org.jpg", initial: "O" },
];

export const DEFAULT_BOSS_ORDER: string[] = ["org", "mudster", "ferrid", "moghulis", "khan"];

export const GBR_BOSS_MAP = new Map(GBR_BOSSES.map((b) => [b.key, b]));

export function formatBossOrderInitials(order: string[]): string {
  return order.map((key) => GBR_BOSS_MAP.get(key)?.initial ?? key).join(" → ");
}

export function formatBossOrderNames(order: string[]): string {
  return order.map((key) => GBR_BOSS_MAP.get(key)?.name ?? key).join(" → ");
}

export function buildGBRTitle(day: string): string {
  const label = day.charAt(0).toUpperCase() + day.slice(1);
  return `Guild Boss Raid - ${label}`;
}
