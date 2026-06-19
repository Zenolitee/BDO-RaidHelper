# Configuration

NW Helper reads environment variables from `.env` through `dotenv`. Copy `.env.example` to `.env` for local development. Do not commit secrets.

## Discord

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Required for bot mode and command registration | None | Discord bot token. The web server can start without it, but bot features are disabled. |
| `DISCORD_CLIENT_ID` | Required for command registration and OAuth login | None | Discord application ID. |
| `DISCORD_CLIENT_SECRET` | Required for dashboard login | None | Discord OAuth client secret. |
| `DISCORD_REDIRECT_URI` | Optional | `${PUBLIC_BASE_URL}/auth/discord/callback` | OAuth callback. Register the exact URL in the Discord Developer Portal. |
| `DISCORD_GUILD_ID` | Required by `npm run register:commands` | None | Default guild ID for guild command registration and legacy channel fallback. |
| `DISCORD_GUILD_IDS` | Optional | `DISCORD_GUILD_ID` | Comma-separated guild IDs for immediate guild-scoped command registration. |
| `REGISTER_COMMANDS_GLOBAL` | Optional | `false` | Set to `true` to register global commands and clear configured guild-scoped copies. Global propagation can take up to one hour. |
| `NODEWAR_CHANNEL_ID` | Optional | None | Legacy/default Discord announcement channel fallback for `DISCORD_GUILD_ID`. `/set-nwchannel` persists per-guild channels. |
| `NODEWAR_ROLE_ID` | Optional | None | Default role ping for scheduled announcements and wizard defaults. |
| `OFFICER_ROLE_ID` | Optional | None | Role accepted by retained legacy posted-roster management handlers in addition to Administrators. |

## Application

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PUBLIC_BASE_URL` | Optional | `http://localhost:3000` | Public web origin used for logs, OAuth callback fallback, and Discord embed links. |
| `PORT` | Optional | `3000` | Express listen port. |
| `DATA_FILE` | Optional | `./data/events.json` | JSON event store path when Supabase event storage is not configured. |
| `TIMEZONE` | Optional | `Asia/Singapore` | IANA timezone used for scheduler calendar decisions and displayed scheduling context. |
| `NODEWAR_POST_TIME` | Optional | `22:15` | Default announcement time in 24-hour `HH:mm`. |
| `NODEWAR_START_TIME` | Optional | `21:00` | Default war start time in 24-hour `HH:mm`. |

## BDO Integrations

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BDO_COMMUNITY_API_BASE_URL` | Optional | `https://api.cutepap.us/community/v1` | Base URL for the BDO REST API community endpoint used for adventurer and guild lookups. |
## Gemini Stats OCR

Gemini is optional. When `GEMINI_API_KEY` is set, score screenshot uploads and rescans try Gemini first, then fall back to local Tesseract OCR if Gemini fails or the app-side quota is exhausted.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Optional | None | Server-only Google AI Studio API key for Gemini vision extraction. Never expose it to browser code. |
| `GEMINI_MODEL` | Optional | `gemini-2.5-flash-lite` | Gemini model used for scoreboard extraction. |
| `GEMINI_USER_MINUTE_LIMIT` | Optional | `3` | Maximum Gemini OCR attempts per Discord user per minute before falling back to Tesseract. |
| `GEMINI_GUILD_DAY_LIMIT` | Optional | `50` | Maximum Gemini OCR attempts per Discord server per day before falling back to Tesseract. The app resets this counter by Pacific date to roughly match Gemini RPD resets. |

## Supabase

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Optional | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended for production | None | Server-only key used for RLS-protected event and session tables. Never expose it to a browser. |
| `SUPABASE_ANON_KEY` | Optional fallback | None | Event-store fallback key when no service role key is configured. |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional fallback | None | Accepted URL alias. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional fallback | None | Accepted event-store key alias. |

Event storage switches to Supabase when a URL and any accepted Supabase key are present. Persistent web sessions require both the URL and `SUPABASE_SERVICE_ROLE_KEY`; otherwise dashboard sessions use process memory.

## Emoji Variables

All emoji variables are optional. Values can be Unicode or raw Discord emoji strings such as `<:shai:123456789012345678>`.

| Variable | Aliases | Purpose |
| --- | --- | --- |
| `EMOJI_MAINBALL` | `EMOJI_FFA` | Mainball/FFA group |
| `EMOJI_DEFENSE` | `EMOJI_DEF` | Defense group |
| `EMOJI_ZERKER` | `EMOJI_ZERK` | Zerker group |
| `EMOJI_SHAI` | None | Shai group |
| `EMOJI_BENCH` | None | Bench group |
| `EMOJI_TENTATIVE` | None | Tentative response |
| `EMOJI_ABSENCE` | None | Absence response |
| `EMOJI_FLEX` | None | Flex group |
| `EMOJI_CANNON` | None | Cannon group |
| `EMOJI_RANGER` | None | Archer/Ranger group |
| `EMOJI_WIZWITCH` | None | Wiz/Witch group |
| `EMOJI_SHOTCALLER` | None | Shotcaller group |
| `EMOJI_DATE` | None | Embed date label |
| `EMOJI_SIGNED` | None | Embed signup count label |
| `EMOJI_TIME` | None | Embed time label |
| `EMOJI_STATUS` | None | Embed status label |
| `EMOJI_WHEN` | None | Embed relative-time label |

## Supabase SQL

```sql
create table if not exists public.nodewar_store (
  key text primary key,
  data jsonb not null default '{"events":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.nodewar_store (key, data)
values ('default', '{"events":[]}'::jsonb)
on conflict (key) do nothing;

alter table public.nodewar_store enable row level security;

create table if not exists public.web_sessions (
  token_hash text primary key,
  data jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists web_sessions_expires_at_idx
  on public.web_sessions (expires_at);

alter table public.web_sessions enable row level security;
```

Use `SUPABASE_SERVICE_ROLE_KEY` in the server process when row level security is enabled.
