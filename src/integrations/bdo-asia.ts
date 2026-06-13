/**
 * Scraper for the official Pearl Abyss Asia (TH/SEA) website.
 * The PA Asia site doesn't expose a public JSON API — data is server-rendered HTML.
 * This module fetches the HTML and parses out the relevant data.
 */

import type { BdoGuildProfile, BdoGuildSearchResult } from "./bdo-community.js";

const BASE_URL = "https://blackdesert.pearlabyss.com/ASIA/en-us";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

/* ── Types ──────────────────────────────────────────────────── */

export interface AsiaPlayerSearchResult {
  familyName: string;
  profileTarget: string;
  guildName: string | null;
  mainCharacter: string | null;
}

export interface AsiaPlayerProfile {
  familyName: string;
  guildName: string | null;
  createdOn: string | null;
  characters: Array<{ name: string; class: string; level: number | null; main?: boolean }>;
  gearScore: number | null;
  energy: number | null;
  contribution: number | null;
}

export interface AsiaGuildProfile {
  name: string;
  createdOn: string | null;
  master: { familyName: string; profileTarget: string } | null;
  memberCount: number;
  occupying: string | null;
  members: Array<{ familyName: string; profileTarget: string }>;
}

/* ── Helpers ────────────────────────────────────────────────── */

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x2B;/g, "+")
    .trim();
}

