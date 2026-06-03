export type ScoreReportResult = "win" | "loss" | "unknown";

export interface ScoreRow {
  id?: string;
  reportId?: string;
  guildId: string;
  familyName: string;
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  damageTaken: number;
  crowdControls: number;
  hpHealed: number;
  allySupport: number;
  structureDamage: number;
  lynchCannonKills: number;
  siegeAssists: number;
  resurrections: number;
  siegeDeaths: number;
  specialKills: number;
  timeAlive: string;
  totalWarTime: string;
}

export interface ScoreReport {
  id: string;
  guildId: string;
  warDate: string;
  result: ScoreReportResult;
  title?: string;
  imageBucket: string;
  imagePath: string;
  imageMimeType: string;
  ocrEngine: string;
  ocrConfidence?: number;
  rawOcrText: string;
  uploadedBy?: string;
  createdAt: string;
  rows: ScoreRow[];
}

export interface ScoreReportInput {
  guildId: string;
  warDate: string;
  result: ScoreReportResult;
  title?: string;
  imageMimeType: string;
  imageOriginalName: string;
  imageBuffer: Buffer;
  ocrEngine?: string;
  rawOcrText: string;
  ocrConfidence?: number;
  uploadedBy?: string;
  rows: ScoreRow[];
}
