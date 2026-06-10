# NW Helper Bot Summary

## Executive Summary

NW Helper is a Black Desert Online Node War management bot and web dashboard. It helps Discord guilds schedule Node War events, post roster signup messages, collect player responses, manage weekly recurrence, track attendance, and review uploaded scoreboard statistics.

The application runs as one Node.js process with two main surfaces:

- A Discord bot built with `discord.js` for slash commands, buttons, modals, select menus, scheduled roster posting, and signup interactions.
- An Express web dashboard for Discord-authenticated server administrators and members to manage raids, inspect rosters, upload scoreboards, and analyze player statistics.

The project is written in TypeScript and can store data locally in JSON files or persist production data in Supabase.

## What We Built

### Discord Node War Bot

The bot supports administrator-driven Node War planning from Discord:

- `/event create` starts a private setup wizard for a Node War event.
- `/event create-today` creates a one-time event for the current day.
- `/event create-test` creates a scheduled Tier 1 test event.
- `/event edit` updates schedule, recurrence, announcement time, and roster composition.
- `/event recurring` toggles weekly recurrence.
- `/event set-slots` updates Tier 1 specialist capacities.
- `/event repost` immediately publishes a roster announcement.
- `/event delete` removes an event from storage.
- `/event list` and `/event show` provide private admin views.
- `/set-nwchannel` saves the announcement channel for a Discord server.

Posted Discord announcements include signup buttons for roster groups such as FFA, Defense, Zerker, Shai, Tentative, Absence, and Sign off. The bot keeps one response per user, moves users between groups, and sends overflow signups to Bench when a target group is full.

### Scheduler And Event Lifecycle

The scheduler runs when the Discord client becomes ready and then repeats every 60 seconds. It:

- Posts due and overdue scheduled announcements.
- Prevents duplicate scheduled posts by checking persisted post state.
- Closes one-time events after the Node War window.
- Rolls weekly events to the next configured day.
- Clears signups for the next weekly roster.
- Refreshes live Discord roster messages when web or bot changes affect the event.

Scheduler behavior is timezone-aware through the `TIMEZONE` environment variable. Default announcement and war start times come from `NODEWAR_POST_TIME` and `NODEWAR_START_TIME`.

### Web Dashboard

The web dashboard lets Discord-authenticated users manage and inspect guild data from a browser.

Main dashboard features include:

- Discord OAuth login with `identify guilds`.
- Server chooser showing only shared servers where the bot is installed.
- Administrator-only raid creation and editing.
- Public event detail pages for known event IDs.
- Member-oriented read-only raid and roster views.
- Stats dashboard per Discord server.
- Navigation and home/dashboard redesigns for easier server switching.

The dashboard uses CSRF tokens for mutating forms and checks Discord administrator permissions before allowing management actions.

### Roster And Attendance System

The roster system supports:

- One-time and weekly recurring raids.
- Tier-based presets for Tier 1, Tier 2, and Tier 3.
- Configurable total capacity and specialist role slots.
- Mainball/FFA capacity recalculation based on specialist slots.
- Bench overflow behavior.
- Tentative and Absence responses that do not consume active roster capacity.
- Live refresh of posted Discord messages after changes.
- Attendance-focused dashboard cards and roster summaries.
- Drag-and-drop role movement in the web roster interface.

### Scoreboard Stats And OCR

The project also includes a scoreboard upload and analytics feature:

- Administrators can upload BDO Node War scoreboard screenshots.
- The server extracts visible player rows into structured score data.
- Gemini vision extraction is used when `GEMINI_API_KEY` is configured and quota allows it.
- Tesseract.js is the local fallback OCR engine.
- Uploaded screenshots can be previewed.
- Extracted reports can be edited manually.
- Reports can be rescanned.
- Player names can be renamed across matching score rows.
- Tables can be sorted in the browser.
- The stats dashboard calculates raw totals, leadership views, support analysis, attendance cards, result colors, and impact scores.

Score reports store player metrics such as kills, deaths, damage dealt, damage taken, crowd controls, healing, ally support, structure damage, siege-related stats, special kills, time alive, and total war time.

## Framework And Technology Stack