function extractProfileTarget(href: string): string {
  const match = href.match(/_target=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/* ── Scrapers ───────────────────────────────────────────────── */

/**
 * Fetches the PA Asia player search page and parses results.
 * Searches by family name (type=2) or character name (type=1).
 */
export async function searchAsiaPlayers(keyword: string, type: "familyName" | "characterName" = "familyName"): Promise<AsiaPlayerSearchResult[]> {
  const searchType = type === "familyName" ? "2" : "1";
  const url = `${BASE_URL}/Game/Profile/Search?_keyword=${encodeURIComponent(keyword)}&_type=${searchType}`;

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`PA Asia player search failed: ${response.status}`);

  const html = await response.text();
  return parsePlayerSearchResults(html);
}

function parsePlayerSearchResults(html: string): AsiaPlayerSearchResult[] {
  const results: AsiaPlayerSearchResult[] = [];

  // Split by <li> tags inside the box_list_area
  const listArea = html.match(/box_list_area[\s\S]*?<\/ul>/);
  if (!listArea) return results;

  const listHtml = listArea[0];
  const items = listHtml.split(/<li>/g).slice(1); // Skip the first split (before first <li>)

  for (const item of items) {
    // Extract family name from <div class="title"><a href="...">Name</a></div>
    const titleMatch = item.match(/<div class="title">\s*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/);
    if (!titleMatch) continue;

    const href = titleMatch[1];
    const familyName = decodeHtmlEntities(titleMatch[2]);
    const profileTarget = extractProfileTarget(href);

    // Extract main character from <div class="user_info"><span>...</span></div>
    const userMatch = item.match(/<div class="user_info">\s*<span>([^<]*)<\/span>/);
    const mainCharacter = userMatch ? decodeHtmlEntities(userMatch[1]) : null;

    // Extract guild from <div class="state"><a href="...">GuildName</a></div>
    const guildMatch = item.match(/<div class="state">\s*(?:<a[^>]*>([^<]+)<\/a>|([^<]*))/);
    const guildName = guildMatch ? decodeHtmlEntities(guildMatch[1] || guildMatch[2] || "") : null;

    if (familyName) {
      results.push({
        familyName,
        profileTarget,
        guildName: guildName || null,
        mainCharacter: mainCharacter || null,
      });
    }
  }

  return results;
}

/**
 * Fetches the PA Asia player profile page and parses character and profile data.
 */
export async function getAsiaPlayerProfile(profileTarget: string): Promise<AsiaPlayerProfile | null> {
  const url = `${BASE_URL}/Game/Profile/Adventure?_target=${encodeURIComponent(profileTarget)}`;

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;

  const html = await response.text();
  return parsePlayerProfile(html);
}

function parsePlayerProfile(html: string): AsiaPlayerProfile | null {
  // Extract family name — appears in <p class="nick">FamilyName</p>
  const familyMatch = html.match(/<p\s+class="nick">\s*([^<]+)/i)
    || html.match(/<h2[^>]*class="[^"]*family[^"]*"[^>]*>([^<]+)/i)
    || html.match(/<span[^>]*class="[^"]*family_name[^"]*"[^>]*>([^<]+)/i);
  const familyName = familyMatch ? decodeHtmlEntities(familyMatch[1]).trim() : null;
  if (!familyName) return null;

  // Extract creation date — <span class="title">Created On</span> <span class="desc">Sep 5, 2019...</span>
  const createdMatch = html.match(/Created On<\/span>\s*<span class="desc">\s*([^<]+)/i);
  const createdOn = createdMatch ? decodeHtmlEntities(createdMatch[1]).trim() : null;

  // Extract guild — <span class="title">Joined Guild</span> <span class="desc guild">...<a>GuildName</a>...</span>
  const guildMatch = html.match(/Joined Guild<\/span>\s*<span class="desc guild">\s*(?:<a[^>]*>)?([^<]+)/i);
  const guildName = guildMatch ? decodeHtmlEntities(guildMatch[1]).trim() : null;

  // Extract stats from profile_detail section
  const detailSection = html.match(/profile_detail[\s\S]*?(?=footer|<\/main)/i)?.[0] ?? html;

  // Max Gear Score — the value appears a few lines after the label, separated by HTML tags
  let gearScore: number | null = null;
  const gsArea = detailSection.match(/Max Gear Score[\s\S]{0,500}/i);
  if (gsArea) {
    const gsNum = gsArea[0].replace(/<[^>]*>/g, '').match(/(\d{2,})/);
    if (gsNum) gearScore = parseInt(gsNum[1], 10) || null;
  }

  // Energy — "Energy" followed by a number
  let energy: number | null = null;
  const energyArea = detailSection.match(/Energy[\s\S]{0,300}/i);
  if (energyArea) {
    const eNum = energyArea[0].replace(/<[^>]*>/g, '').match(/(\d{1,4})/);
    if (eNum) energy = parseInt(eNum[1], 10) || null;
  }

  // Contribution Points — "Contribution Points" followed by a number
  let contribution: number | null = null;
  const contribArea = detailSection.match(/Contribution Points[\s\S]{0,300}/i);
  if (contribArea) {
    const cNum = contribArea[0].replace(/<[^>]*>/g, '').match(/(\d{1,4})/);
    if (cNum) contribution = parseInt(cNum[1], 10) || null;
  }

  // Extract characters from profile_list section
  const characters = parseCharacterList(html);

  return { familyName, guildName, createdOn, characters, gearScore, energy, contribution };
}

function parseCharacterList(html: string): Array<{ name: string; class: string; level: number | null; main?: boolean }> {
  const characters: Array<{ name: string; class: string; level: number | null; main?: boolean }> = [];

  // Extract from profile_list section
  const listSection = html.match(/profile_list[\s\S]*?<\/ul>/i);
  if (!listSection) return characters;

  const listHtml = listSection[0];

  // Split by <li> tags to get individual character entries
  const items = listHtml.split(/<li/g).slice(1);

  for (const item of items) {
    // Character name: <p class="character_name">Name</p>
    const nameMatch = item.match(/class="character_name">\s*([^<]+)/i);
    if (!nameMatch) continue;
    const name = decodeHtmlEntities(nameMatch[1]).trim();

    // Check for "Main Character" label
    const isMain = /main\s*character/i.test(item);

    // Extract class from the cleaned text — look for known BDO class names
    const cleanText = item.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const bdoClasses = /(?:Shai|Sorceress|Witch|Berserker|Musa|Maehwa|Warrior|Ranger|Valkyrie|Wizard|Kunoichi|Ninja|Dark\s*Knight|Striker|Mystic|Lahn|Archer|Guardian|Hashashin|Nova|Sage|Corsair|Drakania|Woosa|Maegu|Scholar|Dusa|Deadeye|Wukong|Seraph|Tamer)/i;
    const classMatch = cleanText.match(bdoClasses);
    const cls = classMatch ? classMatch[0] : "Unknown";

    // Level
    const levelMatch = cleanText.match(/Lv\.\s*(\d+)/i);
    const level = levelMatch ? parseInt(levelMatch[1], 10) : null;

    characters.push({ name, class: cls, level: level || null, main: isMain || undefined });
  }

  return characters;
}

/**
 * Fetches the PA Asia guild search page and parses results.
 */
export async function searchAsiaGuilds(guildName: string): Promise<BdoGuildSearchResult[]> {
  const url = `${BASE_URL}/Game/Guild?_searchText=${encodeURIComponent(guildName)}`;

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`PA Asia guild search failed: ${response.status}`);

  const html = await response.text();
  return parseGuildSearchResults(html);
}

