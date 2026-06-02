# NW Helper

NW Helper is a Discord bot and web dashboard for planning Black Desert Online Node War rosters. It creates scheduled raid announcements, lets guild members sign up from Discord buttons, tracks specialist slot limits, and gives server administrators a browser-based view of raid schedules and rosters.

## Project Overview

NW Helper is intended for guild administrators, officers, and members:

- Administrators create, edit, list, repost, and delete Node War events.
- The interaction router retains officer-aware legacy handlers for roster refresh and close actions when `OFFICER_ROLE_ID` is configured.
- Guild members sign up for roster groups directly from a Discord announcement.
- Administrators can log in to the web dashboard with Discord, choose a shared server, and manage raids for that server.

Main features:

- One-time and weekly recurring Node War rosters.
- Tier and weekday capacity presets for Tier 1, Tier 2, and Tier 3 wars.
- Discord creation and editing wizards with buttons, select menus, and modals.
- Mainball/FFA, Defense, Zerker, Shai, Bench, and optional custom roster groups.
- Automatic overflow to Bench when a requested group is full.
- A minute-based scheduler with restart recovery and duplicate-post prevention.
- JSON-file storage for local use or Supabase storage for persistent deployments.
- Discord OAuth dashboard login with administrator-only server selection.

## Architecture

The application starts from `src/index.ts` and runs the Discord bot and Express web server in one Node.js process.

| Area | Responsibility |
| --- | --- |
| Discord bot | `src/bot.ts` handles slash commands, buttons, selects, modals, roster posting, and the scheduler. |
| Scheduler | `src/bot.ts` runs once at startup and every 60 seconds to close expired raids, roll weekly schedules, post due announcements, and create configured automatic Tier 1 announcements. |
| Web dashboard | `src/web.ts` serves public raid pages and authenticated administrator management pages. |
| Storage layer | `src/store.ts` implements serialized JSON storage and roster mutations. `src/supabase-store.ts` overrides persistence for Supabase. |
| Authentication | `src/web.ts` uses Discord OAuth. `src/web-session-store.ts` stores opaque session tokens in memory or stores SHA-256 token hashes in Supabase. |
| Event system | A `WarEvent` in `src/types.ts` stores schedule, capacity, groups, signups, delivery settings, Discord message IDs, and lifecycle flags. |

See [docs/architecture.md](docs/architecture.md) for file responsibilities and end-to-end flows.

## Installation

### Requirements

- Node.js 20 or newer.
- npm.
- A Discord application with a bot token and application ID.
- A Discord server where the bot is installed.
- Optional: a Supabase project for persistent production storage.

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`.

3. Set at least:

   ```env
   DISCORD_TOKEN=
   DISCORD_CLIENT_ID=
   DISCORD_GUILD_ID=
   PUBLIC_BASE_URL=http://localhost:3000
   ```

4. Register commands:

   ```bash
   npm run register:commands
   ```

5. Start local development:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000`.

The web dashboard requires `DISCORD_CLIENT_SECRET` and a matching `DISCORD_REDIRECT_URI`. Scheduled posting requires a channel set with `/set-nwchannel` or `NODEWAR_CHANNEL_ID`.

### Build

```bash
npm run typecheck
npm run build
npm start
```

`npm run build` compiles `src/styles/input.css` into `src/public/styles.css`, then compiles TypeScript into `dist/`.

See [docs/configuration.md](docs/configuration.md) for every environment variable and [docs/deployment.md](docs/deployment.md) for production setup.

## Commands

All registered slash commands require Discord server Administrator permission. Signup buttons are available to guild members. Legacy management handlers use Administrator permission or `OFFICER_ROLE_ID` where noted.

| Command | Purpose |
| --- | --- |
| `/event create` | Open the private Node War setup wizard. |
| `/event create-today` | Open a one-time wizard for today's Node War preset. |
| `/event create-test day:<day> time:<HH:mm> ping-role:<role>` | Create a scheduled Tier 1 test announcement. |
| `/event edit id:<event_id>` | Open the private edit wizard. |
| `/event recurring id:<event_id> enabled:<true|false>` | Enable or disable weekly recurrence. |
| `/event set-slots id:<event_id> def:<n> zerk:<n> shai:<n>` | Update specialist capacities and recalculate Mainball/FFA. |
| `/event repost id:<event_id>` | Immediately publish a new roster message. |
| `/event delete id:<event_id>` | Delete an event from storage. |
| `/event list` | List up to ten open events for the current server. |
| `/event show id:<event_id>` | Show a private event preview with Post now, Edit, and Delete buttons. |
| `/set-nwchannel` | Save the current text channel as this server's announcement channel. |

The following names are not registered slash commands in the current implementation:

| Requested name | Current way to perform the action |
| --- | --- |
| `/event rename` | Titles are generated from tier, weekday, territory group, and capacity. There is no standalone rename command. |
| `/event set-time` | Use `/event edit` and choose `Time to post`. The war start time comes from `NODEWAR_START_TIME`. |
| `/event close` | No current slash command or rendered button exposes manual closing. One-time events close automatically after the war window. |

See [docs/commands.md](docs/commands.md) for parameters, permissions, examples, and wizard behavior.

## Event Lifecycle

### Event Creation

`/event create` opens a private wizard. The administrator selects a tier, one or more weekdays, one-time or weekly recurrence, announcement time, ping roles, specialist slots, and an announcement channel. The wizard stores one event representing the next selected raid date. The web dashboard provides the same core scheduling controls and supports optional custom roster groups.

