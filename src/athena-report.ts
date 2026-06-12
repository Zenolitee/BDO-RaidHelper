/**
 * Athena War Intelligence Report — embed builder and data preparation.
 *
 * Separated from bot.ts so that:
 *  • Data preparation (`prepareAthenaReport`) is reusable for future
 *    image-based report cards without depending on Discord.js.
 *  • Rendering (`buildAthenaReportEmbed`) is Discord-specific.
 *  • Future extensions (trends, comparisons, class stats, images) can
 *    add new exports without touching the command handler.
 */
import { EmbedBuilder } from "discord.js";
import type { PlayerScoreAggregate } from "./web/types.js";
import type { ScoreReport, ScoreReportResult } from "./score-types.js";

// ---------------------------------------------------------------------------
// Colors & branding
// ---------------------------------------------------------------------------

export const ATHENA_GOLD = 0xc99a2e;
export const ATHENA_DARK = 0x1a1a2e;

const RESULT_EMOJI: Record<ScoreReportResult, string> = {
  win: "✅",
  loss: "❌",
  unknown: "❓",
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Compact stat formatter: 1.2M, 823K, 99. */
export function formatStat(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  }
  return String(value);
}

function kdRatio(p: PlayerScoreAggregate): string {
  return p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : String(p.kills);
}

function kdValue(p: PlayerScoreAggregate): number {
  return p.deaths > 0 ? p.kills / p.deaths : p.kills;
}

/** Format a Discord-friendly date: "2026-06-12". */
function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-CA", { timeZone: "UTC" });
}

/** Format time in 12-hour: "11:18 PM". */
function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Singapore",
  });
}