| Area | Technology |
| --- | --- |
| Runtime | Node.js 20+ |
| Language | TypeScript |
| Module format | Native ES modules |
| Discord integration | `discord.js` v14 |
| Web server | Express |
| Styling | Tailwind CSS CLI plus custom CSS |
| Local dev runner | `tsx watch` |
| Build | TypeScript compiler (`tsc`) |
| Local storage | JSON files under `data/` |
| Production storage | Supabase database and storage |
| OAuth | Discord OAuth2 |
| Sessions | In-memory sessions or Supabase-backed hashed session tokens |
| OCR | Gemini API when configured, Tesseract.js fallback |
| Upload handling | Multer |
| IDs | `nanoid` and UUIDs |
| QA smoke checks | Custom Node script in `scripts/qa-web-smoke.mjs` |

## Main Source Files

| File | Purpose |
| --- | --- |
| `src/index.ts` | Application entry point. Starts storage, web app, and Discord client. |
| `src/config.ts` | Environment variable parsing and defaults. |
| `src/bot.ts` | Discord client, command routing, wizards, interactions, scheduler, posting, refresh logic. |
| `src/commands.ts` | Slash command definitions. |
| `src/register-commands.ts` | Guild or global Discord command registration. |
| `src/store.ts` | JSON event store, event validation, serialized mutations, roster capacity logic. |
| `src/supabase-store.ts` | Supabase event persistence adapter. |
| `src/web.ts` | Express routes, OAuth, dashboard rendering, CSRF checks, stats routes, management handlers. |
| `src/web-session-store.ts` | In-memory and Supabase session persistence. |
| `src/render.ts` | Discord embeds and button components. |
| `src/nodewar-presets.ts` | Tier presets, weekday labels, default group layouts. |
| `src/emojis.ts` | Emoji configuration and labels. |
| `src/score-store.ts` | JSON and Supabase storage for scoreboard reports and uploaded images. |
| `src/score-ocr.ts` | Gemini and Tesseract scoreboard extraction. |
| `src/score-types.ts` | Score report and score row TypeScript contracts. |
| `src/styles/input.css` | Dashboard CSS source. |
| `src/public/styles.css` | Generated dashboard CSS served by Express. |

## Data Storage

NW Helper supports two storage modes.

Local JSON mode:

- Event data is stored in `DATA_FILE`, defaulting to `./data/events.json`.
- Score data is stored beside it in `data/scores.json`.
- Uploaded score images are stored under `data/score-images`.
- This mode is suitable for local development or one self-hosted process.

Supabase mode:

- Event storage uses the `nodewar_store` table.
- Dashboard sessions can use the `web_sessions` table.
- Score reports use `score_reports` and `score_rows`.
- Uploaded screenshots use the private `score-screenshots` storage bucket.
- Production should use `SUPABASE_SERVICE_ROLE_KEY` on the server because row level security is enabled.

Related SQL lives in:

- `docs/configuration.md` for event/session tables.
- `docs/supabase-score-schema.sql` for score reports, score rows, and screenshot storage.

## Environment Configuration

Important environment variables include:

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Bot token used to log in the Discord client. |
| `DISCORD_CLIENT_ID` | Discord application ID for command registration and OAuth. |
| `DISCORD_CLIENT_SECRET` | OAuth secret for dashboard login. |
| `DISCORD_REDIRECT_URI` | Discord OAuth callback URL. |
| `DISCORD_GUILD_ID` | Default development guild ID. |
| `DISCORD_GUILD_IDS` | Optional comma-separated guild IDs for command registration. |
| `REGISTER_COMMANDS_GLOBAL` | Registers commands globally when set to `true`. |
| `PUBLIC_BASE_URL` | Public web origin used for links and OAuth fallback. |
| `PORT` | Express listen port. |
| `DATA_FILE` | Local JSON event store path. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase key for production. |
| `TIMEZONE` | Scheduler timezone. |
| `NODEWAR_POST_TIME` | Default roster announcement time. |
| `NODEWAR_START_TIME` | Default war start time. |
| `NODEWAR_CHANNEL_ID` | Legacy/default announcement channel. |
| `NODEWAR_ROLE_ID` | Default ping role. |
| `OFFICER_ROLE_ID` | Optional officer role for retained legacy management handlers. |
| `GEMINI_API_KEY` | Optional Gemini key for scoreboard OCR. |
| `GEMINI_MODEL` | Gemini model name, defaulting to `gemini-2.5-flash-lite`. |
| `GEMINI_USER_MINUTE_LIMIT` | Per-user Gemini OCR rate limit. |
| `GEMINI_GUILD_DAY_LIMIT` | Per-server Gemini OCR daily limit. |
| `EMOJI_*` | Custom Unicode or Discord emoji values for groups and labels. |

