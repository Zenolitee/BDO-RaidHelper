# NW Helper

A Discord bot and web roster page for Black Desert Online Node War and Siege planning.

## First slice

- `/event create` opens a private interactive setup wizard.
- `/event create-today` opens a one-time setup wizard for today's Node War.
- `/event create-test` creates a simple test announcement using only day and announcement time.
- `/event set-slots` adjusts DEF, ZERK, and SHAI caps after creation; Mainball/FFA is recalculated.
- `/event edit` opens a private wizard for day and slot changes.
- Discord signup happens through DEF, ZERK, SHAI, FFA, and Leave buttons on the event message.
- `/event list` shows upcoming events.
- `/event show` shows event information.
- `/event delete` deletes an event.
- `/event repost` reposts an event immediately to the configured or selected roster channel.
- The web page shows events as Mainball/FFA, Defense, Zerker, Shai, and Bench columns.
- The web dashboard supports Discord OAuth login, administrator server selection, one-time raid creation, and linked roster allocation sliders.
- Web raid creation loads channels and roles from the selected Discord server, requires a roster channel, and supports multiple optional ping roles.
- One-time web raids select one weekday. Weekly web schedules can select multiple weekdays and create an independent fresh roster for each day.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID`.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Register slash commands for your test guild:

   ```bash
   npm run register:commands
   ```

5. Start the bot and web server:

   ```bash
   npm run dev
   ```

Open `http://localhost:3000` for the roster dashboard.

The dashboard stylesheet is authored in `src/styles/input.css` and compiled with the Tailwind CLI. Both `npm run dev` and `npm run build` regenerate `src/public/styles.css`.

## Supabase storage

The bot uses JSON storage unless Supabase is configured. To store events in Supabase, create the table below in the Supabase SQL editor, then add these values to `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_ANON_KEY` are accepted as fallback names, but `SUPABASE_SERVICE_ROLE_KEY` is recommended for the bot process.

SQL:

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

The private dashboard stores a SHA-256 hash of its opaque session cookie in `web_sessions`. This keeps Discord logins active across Railway restarts without storing the raw browser token or Discord OAuth access token. Use `SUPABASE_SERVICE_ROLE_KEY` for the bot process so the server can access the RLS-protected session table.

## Discord values to collect

Use the Discord Developer Portal: https://discord.com/developers/applications

- `DISCORD_CLIENT_ID`: Open your application, then `General Information`, then copy `Application ID`.
- `DISCORD_TOKEN`: Open your application, then `Bot`, then copy or reset the token. Keep this private. If it is pasted into chat or committed, reset it immediately.
- `DISCORD_GUILD_ID`: In Discord, enable `User Settings > Advanced > Developer Mode`, right-click your server, then `Copy Server ID`.
- `DISCORD_GUILD_IDS`: Optional comma-separated server IDs for instant slash-command registration in more than one server.
- `REGISTER_COMMANDS_GLOBAL`: Set to `true` to register commands globally instead of per server. Global commands can take up to 1 hour to appear.
- Bot invite: In the Developer Portal, open `OAuth2 > URL Generator`. Select scopes `bot` and `applications.commands`. Add permissions `Send Messages`, `Use Slash Commands`, `Embed Links`, `Read Message History`, and `View Channels`, then open the generated URL.
- `PUBLIC_BASE_URL`: Use `http://localhost:3000` for local testing. For guild members to open web roster links, use a deployed URL or a tunnel URL such as Cloudflare Tunnel/ngrok.
- `TIMEZONE`: Timezone used by the scheduler. Default is `Asia/Singapore`.
- `DISCORD_CLIENT_SECRET`: OAuth2 client secret used by the private web dashboard.
- `DISCORD_REDIRECT_URI`: OAuth2 callback URL. Add the same URL in the Discord Developer Portal. Defaults to `http://localhost:3000/auth/discord/callback`.

