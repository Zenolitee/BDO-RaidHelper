import { config } from "../config.js";

export type BdoRegion = "EU" | "KR" | "NA" | "SA" | "ASIA";
export type BdoAdventurerSearchType = "familyName" | "characterName";

export interface BdoHistoryActivity {
  fish: number;
  loot: number;
  lootWeight: number;
  mobs: number;
}

export interface BdoAdventurerSearchResult {
  familyName: string;
  profileTarget: string;
  region: BdoRegion;
  guild?: { name: string } | null;
  privacy?: number | null;
}

export interface BdoAdventurerProfile extends BdoAdventurerSearchResult {
  contributionPoints?: number | null;
  createdOn: string;
  characters: Array<{ name: string; class: string; main?: boolean | null; level?: number | null }>;
  lifeFame?: number | null;
  combatFame?: number | null;
  energy?: number | null;
  gs?: number | null;
  history?: BdoHistoryActivity | null;
}

export interface BdoGuildSearchResult {
  name: string;
  region: BdoRegion;
  createdOn?: string;
  master?: { familyName: string; profileTarget: string } | null;
  population?: number;
}

export interface BdoGuildProfile extends BdoGuildSearchResult {
  members: Array<{ familyName: string; profileTarget: string }>;
  occupying?: string | null;
}

export const bdoCommunityApi = {
  name: "BDO REST API",
  docsUrl: "https://man90es.github.io/BDO-REST-API/",
  repositoryUrl: "https://github.com/man90es/BDO-REST-API",
  defaultBaseUrl: "https://api.cutepap.us/community/v1",
  regions: ["EU", "KR", "NA", "SA"] as const,
};

function endpoint(path: string, params: Record<string, string | undefined>): string {
  const url = new URL(`${config.bdoCommunityApiBaseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`BDO REST API request failed with ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function searchBdoAdventurers(query: string, region: BdoRegion = "NA", searchType: BdoAdventurerSearchType = "familyName") {
  return readJson<BdoAdventurerSearchResult[]>(endpoint("/adventurer/search", { query, region, searchType }));
}

export function getBdoAdventurer(profileTarget: string, region: BdoRegion = "NA") {
  return readJson<BdoAdventurerProfile>(endpoint("/adventurer", { profileTarget, region }));
}

export function searchBdoGuilds(query: string, region: BdoRegion = "NA") {
  return readJson<BdoGuildSearchResult[]>(endpoint("/guild/search", { query, region }));
}

export function getBdoGuild(guildName: string, region: BdoRegion = "NA") {
  return readJson<BdoGuildProfile>(endpoint("/guild", { guildName, region }));
}
