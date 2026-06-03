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
  const rowPassRows = parseScoreRows(results[0].data.text);
  const sparseNames = parseSparsePlayerNames(results[1].data.text);
  if (sparseNames.length < 10 && rowPassRows[0] && !sparseNames.some((name) => normalizePlayerName(name) === normalizePlayerName(rowPassRows[0].familyName))) {
    sparseNames.unshift(rowPassRows[0].familyName);
  }
  const sparseRows =
    sparseNames.length >= rowPassRows.length
      ? sparseNames.map((familyName, index) => ({ ...emptyScoreRow(familyName), ...rowPassRows[index], familyName }))
      : [];
  const rows = mergeScoreRows([...(sparseRows.length ? sparseRows : rowPassRows), ...parseScoreRows(results[1].data.text)]);
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
  const firstStatIndex = tokens.findIndex((token, index) => index > nameStartIndex && isStatToken(token));
  if (firstStatIndex <= nameStartIndex) return undefined;

  const familyName = tokens.slice(nameStartIndex, firstStatIndex).join(" ").replace(/[^a-zA-Z0-9 _.-]/g, "").trim();
  if (familyName.length < 2 || /^(family|name|guild|result|node|war)$/i.test(familyName)) return undefined;

  const stats = tokens.slice(firstStatIndex).filter(isStatToken);
  if (stats.length < 5) return undefined;

  const numeric = stats.filter((token) => !TIME_PATTERN.test(token));
  const times = stats.filter((token) => TIME_PATTERN.test(token));
  if (numeric.length < 5) return undefined;

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

function parseSparsePlayerNames(rawText: string): string[] {
  const ignored = new Set(["family", "name", "result", "node", "war", "guild", "estimating", "resolution", "xww"]);
  const names: string[] = [];
  let passedHeader = false;
  for (const line of rawText.split(/\r?\n/)) {
    const clean = line.replace(/[^a-zA-Z0-9_.-]/g, "").trim();
    if (/^familyname$/i.test(clean) || /^family$/i.test(clean)) {
      passedHeader = true;
      continue;
    }
    if (!passedHeader || clean.length < 3 || ignored.has(clean.toLowerCase()) || /^\d/.test(clean) || isStatToken(clean)) continue;
    if (/^[a-zA-Z][a-zA-Z0-9_.-]{2,24}$/.test(clean)) names.push(clean);
  }
  return names;
}

function emptyScoreRow(familyName: string): Omit<ScoreRow, "guildId"> {
  return {
    familyName,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    damageTaken: 0,
    crowdControls: 0,
    hpHealed: 0,
    allySupport: 0,
    structureDamage: 0,
    lynchCannonKills: 0,
    siegeAssists: 0,
    resurrections: 0,
    siegeDeaths: 0,
    specialKills: 0,
    timeAlive: "",
    totalWarTime: ""
  };
}