`/event create-today` uses today's weekday and forces a one-time schedule. `/event create-test` creates a Tier 1 test event for the selected weekday and scheduled announcement time.

### Scheduling And Posting

Each event stores its war date and time plus an announcement date and time. Normal wizard and web events announce on the day before the war. The scheduler posts due announcements, records the Discord message location and `announcedAt`, and marks one-time schedules inactive after posting.

`/event repost` and the event preview's `Post now` button publish immediately. Reposting creates a new Discord message and updates the stored message reference.

### Signups

Members click `FFA`, `DEF`, `ZERK`, or `SHAI` on the Discord message. A member has one response and clicking another option moves it. `Tentative` and `Absence` record non-roster responses without consuming capacity. `Sign off` removes the response. When a requested roster group is full, the member is assigned to Bench and the requested group is retained for display.

After a deployment, the bot edits tracked open Discord roster messages in place so ongoing events receive newly rendered buttons and columns without clearing existing responses.

### Editing

`/event edit` can change selected days, announcement time, composition, and repeat mode. Updating slots or schedule details refreshes the current Discord message when one exists. If the raid date changes, signups are cleared for the fresh roster.

### Closing

One-time events close automatically one hour after their configured start time. Weekly schedules close the previous roster display, then reuse the same event ID for the next selected day with cleared signups. The current UI does not expose a manual close control.

## Roster System

The standard Tier 1 layout is:

| Group | Behavior |
| --- | --- |
| Mainball/FFA | Receives the remaining roster capacity after specialist slots are allocated. Discord button label: `FFA`. |
| Defense | Specialist group with a configurable cap. Discord button label: `DEF`. |
| Zerker | Specialist group with a configurable cap. Discord button label: `ZERK`. |
| Shai | Specialist group with a configurable cap. Discord button label: `SHAI`. |
| Tentative | Non-roster response that does not consume capacity. Discord button label: `Tentative`. |
| Absence | Non-roster response that does not consume capacity. Discord button label: `Absence`. |
| Bench | Overflow destination. It is not directly selectable and has no active-roster cap. |

Tier 1 defaults are Defense `5`, Zerker `2`, and Shai `2`. Mainball/FFA is:

```text
total capacity - all non-Mainball, non-Bench group capacities
```

Tier 2 and Tier 3 presets start with Mainball/FFA, Defense, Flex, and Bench. The web dashboard can add enabled custom roles from supported presets or validated custom role inputs. When capacities shrink, overflowing existing signups are moved to Bench in stored order.

## Scheduler

- Runs immediately when the Discord client becomes ready.
- Runs every 60 seconds afterward.
- Uses `TIMEZONE` for scheduler calendar decisions and announcement matching.
- Uses `NODEWAR_POST_TIME` as the default announcement time.
- Uses `NODEWAR_START_TIME` as the default war start time.
- Treats a war as one hour long.
- Posts overdue unannounced events after a restart.
- Skips events with `announcedAt`, closed events, and inactive events.
- Rolls weekly events into the next selected weekday using the same event ID and a fresh signup list.
- Uses `createEventIfMissing` for the configured automatic Tier 1 creation path to avoid duplicate event records for the same guild, kind, tier, day, and date.

## Discord Integration

### Buttons

Posted event messages include member signup buttons. `/event show` includes Administrator-only `Post now`, `Edit`, and `Delete` controls. The interaction router retains handlers for older `Refresh` and `Close` custom IDs, but current renderers do not emit those buttons.

### Modals And Select Menus

Creation and editing use ephemeral Discord interactions:

- Select menus choose tier, weekdays, recurrence, roles, and channels.
- Modals collect custom announcement time and slot counts.
- Wizard state is stored in memory and expires after ten minutes.
- Only the user who started a wizard can operate it.

### Permissions

- Slash commands are registered with Administrator default permissions and re-check Administrator access at runtime.
- `/set-nwchannel` must run in a guild text channel.
- Signup and sign-off buttons validate that the event belongs to the Discord server where the button was clicked.
- Legacy `Post now`, `Refresh`, and `Close` interaction handlers allow Administrators or members with `OFFICER_ROLE_ID`. In the current UI, `/event show` is Administrator-only and renders `Post now`.

## Web Dashboard

The dashboard is served from the same process as the bot.

### Server Selection

Discord OAuth requests `identify guilds`. After login, the dashboard shows only servers where:

- The user has Discord Administrator permission.
- The bot is also installed.

### Dashboard

The selected server dashboard lists its raid schedules, signup counts, active state, and auto-repost state. Administrators can create raids, open detail pages, manage schedules, toggle status, toggle weekly auto repost, or delete events.

### Raid Detail Pages

`/events/:id` shows a public roster view for a known event ID. Authenticated administrators get management controls. `/events/:id/edit` is restricted to administrators of the event's Discord server.

### Raid Management

Web creation and editing support tier, selected days, recurrence, announcement time, delivery channel, ping roles, and roster allocation. Management writes to the same event store used by Discord and refreshes an existing Discord post when possible.

## Storage And Authentication

Without Supabase configuration, the bot stores JSON at `DATA_FILE`. Writes are queued and use a temporary file followed by rename.

With `SUPABASE_URL` and a Supabase key, events are stored as JSON in `public.nodewar_store`. With `SUPABASE_SERVICE_ROLE_KEY`, dashboard sessions are stored in `public.web_sessions`; otherwise sessions are in memory and are lost on restart. The session cookie stores an opaque random token. Supabase stores only its SHA-256 hash.

See [docs/security.md](docs/security.md) for the security model and [docs/configuration.md](docs/configuration.md) for the required SQL.
