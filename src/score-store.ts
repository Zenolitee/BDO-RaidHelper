import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ScoreReport, ScoreReportInput, ScoreReportResult, ScoreRow } from "./score-types.js";

const SCORE_BUCKET = "score-screenshots";

interface ScoreStoreData {
  reports: ScoreReport[];
  playerClasses?: Record<string, Record<string, string>>;
}

interface ScoreReportRow {
  id: string;
  guild_id: string;
  war_date: string;
  result: ScoreReportResult;
  title?: string | null;
  image_bucket: string;
  image_path: string;
  image_mime_type: string;
  ocr_engine: string;
  ocr_confidence?: number | null;
  raw_ocr_text: string;
  uploaded_by?: string | null;
  created_at: string;
}

interface ScoreMetricRow {
  id: string;
  report_id: string;
  guild_id: string;
  family_name: string;
  kills: number;
  deaths: number;
  assists: number;
  damage_dealt: number;
  damage_taken: number;
  crowd_controls: number;
  hp_healed: number;
  ally_support: number;
  structure_damage: number;
  lynch_cannon_kills: number;
  siege_assists: number;
  resurrections: number;
  siege_deaths: number;
  special_kills: number;
  time_alive: string;
  total_war_time: string;
}

export interface ScoreStore {
  listReports(guildId: string): Promise<ScoreReport[]>;
  getReport(guildId: string, reportId: string): Promise<ScoreReport | undefined>;
  createReport(input: ScoreReportInput): Promise<ScoreReport>;
  readReportImage(guildId: string, reportId: string): Promise<{ report: ScoreReport; imageBuffer: Buffer } | undefined>;
  updateReport(
    guildId: string,
    reportId: string,
    updates: Pick<ScoreReportInput, "warDate" | "result" | "title" | "rows">
  ): Promise<ScoreReport>;
  replaceReportExtraction(
    guildId: string,
    reportId: string,
    extraction: Pick<ScoreReportInput, "ocrEngine" | "rawOcrText" | "ocrConfidence" | "rows">
  ): Promise<ScoreReport>;
  renamePlayer(guildId: string, oldName: string, newName: string): Promise<number>;
  deleteReport(guildId: string, reportId: string): Promise<void>;
  getPlayerClass(guildId: string, playerName: string): Promise<string | null>;
  setPlayerClass(guildId: string, playerName: string, classKey: string | null): Promise<void>;
  getPlayerClasses(guildId: string): Promise<Record<string, string>>;
}

export class JsonScoreStore implements ScoreStore {
  constructor(
    private readonly filePath: string,
    private readonly imageDirectory: string
  ) {}

  async listReports(guildId: string): Promise<ScoreReport[]> {
    const data = await this.read();
    return data.reports
      .filter((report) => report.guildId === guildId)
      .sort((left, right) => right.warDate.localeCompare(left.warDate) || right.createdAt.localeCompare(left.createdAt));
  }

  async createReport(input: ScoreReportInput): Promise<ScoreReport> {
    const id = randomUUID();
    const imagePath = path.join(input.guildId, id, safeFileName(input.imageOriginalName));
    const absoluteImagePath = path.join(this.imageDirectory, imagePath);
    await fs.mkdir(path.dirname(absoluteImagePath), { recursive: true });
    await fs.writeFile(absoluteImagePath, input.imageBuffer);

    const report: ScoreReport = {
      id,
      guildId: input.guildId,
      warDate: input.warDate,
      result: input.result,
      title: input.title,
      imageBucket: "local",
      imagePath,
      imageMimeType: input.imageMimeType,
      ocrEngine: input.ocrEngine ?? "tesseract.js",
      ocrConfidence: input.ocrConfidence,
      rawOcrText: input.rawOcrText,
      uploadedBy: input.uploadedBy,
      createdAt: new Date().toISOString(),
      rows: input.rows.map((row) => ({ ...row, id: randomUUID(), reportId: id, guildId: input.guildId }))
    };

    const data = await this.read();
    data.reports.push(report);
    await this.write(data);
    return report;
  }

  async getReport(guildId: string, reportId: string): Promise<ScoreReport | undefined> {
    const data = await this.read();
    return data.reports.find((candidate) => candidate.guildId === guildId && candidate.id === reportId);
  }

  async readReportImage(guildId: string, reportId: string): Promise<{ report: ScoreReport; imageBuffer: Buffer } | undefined> {
    const data = await this.read();
    const report = data.reports.find((candidate) => candidate.guildId === guildId && candidate.id === reportId);
    if (!report) return undefined;
    const imageBuffer = await fs.readFile(path.join(this.imageDirectory, report.imagePath));
    return { report, imageBuffer };
  }

