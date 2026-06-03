-- NW Helper score screenshot storage and OCR result tables.
-- Paste this into the Supabase SQL editor before deploying the Stats upload feature.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'score-screenshots',
  'score-screenshots',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.score_reports (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  war_date date not null,
  result text not null default 'unknown' check (result in ('win', 'loss', 'unknown')),
  title text,
  image_bucket text not null default 'score-screenshots',
  image_path text not null,
  image_mime_type text not null,
  ocr_engine text not null default 'tesseract.js',
  ocr_confidence numeric,
  raw_ocr_text text not null default '',
  uploaded_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.score_rows (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.score_reports(id) on delete cascade,
  guild_id text not null,
  family_name text not null,
  kills integer not null default 0,
  deaths integer not null default 0,
  assists integer not null default 0,
  damage_dealt bigint not null default 0,
  damage_taken bigint not null default 0,
  crowd_controls integer not null default 0,
  hp_healed bigint not null default 0,
  ally_support bigint not null default 0,
  structure_damage bigint not null default 0,
  lynch_cannon_kills integer not null default 0,
  siege_assists integer not null default 0,
  resurrections integer not null default 0,
  siege_deaths integer not null default 0,
  special_kills integer not null default 0,
  time_alive text not null default '',
  total_war_time text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists score_reports_guild_date_idx
  on public.score_reports (guild_id, war_date desc, created_at desc);

create index if not exists score_rows_report_idx
  on public.score_rows (report_id);

create index if not exists score_rows_guild_player_idx
  on public.score_rows (guild_id, lower(family_name));

alter table public.score_reports enable row level security;
alter table public.score_rows enable row level security;

-- The Railway server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS for uploads and reads.
-- Do not add public read/write policies unless you later move uploads directly into the browser.