For the private web dashboard, open the Discord Developer Portal OAuth2 settings, add the redirect URI, and set `DISCORD_CLIENT_SECRET`. The dashboard requests `identify guilds` and only shows administrator servers shared with the bot. Open an event and select `Edit raid` to update weekly raid days, announcement time, and roster allocation. Increasing Defense, Zerker, Shai, or a custom role automatically reduces Mainball/FFA. Custom roles can store a Unicode emoji, an alias such as `:mage:`, or a raw Discord emoji value such as `<:name:123456789>`.
- `NODEWAR_POST_TIME`: Daily auto-post time in `HH:mm`. Default is `22:15`, calculated in `TIMEZONE`.
- `NODEWAR_START_TIME`: Node War start time in `HH:mm`. Default is `21:00`.
- `NODEWAR_CHANNEL_ID`: Channel where the scheduler and `/event repost` publish roster posts.
- `NODEWAR_ROLE_ID`: Role pinged by scheduled posts, for example `<@&ROLE_ID>`.
- `OFFICER_ROLE_ID`: Optional role allowed to edit, close, delete, and repost events.
- The website home page includes an `Invite to Server` button. Its invite URL requests `Use External Emojis` and `Mention Everyone, @here, and All Roles` along with the bot's normal message/embed permissions.

It is fine to paste the client ID and guild ID here. Do not paste the bot token here unless you plan to reset it afterward; put it directly in `D:\NW-Helper\.env`.

## Node War presets

The bot uses the current NA/EU Occupation Mode Node War participant table:

| Tier | Territory group | Sunday | Monday | Tuesday | Wednesday | Thursday | Friday |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Tier 1 | Balenos/Serendia | 30 | 25 | 30 | 25 | 30 | 25 |
| Tier 2 | Calpheon/Ulukita | 50 | 40 | 40 | 40 | 40 | 50 |
| Tier 3 | Valencia/Edania | 75 | 55 | 55 | 75 | 55 | 75 |

Create an event through the private wizard. Creation stores the event only; the Discord roster post is sent later when the selected announcement time is reached.

Weekly rosters use one persistent raid ID. After each completed war, the previous Discord post remains as history while the same raid card rotates to the next selected weekday with a day-correct title and empty signup list. The web dashboard can pause a raid with `Status` or disable future rotation with `Auto repost`.
One-time raids switch to inactive immediately after their announcement is posted. Their Discord signup message remains usable until the war ends.
Node War is treated as a one-hour event from `21:00` to `22:00` GMT+8, so the next-day roster can announce at `22:15`.

```bash
/event create
```

Create a one-time event for today's war. This uses today's weekday automatically and also waits for today's selected announcement time:

```bash
/event create-today
```

Create a quick ping test:

```bash
/event create-test day:Monday time:22:15
```

At announcement time, the bot posts the normal Discord roster embed with configured custom emojis inline. The message keeps signup buttons below the embed:

- `DEF`, `ZERK`, `SHAI`, and `FFA`: sign up or move to that group.
- `Leave`: remove your signup.
- `Refresh` and `Close`: officer/admin controls.

For Tier 1 events, default slots are Defense 5, Zerker 2, Shai 2, and Mainball/FFA gets the remaining capacity. If a role is full and someone clicks its signup button, the bot places them in `Bench` automatically.

Then tune the roster split:

```bash
/event set-slots id:<event_id> def:5 zerk:2 shai:2
```

Edit event details:

```bash
/event edit id:<event_id>
/event recurring id:<event_id> enabled:false
```

## Class emojis

Unicode emojis work immediately in `.env`, for example `EMOJI_MAINBALL=⚔️`.

For BDO class icons, upload small class images or emotes to the Discord server. In Discord, type the emoji with a backslash before it, such as `\:shai:`. Copy the output format, such as `<:shai:123456789012345678>`, then paste it into `.env`:

```env
EMOJI_MAINBALL=<:Striker_icon:1509992261889560626>
EMOJI_DEFENSE=<:Warrior_icon:1509984324689334362>
EMOJI_ZERKER=<:Berserker_icon:1509984343614029874>
EMOJI_SHAI=<:shai:1509984302149140520>
EMOJI_BENCH=⏳
```

Aliases are supported for older env files: `EMOJI_FFA` maps to Mainball/FFA, `EMOJI_DEF` maps to Defense, and `EMOJI_ZERK` maps to Zerker.