  async updateReport(
    guildId: string,
    reportId: string,
    updates: Pick<ScoreReportInput, "warDate" | "result" | "title" | "rows">
  ): Promise<ScoreReport> {
    const data = await this.read();
    const report = data.reports.find((candidate) => candidate.guildId === guildId && candidate.id === reportId);
    if (!report) throw new Error("Score report not found.");
    report.warDate = updates.warDate;
    report.result = updates.result;
    report.title = updates.title;
    report.ocrEngine = report.ocrEngine.includes("+manual") ? report.ocrEngine : `${report.ocrEngine}+manual`;
    report.rows = updates.rows.map((row) => ({ ...row, id: randomUUID(), reportId, guildId }));
    await this.write(data);
    return report;
  }

  async replaceReportExtraction(
    guildId: string,
    reportId: string,
    extraction: Pick<ScoreReportInput, "ocrEngine" | "rawOcrText" | "ocrConfidence" | "rows">
  ): Promise<ScoreReport> {
    const data = await this.read();
    const report = data.reports.find((candidate) => candidate.guildId === guildId && candidate.id === reportId);
    if (!report) throw new Error("Score report not found.");
    report.ocrEngine = extraction.ocrEngine ?? report.ocrEngine;
    report.rawOcrText = extraction.rawOcrText;
    report.ocrConfidence = extraction.ocrConfidence;
    report.rows = extraction.rows.map((row) => ({ ...row, id: randomUUID(), reportId, guildId }));
    await this.write(data);
    return report;
  }

  async deleteReport(guildId: string, reportId: string): Promise<void> {
    const data = await this.read();
    const reportIndex = data.reports.findIndex((candidate) => candidate.guildId === guildId && candidate.id === reportId);
    if (reportIndex < 0) throw new Error("Score report not found.");
    const [report] = data.reports.splice(reportIndex, 1);
    await this.write(data);

    const absoluteImagePath = path.resolve(this.imageDirectory, report.imagePath);
    const imageRoot = path.resolve(this.imageDirectory);
    if (absoluteImagePath.startsWith(`${imageRoot}${path.sep}`)) {
      await fs.rm(absoluteImagePath, { force: true });
      await fs.rm(path.dirname(absoluteImagePath), { force: true, recursive: true });
    }
  }

  async renamePlayer(guildId: string, oldName: string, newName: string): Promise<number> {
    const normalizedOldName = oldName.trim().toLowerCase();
    const cleanedNewName = newName.trim();
    if (!normalizedOldName || !cleanedNewName) return 0;

    const data = await this.read();
    let renamed = 0;
    for (const report of data.reports) {
      if (report.guildId !== guildId) continue;
      let reportRenamed = 0;
      for (const row of report.rows) {
        if (row.familyName.trim().toLowerCase() === normalizedOldName) {
          row.familyName = cleanedNewName;
          renamed += 1;
          reportRenamed += 1;
        }
      }
      if (reportRenamed && !report.ocrEngine.includes("+manual")) {
        report.ocrEngine = `${report.ocrEngine}+manual`;
      }
    }

    if (renamed) await this.write(data);
    return renamed;
  }

  async getPlayerClass(guildId: string, playerName: string): Promise<string | null> {
    const data = await this.read();
    return data.playerClasses?.[guildId]?.[playerName.toLowerCase()] ?? null;
  }

  async setPlayerClass(guildId: string, playerName: string, classKey: string | null): Promise<void> {
    const data = await this.read();
    if (!data.playerClasses) data.playerClasses = {};
    if (!data.playerClasses[guildId]) data.playerClasses[guildId] = {};
    const key = playerName.toLowerCase();
    if (classKey) {
      data.playerClasses[guildId][key] = classKey;
    } else {
      delete data.playerClasses[guildId][key];
    }
    await this.write(data);
  }

  async getPlayerClasses(guildId: string): Promise<Record<string, string>> {
    const data = await this.read();
    return data.playerClasses?.[guildId] ?? {};
  }

  private async read(): Promise<ScoreStoreData> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ScoreStoreData>;
      return {
        reports: Array.isArray(parsed.reports) ? parsed.reports.filter(isScoreReport) : [],
        playerClasses: parsed.playerClasses ?? {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { reports: [], playerClasses: {} };
      throw error;
    }
  }

