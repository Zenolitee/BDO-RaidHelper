# Guild Boss Raid (GBR) Feature Design

## Overview

Add a new event type "Guild Boss Raid" (GBR) to the NW-Helper bot. GBR is a notification-only event — no signup/attendance tracking. Members are informed of the boss order and event time via a Discord embed announcement.

## Data Model

### WarEvent Type Extension

**File:** `src/types.ts`

Add `"gbr"` to the `kind` union:

```ts
kind: "nodewar" | "siege" | "gbr"
```

### New GBR-Specific Fields

Add to the `WarEvent` interface:

```ts
bossOrder?: string[]  // Array of 5 boss keys in kill order
```

**Default boss order:** `["org", "mudster", "ferrid", "moghulis", "khan"]`

### Boss Definitions

| Key | Display Name | Image File |
|-----|-------------|------------|
| `khan` | Khan | `/gbr/khan.jpg` |
| `ferrid` | Ferrid | `/gbr/ferrid.png` |
| `mudster` | Mudster | `/gbr/mudster.png` |
| `moghulis` | Moghulis | `/gbr/moghulis.jpg` |
| `org` | Org | `/gbr/org.jpg` |

### Boss Initials Mapping

| Boss | Initial |
|------|---------|
| Khan | K |
| Ferrid | F |
| Mudster | MU |
| Moghulis | MO |
| Org | O |

### Reused Fields

GBR events reuse existing `WarEvent` fields:
- `title` — Auto-generated as "Guild Boss Raid - [Day]"
- `date` — Event date
- `time` — Boss start time
- `recurrence` — "once" or "weekly"
- `repeatDays` — Array of selected days
- `announcementTime` — When to post the announcement
- `timezone` — Timezone for the event
- `announcementChannelId` — Channel chosen by creator
- `announcementRoleIds` — Roles to ping
- `guildId` — Guild ID
- `createdBy` — User who created the event

### Fields NOT Used for GBR

- `tier` — No tier system for GBR
- `capacity` — No slot tracking
- `groups` — No roster groups
- `roster` — No signup tracking

## Web Create Page

### Route

`GET /create?guild={id}&type=gbr`

### Layout

Four panels in a horizontal row (compact, centered):

```
[Schedule] [Boss Order] [Delivery] [Live Preview]
```

Column widths: 385px | 420px | 330px | 530px (centered, max-width 1720px)

### Panel 01: Schedule

Fields:
- **Repeat** — Dropdown: Once / Weekly
- **Announce At** — Time input (default: config.NODEWAR_POST_TIME)
- **Boss Time** — Time input (default: config.NODEWAR_START_TIME)
- **Timezone** — Dropdown (TIMEZONE_OPTIONS)
- **Pick a day for GBR** — Day checkbox buttons (Mon-Sun), single letter labels

### Panel 02: Boss Order

- Vertical list of 5 draggable cards
- Each card shows: number (1-5), boss image (48x48), boss name, drag handle
- Drag-and-drop reordering updates the number and preview live
- Default order: Org, Mudster, Ferrid, Moghulis, Khan

### Panel 03: Delivery

- **Channel** — Dropdown of guild channels (user picks per event)
- **Ping Roles** — Checkboxes for available roles

### Panel 04: Live Preview

Discord embed mockup that updates in real-time:
- Bot avatar + "Athena" + "BOT" tag + timestamp
- Embed with red left border
- Title: "Guild Boss Raid - [Day]"
- 2x2 grid: Date, Time, Announce, Status
- Boss Order section: initials chain + full names
- Countdown: "Starting in X hours"
- Footer: "Project Athena | Event GBR-{id}"

### Form Submission

**POST /create** with:
- `csrfToken`, `guildId`
- `type: "gbr"`
- `bossOrder` — JSON array of boss keys in order
- `recurrence`, `repeatDays`, `announcementTime`, `timezone`
- `bossTime` — The boss start time
- `announcementChannelId`, `announcementRoleIds`

## Discord Announcement Embed

### Embed Structure

```ts
{
  title: "Guild Boss Raid - Monday",
  color: 0xed4245,  // Red
  fields: [
    { name: "📅 Date", value: "**June 23, 2026**", inline: true },
    { name: "⏰ Time", value: "**9:00 PM**", inline: true },
    { name: "📢 Announce", value: "**10:15 PM**", inline: true },
    { name: "📊 Status", value: "**Open**", inline: true },
  ],
  description: "🐉 **BOSS ORDER**\n`O → MU → F → MO → K`\nOrg → Mudster → Ferrid → Moghulis → Khan\n\n⏱️ **Starting in 2 hours**",
  footer: { text: "Project Athena | Event GBR-001" },
  timestamp: createdAt
}
```

### No Signup Buttons

Unlike Node War events, GBR announcements have **no ActionRow buttons**. This is notification-only.

### Announcement Flow

1. Creator submits GBR event via web form
2. Event stored with `kind: "gbr"` and `bossOrder` array
3. Scheduler posts the embed to the chosen channel at `announcementTime`
4. Embed is refreshed if event is edited (no signup-driven refresh needed)

## Implementation Files

| File | Changes |
|------|---------|
| `src/types.ts` | Add `"gbr"` to `kind`, add `bossOrder` field |
| `src/web/templates/create-edit-page.ts` | Add `renderCreateGBRPage()` function |
| `src/web.ts` | Route `type=gbr` to GBR form, handle GBR POST |
| `src/render.ts` | Add `renderGBREventEmbed()` for GBR-specific embed |
| `src/bot/posting.ts` | Support posting GBR events (no buttons) |
| `src/web/templates/event-type-picker.ts` | Already defined, no changes needed |

## Visual Reference

See mockup: `compact-v9.html` in `.superpowers/brainstorm/gbr-session/content/`