function padEnd(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

// ---------------------------------------------------------------------------
// Data preparation — pure, no Discord dependency
// ---------------------------------------------------------------------------

export interface AthenaPlayerRanking {
  rank: number;
  player: PlayerScoreAggregate;
  kd: string;
  killsFmt: string;
  deathsFmt: string;
  damageFmt: string;
}

export interface AthenaMvp {
  player: PlayerScoreAggregate;
  score: number;
}

export interface AthenaCategoryLeaders {
  mostKills: PlayerScoreAggregate;
  mostDeaths: PlayerScoreAggregate;
  highestKd: PlayerScoreAggregate;
  highestDamage: PlayerScoreAggregate;
}

export interface AthenaFullReport {
  /** Sorted player rankings (all players). */
  rankings: AthenaPlayerRanking[];
  /** MVP winner and composite score. */
  mvp: AthenaMvp | null;
  /** Category leaders. */
  leaders: AthenaCategoryLeaders | null;
  /** Aggregate guild stats. */
  totalKills: number;
  totalDeaths: number;
  guildKd: string;
  playerCount: number;
  reportCount: number;
  /** Latest report metadata. */
  latestTitle: string;
  warDate: string;
  warResult: ScoreReportResult;
}

/**
 * Pure data preparation — no Discord types.
 * Reusable for future image-based report generation.
 */
export function prepareAthenaReport(params: {
  players: PlayerScoreAggregate[];
  reports: ScoreReport[];
  totalKills: number;
  totalDeaths: number;
}): AthenaFullReport {
  const { players, reports, totalKills, totalDeaths } = params;
  const latest = reports[0];

  const sorted = [...players].sort(
    (a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt
  );

  const rankings: AthenaPlayerRanking[] = sorted.map((player, i) => ({
    rank: i + 1,
    player,
    kd: kdRatio(player),
    killsFmt: formatStat(player.kills),
    deathsFmt: formatStat(player.deaths),
    damageFmt: formatStat(player.damageDealt),
  }));

  const mvp = calculateMvp(players);
  const leaders = players.length >= 2 ? findCategoryLeaders(players) : null;

  return {
    rankings,
    mvp,
    leaders,
    totalKills,
    totalDeaths,
    guildKd: totalDeaths
      ? (totalKills / totalDeaths).toFixed(2)
      : String(totalKills),
    playerCount: players.length,
    reportCount: reports.length,
    latestTitle: latest.title ?? formatDate(latest.warDate),
    warDate: latest.warDate,
    warResult: latest.result,
  };
}

// ---------------------------------------------------------------------------
// MVP calculation
// ---------------------------------------------------------------------------

/**
 * Weighted composite score normalized across the player pool.
 * Weights: Kills 40% · K/D 30% · Damage 30%.
 *
 * Returns null only when the player pool is empty.
 */
function calculateMvp(
  players: PlayerScoreAggregate[]
): AthenaMvp | null {
  if (!players.length) return null;

  const maxKills = Math.max(...players.map((p) => p.kills));
  const maxKd = Math.max(...players.map((p) => kdValue(p)));
  const maxDamage = Math.max(...players.map((p) => p.damageDealt));

  let best = players[0];
  let bestScore = -Infinity;

  for (const player of players) {
    const killsNorm = maxKills > 0 ? player.kills / maxKills : 0;
    const kdNorm = maxKd > 0 ? kdValue(player) / maxKd : 0;
    const dmgNorm = maxDamage > 0 ? player.damageDealt / maxDamage : 0;
    const score = killsNorm * 40 + kdNorm * 30 + dmgNorm * 30;

    if (score > bestScore || (score === bestScore && player.kills > best.kills)) {
      bestScore = score;
      best = player;
    }
  }

  return { player: best, score: bestScore };
}

// ---------------------------------------------------------------------------
// Category leaders
// ---------------------------------------------------------------------------

function findCategoryLeaders(
  players: PlayerScoreAggregate[]
): AthenaCategoryLeaders {
  let mostKills = players[0];
  let mostDeaths = players[0];
  let highestKd = players[0];
  let highestDamage = players[0];

  for (const p of players) {
    if (p.kills > mostKills.kills) mostKills = p;
    if (p.deaths > mostDeaths.deaths) mostDeaths = p;
    if (kdValue(p) > kdValue(highestKd)) highestKd = p;
    if (p.damageDealt > highestDamage.damageDealt) highestDamage = p;
  }

  return { mostKills, mostDeaths, highestKd, highestDamage };
}

// ---------------------------------------------------------------------------
// Discord embed builder
// ---------------------------------------------------------------------------

/**
 * Build the full Athena Scoreboard Export embed.
 *
 * Layout:
 *  1. Title & date subtitle
 *  2. Two-column summary code block (MVP | Guild Stats)
 *  3. Divider
 *  4. Scoreboard table code block
 *  5. Footer
 */
export function buildAthenaReportEmbed(
  report: AthenaFullReport
): EmbedBuilder {
  const description = buildDescription(report);

  return new EmbedBuilder()
    .setTitle("\u2694\uFE0F Project Athena \u2014 Scoreboard Export")
    .setColor(ATHENA_GOLD)
    .setDescription(description)
    .setFooter({ text: "Project Athena Scoreboard \u2022 Generated " + formatTime() });
}

// ---------------------------------------------------------------------------
// Description builder — all layout logic lives here
// ---------------------------------------------------------------------------

function buildDescription(report: AthenaFullReport): string {
  const parts: string[] = [];

  // --- Subtitle ---
  parts.push(
    `Date: ${report.warDate}`,
    `Reports: ${report.reportCount} \u00B7 Players: ${report.playerCount}`,
  );

  // --- Two-column summary code block ---
  parts.push("");
  parts.push(buildSummaryCodeBlock(report));

  // --- Divider ---
  parts.push("");
  parts.push("\u2501".repeat(52));

  // --- Scoreboard table code block ---
  parts.push("");
  parts.push(buildTableCodeBlock(report));

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Two-column summary code block
// ---------------------------------------------------------------------------

const COL_LEFT = 30;
const COL_RIGHT = 28;

function buildSummaryCodeBlock(report: AthenaFullReport): string {
  const lines: string[] = [];

  // Header
  lines.push(
    padEnd("MVP", COL_LEFT) + "| Guild Stats"
  );
  lines.push(
    "-".repeat(COL_LEFT) + "|" + "-".repeat(COL_RIGHT)
  );

  // Left column: MVP name + medals + stats
  // Right column: guild stats
  const left: string[] = [];
  const right: string[] = [];

  // MVP header line
  if (report.mvp) {
    left.push(`\uD83C\uDFC6 ${truncate(report.mvp.player.familyName, 22)}`);
  } else {
    left.push("N/A");
  }
  right.push(`\u2694\uFE0F Total Kills: ${report.totalKills}`);

  // Medal lines (top 3)
  const medals = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"];
  const podium = report.rankings.slice(0, 3);
  for (const entry of podium) {
    left.push(`${medals[entry.rank - 1]} ${truncate(entry.player.familyName, 24)}`);
  }
  // Pad right column to match podium lines
  const podiumCount = podium.length;
  if (podiumCount > 0) {
    right.push(`\uD83D\uDC80 Total Deaths: ${report.totalDeaths}`);
    if (podiumCount >= 2) right.push(`\uD83D\uDCCA Guild K/D: ${report.guildKd}`);
    if (podiumCount >= 3) right.push(`\uD83D\uDC65 Players: ${report.playerCount}`);
  }

  // Pad left to match right length
  while (left.length < right.length) left.push("");
  while (right.length < left.length) right.push("");

  // MVP detailed stats (below medals)
  if (report.mvp) {
    const mvp = report.mvp.player;
    left.push(
      `${formatStat(mvp.kills)} K / ${formatStat(mvp.deaths)} D \u00B7 ${kdRatio(mvp)} K/D`
    );
    left.push(`${formatStat(mvp.damageDealt)} Damage`);
    right.push(`\uD83D\uDCC1 Reports: ${report.reportCount}`);
    right.push("");
  }

  while (left.length < right.length) left.push("");
  while (right.length < left.length) right.push("");

  for (let i = 0; i < left.length; i++) {
    lines.push(padEnd(left[i], COL_LEFT) + "|" + right[i]);
  }

  return "```\n" + lines.join("\n") + "\n```";
}

// ---------------------------------------------------------------------------
// Scoreboard table code block
// ---------------------------------------------------------------------------

const TABLE_RANK = 4;
const TABLE_NAME = 16;
const TABLE_KILLS = 6;
const TABLE_DEATHS = 7;
const TABLE_KD = 5;
const TABLE_DMG = 8;
const TABLE_WARS = 5;

function buildTableCodeBlock(report: AthenaFullReport): string {
  const lines: string[] = [];

  // Header
  lines.push(
    padEnd("Rank", TABLE_RANK) + " | " +
    padEnd("Player", TABLE_NAME) + " | " +
    padStart("Kills", TABLE_KILLS) + " | " +
    padStart("Deaths", TABLE_DEATHS) + " | " +
    padStart("K/D", TABLE_KD) + " | " +
    padStart("Damage", TABLE_DMG) + " | " +
    padStart("Wars", TABLE_WARS)
  );

  // Separator
  const sepLen =
    TABLE_RANK + 3 + TABLE_NAME + 3 + TABLE_KILLS + 3 + TABLE_DEATHS +
    3 + TABLE_KD + 3 + TABLE_DMG + 3 + TABLE_WARS;
  lines.push("-".repeat(sepLen));

  // Data rows
  for (const entry of report.rankings) {
    const name = truncate(entry.player.familyName, TABLE_NAME);
    lines.push(
      padStart(String(entry.rank), TABLE_RANK) + " | " +
      padEnd(name, TABLE_NAME) + " | " +
      padStart(String(entry.player.kills), TABLE_KILLS) + " | " +
      padStart(String(entry.player.deaths), TABLE_DEATHS) + " | " +
      padStart(entry.kd, TABLE_KD) + " | " +
      padStart(entry.damageFmt, TABLE_DMG) + " | " +
      padStart(String(entry.player.participations), TABLE_WARS)
    );
  }

  return "```\n" + lines.join("\n") + "\n```";
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, Math.max(0, max - 1)) + "\u2026" : value;
}

// ---------------------------------------------------------------------------
// Future extension points (DO NOT IMPLEMENT — architectural placeholders)
// ---------------------------------------------------------------------------

// export interface AthenaImageReport {
//   mvpBanner: Buffer;
//   topPlayerCards: Buffer[];
//   fullReportCard: Buffer;
// }
//
// export function buildAthenaImageReport(report: AthenaFullReport): Promise<AthenaImageReport> {
//   throw new Error("Not yet implemented");
// }
//
// export interface AthenaTrendReport {
//   killsTrend: { date: string; value: number }[];
//   kdTrend: { date: string; value: number }[];
//   damageTrend: { date: string; value: number }[];
// }
//
// export function buildAthenaTrendReport(
//   current: AthenaFullReport,
//   historical: ScoreReport[]
// ): AthenaTrendReport {
//   throw new Error("Not yet implemented");
// }
//
// export function buildAthenaComparisonEmbed(
//   current: AthenaFullReport,
//   previous: AthenaFullReport
// ): EmbedBuilder {
//   throw new Error("Not yet implemented");
// }
//
// export function buildAthenaClassStats(report: AthenaFullReport): EmbedBuilder {
//   throw new Error("Not yet implemented");
// }
//
// export function buildAthenaAttendanceReport(
//   reports: ScoreReport[]
// ): EmbedBuilder {
//   throw new Error("Not yet implemented");
// }
