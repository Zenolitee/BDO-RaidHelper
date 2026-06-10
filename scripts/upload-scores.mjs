import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { randomUUID } from 'crypto';

// Read .env
const envLines = fs.readFileSync('.env', 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq === -1) continue;
  env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
if (!url || !key) { console.error('Missing Supabase credentials'); process.exit(1); }

const supabase = createClient(url, key, { auth: { persistSession: false } });
const BUCKET = 'score-screenshots';
const GUILD_ID = '1271355450545147995'; // from test mode URL

// Placeholder PNG (1x1 transparent)
const placeholderPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Helper to convert K/M values
function p(s) {
  s = s.trim();
  if (s.endsWith('M')) return Math.round(parseFloat(s.slice(0, -1)) * 1_000_000);
  if (s.endsWith('K')) return Math.round(parseFloat(s.slice(0, -1)) * 1_000);
  return parseInt(s, 10);
}

// Image 1: 2026-06-08 Victory
const rows1 = [
  { familyName: "Flavour", kills: 34, deaths: 10, assists: 4, damageDealt: p("400.6K"), damageTaken: p("291.6K"), crowdControls: 100, hpHealed: p("226.9K"), allySupport: 22805, structureDamage: p("252.5K"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "04:34", totalWarTime: "27:26" },
  { familyName: "Gahdehm", kills: 44, deaths: 5, assists: 5, damageDealt: p("482.2K"), damageTaken: p("263.7K"), crowdControls: 84, hpHealed: p("231.0K"), allySupport: 21684, structureDamage: p("4.6M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 3, timeAlive: "02:05", totalWarTime: "29:55" },
  { familyName: "Araghchi", kills: 17, deaths: 13, assists: 3, damageDealt: p("276.0K"), damageTaken: p("343.4K"), crowdControls: 38, hpHealed: p("259.4K"), allySupport: 24422, structureDamage: p("7.0M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "04:40", totalWarTime: "27:20" },
  { familyName: "Abhi", kills: 81, deaths: 12, assists: 12, damageDealt: p("880.0K"), damageTaken: p("189.8K"), crowdControls: 142, hpHealed: p("176.0K"), allySupport: 16748, structureDamage: p("4.4M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "00:45", totalWarTime: "31:15" },
  { familyName: "Umihotaru", kills: 24, deaths: 7, assists: 3, damageDealt: p("477.4K"), damageTaken: p("216.9K"), crowdControls: 95, hpHealed: p("168.5K"), allySupport: 83051, structureDamage: p("3.8M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "02:25", totalWarTime: "29:35" },
  { familyName: "PureSolstice", kills: 12, deaths: 9, assists: 2, damageDealt: p("233.3K"), damageTaken: p("190.2K"), crowdControls: 47, hpHealed: p("136.2K"), allySupport: 82916, structureDamage: p("4.9M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "03:14", totalWarTime: "28:46" },
  { familyName: "TheMajesty", kills: 0, deaths: 0, assists: 0, damageDealt: 57981, damageTaken: 2701, crowdControls: 46, hpHealed: 2672, allySupport: 160, structureDamage: 594100, lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 10, timeAlive: "00:00", totalWarTime: "32:00" },
];

// Image 2: 2026-06-09 Defeat
const rows2 = [
  { familyName: "Gahdehm", kills: 35, deaths: 21, assists: 3, damageDealt: p("633.8K"), damageTaken: p("559.2K"), crowdControls: 125, hpHealed: p("421.8K"), allySupport: 51167, structureDamage: p("604.7K"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "09:38", totalWarTime: "50:04" },
  { familyName: "Edgy", kills: 41, deaths: 25, assists: 4, damageDealt: p("670.1K"), damageTaken: p("628.2K"), crowdControls: 131, hpHealed: p("463.2K"), allySupport: 64246, structureDamage: p("3.7M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "10:59", totalWarTime: "48:43" },
  { familyName: "Conkey", kills: 42, deaths: 14, assists: 5, damageDealt: p("629.2K"), damageTaken: p("477.7K"), crowdControls: 95, hpHealed: p("387.9K"), allySupport: 50124, structureDamage: p("1.5M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "06:39", totalWarTime: "53:03" },
  { familyName: "Oxt4", kills: 32, deaths: 30, assists: 4, damageDealt: p("464.0K"), damageTaken: p("478.2K"), crowdControls: 90, hpHealed: p("295.5K"), allySupport: 47528, structureDamage: 4100000, lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "14:49", totalWarTime: "44:53" },
  { familyName: "Flavouur", kills: 44, deaths: 20, assists: 4, damageDealt: p("860.9K"), damageTaken: p("558.7K"), crowdControls: 20, hpHealed: p("427.8K"), allySupport: 47528, structureDamage: p("1.5M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "09:46", totalWarTime: "49:56" },
  { familyName: "Araghchi", kills: 30, deaths: 34, assists: 2, damageDealt: p("430.9K"), damageTaken: p("656.6K"), crowdControls: 37, hpHealed: p("432.1K"), allySupport: 60100, structureDamage: p("2.7M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "15:06", totalWarTime: "44:36" },
  { familyName: "Quren", kills: 51, deaths: 21, assists: 6, damageDealt: p("983.0K"), damageTaken: p("703.6K"), crowdControls: 209, hpHealed: p("564.2K"), allySupport: 67879, structureDamage: p("2.0M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "08:45", totalWarTime: "50:57" },
  { familyName: "Umihotaru", kills: 35, deaths: 24, assists: 3, damageDealt: p("843.7K"), damageTaken: p("483.7K"), crowdControls: 162, hpHealed: p("325.2K"), allySupport: 333000, structureDamage: p("669.3K"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "10:12", totalWarTime: "49:30" },
  { familyName: "Abhi", kills: 137, deaths: 11, assists: 15, damageDealt: 1700000, damageTaken: p("474.7K"), crowdControls: 317, hpHealed: p("404.2K"), allySupport: 45491, structureDamage: p("3.0M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "05:28", totalWarTime: "54:14" },
  { familyName: "PureSolstice", kills: 24, deaths: 29, assists: 3, damageDealt: p("390.1K"), damageTaken: p("533.0K"), crowdControls: 105, hpHealed: p("339.1K"), allySupport: 181200, structureDamage: p("2.6M"), lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "13:10", totalWarTime: "46:32" },
  { familyName: "TheMajesty", kills: 4, deaths: 7, assists: 2, damageDealt: 80245, damageTaken: p("105.1K"), crowdControls: 56, hpHealed: 62991, allySupport: 8179, structureDamage: 0, lynchCannonKills: 0, siegeAssists: 0, resurrections: 0, siegeDeaths: 0, specialKills: 0, timeAlive: "03:48", totalWarTime: "55:48" },
];

async function uploadReport(warDate, result, title, rows) {
  const reportId = randomUUID();
  const imagePath = `${GUILD_ID}/${reportId}.png`;

  // Upload placeholder image
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(imagePath, placeholderPng, { contentType: 'image/png', upsert: false });
  if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);

  // Insert report
  const reportRow = {
    id: reportId,
    guild_id: GUILD_ID,
    war_date: warDate,
    result,
    title,
    image_bucket: BUCKET,
    image_path: imagePath,
    image_mime_type: 'image/png',
    ocr_engine: 'manual-extraction',
    ocr_confidence: 100,
    raw_ocr_text: 'Extracted from screenshot by AI',
    uploaded_by: 'Codex (AI extraction)',
    created_at: new Date().toISOString()
  };

  const { error: reportError } = await supabase.from('score_reports').insert(reportRow);
  if (reportError) throw new Error(`Report insert failed: ${reportError.message}`);

  // Insert score rows
  const metricRows = rows.map(row => ({
    id: randomUUID(),
    report_id: reportId,
    guild_id: GUILD_ID,
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
  }));

  const { error: rowError } = await supabase.from('score_rows').insert(metricRows);
  if (rowError) throw new Error(`Row insert failed: ${rowError.message}`);

  console.log(`✓ Uploaded ${title}: ${rows.length} players (${result})`);
}

// Upload both reports
await uploadReport('2026-06-08', 'win', 'Node War - Jun 8', rows1);
await uploadReport('2026-06-09', 'loss', 'Node War - Jun 9', rows2);
console.log('\nDone! Both reports uploaded.');
