import Tesseract from "tesseract.js";
import os from "node:os";
import path from "node:path";
import type { ScoreRow } from "./score-types.js";

const TIME_PATTERN = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const NUMBER_PATTERN = /^[\d,.]+[kKmM]?$/;
const TESSERACT_CACHE_PATH = path.join(os.tmpdir(), "nw-helper-tessdata");

export interface ScoreExtraction {
  rawText: string;
  confidence?: number;
  rows: Omit<ScoreRow, "guildId">[];
}

export async function extractScoreScreenshot(image: Buffer): Promise<ScoreExtraction> {
  const results = await Promise.all([recognizeWithPsm(image, Tesseract.PSM.SINGLE_BLOCK), recognizeWithPsm(image, Tesseract.PSM.SPARSE_TEXT)]);
  const rawText = results.map((result) => result.data.text).join("\n\n--- sparse pass ---\n\n");
  const rows = mergeScoreRows([...parseScoreRows(results[0].data.text), ...parseScoreRows(results[1].data.text)]);
  const confidence = Math.max(...results.map((result) => result.data.confidence).filter(Number.isFinite));

  return {
    rawText,
    confidence: Number.isFinite(confidence) ? confidence : undefined,
    rows
  };
}

export function parseScoreRows(rawText: string): Omit<ScoreRow, "guildId">[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => parseScoreLine(line))
    .filter((row): row is Omit<ScoreRow, "guildId"> => Boolean(row));
}

function parseScoreLine(line: string): Omit<ScoreRow, "guildId"> | undefined {
  const normalized = line.replace(/[|()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  const tokens = normalized.split(" ");
  const nameStartIndex = tokens.findIndex(isLikelyNameToken);
  if (nameStartIndex < 0) return undefined;
  const firstStatIndex = tokens.findIndex((token, index) => index > nameStartIndex && isScoreCellToken(token));
  if (firstStatIndex <= nameStartIndex) return undefined;

  const familyName = tokens.slice(nameStartIndex, firstStatIndex).join(" ").replace(/[^a-zA-Z0-9 _.-]/g, "").trim();
  if (familyName.length < 2 || /^(family|name|guild|result|node|war)$/i.test(familyName)) return undefined;

  const stats: string[] = [];
  const times: string[] = [];
  for (const token of tokens.slice(firstStatIndex)) {
    if (looksLikeTime(token) && stats.length >= 8) {
      times.push(normalizeTime(token));
      continue;
    }

    const scoreCell = normalizeScoreCellToken(token);
    if (scoreCell !== undefined && stats.length < 14) {
      stats.push(scoreCell);
    }
  }
  if (stats.length < 5) return undefined;

  return {
    familyName,
    kills: parseCountNumber(stats[0]),
    deaths: parseCountNumber(stats[1]),
    assists: parseCountNumber(stats[2]),
    damageDealt: parseStatNumber(stats[3]),
    damageTaken: parseStatNumber(stats[4]),
    crowdControls: parseStatNumber(stats[5]),
    hpHealed: parseStatNumber(stats[6]),
    allySupport: parseStatNumber(stats[7]),
    structureDamage: parseStatNumber(stats[8]),
    lynchCannonKills: parseStatNumber(stats[9]),
    siegeAssists: parseStatNumber(stats[10]),
    resurrections: parseStatNumber(stats[11]),
    siegeDeaths: parseStatNumber(stats[12]),
    specialKills: parseStatNumber(stats[13]),
    timeAlive: times[0] ?? "",
    totalWarTime: times[1] ?? ""
  };
}

function isStatToken(token: string): boolean {
  return NUMBER_PATTERN.test(cleanNumberToken(token)) || TIME_PATTERN.test(token);
}

function isScoreCellToken(token: string): boolean {
  return isStatToken(token) || normalizeScoreCellToken(token) !== undefined;
}

function normalizeScoreCellToken(token: string): string | undefined {
  if (isOcrZero(token)) return "0";
  if (NUMBER_PATTERN.test(cleanNumberToken(token))) return token;
  if (isStatPlaceholderToken(token)) return "0";
  return undefined;
}

function isStatPlaceholderToken(token: string): boolean {
  const clean = token.replace(/[^a-zA-Z]/g, "").toLowerCase();
  return /^(?:el|i|l|j|o|q|tow|sea|ams|as|ses|mask|im|ek|ema|os|sm|nm|am)$/.test(clean);
}

function isLikelyNameToken(token: string): boolean {
  return /[a-zA-Z]/.test(token) && !isStatToken(token) && !/^(family|name|guild|result|node|war)$/i.test(token);
}

function parseStatNumber(value: string | undefined): number {
  if (!value) return 0;
  const clean = cleanNumberToken(value);
  const multiplier = clean.toLowerCase().endsWith("m") ? 1_000_000 : clean.toLowerCase().endsWith("k") ? 1_000 : 1;
  const numeric = Number(clean.replace(/[kKmM]/g, "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : 0;
}

function parseCountNumber(value: string | undefined): number {
  if (!value) return 0;
  const numeric = Number(cleanNumberToken(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function cleanNumberToken(token: string): string {
  return token.replace(/[^\d,.kKmM]/g, "");
}

async function recognizeWithPsm(image: Buffer, psm: Tesseract.PSM): Promise<Tesseract.RecognizeResult> {
  const worker = await Tesseract.createWorker("eng", undefined, {
    cachePath: TESSERACT_CACHE_PATH,
    logger: () => undefined
  });
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  try {
    return await worker.recognize(image);
  } finally {
    await worker.terminate();
  }
}

function mergeScoreRows(rows: Omit<ScoreRow, "guildId">[]): Omit<ScoreRow, "guildId">[] {
  const merged: Omit<ScoreRow, "guildId">[] = [];
  for (const row of rows) {
    const normalizedName = normalizePlayerName(row.familyName);
    if (!normalizedName || merged.some((candidate) => normalizePlayerName(candidate.familyName) === normalizedName)) continue;
    merged.push(row);
  }
  return merged;
}

function normalizePlayerName(name: string): string {
  return name.toLowerCase().replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]/g, "");
}

function looksLikeTime(value: string): boolean {
  return /^\d{1,2}:?\d{2}(?::\d{2})?\.?$/.test(value);
}

function normalizeTime(value: string | undefined): string {
  if (!value) return "";
  const clean = value.replace(/\.$/, "");
  return clean.includes(":") ? clean : clean.length === 4 ? `${clean.slice(0, 2)}:${clean.slice(2)}` : clean;
}

function isOcrZero(value: string): boolean {
  return /^[oO\[\]J]+$/.test(value);
}
