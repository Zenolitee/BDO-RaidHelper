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
      const score = killsScore * 0.10 + assistsScore * 0.05 + damageScore * 0.25 + structureScore * 0.35 + objectiveScore * 0.20 + survivalScore * 0.05;

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
/* ── Score Validation ─────────────────────────────────────────── */

interface ScoreValidationWarning {
  player: string;
  field: string;
  message: string;
}

/**
 * Validate extracted score rows for common OCR/extraction errors.
 * Returns warnings, not errors — rows are still saved but flagged.
 */
function validateScoreRows(rows: ScoreRow[]): ScoreValidationWarning[] {
  const warnings: ScoreValidationWarning[] = [];
  for (const row of rows) {
    const name = row.familyName;
    // Empty row (all zeros)
    if (!row.kills && !row.deaths && !row.assists && !row.damageDealt) {
      warnings.push({ player: name, field: "all", message: "All stats are zero — possibly an empty/invalid row" });
      continue;
    }
    // Suspiciously high death ratio
    if (row.deaths > row.kills * 3 && row.kills > 0) {
      warnings.push({ player: name, field: "deaths", message: `High death ratio (${row.deaths} deaths vs ${row.kills} kills)` });
    }
    // Very high damage (100M+)
    if (row.damageDealt > 100_000_000) {
      warnings.push({ player: name, field: "damageDealt", message: `Very high damage: ${row.damageDealt.toLocaleString()}` });
    }
    // Zero time alive but has kills
    if (row.timeAlive === "00:00" && row.kills > 5) {
      warnings.push({ player: name, field: "timeAlive", message: "Zero time alive but has kills — possibly incomplete data" });
    }
  }
  return warnings;
}

/**
 * Normalize a player name: trim whitespace, collapse multiple spaces.
 * Does NOT change casing — that's handled by case-insensitive keys.
 */
function normalizePlayerName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Detect potential duplicate players in a set of rows (case-insensitive).
 * Returns groups of names that map to the same normalized key.
 */
function detectDuplicatePlayers(rows: ScoreRow[]): Map<string, string[]> {
  const byKey = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = normalizePlayerName(row.familyName).toLowerCase();
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key)!.add(row.familyName);
  }
  // Only return groups with >1 distinct name
  const dupes = new Map<string, string[]>();
  for (const [key, names] of byKey) {
    if (names.size > 1) dupes.set(key, [...names]);
  }
  return dupes;
}
/**
 * Detect outlier stat values across a set of rows using z-score analysis.
 * Returns a map of playerName → list of warning messages for stats > 2.5σ from mean.
 */
function detectOutliers(rows: ScoreRow[]): Map<string, string[]> {
  const fields: Array<{ key: keyof ScoreRow; label: string }> = [
    { key: 'kills', label: 'Kills' },
    { key: 'deaths', label: 'Deaths' },
    { key: 'damageDealt', label: 'Damage' },
    { key: 'crowdControls', label: 'CC' },
    { key: 'structureDamage', label: 'Structure' },
    { key: 'allySupport', label: 'Support' }
  ];
  const warnings = new Map<string, string[]>();
  for (const { key, label } of fields) {
    const values = rows.map(r => Number(r[key]) || 0);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    if (stddev === 0) continue;
    for (const row of rows) {
      const val = Number(row[key]) || 0;
      const z = (val - mean) / stddev;
      if (Math.abs(z) > 2.5) {
        const dir = z > 0 ? 'unusually high' : 'unusually low';
        const list = warnings.get(row.familyName) || [];
        list.push(`${label} is ${dir} (${Math.round(val)} vs avg ${Math.round(mean)})`);
        warnings.set(row.familyName, list);
      }
    }
  }
  return warnings;
}


export {
  type ScoreGeminiQuotaResult,
  type ScoreGeminiQuota,
  type ScoreValidationWarning,
  createScoreGeminiQuota,
  consumeScoreGeminiQuota,
  getPacificDateKey,
  aggregateScoreRows,
  calculateImpactScores,
  sortScoreAggregates,
  parseScoreSortKey,
  validateScoreRows,
  normalizePlayerName,
  detectDuplicatePlayers,
  detectOutliers
};
