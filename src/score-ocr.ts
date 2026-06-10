import Tesseract from "tesseract.js";
import sharp from "sharp";
import os from "node:os";

import path from "node:path";
import type { ScoreRow } from "./score-types.js";

const TIME_PATTERN = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const NUMBER_PATTERN = /^[\d,.]+[kKmM]?$/;
const TESSERACT_CACHE_PATH = path.join(os.tmpdir(), "nw-helper-tessdata");

export interface ScoreExtraction {
  engine: string;
  rawText: string;
  confidence?: number;
  rows: Omit<ScoreRow, "guildId">[];
}

export interface ScoreExtractionOptions {
  mimeType?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  preferGemini?: boolean;
}

export async function extractScoreScreenshot(image: Buffer, options: ScoreExtractionOptions = {}): Promise<ScoreExtraction> {
  if (options.preferGemini && options.geminiApiKey) {
    try {
      const geminiExtraction = await extractScoreScreenshotWithGemini(image, options.geminiApiKey, options.geminiModel ?? "gemini-2.5-flash-lite", options.mimeType ?? "image/png");
      if (geminiExtraction.rows.length) return geminiExtraction;
      console.warn("Gemini score extraction returned no rows; falling back to Tesseract.");
    } catch (error) {
      console.warn(`Gemini score extraction failed; falling back to Tesseract. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return extractScoreScreenshotWithTesseract(image);
}

async function preprocessForOcr(image: Buffer): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  let pipeline = sharp(image);
  // Upscale small images for better Tesseract accuracy
  if (width < 1200) {
    const scale = Math.min(3, Math.ceil(1200 / width));
    pipeline = pipeline.resize({ width: width * scale, kernel: sharp.kernel.lanczos3 });
  }
  // Light preprocessing: grayscale + normalize contrast only (no threshold — keeps decimals)
  return pipeline.grayscale().normalize().toBuffer();
}

async function extractScoreScreenshotWithTesseract(image: Buffer): Promise<ScoreExtraction> {
  const preprocessed = await preprocessForOcr(image);
  const results = await Promise.all([recognizeWithPsm(preprocessed, Tesseract.PSM.SINGLE_BLOCK), recognizeWithPsm(preprocessed, Tesseract.PSM.SPARSE_TEXT)]);
  const rawText = results.map((result) => result.data.text).join("\n\n--- sparse pass ---\n\n");
  const coordinateRows = parseCoordinateRows(results[0]);
  const rows = mergeScoreRows([...coordinateRows, ...parseScoreRows(results[0].data.text), ...parseScoreRows(results[1].data.text)]);
  const confidence = Math.max(...results.map((result) => result.data.confidence).filter(Number.isFinite));

  return {
    engine: "tesseract.js",
    rawText,
    confidence: Number.isFinite(confidence) ? confidence : undefined,
    rows
  };
}

async function extractScoreScreenshotWithGemini(image: Buffer, apiKey: string, model: string, mimeType: string): Promise<ScoreExtraction> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: buildGeminiScorePrompt() },
            {
              inline_data: {
                mime_type: mimeType,
                data: image.toString("base64")
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    })
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini API returned ${response.status}: ${responseText.slice(0, 300)}`);
  }

  const parsed = JSON.parse(responseText) as GeminiGenerateContentResponse;
  const parts = parsed.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  const text = parts
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
  const rows = parseGeminiRows(text);
  return {
    engine: `gemini:${model}`,
    rawText: text || responseText,
    confidence: rows.length ? 100 : undefined,
    rows
  };
}

export function parseScoreRows(rawText: string): Omit<ScoreRow, "guildId">[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => parseScoreLine(line))
    .filter((row): row is Omit<ScoreRow, "guildId"> => Boolean(row));
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

interface GeminiScoreRow {
  familyName?: unknown;
  family_name?: unknown;
  name?: unknown;
  kills?: unknown;
  deaths?: unknown;
  assists?: unknown;
  damageDealt?: unknown;
  damage_dealt?: unknown;
  damageTaken?: unknown;
  damage_taken?: unknown;
  crowdControls?: unknown;
  crowd_controls?: unknown;
  cc?: unknown;
  hpHealed?: unknown;
  hp_healed?: unknown;
  healing?: unknown;
  allySupport?: unknown;
  ally_support?: unknown;
  alliesHealed?: unknown;
  allies_healed?: unknown;
  structureDamage?: unknown;
  structure_damage?: unknown;
  fortDamage?: unknown;
  fort_damage?: unknown;
  lynchCannonKills?: unknown;
  lynch_cannon_kills?: unknown;
  siegeAssists?: unknown;
  siege_assists?: unknown;
  resurrections?: unknown;
  revives?: unknown;
  siegeDeaths?: unknown;
  siege_deaths?: unknown;
  specialKills?: unknown;
  special_kills?: unknown;
  timeAlive?: unknown;
  time_alive?: unknown;
  totalWarTime?: unknown;
  total_war_time?: unknown;
}

function buildGeminiScorePrompt(): string {
  return [
    "Extract the BDO Node War scoreboard table from this screenshot.",
    "Return only JSON. Do not include markdown.",
    "Use this exact shape: {\"rows\":[{\"familyName\":\"\",\"kills\":0,\"deaths\":0,\"assists\":0,\"damageDealt\":0,\"damageTaken\":0,\"crowdControls\":0,\"hpHealed\":0,\"allySupport\":0,\"structureDamage\":0,\"lynchCannonKills\":0,\"siegeAssists\":0,\"resurrections\":0,\"siegeDeaths\":0,\"specialKills\":0,\"timeAlive\":\"\",\"totalWarTime\":\"\"}]}",
    "Read player names from the left Family Name column.",
    "Return all visible player rows, top to bottom.",
    "The assists field is the kill streak column, not player assists.",
    "Use hpHealed only for the self HP healed / recovery column.",
    "Use allySupport only for the right-side Support / healing given to allies column marked with the plus + support icon.",
    "Convert K/M values to full integers. Example: 614.1K is 614100 and 5.4M is 5400000.",
    "If a cell is blank, unreadable, or not visible, use 0 for numeric fields and an empty string for time fields.",
    "Do not invent players or stats."
  ].join("\n");
}

function parseGeminiRows(rawText: string): Omit<ScoreRow, "guildId">[] {
  const parsed = parseJsonFromText(rawText);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { rows?: unknown })?.rows) ? (parsed as { rows: unknown[] }).rows : [];
  return mergeScoreRows(rows.map((row) => parseGeminiRow(row)).filter((row): row is Omit<ScoreRow, "guildId"> => Boolean(row)));
}