  private async write(data: ScoreStoreData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

export class SupabaseScoreStore implements ScoreStore {
  private readonly supabase: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.supabase = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  async listReports(guildId: string): Promise<ScoreReport[]> {
    const { data: reports, error: reportError } = await this.supabase
      .from("score_reports")
      .select("*")
      .eq("guild_id", guildId)
      .order("war_date", { ascending: false })
      .order("created_at", { ascending: false })
      .returns<ScoreReportRow[]>();

    if (reportError) throw new Error(`Score report read failed: ${reportError.message}`);
    if (!reports.length) return [];

    const { data: rows, error: rowError } = await this.supabase
      .from("score_rows")
      .select("*")
      .in(
        "report_id",
        reports.map((report) => report.id)
      )
      .returns<ScoreMetricRow[]>();

    if (rowError) throw new Error(`Score row read failed: ${rowError.message}`);

    const rowsByReport = new Map<string, ScoreRow[]>();
    for (const row of rows) {
      const list = rowsByReport.get(row.report_id) ?? [];
      list.push(fromScoreMetricRow(row));
      rowsByReport.set(row.report_id, list);
    }

    return reports.map((report) => fromScoreReportRow(report, rowsByReport.get(report.id) ?? []));
  }

  async createReport(input: ScoreReportInput): Promise<ScoreReport> {
    const id = randomUUID();
    const imagePath = `${input.guildId}/${id}/${safeFileName(input.imageOriginalName)}`;
    const { error: uploadError } = await this.supabase.storage.from(SCORE_BUCKET).upload(imagePath, input.imageBuffer, {
      contentType: input.imageMimeType,
      upsert: false
    });

    if (uploadError) throw new Error(`Score screenshot upload failed: ${uploadError.message}`);

    const reportRow = {
      id,
      guild_id: input.guildId,
      war_date: input.warDate,
      result: input.result,
      title: input.title || null,
      image_bucket: SCORE_BUCKET,
      image_path: imagePath,
      image_mime_type: input.imageMimeType,
      ocr_engine: input.ocrEngine ?? "tesseract.js",
      ocr_confidence: input.ocrConfidence ?? null,
      raw_ocr_text: input.rawOcrText,
      uploaded_by: input.uploadedBy ?? null
    };

    const { data: insertedReport, error: reportError } = await this.supabase
      .from("score_reports")
      .insert(reportRow)
      .select("*")
      .single<ScoreReportRow>();

    if (reportError) throw new Error(`Score report insert failed: ${reportError.message}`);

    const metricRows = input.rows.map((row) => toScoreMetricInsert(row, id, input.guildId));
    if (metricRows.length) {
      const { error: rowError } = await this.supabase.from("score_rows").insert(metricRows);
      if (rowError) throw new Error(`Score row insert failed: ${rowError.message}`);
    }

    return fromScoreReportRow(insertedReport, metricRows.map((row) => fromScoreMetricRow({ ...row, id: randomUUID() })));
  }

  async getReport(guildId: string, reportId: string): Promise<ScoreReport | undefined> {
    const { data: report, error: reportError } = await this.supabase
      .from("score_reports")
      .select("*")
      .eq("guild_id", guildId)
      .eq("id", reportId)
      .maybeSingle<ScoreReportRow>();

    if (reportError) throw new Error(`Score report read failed: ${reportError.message}`);
    if (!report) return undefined;

    const { data: rows, error: rowError } = await this.supabase
      .from("score_rows")
      .select("*")
      .eq("guild_id", guildId)
      .eq("report_id", reportId)
      .returns<ScoreMetricRow[]>();

    if (rowError) throw new Error(`Score row read failed: ${rowError.message}`);
    return fromScoreReportRow(report, rows.map(fromScoreMetricRow));
  }

  async readReportImage(guildId: string, reportId: string): Promise<{ report: ScoreReport; imageBuffer: Buffer } | undefined> {
    const { data: report, error: reportError } = await this.supabase
      .from("score_reports")
      .select("*")
      .eq("guild_id", guildId)
      .eq("id", reportId)
      .maybeSingle<ScoreReportRow>();

    if (reportError) throw new Error(`Score report read failed: ${reportError.message}`);
    if (!report) return undefined;

    const { data: image, error: imageError } = await this.supabase.storage.from(report.image_bucket).download(report.image_path);
    if (imageError) throw new Error(`Score screenshot download failed: ${imageError.message}`);

    return {
      report: fromScoreReportRow(report, []),
      imageBuffer: Buffer.from(await image.arrayBuffer())
    };
  }

  async updateReport(
    guildId: string,
    reportId: string,
    updates: Pick<ScoreReportInput, "warDate" | "result" | "title" | "rows">
  ): Promise<ScoreReport> {
    const existing = await this.getReport(guildId, reportId);
    if (!existing) throw new Error("Score report not found.");
    const ocrEngine = existing.ocrEngine.includes("+manual") ? existing.ocrEngine : `${existing.ocrEngine}+manual`;

    const { data: report, error: reportError } = await this.supabase
      .from("score_reports")
      .update({
        war_date: updates.warDate,
        result: updates.result,
        title: updates.title ?? null,
        ocr_engine: ocrEngine
      })
      .eq("guild_id", guildId)
      .eq("id", reportId)
      .select("*")
      .single<ScoreReportRow>();

    if (reportError) throw new Error(`Score report update failed: ${reportError.message}`);

    const { error: deleteError } = await this.supabase.from("score_rows").delete().eq("guild_id", guildId).eq("report_id", reportId);
    if (deleteError) throw new Error(`Score row cleanup failed: ${deleteError.message}`);

    const metricRows = updates.rows.map((row) => toScoreMetricInsert(row, reportId, guildId));
    if (metricRows.length) {
      const { error: rowError } = await this.supabase.from("score_rows").insert(metricRows);
      if (rowError) throw new Error(`Score row insert failed: ${rowError.message}`);
    }

    return fromScoreReportRow(report, metricRows.map((row) => fromScoreMetricRow({ ...row, id: randomUUID() })));
  }

  async replaceReportExtraction(
    guildId: string,
    reportId: string,
    extraction: Pick<ScoreReportInput, "ocrEngine" | "rawOcrText" | "ocrConfidence" | "rows">
  ): Promise<ScoreReport> {
    const { data: report, error: reportError } = await this.supabase
      .from("score_reports")
      .update({
        ocr_engine: extraction.ocrEngine ?? "tesseract.js",
        raw_ocr_text: extraction.rawOcrText,
        ocr_confidence: extraction.ocrConfidence ?? null
      })
      .eq("guild_id", guildId)
      .eq("id", reportId)
      .select("*")
      .single<ScoreReportRow>();

    if (reportError) throw new Error(`Score report update failed: ${reportError.message}`);

    const { error: deleteError } = await this.supabase.from("score_rows").delete().eq("guild_id", guildId).eq("report_id", reportId);
    if (deleteError) throw new Error(`Score row cleanup failed: ${deleteError.message}`);

    const metricRows = extraction.rows.map((row) => toScoreMetricInsert(row, reportId, guildId));
    if (metricRows.length) {
      const { error: rowError } = await this.supabase.from("score_rows").insert(metricRows);
      if (rowError) throw new Error(`Score row insert failed: ${rowError.message}`);
    }

    return fromScoreReportRow(report, metricRows.map((row) => fromScoreMetricRow({ ...row, id: randomUUID() })));
  }

  async deleteReport(guildId: string, reportId: string): Promise<void> {
    const existing = await this.getReport(guildId, reportId);
    if (!existing) throw new Error("Score report not found.");

    const { error: rowError } = await this.supabase.from("score_rows").delete().eq("guild_id", guildId).eq("report_id", reportId);
    if (rowError) throw new Error(`Score row delete failed: ${rowError.message}`);

    const { error: reportError } = await this.supabase.from("score_reports").delete().eq("guild_id", guildId).eq("id", reportId);
    if (reportError) throw new Error(`Score report delete failed: ${reportError.message}`);

    const { error: imageError } = await this.supabase.storage.from(existing.imageBucket).remove([existing.imagePath]);
    if (imageError) throw new Error(`Score screenshot delete failed: ${imageError.message}`);
  }

  async renamePlayer(guildId: string, oldName: string, newName: string): Promise<number> {
    const cleanedOldName = oldName.trim();
    const cleanedNewName = newName.trim();
    if (!cleanedOldName || !cleanedNewName) return 0;

    const { data, error } = await this.supabase
      .from("score_rows")
      .update({ family_name: cleanedNewName })
      .eq("guild_id", guildId)
      .ilike("family_name", escapePostgrestLike(cleanedOldName))
      .select("id");

    if (error) throw new Error(`Score player rename failed: ${error.message}`);
    return data?.length ?? 0;
  }

  async getPlayerClass(guildId: string, playerName: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("player_classes")
      .select("class_key")
      .eq("guild_id", guildId)
      .ilike("family_name", escapePostgrestLike(playerName.trim()))
      .maybeSingle<{ class_key: string }>();
    if (error) {
      if (error.code === "42P01" || error.message?.includes("does not exist")) return null;
      throw new Error(`Player class read failed: ${error.message}`);
    }
    return data?.class_key ?? null;
  }

  async setPlayerClass(guildId: string, playerName: string, classKey: string | null): Promise<void> {
    const cleanedName = playerName.trim();
    if (classKey) {
      const { error } = await this.supabase
        .from("player_classes")
        .upsert({ guild_id: guildId, family_name: cleanedName, class_key: classKey }, { onConflict: "guild_id,family_name" });
      if (error && error.code !== "42P01" && !error.message?.includes("does not exist")) {
        throw new Error(`Player class write failed: ${error.message}`);
      }
    } else {
      const { error } = await this.supabase
        .from("player_classes")
        .delete()
        .eq("guild_id", guildId)
        .ilike("family_name", escapePostgrestLike(cleanedName));
      if (error && error.code !== "42P01" && !error.message?.includes("does not exist")) {
        throw new Error(`Player class delete failed: ${error.message}`);
      }
    }
  }

  async getPlayerClasses(guildId: string): Promise<Record<string, string>> {
    const { data, error } = await this.supabase
      .from("player_classes")
      .select("family_name, class_key")
      .eq("guild_id", guildId)
      .returns<Array<{ family_name: string; class_key: string }>>();
    if (error) {
      if (error.code === "42P01" || error.message?.includes("does not exist")) return {};
      throw new Error(`Player classes read failed: ${error.message}`);
    }
    const map: Record<string, string> = {};
    for (const row of data ?? []) {
      map[row.family_name.toLowerCase()] = row.class_key;
    }
    return map;
  }
}

export function createScoreStore(options: {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  dataFile: string;
}): ScoreStore {
  if (options.supabaseUrl && options.supabaseServiceRoleKey) {
    return new SupabaseScoreStore(options.supabaseUrl, options.supabaseServiceRoleKey);
  }

  const dataDirectory = path.dirname(options.dataFile);
  return new JsonScoreStore(path.join(dataDirectory, "scores.json"), path.join(dataDirectory, "score-images"));
}

function toScoreMetricInsert(row: Omit<ScoreRow, "guildId">, reportId: string, guildId: string): Omit<ScoreMetricRow, "id"> {
  return {
    report_id: reportId,
    guild_id: guildId,
    family_name: row.familyName,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    damage_dealt: row.damageDealt,
    damage_taken: row.damageTaken,
    crowd_controls: row.crowdControls,
    hp_healed: row.hpHealed,
    ally_support: row.allySupport,
    structure_damage: row.structureDamage,
    lynch_cannon_kills: row.lynchCannonKills,
    siege_assists: row.siegeAssists,
    resurrections: row.resurrections,
    siege_deaths: row.siegeDeaths,
    special_kills: row.specialKills,
    time_alive: row.timeAlive,
    total_war_time: row.totalWarTime
  };
}

function fromScoreReportRow(row: ScoreReportRow, rows: ScoreRow[]): ScoreReport {
  return {
    id: row.id,
    guildId: row.guild_id,
    warDate: row.war_date,
    result: row.result,
    title: row.title ?? undefined,
    imageBucket: row.image_bucket,
    imagePath: row.image_path,
    imageMimeType: row.image_mime_type,
    ocrEngine: row.ocr_engine,
    ocrConfidence: row.ocr_confidence ?? undefined,
    rawOcrText: row.raw_ocr_text,
    uploadedBy: row.uploaded_by ?? undefined,
    createdAt: row.created_at,
    rows
  };
}

function fromScoreMetricRow(row: ScoreMetricRow): ScoreRow {
  return {
    id: row.id,
    reportId: row.report_id,
    guildId: row.guild_id,
    familyName: row.family_name,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    damageDealt: row.damage_dealt,
    damageTaken: row.damage_taken,
    crowdControls: row.crowd_controls,
    hpHealed: row.hp_healed,
    allySupport: row.ally_support,
    structureDamage: row.structure_damage,
    lynchCannonKills: row.lynch_cannon_kills,
    siegeAssists: row.siege_assists,
    resurrections: row.resurrections,
    siegeDeaths: row.siege_deaths,
    specialKills: row.special_kills,
    timeAlive: row.time_alive,
    totalWarTime: row.total_war_time
  };
}

function isScoreReport(value: unknown): value is ScoreReport {
  return Boolean(value && typeof value === "object" && typeof (value as Partial<ScoreReport>).id === "string");
}

function safeFileName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const base = path.basename(fileName, extension).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "score";
  return `${base}${[".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? extension : ".png"}`;
}

function escapePostgrestLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