## Tools And Scripts Used

Project scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Builds CSS and starts the TypeScript app in watch mode. |
| `npm run start` | Runs the compiled production app from `dist/index.js`. |
| `npm run build` | Builds CSS and compiles TypeScript. |
| `npm run build:css` | Compiles `src/styles/input.css` to `src/public/styles.css`. |
| `npm run qa:web` | Builds the app and runs the dashboard smoke test. |
| `npm run register:commands` | Registers Discord slash commands. |
| `npm run typecheck` | Runs TypeScript with `--noEmit`. |

Development and verification tools used in the project:

- npm for dependency and script execution.
- TypeScript compiler for build and type checking.
- Tailwind CLI for CSS generation.
- `tsx` for local TypeScript watch mode.
- A custom smoke test script for compiled web behavior.
- Git for version control and project history.
- Supabase SQL editor or migrations for production database setup.
- Discord Developer Portal for bot, OAuth, command, and redirect configuration.
- Railway or a similar Node host for deployment.

## Work Completed So Far

Based on the project source and commit history, the work completed includes:

- Built the original self-hosted BDO raid helper bot.
- Added Discord slash commands, setup wizards, roster posting, signup buttons, and role pings.
- Added overflow bench handling and one-time event expiry.
- Added event list, show, edit, delete, repost, and schedule management flows.
- Added a web roster manager with Discord OAuth.
- Redesigned the web raid dashboard and added delivery settings.
- Added scheduler rollover for weekly rosters and live posted-roster refresh after web edits.
- Added persistent weekly raid cards and one-hour Node War lifecycle behavior.
- Added persistent web sessions and centered dashboard layouts.
- Added attendance responses and live roster refresh.
- Added roster drag-and-drop role movement and widened current roster layouts.
- Added scoreboard screenshot OCR upload, rescanning, manual editing, preview, and player rename tools.
- Added Gemini OCR support with Tesseract fallback.
- Added sortable score tables, support analysis, leader analysis, result colors, attendance cards, and impact score tables.
- Added member views, server choosers, dashboard navigation improvements, and home page redesigns.
- Added documentation for architecture, commands, configuration, deployment, security, Supabase score schema, and project audits.

## Security And Permission Model

The bot and dashboard use several protections:

- Slash commands require Discord Administrator permission.
- Dashboard management actions require a Discord-authenticated session and server administrator access.
- Mutating dashboard forms require CSRF validation.
- Sessions are stored as opaque HTTP-only cookies.
- Supabase session storage stores SHA-256 token hashes instead of raw tokens.
- Score uploads are limited to image MIME types and bounded upload sizes.
- Server secrets stay in environment variables and should not be committed.
- Supabase production usage should rely on the service-role key only on the server.

## Deployment Summary

Local development:

```bash
npm install
npm run register:commands
npm run dev
```

Production build:

```bash
npm run typecheck
npm run build
npm start
```

For Railway or another Node host:

- Set environment variables in the hosting dashboard.
- Use `npm run build` as the build command.
- Use `npm start` as the start command.
- Set `PUBLIC_BASE_URL` to the deployed HTTPS URL.
- Set `DISCORD_REDIRECT_URI` to `${PUBLIC_BASE_URL}/auth/discord/callback`.
- Use Supabase for persistent production storage.
- Keep a single replica when using JSON storage.

## Current Limitations And Notes

- JSON storage is intended for one process only. Supabase is required before scaling horizontally.
- Discord command registration must be rerun when slash command definitions change.
- Global Discord command registration can take up to one hour to propagate.
- Wizard state and OAuth state are process-local and reset on restart.
- Manual close controls are not currently exposed in registered slash commands or rendered dashboard controls.
- Scoreboard OCR should be reviewed by an administrator because screenshots can be noisy and extraction may need manual correction.
- Gemini OCR is optional and rate-limited by app-side quotas before falling back to Tesseract.

## Existing Documentation

More detailed project documentation is available in:

- `README.md`
- `docs/architecture.md`
- `docs/commands.md`
- `docs/configuration.md`
- `docs/deployment.md`
- `docs/security.md`
- `docs/supabase-score-schema.sql`
- `docs/refactor-report.md`
- `docs/documentation-audit.md`
- `docs/dead-code-report.md`