function parseJsonFromText(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) throw new Error("Gemini response did not contain JSON.");
    return JSON.parse(match[1]);
  }
}

function parseGeminiRow(value: unknown): Omit<ScoreRow, "guildId"> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as GeminiScoreRow;
  const familyName = normalizeFamilyName(String(row.familyName ?? row.family_name ?? row.name ?? ""));
  if (familyName.length < 2) return undefined;

  return {
    familyName,
    kills: parseCountNumber(readGeminiValue(row.kills)),
    deaths: parseCountNumber(readGeminiValue(row.deaths)),
    assists: parseCountNumber(readGeminiValue(row.assists)),
    damageDealt: parseStatNumber(readGeminiValue(row.damageDealt ?? row.damage_dealt)),
    damageTaken: parseStatNumber(readGeminiValue(row.damageTaken ?? row.damage_taken)),
    crowdControls: parseCountNumber(readGeminiValue(row.crowdControls ?? row.crowd_controls ?? row.cc)),
    hpHealed: parseStatNumber(readGeminiValue(row.hpHealed ?? row.hp_healed ?? row.healing)),
    allySupport: parseStatNumber(readGeminiValue(row.allySupport ?? row.ally_support ?? row.alliesHealed ?? row.allies_healed)),
    structureDamage: parseStatNumber(readGeminiValue(row.structureDamage ?? row.structure_damage ?? row.fortDamage ?? row.fort_damage)),
    lynchCannonKills: parseCountNumber(readGeminiValue(row.lynchCannonKills ?? row.lynch_cannon_kills)),
    siegeAssists: parseCountNumber(readGeminiValue(row.siegeAssists ?? row.siege_assists)),
    resurrections: parseCountNumber(readGeminiValue(row.resurrections ?? row.revives)),
    siegeDeaths: parseCountNumber(readGeminiValue(row.siegeDeaths ?? row.siege_deaths)),
    specialKills: parseCountNumber(readGeminiValue(row.specialKills ?? row.special_kills)),
    timeAlive: normalizeTime(readGeminiValue(row.timeAlive ?? row.time_alive)),
    totalWarTime: normalizeTime(readGeminiValue(row.totalWarTime ?? row.total_war_time))
  };
}

function readGeminiValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
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
  // Skip rank column if first value looks like a rank (small number, enough data follows)
  const effectiveStats = (stats.length >= 9 && parseCountNumber(stats[0]) > 0 && parseCountNumber(stats[0]) <= 100)
    ? stats.slice(1)
    : stats;
  if (effectiveStats.length < 5) return undefined;

  return {
    familyName,
    kills: parseCountNumber(effectiveStats[0]),
    deaths: parseCountNumber(effectiveStats[1]),
    assists: parseCountNumber(effectiveStats[2]),
    damageDealt: parseStatNumber(effectiveStats[3]),
    damageTaken: parseStatNumber(effectiveStats[4]),
    crowdControls: parseStatNumber(effectiveStats[5]),
    hpHealed: parseStatNumber(effectiveStats[6]),
    allySupport: parseStatNumber(effectiveStats[7]),
    structureDamage: parseStatNumber(effectiveStats[8]),
    lynchCannonKills: parseCountNumber(effectiveStats[9]),
    siegeAssists: parseCountNumber(effectiveStats[10]),
    resurrections: parseCountNumber(effectiveStats[11]),
    siegeDeaths: parseCountNumber(effectiveStats[12]),
    specialKills: parseCountNumber(effectiveStats[13]),
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
  const clean = fixOcrNumber(value);
  const multiplier = clean.toLowerCase().endsWith("m") ? 1_000_000 : clean.toLowerCase().endsWith("k") ? 1_000 : 1;
  const numeric = Number(clean.replace(/[kKmM]/g, "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : 0;
}
function parseCountNumber(value: string | undefined): number {
  if (!value) return 0;
  const clean = fixOcrNumber(value);
  const numeric = Number(clean.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}
function fixOcrNumber(token: string): string {
  // Fix common OCR artifacts in numbers
  let s = token.replace(/[^\d,.kKmM\s]/g, " ").trim();
  // Replace OCR letter confusions: O/o → 0, l/I → 1
  s = s.replace(/\b[Oo]\b/g, "0").replace(/\b[lI]\b/g, "1");
  // "430 OK" → "430.0K" (space + O before K suffix)
  s = s.replace(/(\d)\s+[Oo]\s*([kKmM])\s*$/i, "$1.0$2");
  // "326 7K" or "1 3M" — digit space digit suffix → insert decimal
  s = s.replace(/(\d)\s+(\d)\s*([kKmM])\s*$/i, "$1.$2$3");
  // Remove trailing non-numeric chars after suffix
  s = s.replace(/[^\d.,kKmM]/g, "");

  // BDO-specific: Tesseract drops decimal points in K/M numbers.
  // Pattern: "11M" should be "1.1M", "4026K" should be "402.6K", "103M" should be "10.3M"
  // BDO always shows: X.XM for millions, XXX.XK for thousands
  const kmMatch = s.match(/^(\d{4,})[kK]$/);
  if (kmMatch) {
    // "4026K" → "402.6K" (insert decimal before last digit)
    s = kmMatch[1].slice(0, -1) + "." + kmMatch[1].slice(-1) + "K";
  }
  const mMatch = s.match(/^(\d{2,})[mM]$/);
  if (mMatch && !s.includes(".")) {
    // "11M" → "1.1M", "103M" → "10.3M", "109M" → "10.9M"
    // Insert decimal before last digit: XXm → X.Xm, XXXm → XX.Xm
    s = mMatch[1].slice(0, -1) + "." + mMatch[1].slice(-1) + "M";
  }
  // Fix double dots
  s = s.replace(/\.{2,}/g, ".");
  return s || "0";
}

function cleanNumberToken(token: string): string {
  return fixOcrNumber(token);
}

async function recognizeWithPsm(image: Buffer, psm: Tesseract.PSM): Promise<Tesseract.RecognizeResult> {
  const worker = await Tesseract.createWorker("eng", undefined, {
    cachePath: TESSERACT_CACHE_PATH,
    logger: () => undefined
  });
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  try {
    return await worker.recognize(image, {}, { blocks: true, text: true });
  } finally {
    await worker.terminate();
  }
}

function mergeScoreRows(rows: Omit<ScoreRow, "guildId">[]): Omit<ScoreRow, "guildId">[] {
  const merged: Omit<ScoreRow, "guildId">[] = [];
  for (const row of rows) {
    const normalizedName = normalizePlayerName(row.familyName);
    if (!normalizedName || merged.some((candidate) => normalizePlayerName(candidate.familyName) === normalizedName || hasSameScoreSignature(candidate, row))) continue;
    merged.push(row);
  }
  return merged;
}

function hasSameScoreSignature(left: Omit<ScoreRow, "guildId">, right: Omit<ScoreRow, "guildId">): boolean {
  const leftValues = getScoreSignatureValues(left);
  const rightValues = getScoreSignatureValues(right);
  const meaningfulValues = leftValues.filter((value) => value !== 0).length;
  if (meaningfulValues < 4) return false;
  return leftValues.every((value, index) => value === rightValues[index]);
}

function getScoreSignatureValues(row: Omit<ScoreRow, "guildId">): Array<number | string> {
  return [
    row.kills,
    row.deaths,
    row.assists,
    row.damageDealt,
    row.damageTaken,
    row.crowdControls,
    row.hpHealed,
    row.allySupport,
    row.structureDamage,
    row.timeAlive,
    row.totalWarTime
  ];
}

function normalizePlayerName(name: string): string {
  return name.toLowerCase().replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]/g, "");
}
/**
 * Post-processing: detect and fix common Tesseract digit-dropping errors.
 * When kills are single-digit but damage/heal/support suggest a full row,
 * the first digit of kills may have been lost.
 */
function postProcessOcrRows(rows: Omit<ScoreRow, "guildId">[]): Omit<ScoreRow, "guildId">[] {
  if (rows.length < 3) return rows;
  // Calculate median damage to establish what "normal" looks like for this war
  const damages = rows.map((r) => r.damageDealt).filter((d) => d > 0).sort((a, b) => a - b);
  const medianDamage = damages.length ? damages[Math.floor(damages.length / 2)] : 0;
  if (!medianDamage) return rows;

  return rows.map((row) => {
    // Skip all-zero rows
    if (!row.kills && !row.deaths && !row.assists && !row.damageDealt) return row;

    const r = { ...row };
    const dmgRatio = medianDamage > 0 ? r.damageDealt / medianDamage : 1;

    // Fix 1: Single-digit kills when damage is high (digit dropped)
    // If kills < 10 but damage > 50% of median, the first digit was likely lost
    if (r.kills > 0 && r.kills < 10 && dmgRatio > 0.5) {
      // Try prepending digits 1-9 to see if the result is more proportional
      const candidateTens = [10, 20, 30, 40, 50, 60, 70, 80, 90];
      for (const base of candidateTens) {
        const candidate = base + r.kills;
        // If this makes kills proportional to damage (roughly: 1 kill per 5K-50K damage)
        const killDmgRatio = r.damageDealt / candidate;
        if (killDmgRatio > 3000 && killDmgRatio < 80000) {
          r.kills = candidate;
          break;
        }
      }
    }

    // Fix 2: Single-digit deaths when damage is high
    if (r.deaths > 0 && r.deaths < 10 && dmgRatio > 0.5) {
      const candidateTens = [10, 20, 30, 40, 50];
      for (const base of candidateTens) {
        const candidate = base + r.deaths;
        // Deaths usually less than kills; if candidate seems reasonable
        if (candidate <= r.kills * 2) {
          r.deaths = candidate;
          break;
        }
      }
    }

    // Fix 3: Single-digit assists when other stats are high (digit dropped from assists)
    if (r.assists > 0 && r.assists < 10 && r.damageDealt > medianDamage * 0.3 && dmgRatio > 0.3) {
      // In BDO, assists are usually 2-20 range; single digit is actually common
      // Only flag if assists is exactly 1-digit AND deaths are 2+ digits
      // This catches "7" that should be "70" or "700" etc.
    }

    return r;
  });
}

interface OcrWord {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function parseCoordinateRows(result: Tesseract.RecognizeResult): Omit<ScoreRow, "guildId">[] {
  const words = extractWords(result);
  if (!words.length) return [];

  const maxX = Math.max(...words.map((word) => word.x1));
  const maxY = Math.max(...words.map((word) => word.y1));
  const rowTolerance = Math.max(8, maxY * 0.014);
  const columnTolerance = Math.max(14, maxX * 0.02);
  const statWords = words.filter((word) => getWordCenter(word).x > maxX * 0.14 && isCoordinateCellToken(word.text));
  const rowBuckets = clusterByPosition(statWords, (word) => getWordCenter(word).y, rowTolerance).filter((bucket) => bucket.items.length >= 4);
  if (rowBuckets.length < 3) return [];

  const columnBuckets = clusterByPosition(statWords, (word) => getWordCenter(word).x, columnTolerance)
    .filter((bucket) => bucket.items.length >= Math.max(2, Math.floor(rowBuckets.length * 0.12)))
    .sort((left, right) => left.center - right.center);
  if (columnBuckets.length < 8) return [];

  // Detect rank column: find "#" or non-icon header text in the header row area
  const headerYThreshold = rowBuckets.length > 0 ? rowBuckets[0].center - rowTolerance * 2 : maxY * 0.15;
  const headerWords = words.filter((word) => getWordCenter(word).y <= headerYThreshold);
  // Look for "#" header or "Family Name" text to determine where stats start
  const familyNameHeader = headerWords.find((word) => /family|name/i.test(word.text));
  const rankHeader = headerWords.find((word) => /^#|^[Nn]o\.?$/.test(word.text.trim()));

  let columnCenters = columnBuckets.map((bucket) => bucket.center);

  // Skip rank column if detected by header or heuristic
  const skipRank = (() => {
    if (rankHeader) {
      const rankX = (rankHeader.x0 + rankHeader.x1) / 2;
      const idx = columnCenters.findIndex((c) => Math.abs(c - rankX) < columnTolerance * 2);
      if (idx >= 0) return idx;
    }
    // Heuristic: BDO scoreboard has 13+ stat columns. If the first column's values are
    // consistently < kills (rank is usually top-right, kills are bigger numbers), skip it.
    // Better heuristic: if there are >= 9 columns and the first column has a narrow range
    // compared to the second, it's likely a rank column.
    if (columnCenters.length >= 9) {
      const firstColVals = rowBuckets.map((bucket) => {
        const val = readCoordinateCell(
          words.filter((w) => Math.abs(getWordCenter(w).y - bucket.center) <= rowTolerance),
          columnCenters[0], columnTolerance
        );
        return val ? parseCountNumber(val) : -1;
      }).filter((v) => v >= 0);
      if (firstColVals.length >= 3) {
        const max = Math.max(...firstColVals);
        const min = Math.min(...firstColVals);
        const range = max - min;
        // Rank columns have narrow range (1-N where N is player count)
        // Kill columns have wider range (0-100+)
        // If max rank <= player count and range is narrow, it's a rank column
        if (max <= rowBuckets.length && range < rowBuckets.length * 0.8) return 0;
      }
    }
    return -1;
  })();

  if (skipRank >= 0) columnCenters.splice(skipRank, 1);

  const timeCenters = columnCenters.length >= 11 ? columnCenters.slice(-2) : [];
  const statCenters = columnCenters.slice(0, timeCenters.length ? -2 : undefined).slice(0, 14);
  const firstStatCenter = statCenters[0] ?? maxX * 0.18;

  return rowBuckets
    .sort((left, right) => left.center - right.center)
    .map((bucket) => parseCoordinateRow(words, bucket.center, rowTolerance, columnTolerance, firstStatCenter, statCenters, timeCenters))
    .filter((row): row is Omit<ScoreRow, "guildId"> => Boolean(row));
}

function parseCoordinateRow(
  words: OcrWord[],
  rowCenter: number,
  rowTolerance: number,
  columnTolerance: number,
  firstStatCenter: number,
  statCenters: number[],
  timeCenters: number[]
): Omit<ScoreRow, "guildId"> | undefined {
  const rowWords = words.filter((word) => Math.abs(getWordCenter(word).y - rowCenter) <= rowTolerance).sort((left, right) => left.x0 - right.x0);
  const familyName = normalizeFamilyName(rowWords.filter((word) => getWordCenter(word).x < firstStatCenter - columnTolerance).map((word) => word.text).join(" "));
  if (familyName.length < 2 || /^(family|name|guild|result|node|war)$/i.test(familyName)) return undefined;

  const stats = statCenters.map((center) => readCoordinateCell(rowWords, center, columnTolerance)).filter((value): value is string => value !== undefined);
  const times = timeCenters.map((center) => readCoordinateCell(rowWords, center, columnTolerance)).filter((value): value is string => value !== undefined).map(normalizeTime);
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

function readCoordinateCell(rowWords: OcrWord[], center: number, columnTolerance: number): string | undefined {
  const expanded = columnTolerance * 1.5; // Wider window to catch split digits
  const cellWords = rowWords
    .map((word) => ({ word, distance: Math.abs(getWordCenter(word).x - center) }))
    .filter((entry) => entry.distance <= expanded)
    .sort((left, right) => left.distance - right.distance);
  if (!cellWords.length) return undefined;
  // Try single closest word first
  for (const { word } of cellWords) {
    const value = normalizeScoreCellToken(word.text) ?? (looksLikeTime(word.text) ? word.text : undefined);
    if (value !== undefined) return value;
  }
  // Try merging 2-3 adjacent words that form a number (handles Tesseract splitting "34" into "3" + "4")
  const adjacent = cellWords.filter((entry) => entry.distance <= columnTolerance * 2);
  for (let len = 2; len <= Math.min(3, adjacent.length); len++) {
    for (let start = 0; start <= adjacent.length - len; start++) {
      const slice = adjacent.slice(start, start + len);
      // Must be x-adjacent (no big gaps)
      let gapOk = true;
      for (let i = 1; i < slice.length; i++) {
        if (Math.abs(slice[i].word.x0 - slice[i - 1].word.x1) > columnTolerance * 0.8) { gapOk = false; break; }
      }
      if (!gapOk) continue;
      // Try direct concatenation
      const merged = slice.map((e) => e.word.text).join("");
      const v1 = normalizeScoreCellToken(merged);
      if (v1 !== undefined) return v1;
      // Try with dot inserted (for "1" + "3M" → "1.3M")
      if (len === 2) {
        const withDot = slice[0].word.text + "." + slice[1].word.text;
        const v2 = normalizeScoreCellToken(withDot);
        if (v2 !== undefined) return v2;
      }
    }
  }
  return undefined;
}

function extractWords(result: Tesseract.RecognizeResult): OcrWord[] {
  const words: OcrWord[] = [];
  for (const block of result.data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          words.push({ text: word.text, x0: word.bbox.x0, x1: word.bbox.x1, y0: word.bbox.y0, y1: word.bbox.y1 });
        }
      }
    }
  }
  return words;
}

function clusterByPosition<T>(items: T[], getPosition: (item: T) => number, tolerance: number): Array<{ center: number; items: T[] }> {
  const buckets: Array<{ center: number; items: T[] }> = [];
  for (const item of items.sort((left, right) => getPosition(left) - getPosition(right))) {
    const position = getPosition(item);
    const bucket = buckets.find((candidate) => Math.abs(candidate.center - position) <= tolerance);
    if (!bucket) {
      buckets.push({ center: position, items: [item] });
      continue;
    }
    bucket.items.push(item);
    bucket.center = bucket.items.reduce((sum, bucketItem) => sum + getPosition(bucketItem), 0) / bucket.items.length;
  }
  return buckets;
}

function getWordCenter(word: OcrWord): { x: number; y: number } {
  return { x: (word.x0 + word.x1) / 2, y: (word.y0 + word.y1) / 2 };
}

function normalizeFamilyName(value: string): string {
  return value.replace(/[^a-zA-Z0-9 _.-]/g, "").replace(/\s+/g, " ").trim();
}

function isCoordinateCellToken(token: string): boolean {
  return isScoreCellToken(token) || looksLikeTime(token);
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
