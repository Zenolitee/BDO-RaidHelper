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
  const result = await Tesseract.recognize(image, "eng", {
    cachePath: TESSERACT_CACHE_PATH,
    logger: () => undefined
  });

  const rawText = result.data.text;
  return {
    rawText,
    confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : undefined,
    rows: parseScoreRows(rawText)
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
  const firstStatIndex = tokens.findIndex(isStatToken);
  if (firstStatIndex <= 0) return undefined;

  const familyName = tokens.slice(0, firstStatIndex).join(" ").replace(/[^a-zA-Z0-9 _.-]/g, "").trim();
  if (familyName.length < 2 || /^(family|name|guild|result|node|war)$/i.test(familyName)) return undefined;

  const stats = tokens.slice(firstStatIndex).filter(isStatToken);
  if (stats.length < 12) return undefined;

  const numeric = stats.filter((token) => !TIME_PATTERN.test(token));
  const times = stats.filter((token) => TIME_PATTERN.test(token));
  if (numeric.length < 12) return undefined;

  return {
    familyName,
    kills: parseStatNumber(numeric[0]),
    deaths: parseStatNumber(numeric[1]),
    assists: parseStatNumber(numeric[2]),
    damageDealt: parseStatNumber(numeric[3]),
    damageTaken: parseStatNumber(numeric[4]),
    crowdControls: parseStatNumber(numeric[5]),
    hpHealed: parseStatNumber(numeric[6]),
    allySupport: parseStatNumber(numeric[7]),
    structureDamage: parseStatNumber(numeric[8]),
    lynchCannonKills: parseStatNumber(numeric[9]),
    siegeAssists: parseStatNumber(numeric[10]),
    resurrections: parseStatNumber(numeric[11]),
    siegeDeaths: parseStatNumber(numeric[12]),
    specialKills: parseStatNumber(numeric[13]),
    timeAlive: times[0] ?? "",
    totalWarTime: times[1] ?? ""
  };
}

function isStatToken(token: string): boolean {
  return NUMBER_PATTERN.test(cleanNumberToken(token)) || TIME_PATTERN.test(token);
}

function parseStatNumber(value: string | undefined): number {
  if (!value) return 0;
  const clean = cleanNumberToken(value);
  const multiplier = clean.toLowerCase().endsWith("m") ? 1_000_000 : clean.toLowerCase().endsWith("k") ? 1_000 : 1;
  const numeric = Number(clean.replace(/[kKmM]/g, "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : 0;
}

function cleanNumberToken(token: string): string {
  return token.replace(/[^\d,.kKmM]/g, "");
}
