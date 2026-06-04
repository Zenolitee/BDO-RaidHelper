# Architecture Overview

NW Helper is a single-process TypeScript application. `src/index.ts` selects a storage adapter, starts the Express dashboard, and optionally logs in the Discord client. The Discord client starts the scheduler after it becomes ready.

## File Responsibilities

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Composition root for storage, bot startup, and web startup. |
| `src/config.ts` | Environment parsing and required Discord registration values. |
| `src/types.ts` | `WarEvent`, signup, group, recurrence, and settings contracts. |
| `src/commands.ts` | Discord slash-command builders for `/event` and `/set-nwchannel`. |
| `src/register-commands.ts` | Guild-scoped or global Discord command registration. |
| `src/bot.ts` | Discord client, interaction routing, wizards, permissions, scheduler, lifecycle transitions, posting, and refresh. |
| `src/store.ts` | Serialized event mutations, JSON persistence, validation, capacity balancing, overflow handling, and guild channel settings. |
| `src/supabase-store.ts` | Supabase-backed `EventStore` persistence override. |
| `src/web-session-store.ts` | In-memory or Supabase-backed dashboard session persistence. |
| `src/web.ts` | Express routes, Discord OAuth, dashboard HTML rendering, CSRF checks, Discord REST lookups, and web management handlers. |
| `src/render.ts` | Discord embed and signup-button rendering. |
| `src/emojis.ts` | Group labels, badges, emoji configuration, and Discord emoji CDN URL parsing. |
| `src/nodewar-presets.ts` | Tier capacities, group defaults, titles, and weekday labels. |
| `src/time-format.ts` | Shared 12-hour clock formatting for Discord and dashboard display text. |
| `src/styles/input.css` | Dashboard stylesheet source. |
| `src/public/styles.css` | Generated minified dashboard stylesheet served at `/assets/styles.css`. |
| `scripts/qa-web-smoke.mjs` | Build-output smoke test for public pages, headers, auth guards, roster rendering, refresh, scheduling, and weekly rollover. |

## Core Data Model

A `WarEvent` is the unit of scheduling and roster state. It contains:

- Identity: `id`, `kind`, `title`, `tier`, and creator metadata.
- War schedule: `day`, `repeatDays`, `date`, `time`, `timezone`, and `recurrence`.
- Delivery schedule: `announcementDate`, `announcementTime`, selected channel, and ping roles.
- Discord post state: `guildId`, `channelId`, `messageId`, and `announcedAt`.
- Roster state: `totalCapacity`, groups, signups, and requested overflow groups.
- Lifecycle state: `closed`, `active`, and `autoRepost`.

`EventStoreData` holds all events plus persisted per-guild announcement channel settings.

## Data Flow

1. Discord interactions and web handlers call `EventStore` mutation methods.
2. `EventStore` serializes operations through one promise queue.
3. JSON mode reads and atomically replaces `DATA_FILE`.
4. Supabase mode reads and upserts the `nodewar_store` row with key `default`.
5. Mutations validate event shape and capacity rules before persistence.
6. When an event already has a Discord message, callers request a message refresh.

## Event Flow

### Discord Creation

1. An Administrator runs `/event create` or `/event create-today`.
2. `bot.ts` stores a ten-minute in-memory wizard state keyed by user ID.
3. Select menus and modals collect tier, days, recurrence, announcement time, roles, specialist slots, and channel.
4. Confirmation creates one event for the next selected raid day.
5. The scheduler later posts the announcement when its delivery schedule is due.

### Web Creation

1. A Discord-authenticated Administrator selects a server shared with the bot.
2. `GET /create` fetches text channels and roles from Discord using the bot token.
3. `POST /create` validates CSRF, server membership, selected delivery values, schedule, and group allocation.
4. The handler stores a one-time or weekly event and redirects to its edit page.

### Signup

1. A guild member clicks a signup button on a posted message.
2. The button handler verifies the event belongs to the current Discord server.
3. `EventStore.signup` inserts or moves the member.
4. If the requested group is full, the member is stored in `bench` with `requestedGroup`.
5. The Discord message is edited with a freshly rendered embed and components.

## Scheduler Flow

`startNodeWarScheduler` runs `runNodeWarScheduler` immediately and every 60 seconds:

1. `closeExpiredOneTimeEvents` closes one-time raids one hour after their start time and refreshes posted messages.
2. `rollCompletedWeeklyEvents` closes the completed weekly post, then either deactivates it or rotates the same event ID into the next selected weekday with cleared signups.
3. `postDueScheduledEvents` posts due and overdue unannounced active events, records message IDs and `announcedAt`, and deactivates one-time schedules after posting.
4. At `NODEWAR_POST_TIME`, the legacy automatic path creates and immediately posts the next Tier 1 event for each persisted guild channel. `createEventIfMissing` prevents duplicate records for an equivalent guild, tier, day, and date.

Persisted `announcedAt`, message IDs, lifecycle flags, and event records make scheduled posting restart tolerant. Wizard state and OAuth login state remain process-local.

## Authentication Flow

1. `/auth/discord` creates a ten-minute OAuth state value and redirects to Discord with `identify guilds`.
2. The callback exchanges the code and fetches the user's profile and guild list.
3. The app also fetches the bot's guild list.
4. The session retains only guilds where the user is an Administrator and the bot is installed.
5. The browser receives an opaque `HttpOnly`, `SameSite=Lax` session cookie.
6. Session data lives in memory or in Supabase. Supabase stores the SHA-256 hash of the cookie token.

## Web Routes

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /` | Public, with optional login | Logged-out product home, logged-in multi-server home, and legacy selected-server dashboard via `?guild=`. |
| `GET /member` | Authenticated shared server member | Read-only member roster board across servers shared by the user and bot. |
| `GET /raids` | Authenticated shared server member | Aggregated raid board across all shared servers; no random server default. |
| `GET /servers` | Authenticated shared server member | Server chooser for opening a specific server dashboard. |
| `GET /guilds/:guildId/raids` | Authenticated shared server | Canonical raid dashboard for one server. |
| `GET /guilds/:guildId/stats` | Authenticated shared server | Canonical stats dashboard for one server. |
| `GET /auth/discord` | Public | Start Discord OAuth. |
| `GET /auth/discord/callback` | Public callback | Complete login and create a dashboard session. |
| `GET /logout` | Public | Delete the session and clear the cookie. |
| `GET /stats` | Authenticated, optional `?guild=` | Legacy stats picker or selected-server stats dashboard. |
| `GET /create` | Authenticated Administrator | Render raid creation. |
| `POST /create` | Authenticated Administrator plus CSRF | Create a raid. |
| `GET /events/:id` | Public for a known ID | Render roster detail. |
| `GET /events/:id/edit` | Authenticated Administrator | Render raid management. |
| `POST /events/:id/composition` | Authenticated Administrator plus CSRF | Update schedule and allocation. |
| `POST /events/:id/delete` | Authenticated Administrator plus CSRF | Delete a raid. |
| `POST /events/:id/status` | Authenticated Administrator plus CSRF | Activate or deactivate a raid. |
| `POST /events/:id/auto-repost` | Authenticated Administrator plus CSRF | Toggle weekly rollover. |
| `GET /api/events` | Denied | Server-scoped listing is intentionally unavailable. |
| `GET /api/events/:id` | Authenticated Administrator | Return one server-authorized event as JSON. |
