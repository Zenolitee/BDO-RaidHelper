# Guild Boss Raid (GBR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GBR event type with a web creation page (Schedule, Boss Order, Delivery, Preview panels) and a Discord notification embed with boss order.

**Architecture:** Extend `WarEvent` with `"gbr"` kind and `bossOrder` field. Create a new `renderCreateGBRPage()` template function. Add GBR-specific embed rendering. Route `type=gbr` through the existing web server.

**Tech Stack:** TypeScript, Express, discord.js EmbedBuilder, vanilla HTML/CSS/JS (no framework).

## Global Constraints

- Node.js + TypeScript project (`src/` directory)
- Existing CSS classes from `tokens.css`, `base.css`, `layout.css`, `components.css`
- discord.js for Discord embeds
- `nanoid` for ID generation
- Follow existing code patterns in `src/web/templates/create-edit-page.ts`

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/types.ts:39` | Modify | Add `"gbr"` to `kind` union, add `bossOrder` field |
| `src/gbr.ts` | Create | GBR constants: boss definitions, initials, default order |
| `src/web/templates/gbr-page.ts` | Create | `renderCreateGBRPage()` — the 4-panel create form |
| `src/web.ts:1218-1227` | Modify | Route `type=gbr` to GBR form |
| `src/web.ts:1241-1279` | Modify | Handle GBR POST submission |
| `src/render.ts` | Modify | Add `renderGBREventEmbed()` and `renderGBREventComponents()` |
| `src/bot/posting.ts:133-138` | Modify | Support GBR message payload (no buttons) |
| `src/web/templates/create-edit-page.ts:68` | Modify | Export `renderCreateGBRPage` from web.ts import |
| `src/web.ts:68` | Modify | Import `renderCreateGBRPage` |

---

### Task 1: Extend WarEvent type with GBR support

**Files:**
- Modify: `src/types.ts:39,40`

**Interfaces:**
- Consumes: None
- Produces: Updated `WarEvent` type with `"gbr"` kind and `bossOrder` field

- [ ] **Step 1: Add `"gbr"` to the kind union and add bossOrder field**

In `src/types.ts`, line 39, change:
```ts
kind: "nodewar" | "siege";
```
to:
```ts
kind: "nodewar" | "siege" | "gbr";
```

After line 48 (after `groups: GroupConfig[];`), add:
```ts
bossOrder?: string[];
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors — existing code is compatible since `bossOrder` is optional)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(gbr): add gbr kind and bossOrder field to WarEvent type"
```

---

### Task 2: Create GBR constants module

**Files:**
- Create: `src/gbr.ts`

**Interfaces:**
- Consumes: None
- Produces: `GBR_BOSSES`, `GBR_BOSS_INITIALS`, `DEFAULT_BOSS_ORDER`, `formatBossOrderInitials`, `formatBossOrderNames`

- [ ] **Step 1: Create src/gbr.ts with boss definitions**

```ts
export interface GbrBoss {
  key: string;
  name: string;
  image: string;
  initial: string;
}

export const GBR_BOSSES: GbrBoss[] = [
  { key: "khan", name: "Khan", image: "/gbr/khan.jpg", initial: "K" },
  { key: "ferrid", name: "Ferrid", image: "/gbr/ferrid.png", initial: "F" },
  { key: "mudster", name: "Mudster", image: "/gbr/mudster.png", initial: "MU" },
  { key: "moghulis", name: "Moghulis", image: "/gbr/moghulis.jpg", initial: "MO" },
  { key: "org", name: "Org", image: "/gbr/org.jpg", initial: "O" },
];

export const DEFAULT_BOSS_ORDER: string[] = ["org", "mudster", "ferrid", "moghulis", "khan"];

export const GBR_BOSS_MAP = new Map(GBR_BOSSES.map((b) => [b.key, b]));

export function formatBossOrderInitials(order: string[]): string {
  return order.map((key) => GBR_BOSS_MAP.get(key)?.initial ?? key).join(" → ");
}

export function formatBossOrderNames(order: string[]): string {
  return order.map((key) => GBR_BOSS_MAP.get(key)?.name ?? key).join(" → ");
}