function parseGuildSearchResults(html: string): BdoGuildSearchResult[] {
  const results: BdoGuildSearchResult[] = [];

  // Each guild result: <li> with guild_title containing <a href="...?_guildName=...">Name</a>
  //   guild_info containing <a href="...">MasterName</a>
  //   date containing creation date
  //   member containing count
  const itemRegex = /<li>\s*<div class="guild_title">\s*(?:<span[^>]*>[^<]*<\/span>\s*)?<span class="text">\s*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>\s*<\/span>\s*<\/div>\s*<div class="guild_info">\s*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>\s*<\/div>\s*<div class="date[^"]*">([^<]*)<\/div>\s*<div class="member">(\d+)<\/div>/gs;

  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const name = decodeHtmlEntities(match[2]);
    const masterHref = match[3];
    const masterName = decodeHtmlEntities(match[4]);
    const createdOn = decodeHtmlEntities(match[5]);
    const memberCount = parseInt(match[6], 10) || 0;

    results.push({
      name,
      region: "EU" as const, // Placeholder — Asia uses a different model
      createdOn: createdOn || undefined,
      master: masterName ? { familyName: masterName, profileTarget: extractProfileTarget(masterHref) } : undefined,
      population: memberCount,
    });
  }

  return results;
}

/**
 * Fetches the PA Asia guild profile page and parses the full profile.
 * Returns null if the guild is not found.
 */
export async function getAsiaGuildProfile(guildName: string): Promise<AsiaGuildProfile | null> {
  const url = `${BASE_URL}/Game/Guild/Profile?_regionType=1&_guildName=${encodeURIComponent(guildName)}&_gameRegion=ASIA`;

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`PA Asia guild profile failed: ${response.status}`);

  const html = await response.text();
  return parseGuildProfile(html, guildName);
}

function parseGuildProfile(html: string, guildName: string): AsiaGuildProfile | null {
  // Check for "no result"
  if (html.includes("no_result")) return null;

  // Extract creation date
  const createdMatch = html.match(/Created On<\/span>\s*<span class="desc">\s*<span>([^<]+)<\/span>/);
  const createdOn = createdMatch ? decodeHtmlEntities(createdMatch[1]) : null;

  // Extract guild master
  const masterMatch = html.match(/Guild Master<\/span>\s*<span class="desc">\s*<span class="character_desc">[^]*?<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/);
  const masterName = masterMatch ? decodeHtmlEntities(masterMatch[2]) : null;
  const masterTarget = masterMatch ? extractProfileTarget(masterMatch[1]) : "";

  // Extract member count
  const memberMatch = html.match(/Members<\/span>\s*<span class="desc">\s*<span>\s*<em>(\d+)<\/em>/);
  const memberCount = memberMatch ? parseInt(memberMatch[1], 10) : 0;

  // Extract occupying
  const occupyingMatch = html.match(/Occupying<\/span>\s*<span class="desc">\s*\n?([^<\n]+)/);
  const occupying = occupyingMatch ? decodeHtmlEntities(occupyingMatch[1]) : null;

  // Check for "Private" marker on member list
  const isPrivate = html.includes("Private");

  return {
    name: guildName,
    createdOn,
    master: masterName ? { familyName: masterName, profileTarget: masterTarget } : null,
    memberCount,
    occupying: occupying && occupying !== "None" ? occupying : null,
    // Member list is private on PA Asia — only count is available
    members: [],
  };
}

/**
 * Adapter that returns data in the same shape as BdoGuildProfile from bdo-community.ts,
 * so it can be used interchangeably in the web UI.
 */
export async function getAsiaGuild(guildName: string): Promise<BdoGuildProfile | null> {
  const profile = await getAsiaGuildProfile(guildName);
  if (!profile) return null;

  return {
    name: profile.name,
    region: "ASIA",
    createdOn: profile.createdOn ?? undefined,
    master: profile.master,
    population: profile.memberCount,
    members: profile.members,
    occupying: profile.occupying,
  };
}
