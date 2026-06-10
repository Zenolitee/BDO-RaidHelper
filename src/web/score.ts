import { config } from '../config.js';
import type { ScoreRow } from '../score-types.js';
import type { PlayerScoreAggregate, PlayerImpactScore, ScoreSortKey } from './types.js';

interface ScoreGeminiQuotaResult {
  allowed: boolean;
  reason?: string;
}

interface ScoreGeminiQuota {
  userMinute: Map<string, { windowStart: number; count: number }>;
  guildDay: Map<string, { day: string; count: number }>;
}

function createScoreGeminiQuota(): ScoreGeminiQuota {
  return {
    userMinute: new Map(),
    guildDay: new Map()
  };
}

const scoreGeminiQuota = createScoreGeminiQuota();

function consumeScoreGeminiQuota(userId: string, guildId: string): ScoreGeminiQuotaResult {
  if (!config.geminiApiKey) return { allowed: false, reason: "Gemini API key not configured; used Tesseract fallback." };

  const userLimit = Math.max(0, config.geminiUserMinuteLimit);
  const guildLimit = Math.max(0, config.geminiGuildDayLimit);
  if (userLimit === 0 || guildLimit === 0) return { allowed: false, reason: "Gemini quota disabled; used Tesseract fallback." };

  const now = Date.now();
  const userBucket = scoreGeminiQuota.userMinute.get(userId);
  if (userBucket && now - userBucket.windowStart < 60_000 && userBucket.count >= userLimit) {
    return { allowed: false, reason: `Gemini user minute limit reached (${userLimit}/minute); used Tesseract fallback.` };
  }

  const today = getPacificDateKey(new Date(now));
  const guildBucket = scoreGeminiQuota.guildDay.get(guildId);
  if (guildBucket?.day === today && guildBucket.count >= guildLimit) {
    return { allowed: false, reason: `Gemini server daily limit reached (${guildLimit}/day); used Tesseract fallback.` };
  }

  if (!userBucket || now - userBucket.windowStart >= 60_000) {
    scoreGeminiQuota.userMinute.set(userId, { windowStart: now, count: 1 });
  } else {
    userBucket.count += 1;
  }

  if (!guildBucket || guildBucket.day !== today) {
    scoreGeminiQuota.guildDay.set(guildId, { day: today, count: 1 });
  } else {
    guildBucket.count += 1;
  }

  return { allowed: true };
}

function getPacificDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function aggregateScoreRows(rows: ScoreRow[]): PlayerScoreAggregate[] {
  const byPlayer = new Map<string, PlayerScoreAggregate>();
  for (const row of rows) {
    const key = row.familyName.toLowerCase();
    const player =
      byPlayer.get(key) ??
      {
        familyName: row.familyName,
        participations: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        damageDealt: 0,
        damageTaken: 0,
        crowdControls: 0,
        hpHealed: 0,
        allySupport: 0,
        structureDamage: 0,
        resurrections: 0
      };
    player.participations += 1;
    player.kills += row.kills;
    player.deaths += row.deaths;
    player.assists += row.assists;
    player.damageDealt += row.damageDealt;
    player.damageTaken += row.damageTaken;
    player.crowdControls += row.crowdControls;
    player.hpHealed += row.hpHealed;
    player.allySupport += row.allySupport;
    player.structureDamage += row.structureDamage;
    player.resurrections += row.resurrections;
    byPlayer.set(key, player);
  }

  return [...byPlayer.values()].sort(
    (left, right) =>
      right.participations - left.participations ||
      right.damageDealt - left.damageDealt ||
      right.kills - left.kills ||
      left.familyName.localeCompare(right.familyName)
  );
}

function calculateImpactScores(players: PlayerScoreAggregate[]): PlayerImpactScore[] {
  const maxKills = Math.max(1, ...players.map((player) => player.kills));
  const maxAssists = Math.max(1, ...players.map((player) => player.assists));
  const maxDamage = Math.max(1, ...players.map((player) => player.damageDealt));
  const maxStructure = Math.max(1, ...players.map((player) => player.structureDamage));
  const objectiveRaw = (player: PlayerScoreAggregate): number =>
    player.crowdControls + player.resurrections * 5 + Math.round((player.hpHealed + player.allySupport) / 100_000);
  const maxObjective = Math.max(1, ...players.map(objectiveRaw));
  const normalized = (value: number, maxValue: number): number => Math.min(100, (value / maxValue) * 100);

  return players
    .map((player) => {
      const killsScore = normalized(player.kills, maxKills);
      const assistsScore = normalized(player.assists, maxAssists);
      const damageScore = normalized(player.damageDealt, maxDamage);
      const structureScore = normalized(player.structureDamage, maxStructure);
      const rawObjective = objectiveRaw(player);
      const objectiveScore = normalized(rawObjective, maxObjective);
      const deathsPerWar = player.participations ? player.deaths / player.participations : player.deaths;
      const survivalScore = Math.max(0, Math.min(100, 100 - deathsPerWar * 12));
      const score = killsScore * 0.2 + assistsScore * 0.1 + damageScore * 0.2 + structureScore * 0.3 + objectiveScore * 0.1 + survivalScore * 0.1;

      return {
        player,
        score,
        killsScore,
        assistsScore,
        damageScore,
        structureScore,
        objectiveScore,
        survivalScore
      };
    })
    .sort((left, right) => right.score - left.score || right.player.structureDamage - left.player.structureDamage || right.player.damageDealt - left.player.damageDealt || left.player.familyName.localeCompare(right.player.familyName));
}

function sortScoreAggregates(players: PlayerScoreAggregate[], sortKey: ScoreSortKey): PlayerScoreAggregate[] {
  return [...players].sort((left, right) => {
    if (sortKey === "kills") return right.kills - left.kills || right.damageDealt - left.damageDealt || left.familyName.localeCompare(right.familyName);
    if (sortKey === "damage") return right.damageDealt - left.damageDealt || right.kills - left.kills || left.familyName.localeCompare(right.familyName);
    return right.participations - left.participations || right.damageDealt - left.damageDealt || right.kills - left.kills || left.familyName.localeCompare(right.familyName);
  });
}

function parseScoreSortKey(value: unknown): ScoreSortKey {
  return value === "kills" || value === "damage" ? value : "wars";
}

export {
  type ScoreGeminiQuotaResult,
  type ScoreGeminiQuota,
  createScoreGeminiQuota,
  consumeScoreGeminiQuota,
  getPacificDateKey,
  aggregateScoreRows,
  calculateImpactScores,
  sortScoreAggregates,
  parseScoreSortKey
};