export function buildGBRTitle(day: string): string {
  const label = day.charAt(0).toUpperCase() + day.slice(1);
  return `Guild Boss Raid - ${label}`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/gbr.ts
git commit -m "feat(gbr): add GBR boss constants and helper functions"
```

---

### Task 3: Create GBR web create page template

**Files:**
- Create: `src/web/templates/gbr-page.ts`

**Interfaces:**
- Consumes: `GBR_BOSSES`, `DEFAULT_BOSS_ORDER` from `src/gbr.ts`, `TIMEZONE_OPTIONS` from `src/timezone.ts`, `renderApp` from `layout.ts`, `renderDeliveryEditor` from `create-edit-page.ts`
- Produces: `renderCreateGBRPage()` function

- [ ] **Step 1: Create src/web/templates/gbr-page.ts**

```ts
import { escapeHtml } from '../utils.js';
import { renderApp } from './layout.js';
import { renderDeliveryEditor } from './create-edit-page.js';
import { GBR_BOSSES, DEFAULT_BOSS_ORDER } from '../../gbr.js';
import { TIMEZONE_OPTIONS } from '../../timezone.js';
import type { WebSession, GuildDeliveryOptions } from '../types.js';

export function renderCreateGBRPage(
  guildId: string,
  csrfToken: string,
  session: WebSession,
  deliveryOptions: GuildDeliveryOptions,
  configuredChannelId?: string
): string {
  const bossesJson = JSON.stringify(GBR_BOSSES);
  const defaultOrderJson = JSON.stringify(DEFAULT_BOSS_ORDER);

  const bossCards = DEFAULT_BOSS_ORDER.map((key, i) => {
    const boss = GBR_BOSSES.find((b) => b.key === key)!;
    return `
      <div class="gbr-boss-card" data-boss-key="${escapeHtml(boss.key)}" draggable="true">
        <span class="gbr-boss-num">${i + 1}</span>
        <img src="${escapeHtml(boss.image)}" alt="${escapeHtml(boss.name)}" class="gbr-boss-img" />
        <span class="gbr-boss-name">${escapeHtml(boss.name)}</span>
        <span class="gbr-boss-drag">⠿</span>
      </div>`;
  }).join("");

  const dayButtons = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    .map((d) => `<span class="gbr-day-btn" data-day="${d}">${d.slice(0, 3).toUpperCase()}</span>`)
    .join("");

  const content = `
    <div class="gbr-create-page">
      <form id="gbr-form" method="POST" action="/create">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
        <input type="hidden" name="guildId" value="${escapeHtml(guildId)}" />
        <input type="hidden" name="type" value="gbr" />
        <input type="hidden" name="bossOrder" id="boss-order-value" value="${escapeHtml(DEFAULT_BOSS_ORDER.join(","))}" />
        <input type="hidden" name="repeatDays" id="repeat-days-value" value="" />

        <div class="gbr-grid">
          <!-- Panel 01: Schedule -->
          <div class="gbr-panel">
            <div class="gbr-panel-head"><span class="gbr-panel-num">01</span> Schedule</div>
            <div class="gbr-panel-body">
              <label class="gbr-label">Repeat</label>
              <select name="recurrence" class="gbr-input">
                <option value="weekly">Weekly</option>
                <option value="once">Once</option>
              </select>

              <label class="gbr-label">Announce At</label>
              <input type="time" name="announcementTime" value="22:15" class="gbr-input" />

              <label class="gbr-label">Boss Time</label>
              <input type="time" name="bossTime" value="21:00" class="gbr-input" />

              <label class="gbr-label">Timezone</label>
              <select name="timezone" class="gbr-input">
                ${TIMEZONE_OPTIONS.map((tz) => `<option value="${escapeHtml(tz.value)}">${escapeHtml(tz.label)}</option>`).join("")}
              </select>

              <label class="gbr-label">Pick a day for GBR</label>
              <div class="gbr-days">${dayButtons}</div>
            </div>
          </div>

          <!-- Panel 02: Boss Order -->
          <div class="gbr-panel">
            <div class="gbr-panel-head"><span class="gbr-panel-num">02</span> Boss Order</div>
            <div class="gbr-panel-body">
              <div class="gbr-boss-list" id="boss-list">
                ${bossCards}
              </div>
            </div>
          </div>

          <!-- Panel 03: Delivery -->
          <div class="gbr-panel">
            <div class="gbr-panel-head"><span class="gbr-panel-num">03</span> Delivery</div>
            <div class="gbr-panel-body">
              ${renderDeliveryEditor(deliveryOptions, configuredChannelId)}
            </div>
          </div>

          <!-- Panel 04: Live Preview -->
          <div class="gbr-panel gbr-panel-preview">
            <div class="gbr-panel-head">Live Preview</div>
            <div class="gbr-panel-body gbr-preview-body">
              <div class="discord-message">
                <div class="discord-avatar"><img src="/assets/avatar.png" alt="Athena" /></div>
                <div class="discord-message-content">
                  <div class="discord-message-header">
                    <span class="discord-author">Athena</span>
                    <span class="discord-bot-tag">BOT</span>
                    <span class="discord-timestamp">Today at <span id="preview-announce-time">10:15 PM</span></span>
                  </div>
                  <div class="discord-embed">
                    <div class="discord-embed-color-bar"></div>
                    <div class="discord-embed-body">
                      <div class="discord-embed-title" id="preview-title">Guild Boss Raid - Monday</div>
                      <div class="discord-embed-fields">
                        <div class="discord-embed-field">
                          <div class="discord-field-name">📅 Date</div>
                          <div class="discord-field-value" id="preview-date">June 23, 2026</div>
                        </div>
                        <div class="discord-embed-field">
                          <div class="discord-field-name">⏰ Time</div>
                          <div class="discord-field-value" id="preview-time">9:00 PM</div>
                        </div>
                        <div class="discord-embed-field">
                          <div class="discord-field-name">📢 Announce</div>
                          <div class="discord-field-value" id="preview-announce">10:15 PM</div>
                        </div>
                        <div class="discord-embed-field">
                          <div class="discord-field-name">📊 Status</div>
                          <div class="discord-field-value">Open</div>
                        </div>
                      </div>
                      <div class="discord-embed-divider"></div>
                      <div class="discord-embed-field-name" style="margin-bottom:4px;">🐉 BOSS ORDER</div>
                      <div class="discord-embed-field-value" id="preview-boss-initials" style="font-weight:600;margin-bottom:2px;">O → MU → F → MO → K</div>
                      <div class="discord-embed-field-value" id="preview-boss-names" style="color:#b5bac1;font-size:12px;">Org → Mudster → Ferrid → Moghulis → Khan</div>
                      <div class="discord-embed-divider"></div>
                      <div class="discord-embed-field-value" id="preview-countdown" style="color:#b5bac1;">⏱️ <strong>Starting in 2 hours</strong></div>
                    </div>
                  </div>
                  <div class="discord-footer">Project Athena | Event GBR-001</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="gbr-actions">
          <button type="submit" class="button button-primary">Create GBR Event</button>
        </div>
      </form>
    </div>
  `;

  return renderApp("Create GBR", content, { session, bodyClass: "gbr-create-body" })
    + renderGBRScript();
}

function renderGBRScript(): string {
  return `<script>
    (function() {
      const bossList = document.getElementById('boss-list');
      const orderInput = document.getElementById('boss-order-value');
      const dayBtns = document.querySelectorAll('.gbr-day-btn');
      const repeatDaysInput = document.getElementById('repeat-days-value');
      const previewInitials = document.getElementById('preview-boss-initials');
      const previewNames = document.getElementById('preview-boss-names');
      const previewTitle = document.getElementById('preview-title');
      const previewDate = document.getElementById('preview-date');
      const previewTime = document.getElementById('preview-time');
      const previewAnnounce = document.getElementById('preview-announce');
      const previewAnnounceTime = document.getElementById('preview-announce-time');
      const previewCountdown = document.getElementById('preview-countdown');

      const BOSS_MAP = ${JSON.stringify(Object.fromEntries(GBR_BOSSES.map(b => [b.key, b])))};
      const BOSS_ORDER = ${JSON.stringify(DEFAULT_BOSS_ORDER)};

      let selectedDay = '';

      // Day button selection
      dayBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const recurrence = document.querySelector('[name="recurrence"]').value;
          if (recurrence === 'once') {
            dayBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedDay = btn.dataset.day;
          } else {
            btn.classList.toggle('active');
            const active = document.querySelectorAll('.gbr-day-btn.active');
            selectedDay = active.length > 0 ? active[0].dataset.day : '';
          }
          repeatDaysInput.value = Array.from(document.querySelectorAll('.gbr-day-btn.active')).map(b => b.dataset.day).join(',');
          updatePreview();
        });
      });

      // Select first day by default
      dayBtns[0].classList.add('active');
      selectedDay = 'monday';
      repeatDaysInput.value = 'monday';

      // Drag and drop
      let draggedCard = null;

      bossList.addEventListener('dragstart', (e) => {
        draggedCard = e.target.closest('.gbr-boss-card');
        if (draggedCard) draggedCard.classList.add('dragging');
      });

      bossList.addEventListener('dragend', (e) => {
        if (draggedCard) draggedCard.classList.remove('dragging');
        draggedCard = null;
      });

      bossList.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(bossList, e.clientY);
        if (draggedCard) {
          if (afterElement == null) {
            bossList.appendChild(draggedCard);
          } else {
            bossList.insertBefore(draggedCard, afterElement);
          }
        }
      });

      bossList.addEventListener('drop', (e) => {
        e.preventDefault();
        updateOrder();
      });

      function getDragAfterElement(container, y) {
        const elements = [...container.querySelectorAll('.gbr-boss-card:not(.dragging)')];
        return elements.reduce((closest, child) => {
          const box = child.getBoundingClientRect();
          const offset = y - box.top - box.height / 2;
          if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
          }
          return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
      }

      function updateOrder() {
        const cards = bossList.querySelectorAll('.gbr-boss-card');
        const order = [];
        cards.forEach((card, i) => {
          card.querySelector('.gbr-boss-num').textContent = i + 1;
          order.push(card.dataset.bossKey);
        });
        orderInput.value = order.join(',');
        updatePreview();
      }

      function updatePreview() {
        const order = orderInput.value.split(',');
        const initials = order.map(k => BOSS_MAP[k]?.initial ?? k).join(' → ');
        const names = order.map(k => BOSS_MAP[k]?.name ?? k).join(' → ');
        previewInitials.textContent = initials;
        previewNames.textContent = names;

        const dayLabel = selectedDay ? selectedDay.charAt(0).toUpperCase() + selectedDay.slice(1) : 'Monday';
        previewTitle.textContent = 'Guild Boss Raid - ' + dayLabel;

        const bossTime = document.querySelector('[name="bossTime"]').value;
        const announceTime = document.querySelector('[name="announcementTime"]').value;
        if (bossTime) {
          const [h, m] = bossTime.split(':');
          const hr = parseInt(h);
          previewTime.textContent = (hr > 12 ? hr - 12 : hr) + ':' + m + (hr >= 12 ? ' PM' : ' AM');
        }
        if (announceTime) {
          const [h, m] = announceTime.split(':');
          const hr = parseInt(h);
          const formatted = (hr > 12 ? hr - 12 : hr) + ':' + m + (hr >= 12 ? ' PM' : ' AM');
          previewAnnounce.textContent = formatted;
          previewAnnounceTime.textContent = formatted;
        }
      }

      // Update preview on input changes
      document.querySelector('[name="bossTime"]').addEventListener('input', updatePreview);
      document.querySelector('[name="announcementTime"]').addEventListener('input', updatePreview);
      document.querySelector('[name="recurrence"]').addEventListener('change', updatePreview);

      updatePreview();
    })();
  </script>`;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/templates/gbr-page.ts
git commit -m "feat(gbr): add GBR web create page template with drag-and-drop boss order"
```

---

### Task 4: Wire up GBR routes in web server

**Files:**
- Modify: `src/web.ts:68` (import)
- Modify: `src/web.ts:1218-1227` (GET /create route)
- Modify: `src/web.ts:1241-1279` (POST /create route)

**Interfaces:**
- Consumes: `renderCreateGBRPage` from `gbr-page.ts`
- Produces: GBR form served at `GET /create?type=gbr`, GBR events created via `POST /create`

- [ ] **Step 1: Add import for renderCreateGBRPage**

In `src/web.ts`, line 68, change:
```ts
import { renderCreateServerPickerPage, renderCreateRaidPage, renderCreateNodeWarNewPage, renderEditRaidPage } from "./web/templates/create-edit-page.js";
```
to:
```ts
import { renderCreateServerPickerPage, renderCreateRaidPage, renderCreateNodeWarNewPage, renderEditRaidPage } from "./web/templates/create-edit-page.js";
import { renderCreateGBRPage } from "./web/templates/gbr-page.js";
```

- [ ] **Step 2: Route type=gbr to GBR form in GET /create**

In `src/web.ts`, lines 1218-1227, replace:
```ts
    // For now, all types lead to the same creation form
    // TODO: Create separate forms for GBR and Custom event types
    try {
      const [deliveryOptions, settings] = await Promise.all([fetchGuildDeliveryOptions(guildId), store.getSettings()]);
      const configuredChannelId = settings.nodeWarChannelIds?.[guildId] ?? config.nodeWarChannelId;
      response
        .type("html")
        .send(eventType === "nodewar-new"
          ? renderCreateNodeWarNewPage(guildId, session.csrfToken, session, deliveryOptions, configuredChannelId)
          : renderCreateRaidPage(guildId, session.csrfToken, session, deliveryOptions, configuredChannelId));
    } catch (error) {
      response.status(502).type("html").send(renderWebError(error));
    }
```
with:
```ts
    try {
      const [deliveryOptions, settings] = await Promise.all([fetchGuildDeliveryOptions(guildId), store.getSettings()]);
      const configuredChannelId = settings.nodeWarChannelIds?.[guildId] ?? config.nodeWarChannelId;
      let page: string;
      if (eventType === "gbr") {
        page = renderCreateGBRPage(guildId, session.csrfToken, session, deliveryOptions, configuredChannelId);
      } else if (eventType === "nodewar-new") {
        page = renderCreateNodeWarNewPage(guildId, session.csrfToken, session, deliveryOptions, configuredChannelId);
      } else {
        page = renderCreateRaidPage(guildId, session.csrfToken, session, deliveryOptions, configuredChannelId);
      }
      response.type("html").send(page);
    } catch (error) {
      response.status(502).type("html").send(renderWebError(error));
    }
```

- [ ] **Step 3: Add GBR branch to POST /create**

In `src/web.ts`, inside the `app.post("/create", ...)` handler (starting at line 1233), after the existing Node War event creation block (before `await store.createEvent(event);` at line 1280), add a GBR branch.

Replace lines 1241-1280 (the entire try block content):
```ts
    try {
      const tier = parseTier(request.body.tier);
      const recurrence = request.body.recurrence === "weekly" ? "weekly" : "once";
      const repeatDays = parseRepeatDays(request.body.repeatDays);
      if (recurrence === "once" && repeatDays.length !== 1) {
        throw new Error("One-time events must use exactly one raid day.");
      }
      const timezone = parseTimezone(request.body.timezone, config.timezone);
      const deliveryOptions = await fetchGuildDeliveryOptions(guildId);
      const announcementChannelId = parseAnnouncementChannelId(request.body.announcementChannelId, deliveryOptions.channels);
      const announcementRoleIds = parseAnnouncementRoleIds(request.body.announcementRoleIds, deliveryOptions.roles);
      const announcementTime = parseClockTime(request.body.announcementTime);
      const next = nextScheduledRaid(repeatDays);
      const totalCapacity = getNodeWarCapacity(tier, next.day);
      const event: WarEvent = {
        id: nanoid(10),
        title: buildNodeWarTitle(next.day, tier, totalCapacity),
        kind: "nodewar",
        tier,
        day: next.day,
        repeatDays: recurrence === "weekly" ? repeatDays : undefined,
        date: next.date,
        time: config.nodeWarStartTime,
        timezone,
        recurrence,
        totalCapacity,
        groups: parseGroupAllocation(request.body.groups, totalCapacity),
        announcementDate: previousDate(next.date),
        announcementTime,
        announcementChannelId,
        announcementRoleIds,
        guildId,
        createdBy: `web:${session.user.id}`,
        createdAt: new Date().toISOString(),
        signups: [],
        closed: false,
        active: true,
        autoRepost: recurrence === "weekly"
      };
      await store.createEvent(event);
      response.redirect(`/events/${event.id}/edit?created=1`);
```

with:
```ts
    try {
      const recurrence = request.body.recurrence === "weekly" ? "weekly" : "once";
      const repeatDays = parseRepeatDays(request.body.repeatDays);
      if (recurrence === "once" && repeatDays.length !== 1) {
        throw new Error("One-time events must use exactly one raid day.");
      }
      const timezone = parseTimezone(request.body.timezone, config.timezone);
      const deliveryOptions = await fetchGuildDeliveryOptions(guildId);
      const announcementChannelId = parseAnnouncementChannelId(request.body.announcementChannelId, deliveryOptions.channels);
      const announcementRoleIds = parseAnnouncementRoleIds(request.body.announcementRoleIds, deliveryOptions.roles);
      const announcementTime = parseClockTime(request.body.announcementTime);
      const next = nextScheduledRaid(repeatDays);

      const eventType = request.body.type;

      let event: WarEvent;

      if (eventType === "gbr") {
        const bossOrder = parseBossOrder(request.body.bossOrder);
        const bossTime = parseClockTime(request.body.bossTime);
        event = {
          id: nanoid(10),
          title: buildGBRTitle(next.day),
          kind: "gbr",
          day: next.day,
          repeatDays: recurrence === "weekly" ? repeatDays : undefined,
          date: next.date,
          time: bossTime,
          timezone,
          recurrence,
          totalCapacity: 0,
          groups: [],
          bossOrder,
          announcementDate: previousDate(next.date),
          announcementTime,
          announcementChannelId,
          announcementRoleIds,
          guildId,
          createdBy: `web:${session.user.id}`,
          createdAt: new Date().toISOString(),
          signups: [],
          closed: false,
          active: true,
          autoRepost: recurrence === "weekly"
        };
      } else {
        const tier = parseTier(request.body.tier);
        const totalCapacity = getNodeWarCapacity(tier, next.day);
        event = {
          id: nanoid(10),
          title: buildNodeWarTitle(next.day, tier, totalCapacity),
          kind: "nodewar",
          tier,
          day: next.day,
          repeatDays: recurrence === "weekly" ? repeatDays : undefined,
          date: next.date,
          time: config.nodeWarStartTime,
          timezone,
          recurrence,
          totalCapacity,
          groups: parseGroupAllocation(request.body.groups, totalCapacity),
          announcementDate: previousDate(next.date),
          announcementTime,
          announcementChannelId,
          announcementRoleIds,
          guildId,
          createdBy: `web:${session.user.id}`,
          createdAt: new Date().toISOString(),
          signups: [],
          closed: false,
          active: true,
          autoRepost: recurrence === "weekly"
        };
      }

      await store.createEvent(event);
      response.redirect(`/events/${event.id}/edit?created=1`);
```

- [ ] **Step 4: Add parseBossOrder helper**

In `src/web.ts`, near the other parser imports (around line 16-28), add the import for `DEFAULT_BOSS_ORDER` from `gbr.ts`. Then add a helper function near the other parsers:

Add to imports at top of file:
```ts
import { DEFAULT_BOSS_ORDER } from "./gbr.js";
```

Add helper function (near the other parse helpers, or at the bottom of the file before the app setup):
```ts
function parseBossOrder(value: unknown): string[] {
  if (typeof value !== "string") return DEFAULT_BOSS_ORDER;
  const parsed = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (parsed.length !== 5) return DEFAULT_BOSS_ORDER;
  return parsed;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/web.ts
git commit -m "feat(gbr): wire up GBR create and submit routes in web server"
```

---

### Task 5: Add GBR-specific Discord embed rendering

**Files:**
- Modify: `src/render.ts:1-35` (add new functions)
- Modify: `src/bot/posting.ts:133-138` (use GBR-specific payload)

**Interfaces:**
- Consumes: `WarEvent` with `kind: "gbr"`, `GBR_BOSSES`, `DEFAULT_BOSS_ORDER` from `src/gbr.ts`
- Produces: `renderGBREventEmbed()`, `renderGBREventComponents()`, `renderGBREventMessagePayload()`

- [ ] **Step 1: Add GBR embed and components to render.ts**

In `src/render.ts`, add imports at the top:
```ts
import { GBR_BOSSES, DEFAULT_BOSS_ORDER, formatBossOrderInitials, formatBossOrderNames } from "./gbr.js";
```

After the existing `renderEventComponents` function (after line 59), add:
```ts
/** Renders the Discord embed for a GBR notification event (no signup buttons). */
export function renderGBREventEmbed(event: WarEvent, resolveEmoji: EmojiResolver = (emoji) => emoji): EmbedBuilder {
  const status = event.closed ? "Closed" : "Open";
  const unix = eventUnixSeconds(event);
  const relativeTime = unix ? `<t:${unix}:R>` : formatEventDate(event);
  const bossOrder = event.bossOrder?.length ? event.bossOrder : DEFAULT_BOSS_ORDER;
  const dayLabel = event.day ? event.day.charAt(0).toUpperCase() + event.day.slice(1) : "Monday";

  const embed = new EmbedBuilder()
    .setTitle(`Guild Boss Raid - ${dayLabel}`)
    .setURL(`${config.publicBaseUrl}/events/${event.id}`)
    .setColor(0xed4245)
    .addFields(
      { name: `${getSummaryEmoji("date")} Date`, value: `**${formatEventDate(event)}**`, inline: true },
      { name: `${getSummaryEmoji("time")} Time`, value: `**${formatEventTime(event)}**`, inline: true },
      { name: "📢 Announce", value: `**${event.announcementTime ? formatClockTime(event.announcementTime) : "TBD"}**`, inline: true },
      { name: `${getSummaryEmoji("status")} Status`, value: `**${status}**`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "🐉 BOSS ORDER", value: `\`${formatBossOrderInitials(bossOrder)}\`\n${formatBossOrderNames(bossOrder)}`, inline: false },
      { name: `${getSummaryEmoji("when")} When`, value: `**${relativeTime}**`, inline: false }
    )
    .setFooter({ text: `Project Athena | Event ${event.id}` })
    .setTimestamp(new Date(event.createdAt));

  return embed;
}

/** GBR events have no signup buttons — notification only. */
export function renderGBREventComponents(): Array<ActionRowBuilder<ButtonBuilder>> {
  return [];
}
```

- [ ] **Step 2: Add GBR message payload to posting.ts**

In `src/bot/posting.ts`, add import:
```ts
import { renderGBREventEmbed, renderGBREventComponents } from '../render.js';
```

After the existing `renderEventMessagePayload` function (after line 139), add:
```ts
export function renderGBREventMessagePayload(event: WarEvent, resolveEmoji = createDiscordEmojiResolver()) {
  return {
    embeds: [renderGBREventEmbed(event, resolveEmoji)],
    components: renderGBREventComponents(),
    attachments: []
  };
}
```

- [ ] **Step 3: Update postEventToChannel to handle GBR**

In `src/bot/posting.ts`, in the `postEventToChannel` function (lines 89-106), change line 103:
```ts
    ...renderEventMessagePayload(event, createDiscordEmojiResolver(client)),
```
to:
```ts
    ...(event.kind === "gbr"
      ? renderGBREventMessagePayload(event, createDiscordEmojiResolver(client))
      : renderEventMessagePayload(event, createDiscordEmojiResolver(client))),
```

Also update `refreshEventMessage` (line 120) similarly:
```ts
  await message.edit(
    event.kind === "gbr"
      ? renderGBREventMessagePayload(event, createDiscordEmojiResolver(client))
      : renderEventMessagePayload(event, createDiscordEmojiResolver(client))
  );
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/bot/posting.ts
git commit -m "feat(gbr): add GBR-specific Discord embed and notification-only message payload"
```

---

### Task 6: Add GBR page styles

**Files:**
- Create or Modify: `src/public/assets/css/gbr.css` (or add to existing CSS)

**Interfaces:**
- Consumes: None
- Produces: CSS styles for `.gbr-create-page`, `.gbr-grid`, `.gbr-panel`, `.gbr-boss-card`, etc.

- [ ] **Step 1: Create GBR stylesheet**

Create `src/public/assets/css/gbr.css`:
```css
/* GBR Create Page */
.gbr-create-body { background: var(--bg-primary, #1e1f22); }

.gbr-create-page { padding: var(--space-4, 16px); max-width: 1720px; margin: 0 auto; }

.gbr-grid {
  display: grid;
  grid-template-columns: 385px 420px 330px 530px;
  gap: 16px;
  justify-content: center;
}

.gbr-panel {
  background: var(--bg-secondary, #2b2d31);
  border-radius: 8px;
  overflow: hidden;
}

.gbr-panel-head {
  padding: 11px 18px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #f2f3f5);
  background: var(--bg-tertiary, #1e1f22);
  border-bottom: 1px solid var(--border-subtle, #3f4147);
  display: flex;
  align-items: center;
  gap: 8px;
}

.gbr-panel-num {
  color: var(--text-muted, #b5bac1);
  font-weight: 700;
}

.gbr-panel-body { padding: 15px 18px; }

.gbr-panel-preview .gbr-panel-body {
  background: #313338;
  padding: 15px 18px;
}

.gbr-label {
  display: block;
  font-size: 13px;
  color: var(--text-muted, #b5bac1);
  margin-bottom: 3px;
  margin-top: 8px;
}

.gbr-label:first-child { margin-top: 0; }

.gbr-input {
  width: 100%;
  background: var(--bg-primary, #1e1f22);
  color: var(--text-primary, #f2f3f5);
  border: 1px solid var(--border-subtle, #3f4147);
  border-radius: 5px;
  padding: 8px 11px;
  font-size: 13px;
  box-sizing: border-box;
}

.gbr-days { display: flex; gap: 4px; flex-wrap: wrap; }

.gbr-day-btn {
  padding: 7px 13px;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 600;
  background: var(--bg-secondary, #2b2d31);
  color: var(--text-muted, #b5bac1);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, color 0.15s;
}

.gbr-day-btn:hover { background: #3f4147; }
.gbr-day-btn.active { background: #5865f2; color: white; }

.gbr-boss-list { display: flex; flex-direction: column; gap: 9px; }

.gbr-boss-card {
  display: flex;
  align-items: center;
  gap: 13px;
  background: var(--bg-secondary, #2b2d31);
  padding: 9px 15px;
  border-radius: 7px;
  cursor: grab;
  transition: background 0.15s, box-shadow 0.15s;
}

.gbr-boss-card:active { cursor: grabbing; }
.gbr-boss-card.dragging { opacity: 0.4; }

.gbr-boss-num {
  color: var(--text-muted, #b5bac1);
  font-weight: 700;
  font-size: 19px;
  min-width: 26px;
}

.gbr-boss-img {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  object-fit: cover;
}

.gbr-boss-name {
  color: var(--text-primary, #f2f3f5);
  font-size: 15px;
}

.gbr-boss-drag {
  margin-left: auto;
  color: var(--text-muted, #80848e);
  font-size: 19px;
}

.gbr-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
```

- [ ] **Step 2: Link the stylesheet in renderApp or the GBR page**

In `src/web/templates/gbr-page.ts`, update the `renderApp` call to include the CSS:
```ts
return renderApp("Create GBR", content, {
  session,
  bodyClass: "gbr-create-body",
  headExtra: '<link rel="stylesheet" href="/assets/css/gbr.css">'
})
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/public/assets/css/gbr.css src/web/templates/gbr-page.ts
git commit -m "feat(gbr): add GBR page styles"
```

---

### Task 7: End-to-end verification

**Files:**
- No new files

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (or equivalent)
Expected: Server starts without errors

- [ ] **Step 2: Navigate to GBR create page**

Open: `http://localhost:3000/create?guild={guildId}&type=gbr`
Expected: GBR page loads with 4 panels (Schedule, Boss Order, Delivery, Preview)

- [ ] **Step 3: Test drag-and-drop boss reordering**

Drag boss cards to reorder. Preview initials chain updates live.

- [ ] **Step 4: Test day selection**

Click day buttons. Preview title updates (e.g., "Guild Boss Raid - Tuesday").

- [ ] **Step 5: Test form submission**

Fill in all fields, submit. Event is created with `kind: "gbr"` and `bossOrder` array.

- [ ] **Step 6: Verify Discord embed**

Check that the posted embed shows boss order initials + full names, no signup buttons.

- [ ] **Step 7: Commit final state**

```bash
git add -A
git commit -m "feat(gbr): complete GBR feature implementation"
```
