import Tesseract from "tesseract.js";
import os from "node:os";
import path from "node:path";
const TIME_PATTERN = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const NUMBER_PATTERN = /^[\d,.]+[kKmM]?$/;
const TESSERACT_CACHE_PATH = path.join(os.tmpdir(), "nw-helper-tessdata");
export async function extractScoreScreenshot(image, options = {}) {
    if (options.preferGemini && options.geminiApiKey) {
        try {
            const geminiExtraction = await extractScoreScreenshotWithGemini(image, options.geminiApiKey, options.geminiModel ?? "gemini-2.5-flash-lite", options.mimeType ?? "image/png");
            if (geminiExtraction.rows.length)
                return geminiExtraction;
            console.warn("Gemini score extraction returned no rows; falling back to Tesseract.");
        }
        catch (error) {
            console.warn(`Gemini score extraction failed; falling back to Tesseract. ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return extractScoreScreenshotWithTesseract(image);
}
async function extractScoreScreenshotWithTesseract(image) {
    const results = await Promise.all([recognizeWithPsm(image, Tesseract.PSM.SINGLE_BLOCK), recognizeWithPsm(image, Tesseract.PSM.SPARSE_TEXT)]);
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
async function extractScoreScreenshotWithGemini(image, apiKey, model, mimeType) {
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
    const parsed = JSON.parse(responseText);
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
export function parseScoreRows(rawText) {
    return rawText
        .split(/\r?\n/)
        .map((line) => parseScoreLine(line))
        .filter((row) => Boolean(row));
}
function buildGeminiScorePrompt() {
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
function parseGeminiRows(rawText) {
    const parsed = parseJsonFromText(rawText);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : [];
    return mergeScoreRows(rows.map((row) => parseGeminiRow(row)).filter((row) => Boolean(row)));
}
function parseJsonFromText(rawText) {
    try {
        return JSON.parse(rawText);
    }
    catch {
        const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (!match)
            throw new Error("Gemini response did not contain JSON.");
        return JSON.parse(match[1]);
    }
}
function parseGeminiRow(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const row = value;
    const familyName = normalizeFamilyName(String(row.familyName ?? row.family_name ?? row.name ?? ""));
    if (familyName.length < 2)
        return undefined;
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
function readGeminiValue(value) {
    if (value === undefined || value === null)
        return undefined;
    return String(value);
}
function parseScoreLine(line) {
    const normalized = line.replace(/[|()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized)
        return undefined;
    const tokens = normalized.split(" ");
    const nameStartIndex = tokens.findIndex(isLikelyNameToken);
    if (nameStartIndex < 0)
        return undefined;
    const firstStatIndex = tokens.findIndex((token, index) => index > nameStartIndex && isScoreCellToken(token));
    if (firstStatIndex <= nameStartIndex)
        return undefined;
    const familyName = tokens.slice(nameStartIndex, firstStatIndex).join(" ").replace(/[^a-zA-Z0-9 _.-]/g, "").trim();
    if (familyName.length < 2 || /^(family|name|guild|result|node|war)$/i.test(familyName))
        return undefined;
    const stats = [];
    const times = [];
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
    if (stats.length < 5)
        return undefined;
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
function isStatToken(token) {
    return NUMBER_PATTERN.test(cleanNumberToken(token)) || TIME_PATTERN.test(token);
}
function isScoreCellToken(token) {
    return isStatToken(token) || normalizeScoreCellToken(token) !== undefined;
}
function normalizeScoreCellToken(token) {
    if (isOcrZero(token))
        return "0";
    if (NUMBER_PATTERN.test(cleanNumberToken(token)))
        return token;
    if (isStatPlaceholderToken(token))
        return "0";
    return undefined;
}
function isStatPlaceholderToken(token) {
    const clean = token.replace(/[^a-zA-Z]/g, "").toLowerCase();
    return /^(?:el|i|l|j|o|q|tow|sea|ams|as|ses|mask|im|ek|ema|os|sm|nm|am)$/.test(clean);
}
function isLikelyNameToken(token) {
    return /[a-zA-Z]/.test(token) && !isStatToken(token) && !/^(family|name|guild|result|node|war)$/i.test(token);
}
function parseStatNumber(value) {
    if (!value)
        return 0;
    const clean = cleanNumberToken(value);
    const multiplier = clean.toLowerCase().endsWith("m") ? 1_000_000 : clean.toLowerCase().endsWith("k") ? 1_000 : 1;
    const numeric = Number(clean.replace(/[kKmM]/g, "").replace(/,/g, ""));
    return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : 0;
}
function parseCountNumber(value) {
    if (!value)
        return 0;
    const numeric = Number(cleanNumberToken(value).replace(/[^\d.]/g, ""));
    return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}
function cleanNumberToken(token) {
    return token.replace(/[^\d,.kKmM]/g, "");
}
async function recognizeWithPsm(image, psm) {
    const worker = await Tesseract.createWorker("eng", undefined, {
        cachePath: TESSERACT_CACHE_PATH,
        logger: () => undefined
    });
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    try {
        return await worker.recognize(image, {}, { blocks: true, text: true });
    }
    finally {
        await worker.terminate();
    }
}
function mergeScoreRows(rows) {
    const merged = [];
    for (const row of rows) {
        const normalizedName = normalizePlayerName(row.familyName);
        if (!normalizedName || merged.some((candidate) => normalizePlayerName(candidate.familyName) === normalizedName || hasSameScoreSignature(candidate, row)))
            continue;
        merged.push(row);
    }
    return merged;
}
function hasSameScoreSignature(left, right) {
    const leftValues = getScoreSignatureValues(left);
    const rightValues = getScoreSignatureValues(right);
    const meaningfulValues = leftValues.filter((value) => value !== 0).length;
    if (meaningfulValues < 4)
        return false;
    return leftValues.every((value, index) => value === rightValues[index]);
}
function getScoreSignatureValues(row) {
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
function normalizePlayerName(name) {
    return name.toLowerCase().replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]/g, "");
}
function parseCoordinateRows(result) {
    const words = extractWords(result);
    if (!words.length)
        return [];
    const maxX = Math.max(...words.map((word) => word.x1));
    const maxY = Math.max(...words.map((word) => word.y1));
    const rowTolerance = Math.max(8, maxY * 0.014);
    const columnTolerance = Math.max(14, maxX * 0.02);
    const statWords = words.filter((word) => getWordCenter(word).x > maxX * 0.14 && isCoordinateCellToken(word.text));
    const rowBuckets = clusterByPosition(statWords, (word) => getWordCenter(word).y, rowTolerance).filter((bucket) => bucket.items.length >= 4);
    if (rowBuckets.length < 3)
        return [];
    const columnBuckets = clusterByPosition(statWords, (word) => getWordCenter(word).x, columnTolerance)
        .filter((bucket) => bucket.items.length >= Math.max(2, Math.floor(rowBuckets.length * 0.12)))
        .sort((left, right) => left.center - right.center);
    if (columnBuckets.length < 8)
        return [];
    const columnCenters = columnBuckets.map((bucket) => bucket.center);
    const timeCenters = columnCenters.length >= 11 ? columnCenters.slice(-2) : [];
    const statCenters = columnCenters.slice(0, timeCenters.length ? -2 : undefined).slice(0, 14);
    const firstStatCenter = statCenters[0] ?? maxX * 0.18;
    return rowBuckets
        .sort((left, right) => left.center - right.center)
        .map((bucket) => parseCoordinateRow(words, bucket.center, rowTolerance, columnTolerance, firstStatCenter, statCenters, timeCenters))
        .filter((row) => Boolean(row));
}
function parseCoordinateRow(words, rowCenter, rowTolerance, columnTolerance, firstStatCenter, statCenters, timeCenters) {
    const rowWords = words.filter((word) => Math.abs(getWordCenter(word).y - rowCenter) <= rowTolerance).sort((left, right) => left.x0 - right.x0);
    const familyName = normalizeFamilyName(rowWords.filter((word) => getWordCenter(word).x < firstStatCenter - columnTolerance).map((word) => word.text).join(" "));
    if (familyName.length < 2 || /^(family|name|guild|result|node|war)$/i.test(familyName))
        return undefined;
    const stats = statCenters.map((center) => readCoordinateCell(rowWords, center, columnTolerance)).filter((value) => value !== undefined);
    const times = timeCenters.map((center) => readCoordinateCell(rowWords, center, columnTolerance)).filter((value) => value !== undefined).map(normalizeTime);
    if (stats.length < 5)
        return undefined;
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
function readCoordinateCell(rowWords, center, columnTolerance) {
    const cellWords = rowWords
        .map((word) => ({ word, distance: Math.abs(getWordCenter(word).x - center) }))
        .filter((entry) => entry.distance <= columnTolerance)
        .sort((left, right) => left.distance - right.distance);
    for (const { word } of cellWords) {
        const value = normalizeScoreCellToken(word.text) ?? (looksLikeTime(word.text) ? word.text : undefined);
        if (value !== undefined)
            return value;
    }
    return undefined;
}
function extractWords(result) {
    const words = [];
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
function clusterByPosition(items, getPosition, tolerance) {
    const buckets = [];
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
function getWordCenter(word) {
    return { x: (word.x0 + word.x1) / 2, y: (word.y0 + word.y1) / 2 };
}
function normalizeFamilyName(value) {
    return value.replace(/[^a-zA-Z0-9 _.-]/g, "").replace(/\s+/g, " ").trim();
}
function isCoordinateCellToken(token) {
    return isScoreCellToken(token) || looksLikeTime(token);
}
function looksLikeTime(value) {
    return /^\d{1,2}:?\d{2}(?::\d{2})?\.?$/.test(value);
}
function normalizeTime(value) {
    if (!value)
        return "";
    const clean = value.replace(/\.$/, "");
    return clean.includes(":") ? clean : clean.length === 4 ? `${clean.slice(0, 2)}:${clean.slice(2)}` : clean;
}
function isOcrZero(value) {
    return /^[oO\[\]J]+$/.test(value);
}
