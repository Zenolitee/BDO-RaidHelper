import { escapeHtml, defaultNextWarDay, renderGroupIcon } from '../utils.js';
import { renderApp, renderPageHeader } from './layout.js';
import { config } from '../../config.js';
import { NODE_WAR_PRESETS, labelWarDay } from '../../nodewar-presets.js';
import { getGroupLabel } from '../../emojis.js';
import { isRosterGroup } from '../../store.js';
import { renderGuildAvatar } from './nav.js';
import { canManageGuild } from '../sessions.js';
import type { WebSession, GuildDeliveryOptions, GuildDashboardSummary } from '../types.js';
import type { WarEvent, WarDay, GroupConfig } from '../../types.js';

/* ── Server Picker ─────────────────────────────────────────── */

export function renderCreateServerPickerPage(session: WebSession, summaries: GuildDashboardSummary[]): string {
  const manageable = summaries.filter((summary) => canManageGuild(session, summary.guild.id));
  const content = `${renderPageHeader("Create Raid", "Choose a server to schedule a Node War roster.", `<a href="/" class="button button-ghost button-sm">Back</a>`)}
  <div class="page-content">
    <div class="grid grid-3">
      ${manageable.map((summary) => {
        const ready = summary.setupWarnings.length === 0;
        return `<div class="card">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);">
            ${renderGuildAvatar(summary.guild)}
            <div>
              <h3 style="margin:0;font-size:var(--text-base);">${escapeHtml(summary.guild.name)}</h3>
              <p style="font-size:var(--text-sm);color:var(--text-muted);margin:0;">${summary.activeRaids} active · ${summary.upcomingRaids} upcoming</p>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-3);">
            <span class="badge ${ready ? "badge-active" : "badge-warning"}">${ready ? "Ready" : "Attention"}</span>
            ${!ready ? summary.setupWarnings.map((w) => `<span class="badge badge-danger">${escapeHtml(w)}</span>`).join("") : ""}
          </div>
          <a href="/create?guild=${encodeURIComponent(summary.guild.id)}" class="button button-primary button-sm" style="width:100%;text-align:center;">Create Raid</a>
        </div>`;
      }).join("")}
      ${manageable.length === 0 ? `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg></div>
        <h3>No manageable servers</h3>
        <p>Your Discord account needs Administrator, Manage Server, Manage Channels, Manage Roles, or Manage Messages on a shared server to create raids.</p>
      </div>` : ""}
    </div>
  </div>`;
  return renderApp("Create Raid", content, { session });
}

/* ── Create Raid Form ──────────────────────────────────────── */

export function renderCreateRaidPage(
  guildId: string,
  csrfToken: string,
  session: WebSession,
  deliveryOptions: GuildDeliveryOptions,
  configuredChannelId?: string
): string {
  const templates = [
    { tier: "tier1", name: "T1 Balenos / Serendia", capacity: 30 },
    { tier: "tier2", name: "T2 Calpheon / Ulukita", capacity: 40 },
    { tier: "tier3", name: "T3 Valencia / Edania", capacity: 55 }
  ];
  const groups: GroupConfig[] = [
    { key: "mainball", label: getGroupLabel("mainball"), capacity: 21 },
    { key: "defense", label: getGroupLabel("defense"), capacity: 5 },
    { key: "zerker", label: getGroupLabel("zerker"), capacity: 2 },
    { key: "shai", label: getGroupLabel("shai"), capacity: 2 }
  ];

  const content = `${renderPageHeader("Create Event", "Schedule a Node War roster. The bot publishes it in Discord at the configured announcement time.", `<a href="/events?guild=${encodeURIComponent(guildId)}" class="button button-ghost button-sm">Back to events</a>`)}
  <div class="page-content">
    <form method="post" action="/create" id="allocation-form">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="guildId" value="${escapeHtml(guildId)}">
      <input type="hidden" name="tier" id="tier-value" value="tier1">
      <input type="hidden" name="groups" id="groups-value">

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);">
        <div>
          <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Capacity</span>
          <strong id="capacity-value" style="font-size:var(--text-2xl);color:var(--accent);margin-left:var(--space-2);">30</strong>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4);">
        <div style="padding:var(--space-4);border-bottom:1px solid var(--border);">
          <h3 style="margin:0 0 var(--space-1);font-size:var(--text-base);">Schedule</h3>
          <p style="margin:0;font-size:var(--text-sm);color:var(--text-muted);">When the roster posts and which days repeat.</p>
        </div>
        <div style="padding:var(--space-4);">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);margin-bottom:var(--space-4);">
            <div class="form-group" style="margin:0;">
              <label class="label" for="recurrence-value">Repeat mode</label>
              <select name="recurrence" id="recurrence-value" class="input">
                <option value="once">One-time event</option>
                <option value="weekly">Repeat weekly</option>
              </select>
            </div>
            <div class="form-group" style="margin:0;">
              <label class="label" for="announcementTime">Announcement time</label>
              <input type="time" name="announcementTime" id="announcementTime" class="input" value="${escapeHtml(config.nodeWarPostTime)}" required>
            </div>
          </div>
          <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-3);">The event starts at ${escapeHtml(config.nodeWarStartTime)} ${escapeHtml(config.timezone)}. One-time raids use one day; weekly schedules can use multiple days.</p>
          <div class="form-group" style="margin:0;">
            <label class="label">Raid days</label>
            <div class="day-checks" style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
              ${renderDayChecks([defaultNextWarDay()])}
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4);">
        <div style="padding:var(--space-4);border-bottom:1px solid var(--border);">
          <h3 style="margin:0 0 var(--space-1);font-size:var(--text-base);">Discord Delivery</h3>
          <p style="margin:0;font-size:var(--text-sm);color:var(--text-muted);">Where the roster posts and which roles receive the ping.</p>
        </div>
        <div style="padding:var(--space-4);">
          ${renderDeliveryEditor(deliveryOptions, configuredChannelId)}
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4);">
        <div style="padding:var(--space-4);border-bottom:1px solid var(--border);">
          <h3 style="margin:0 0 var(--space-1);font-size:var(--text-base);">Node War Templates</h3>
          <p style="margin:0;font-size:var(--text-sm);color:var(--text-muted);">Select a tier to set capacity and composition.</p>
        </div>
        <div style="padding:var(--space-4);">
          <div class="grid grid-3">
            ${templates.map((template, index) => `
            <button type="button" class="card template-button ${index === 0 ? "active" : ""}" data-capacity="${template.capacity}" data-tier="${template.tier}" style="cursor:pointer;text-align:center;border:2px solid ${index === 0 ? "var(--accent)" : "var(--border)"};background:${index === 0 ? "rgba(99,102,241,0.08)" : "var(--bg-surface)"};">
              <span style="display:block;font-weight:600;margin-bottom:var(--space-1);">${escapeHtml(template.name)}</span>
              <small style="color:var(--text-muted);font-size:var(--text-xs);">Preset capacity by weekday</small>
            </button>`).join("")}
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4);">
        <div style="padding:var(--space-4);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
          <div>
            <h3 style="margin:0 0 var(--space-1);font-size:var(--text-base);">Composition</h3>
            <p style="margin:0;font-size:var(--text-sm);color:var(--text-muted);">Linked slot allocation across groups.</p>
          </div>
          <button type="button" id="add-role" class="button button-secondary button-sm">Add custom role</button>
        </div>
        <div style="padding:var(--space-4);">
          <div id="role-table">
            ${groups.map((group) => renderSliderRow(group)).join("")}
          </div>
          <p style="font-size:var(--text-xs);color:var(--text-muted);margin:var(--space-3) 0 0;">Increasing a specialist role reduces Mainball / FFA automatically.</p>
        </div>
      </div>

      <div style="display:flex;gap:var(--space-3);justify-content:flex-end;padding-bottom:var(--space-8);">
        <a href="/events?guild=${encodeURIComponent(guildId)}" class="button button-ghost">Cancel</a>
        <button type="submit" class="button button-primary">Schedule Raid</button>
      </div>
    </form>
  </div>`;
  return renderApp("Create Raid", content, { session }) + renderRecurrenceDayScript() + renderAllocationScript(true);
}

/* ── Edit Raid Form ────────────────────────────────────────── */

export function renderEditRaidPage(event: WarEvent, csrfToken: string, session: WebSession): string {
  const repeatDays = event.recurrence === "weekly" && event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
  const content = `${renderPageHeader("Edit — " + event.title, "Modify schedule, delivery, and slot allocation.", `<a href="/events/${event.id}" class="button button-ghost button-sm">Back to roster</a>`)}
  <div class="page-content">
    <form method="post" action="/events/${event.id}/composition" id="allocation-form">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="groups" id="groups-value">

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);">
        <div>
          <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Capacity</span>
          <strong id="capacity-value" style="font-size:var(--text-2xl);color:var(--accent);margin-left:var(--space-2);">${event.totalCapacity}</strong>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4);">
        <div style="padding:var(--space-4);border-bottom:1px solid var(--border);">
          <h3 style="margin:0 0 var(--space-1);font-size:var(--text-base);">Schedule</h3>
          <p style="margin:0;font-size:var(--text-sm);color:var(--text-muted);">When the roster posts and which days repeat.</p>
        </div>
        <div style="padding:var(--space-4);">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);margin-bottom:var(--space-4);">
            <div class="form-group" style="margin:0;">
              <label class="label" for="recurrence-value">Repeat mode</label>
              <select name="recurrence" id="recurrence-value" class="input">
                <option value="once"${event.recurrence !== "weekly" ? " selected" : ""}>One-time event</option>
                <option value="weekly"${event.recurrence === "weekly" ? " selected" : ""}>Repeat weekly</option>
              </select>
            </div>
            <div class="form-group" style="margin:0;">
              <label class="label" for="announcementTime">Announcement time</label>
              <input name="announcementTime" type="time" id="announcementTime" class="input" value="${escapeHtml(event.announcementTime ?? config.nodeWarPostTime)}" required>
            </div>
          </div>
          <div class="form-group" style="margin:0;">
            <label class="label">Raid days</label>
            <div class="day-checks" style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
              ${renderDayChecks(repeatDays)}
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4);">
        <div style="padding:var(--space-4);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
          <div>
            <h3 style="margin:0 0 var(--space-1);font-size:var(--text-base);">Composition</h3>
            <p style="margin:0;font-size:var(--text-sm);color:var(--text-muted);">Linked slot allocation across groups.</p>
          </div>
          <button type="button" id="add-role" class="button button-secondary button-sm">Add custom role</button>
        </div>
        <div style="padding:var(--space-4);">
          <div id="role-table">
            ${event.groups.filter((group) => isRosterGroup(group.key)).map((group) => renderSliderRow(group)).join("")}
          </div>
          <p style="font-size:var(--text-xs);color:var(--text-muted);margin:var(--space-3) 0 0;">Increasing a specialist role reduces Mainball / FFA automatically.</p>
        </div>
      </div>

      <div style="display:flex;gap:var(--space-3);justify-content:flex-end;padding-bottom:var(--space-8);">
        <a href="/events/${event.id}" class="button button-ghost">Cancel</a>
        <button type="submit" class="button button-primary">Save raid settings</button>
      </div>
    </form>
  </div>`;
  return renderApp("Edit — " + event.title, content, { session }) + renderRecurrenceDayScript() + renderAllocationScript(false);
}

/* ── Node War New (stub — delegates to existing raid page) ──── */

export function renderCreateNodeWarNewPage(
  guildId: string,
  csrfToken: string,
  session: WebSession,
  deliveryOptions: GuildDeliveryOptions,
  configuredChannelId?: string
): string {
  const templates = [
    { tier: "tier1", name: "T1 Balenos / Serendia", capacity: 30 },
    { tier: "tier2", name: "T2 Calpheon / Ulukita", capacity: 40 },
    { tier: "tier3", name: "T3 Valencia / Edania", capacity: 55 }
  ];
  const groups: GroupConfig[] = [
    { key: "mainball", label: getGroupLabel("mainball"), capacity: 25 },
    { key: "defense", label: getGroupLabel("defense"), capacity: 5 }
  ];

  const content = `
    <form method="post" action="/create" id="allocation-form" class="nwnew-shell">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="guildId" value="${escapeHtml(guildId)}">
      <input type="hidden" name="type" value="nodewar">
      <input type="hidden" name="tier" id="tier-value" value="tier1">
      <input type="hidden" name="groups" id="groups-value">

      <div class="nwnew-topbar">
        <div class="nwnew-title">
          <span>Node War Builder</span>
          <h1>Create Raid</h1>
        </div>
        <div class="nwnew-actions">
          <a href="/create?guild=1271355450545147995" class="button button-ghost">Cancel</a>
          <button type="submit" class="button button-primary">Schedule Raid</button>
        </div>
      </div>

      <div class="nwnew-grid">
        <div class="nwnew-column nwnew-plan">
          <section class="nwnew-panel">
            <div class="nwnew-panel-head"><span>01</span><strong>Schedule</strong></div>
            <div class="nwnew-fields">
              <label class="nwnew-field">
                <span>Repeat mode</span>
                <select name="recurrence" id="recurrence-value" class="input">
                  <option value="once">One-time event</option>
                  <option value="weekly">Repeat weekly</option>
                </select>
              </label>
              <label class="nwnew-field">
                <span>Announcement time</span>
                <input type="time" name="announcementTime" id="announcementTime" class="input" value="${escapeHtml(config.nodeWarPostTime)}" required>
              </label>
            </div>
            <div class="nwnew-days">
              <span>Raid days</span>
              <div class="day-checks">${renderDayChecks([defaultNextWarDay()])}</div>
            </div>
          </section>

          <section class="nwnew-panel">
            <div class="nwnew-panel-head"><span>02</span><strong>Node War Templates</strong></div>
            <div class="nwnew-template-stack">
              ${templates.map((template, index) => `
                <button type="button" class="template-button ${index === 0 ? "active" : ""}" data-capacity="${template.capacity}" data-tier="${template.tier}">
                  <span>${escapeHtml(template.name)}</span>
                  <strong>${template.capacity}</strong>
                </button>
              `).join("")}
            </div>
          </section>

          <section class="nwnew-panel">
            <div class="nwnew-panel-head"><span>03</span><strong>Discord Delivery</strong></div>
            <div class="nwnew-delivery">${renderNodeWarNewDeliveryEditor(deliveryOptions, configuredChannelId)}</div>
          </section>
        </div>

        <div class="nwnew-column nwnew-compose">
          <section class="nwnew-panel nwnew-composition-panel">
            <div class="nwnew-panel-head">
              <span>04</span>
              <strong>Composition</strong>
              <button type="button" id="add-role" class="button button-secondary button-sm">Add custom role</button>
            </div>
            <div class="nwnew-capacity-strip">
              <div><span>Capacity</span><strong id="capacity-value">30</strong></div>
              <p>Specialist slots reduce Mainball / FFA automatically. Capacity follows the selected tier and raid day.</p>
            </div>
            <div id="role-table" class="nwnew-role-table">
              ${groups.map((group) => renderSliderRow(group)).join("")}
            </div>
          </section>
        </div>

        <aside class="nwnew-preview" aria-label="Discord message preview">
          <div class="nwnew-preview-toolbar">
            <div><span>Live Preview</span><strong>Discord roster post</strong></div>
            <span class="nwnew-live-dot">Live</span>
          </div>
          <div class="discord-message">
            <div class="discord-avatar"><img class="discord-avatar-img" src="/assets/project_athena.png" alt="Athena"></div>
            <div class="discord-message-content">
              <div class="discord-message-header">
                <span class="discord-message-author">Athena</span>
                <span class="discord-message-bot-tag">BOT</span>
                <span class="discord-message-timestamp">Today at <span id="nw-preview-post-time">${escapeHtml(config.nodeWarPostTime)}</span></span>
              </div>
              <div class="discord-message-mention" id="nw-preview-ping" style="display:none;"></div>
              <div class="discord-embed">
                <div class="discord-embed-color-bar"></div>
                <div class="discord-embed-body">
                  <div class="discord-embed-title" id="nw-preview-title">Node War - ${labelWarDay(defaultNextWarDay())}</div>
                  <div class="discord-embed-fields">
                    <div class="discord-embed-field">
                      <div class="discord-embed-field-name">📅 Date</div>
                      <div class="discord-embed-field-value"><strong id="nw-preview-date">${labelWarDay(defaultNextWarDay())}</strong></div>
                    </div>
                    <div class="discord-embed-field">
                      <div class="discord-embed-field-name">🍒 Signed</div>
                      <div class="discord-embed-field-value"><strong>0 / <span id="nw-preview-capacity">30</span></strong></div>
                    </div>
                    <div class="discord-embed-field">
                      <div class="discord-embed-field-name">⏰ Time</div>
                      <div class="discord-embed-field-value"><strong id="nw-preview-war-time">${escapeHtml(config.nodeWarStartTime)}</strong></div>
                    </div>
                    <div class="discord-embed-field">
                      <div class="discord-embed-field-name">📜 Status</div>
                      <div class="discord-embed-field-value"><strong>Open</strong></div>
                    </div>
                    <div class="discord-embed-field">
                      <div class="discord-embed-field-name">❓ When</div>
                      <div class="discord-embed-field-value"><strong id="nw-preview-when">at war time</strong></div>
                    </div>
                    <div class="discord-embed-field">
                      <div class="discord-embed-field-name">&nbsp;</div>
                      <div class="discord-embed-field-value">&nbsp;</div>
                    </div>
                  </div>
                  <div class="discord-embed-fields discord-roster-fields" id="preview-groups"></div>
                </div>
              </div>
              <div class="discord-embed-footer">Project Athena | Node War roster</div>
              <div class="discord-buttons" id="nw-preview-signup-buttons"></div>
              <div class="discord-buttons">
                <span class="discord-button discord-button-danger">Sign off</span>
                <span class="discord-button discord-button-secondary">${renderGroupIcon("tentative")} Tentative</span>
                <span class="discord-button discord-button-secondary">${renderGroupIcon("absence")} Absence</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </form>`;

  return renderApp("Create Node War", content, { session, bodyClass: "nodewar-new-body" })
    + renderRecurrenceDayScript()
    + renderAllocationScript(true)
    + renderNodeWarPreviewScript();
}

function renderNodeWarNewDeliveryEditor(options: GuildDeliveryOptions, configuredChannelId?: string): string {
  return `
    <div class="form-group">
      <label class="label" for="announcementChannelId">Roster channel</label>
      <select name="announcementChannelId" id="announcementChannelId" class="input" required>
        <option value="">Select a Discord channel</option>
        ${options.channels
          .map((channel) => `<option value="${escapeHtml(channel.id)}"${channel.id === configuredChannelId ? " selected" : ""}># ${escapeHtml(channel.name)}</option>`)
          .join("")}
      </select>
    </div>
    <div class="form-group">
      <span class="label">Ping roles</span>
      <details class="nwnew-role-menu">
        <summary><span id="announcement-role-summary">No role ping</span></summary>
        <div class="nwnew-role-options">
          ${options.roles.length
            ? options.roles
                .map((role) => `
                  <label class="nwnew-role-option">
                    <input type="checkbox" name="announcementRoleIds" value="${escapeHtml(role.id)}"${role.id === config.nodeWarRoleId ? " checked" : ""}>
                    <span>@${escapeHtml(role.name)}</span>
                  </label>`)
                .join("")
            : `<p class="nwnew-role-empty">No selectable server roles found.</p>`}
        </div>
      </details>
    </div>`;
}

/* ── Delivery Editor ───────────────────────────────────────── */

export function renderDeliveryEditor(options: GuildDeliveryOptions, configuredChannelId?: string): string {
  return `
    <div class="form-group">
      <label class="label" for="announcementChannelId">Roster channel</label>
      <select name="announcementChannelId" id="announcementChannelId" class="input" required>
        <option value="">Select a Discord channel</option>
        ${options.channels
          .map((channel) => `<option value="${escapeHtml(channel.id)}"${channel.id === configuredChannelId ? " selected" : ""}># ${escapeHtml(channel.name)}</option>`)
          .join("")}
      </select>
    </div>
    <div class="form-group">
      <label class="label">Ping roles <span style="font-weight:400;color:var(--text-muted);font-size:var(--text-sm);">— optional, select any number</span></label>
      <div style="display:flex;flex-direction:column;gap:var(--space-2);margin-top:var(--space-2);">
        ${options.roles.length > 0
          ? options.roles.map((role) => `
          <label style="display:flex;align-items:center;gap:var(--space-2);cursor:pointer;padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);transition:background 0.15s;" onmouseover="this.style.background='var(--bg-surface-hover)'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" name="announcementRoleIds" value="${escapeHtml(role.id)}"${role.id === config.nodeWarRoleId ? " checked" : ""} style="accent-color:var(--accent);">
            <span>@${escapeHtml(role.name)}</span>
          </label>`).join("")
          : "<p style=\"font-size:var(--text-sm);color:var(--text-muted);\">No selectable server roles found.</p>"}
      </div>
    </div>`;
}

/* ── Allocation Editor ─────────────────────────────────────── */

function renderSliderRow(group: GroupConfig): string {
  const isDefault = ["mainball", "defense"].includes(group.key);
  return `<div class="form-group${isDefault ? "" : " custom-role"}" data-key="${escapeHtml(group.key)}" data-label="${escapeHtml(group.label)}" data-emoji="${escapeHtml(group.emoji ?? "")}" style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border);">
    <div style="display:flex;align-items:center;gap:var(--space-3);">
      <span class="role-icon-preview">${renderGroupIcon(group.key, group.emoji)}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-1);">
          ${isDefault
            ? `<strong style="font-size:var(--text-sm);">${escapeHtml(group.label)}</strong>`
            : `<input class="role-label-input input" style="flex:1;min-width:0;padding:var(--space-1) var(--space-2);font-size:var(--text-sm);" aria-label="Custom role name" value="${escapeHtml(group.label)}" placeholder="Role name">
               <input class="role-emoji-input" type="hidden" value="${escapeHtml(group.emoji ?? "")}">
               <button class="role-emote-button button button-secondary button-sm" type="button">Icon</button>
               <button class="remove-role button button-danger button-sm" type="button" aria-label="Remove custom role">Remove</button>`
          }
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-3);">
          <input aria-label="${escapeHtml(group.label)} slots" type="range" min="0" max="100" value="${group.capacity}"${group.key === "mainball" ? " disabled" : ""} style="flex:1;accent-color:var(--accent);">
          <output style="font-size:var(--text-sm);color:var(--accent);font-weight:600;min-width:2.5rem;text-align:right;">${group.capacity}</output>
        </div>
      </div>
    </div>
  </div>`;
}

/* ── Day Checks ────────────────────────────────────────────── */

const WEB_WAR_DAYS: WarDay[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];

function renderDayChecks(selectedDays: WarDay[]): string {
  return WEB_WAR_DAYS.map((day) => {
    const checked = selectedDays.includes(day);
    return `<label style="display:inline-flex;align-items:center;gap:var(--space-1);cursor:pointer;padding:var(--space-1) var(--space-2);border:1px solid ${checked ? "var(--accent)" : "var(--border)"};border-radius:var(--radius-sm);background:${checked ? "rgba(99,102,241,0.08)" : "transparent"};font-size:var(--text-sm);transition:all 0.15s;">
      <input type="checkbox" name="repeatDays" value="${day}"${checked ? " checked" : ""} style="accent-color:var(--accent);">
      <span>${labelWarDay(day).slice(0, 3)}</span>
    </label>`;
  }).join("");
}

/* ── Inline Scripts (preserved from old raids.ts) ───────────── */

function renderAllocationScript(useTemplates: boolean): string {
  return `<script>
    (() => {
      const form = document.querySelector("#allocation-form");
      const table = document.querySelector("#role-table");
      const capacityLabel = document.querySelector("#capacity-value");
      const groupsValue = document.querySelector("#groups-value");
      const tierInput = document.querySelector("#tier-value");
      const presets = ${JSON.stringify(Object.fromEntries(Object.entries(NODE_WAR_PRESETS).map(([tier, preset]) => [tier, preset.maxParticipantsByDay])))};
      const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      let capacity = Number(capacityLabel.textContent);
      const rows = () => [...table.querySelectorAll("[data-key]")];
      const specialists = () => rows().filter((row) => row.dataset.key !== "mainball");
      const serialize = () => {
        groupsValue.value = JSON.stringify(rows().map((row) => ({
          key: row.dataset.key,
          label: row.querySelector(".role-label-input")?.value || row.dataset.label,
          emoji: row.querySelector(".role-emoji-input")?.value || row.dataset.emoji || undefined,
          capacity: Number(row.querySelector('input[type="range"]').value)
        })));
        window.__updateNodeWarPreview?.();
      };
      window.__serializeRoleAllocation = serialize;
      const rebalance = () => {
        const main = table.querySelector('[data-key="mainball"]');
        const mainSlider = main.querySelector('input[type="range"]');
        specialists().forEach((row) => row.querySelector('input[type="range"]').max = String(capacity));
        const used = specialists().reduce((sum, row) => sum + Number(row.querySelector('input[type="range"]').value), 0);
        mainSlider.max = String(capacity);
        mainSlider.value = String(Math.max(0, capacity - used));
        main.querySelector("output").value = mainSlider.value;
        capacityLabel.textContent = String(capacity);
        serialize();
        window.__updateNodeWarPreview?.();
      };
      const bind = (row) => {
        const slider = row.querySelector('input[type="range"]');
        slider.addEventListener("input", () => {
          const others = specialists().filter((candidate) => candidate !== row)
            .reduce((sum, candidate) => sum + Number(candidate.querySelector('input[type="range"]').value), 0);
          slider.value = String(Math.min(Number(slider.value), Math.max(0, capacity - others)));
          row.querySelector("output").value = slider.value;
          rebalance();
        });
        row.querySelectorAll("input[type=text], .role-label-input, .role-emoji-input").forEach((input) => input.addEventListener("input", serialize));
        row.querySelector(".remove-role")?.addEventListener("click", () => { row.remove(); rebalance(); });
      };
      rows().forEach(bind);
      document.querySelector("#add-role").addEventListener("click", () => {
        const key = "custom-" + Date.now().toString(36);
        const row = document.createElement("div");
        row.className = "form-group custom-role";
        row.dataset.key = key;
        row.dataset.label = "Custom role";
        row.dataset.emoji = "";
        row.style.padding = "var(--space-3) var(--space-4)";
        row.style.borderBottom = "1px solid var(--border)";
        row.innerHTML = '<div style="display:flex;align-items:center;gap:var(--space-3);"><span class="role-icon-preview"><span class="role-emoji" style="font-size:var(--text-lg);">+</span></span><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-1);"><input class="role-label-input input" style="flex:1;min-width:0;padding:var(--space-1) var(--space-2);font-size:var(--text-sm);" aria-label="Custom role name" placeholder="Role name"><input class="role-emoji-input" type="hidden" value=""><button class="role-emote-button button button-secondary button-sm" type="button">Icon</button><button class="remove-role button button-danger button-sm" type="button" aria-label="Remove custom role">Remove</button></div><div style="display:flex;align-items:center;gap:var(--space-3);"><input aria-label="Custom role slots" type="range" min="0" max="' + capacity + '" value="0" style="flex:1;accent-color:var(--accent);"><output style="font-size:var(--text-sm);color:var(--accent);font-weight:600;min-width:2.5rem;text-align:right;">0</output></div></div></div>';
        table.append(row);
        bind(row);
        window.__bindRoleIconPicker?.(row);
        serialize();
      });
      ${useTemplates ? `const syncTemplateCapacity = () => {
        const day = document.querySelector('.day-checks input[name="repeatDays"]:checked')?.value;
        if (!day || !tierInput?.value) return;
        document.querySelectorAll(".template-button").forEach((button) => {
          const templateCapacity = presets[button.dataset.tier]?.[day];
          const label = button.querySelector("strong");
          if (templateCapacity && label) label.textContent = String(templateCapacity);
          if (templateCapacity) button.dataset.capacity = String(templateCapacity);
        });
        capacity = Number(presets[tierInput.value][day]);
        rebalance();
      };
      document.querySelectorAll(".template-button").forEach((button) => button.addEventListener("click", () => {
        document.querySelectorAll(".template-button").forEach((candidate) => {
          candidate.classList.remove("active");
          candidate.style.borderColor = "var(--border)";
          candidate.style.background = "var(--bg-surface)";
        });
        button.classList.add("active");
        button.style.borderColor = "var(--accent)";
        button.style.background = "rgba(99,102,241,0.08)";
        tierInput.value = button.dataset.tier;
        syncTemplateCapacity();
      }));
      document.querySelectorAll('.day-checks input[name="repeatDays"]').forEach((input) => input.addEventListener("change", syncTemplateCapacity));
      syncTemplateCapacity();` : ""}
      form.addEventListener("submit", serialize);
      rebalance();
    })();
  </script>${renderRoleIconPickerScript()}`;
}

function renderRoleIconPickerScript(): string {
  const classIcons = [
    "archer", "berserker", "corsair", "darkknight", "deadeye", "drakania", "dusa", "guardian",
    "hashashin", "kunoichi", "lahn", "maegu", "maehwa", "musa", "mystic", "ninja", "nova",
    "ranger", "sage", "scholar", "seraph", "shai", "sorceress", "striker", "tamer", "valkyrie",
    "warrior", "witch", "wizard", "woosa", "wukong"
  ].map((name) => ({ label: name.replace(/(^|_)([a-z])/g, (_m, prefix, char) => `${prefix}${char.toUpperCase()}`), value: `pa_${name}`, src: `/images/classes/pa_${name}.png` }));
  const unicodeEmojiGroups = [
    { name: "Combat", emojis: ["⚔️", "🛡️", "🏹", "🪓", "🔱", "🗡️", "💣", "🎯", "🥷", "🧨", "💥", "🩸", "☠️", "💀", "🪦", "🚩", "🏴", "🏳️", "🧱", "⛓️"] },
    { name: "Magic", emojis: ["✨", "⭐", "🌟", "💫", "🔮", "🧿", "🪄", "🧙", "🧝", "🧛", "🧞", "🧚", "🌙", "☀️", "🌘", "🌑", "🌕", "🌌", "🌀", "💎"] },
    { name: "Elements", emojis: ["🔥", "❄️", "⚡", "🌊", "💧", "🌪️", "🌬️", "🌫️", "🌋", "🪨", "🌲", "🍃", "☄️", "🌈", "☁️", "⛈️", "🌩️", "🌧️", "🧊", "♨️"] },
    { name: "Creatures", emojis: ["🐉", "🐲", "🐺", "🦅", "🦁", "🐯", "🐻", "🦊", "🐍", "🦂", "🕷️", "🦇", "🦉", "🐎", "🦄", "🐗", "🦍", "🐢", "🦈", "🐙"] },
    { name: "Status", emojis: ["👑", "📣", "🧭", "🪖", "🎖️", "🏆", "🥇", "📌", "📍", "🚨", "✅", "❌", "❓", "❗", "⚠️", "🔴", "🟠", "🟡", "🟢", "🔵"] },
    { name: "Objects", emojis: ["🧰", "🧪", "💊", "🪤", "🪜", "🔦", "🕯️", "📿", "🧲", "🪬", "🧹", "🔨", "⚒️", "🛠️", "⚙️", "🧵", "🪡", "📜", "🗝️", "🧺"] }
  ];

  return `<script>
    (() => {
      const classIcons = ${JSON.stringify(classIcons)};
      const unicodeEmojiGroups = ${JSON.stringify(unicodeEmojiGroups)};
      let activeRow;
      let activeEmojiTab = "classes";

      const escapeHtml = (value) => String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      const iconMarkup = (value) => {
        if (!value) return '<span class="role-emoji">+</span>';
        if (value.startsWith("pa_")) return '<img class="role-icon" src="/images/classes/' + escapeHtml(value) + '.png" alt="">';
        return '<span class="role-emoji">' + escapeHtml(value) + '</span>';
      };
      const setRowIcon = (row, value) => {
        row.dataset.emoji = value;
        const input = row.querySelector(".role-emoji-input");
        const preview = row.querySelector(".role-icon-preview");
        if (input) input.value = value;
        if (preview) preview.innerHTML = iconMarkup(value);
        window.__serializeRoleAllocation?.();
        window.__updateNodeWarPreview?.();
      };
      const renderOptions = (kind, query = "") => {
        const body = document.querySelector("#role-emote-options");
        if (!body) return;
        const current = activeRow?.querySelector(".role-emoji-input")?.value || "";
        const search = query.trim().toLowerCase();
        if (kind === "classes") {
          const filtered = search ? classIcons.filter((icon) => icon.label.toLowerCase().includes(search) || icon.value.toLowerCase().includes(search)) : classIcons;
          body.classList.add("role-emote-grid-classes");
          body.innerHTML = filtered.map((icon) =>
            '<button type="button" class="role-emote-option role-class-option' + (current === icon.value ? ' active' : '') + '" data-value="' + escapeHtml(icon.value) + '">' +
              '<img src="' + escapeHtml(icon.src) + '" alt=""><span>' + escapeHtml(icon.label) + '</span>' +
            '</button>'
          ).join("");
        } else {
          body.classList.remove("role-emote-grid-classes");
          body.innerHTML = unicodeEmojiGroups.map((group) => {
            const emojis = search ? group.emojis.filter((emoji) => emoji.includes(search)) : group.emojis;
            if (!emojis.length) return "";
            return '<div class="role-emoji-section"><h4>' + escapeHtml(group.name) + '</h4><div class="role-emoji-section-grid">' +
              emojis.map((emoji) => '<button type="button" class="role-emote-option' + (current === emoji ? ' active' : '') + '" data-value="' + escapeHtml(emoji) + '">' + escapeHtml(emoji) + '</button>').join("") +
            '</div></div>';
          }).join("");
        }
        if (!body.innerHTML.trim()) body.innerHTML = '<p class="role-emote-empty">No icons found.</p>';
      };
      const ensureModal = () => {
        let modal = document.querySelector("#role-emote-modal");
        if (modal) return modal;
        modal = document.createElement("div");
        modal.id = "role-emote-modal";
        modal.className = "role-emote-modal";
        modal.hidden = true;
        modal.innerHTML = '<div class="role-emote-dialog" role="dialog" aria-modal="true" aria-labelledby="role-emote-title">' +
          '<div class="role-emote-dialog-head"><strong id="role-emote-title">Choose Role Icon</strong><button type="button" class="role-emote-close" aria-label="Close">×</button></div>' +
          '<div class="role-emote-tabs"><button type="button" class="active" data-tab="classes">Class icons</button><button type="button" data-tab="unicode">Unicode</button></div>' +
          '<div class="role-emote-search"><input type="search" id="role-emote-search" placeholder="Search icons"></div>' +
          '<div id="role-emote-options" class="role-emote-grid"></div>' +
        '</div>';
        document.body.append(modal);
        modal.addEventListener("click", (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target) return;
          if (target === modal || target.closest(".role-emote-close")) {
            modal.hidden = true;
            return;
          }
          const tab = target.closest("[data-tab]");
          if (tab) {
            activeEmojiTab = tab.getAttribute("data-tab") || "classes";
            modal.querySelectorAll(".role-emote-tabs button").forEach((button) => button.classList.toggle("active", button === tab));
            const search = modal.querySelector("#role-emote-search");
            if (search instanceof HTMLInputElement) search.value = "";
            renderOptions(activeEmojiTab);
            return;
          }
          const option = target.closest("[data-value]");
          if (option && activeRow) {
            setRowIcon(activeRow, option.getAttribute("data-value") || "");
            modal.hidden = true;
          }
        });
        modal.querySelector("#role-emote-search")?.addEventListener("input", (event) => {
          const input = event.target instanceof HTMLInputElement ? event.target : null;
          renderOptions(activeEmojiTab, input?.value || "");
        });
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape") modal.hidden = true;
        });
        return modal;
      };
      const openModal = (row) => {
        activeRow = row;
        const modal = ensureModal();
        activeEmojiTab = "classes";
        modal.hidden = false;
        const search = modal.querySelector("#role-emote-search");
        if (search instanceof HTMLInputElement) search.value = "";
        modal.querySelectorAll(".role-emote-tabs button").forEach((button) => button.classList.toggle("active", button.getAttribute("data-tab") === "classes"));
        renderOptions("classes");
      };
      window.__bindRoleIconPicker = (row) => {
        row.querySelector(".role-emote-button")?.addEventListener("click", () => openModal(row));
      };
      document.querySelectorAll("#role-table .custom-role").forEach((row) => window.__bindRoleIconPicker(row));
    })();
  </script>`;
}

function renderRecurrenceDayScript(): string {
  return `<script>
    (() => {
      const recurrence = document.querySelector("#recurrence-value");
      const checks = [...document.querySelectorAll('.day-checks input[name="repeatDays"]')];
      const labels = [...document.querySelectorAll('.day-checks label')];
      const enforce = (changed) => {
        if (recurrence.value !== "once") {
          labels.forEach((label) => { label.style.borderColor = "var(--border)"; label.style.background = "transparent"; });
          checks.forEach((check) => {
            const lbl = check.closest("label");
            if (lbl) { lbl.style.borderColor = check.checked ? "var(--accent)" : "var(--border)"; lbl.style.background = check.checked ? "rgba(99,102,241,0.08)" : "transparent"; }
          });
          return;
        }
        if (changed?.checked) checks.forEach((check) => { if (check !== changed) check.checked = false; });
        if (!checks.some((check) => check.checked)) (changed || checks[0]).checked = true;
        labels.forEach((label) => { label.style.borderColor = "var(--border)"; label.style.background = "transparent"; });
        checks.forEach((check) => {
          const lbl = check.closest("label");
          if (lbl) { lbl.style.borderColor = check.checked ? "var(--accent)" : "var(--border)"; lbl.style.background = check.checked ? "rgba(99,102,241,0.08)" : "transparent"; }
        });
      };
      checks.forEach((check) => check.addEventListener("change", () => enforce(check)));
      recurrence.addEventListener("change", () => enforce());
      enforce();
    })();
  </script>`;
}

function renderNodeWarPreviewScript(): string {
  const tierNames = {
    tier1: "T1 Balenos / Serendia",
    tier2: "T2 Calpheon / Ulukita",
    tier3: "T3 Valencia / Edania"
  };
  const dayLabels = Object.fromEntries(WEB_WAR_DAYS.map((day) => [day, labelWarDay(day)]));
  const extraGroups = [
    { key: "bench", label: getGroupLabel("bench"), icon: renderGroupIcon("bench") },
    { key: "tentative", label: getGroupLabel("tentative"), icon: renderGroupIcon("tentative") },
    { key: "absence", label: getGroupLabel("absence"), icon: renderGroupIcon("absence") }
  ];

  return `<script>
    (() => {
      const tierInput = document.querySelector("#tier-value");
      const capacityLabel = document.querySelector("#capacity-value");
      const title = document.querySelector("#nw-preview-title");
      const date = document.querySelector("#nw-preview-date");
      const capacity = document.querySelector("#nw-preview-capacity");
      const postTime = document.querySelector("#nw-preview-post-time");
      const announceInput = document.querySelector("#announcementTime");
      const when = document.querySelector("#nw-preview-when");
      const roleSummary = document.querySelector("#announcement-role-summary");
      const ping = document.querySelector("#nw-preview-ping");
      const groups = document.querySelector("#preview-groups");
      const signupButtons = document.querySelector("#nw-preview-signup-buttons");
      const table = document.querySelector("#role-table");
      const tierNames = ${JSON.stringify(tierNames)};
      const dayLabels = ${JSON.stringify(dayLabels)};
      const extraGroups = ${JSON.stringify(extraGroups)};

      const selectedDay = () => document.querySelector('.day-checks input[name="repeatDays"]:checked')?.value || "monday";
      const formatTime = (value) => {
        if (!value) return "";
        const parts = value.split(":");
        let hour = Number(parts[0]);
        const minute = parts[1] || "00";
        const suffix = hour >= 12 ? "PM" : "AM";
        hour = hour % 12 || 12;
        return hour + ":" + minute + " " + suffix;
      };

      window.__updateNodeWarPreview = () => {
        const day = selectedDay();
        const dayText = dayLabels[day] || day;
        const tierText = tierNames[tierInput?.value || "tier1"] || "Node War";
        const cap = capacityLabel?.textContent?.trim() || "30";
        if (title) title.textContent = tierText + " - " + dayText;
        if (date) date.textContent = dayText;
        if (capacity) capacity.textContent = cap;
        if (postTime) postTime.textContent = formatTime(announceInput?.value || "");
        if (when) when.textContent = "at war time";
        const selectedRoles = [...document.querySelectorAll('input[name="announcementRoleIds"]:checked')]
          .map((input) => input.closest("label")?.querySelector("span")?.textContent?.trim())
          .filter(Boolean);
        if (roleSummary) {
          roleSummary.textContent = selectedRoles.length ? selectedRoles.join(", ") : "No role ping";
        }
        if (ping) {
          const hasRole = selectedRoles.length > 0;
          ping.textContent = selectedRoles.join(" ");
          ping.style.display = hasRole ? "inline-block" : "none";
        }
        if (groups && table) {
          const roster = [...table.querySelectorAll("[data-key]")]
            .map((row) => {
              const label = row.querySelector(".role-label-input")?.value || row.dataset.label || "Role";
              const groupCapacity = row.querySelector("output")?.value || row.querySelector("output")?.textContent || "0";
              const icon = row.querySelector(".role-icon, .role-class-icon, .role-emoji")?.outerHTML || "";
              const denominator = "/" + groupCapacity;
              return { label, count: "0", icon, denominator };
            });
          extraGroups.forEach((group) => roster.push({ label: group.label, count: "0", icon: group.icon, denominator: "" }));
          groups.innerHTML = roster.map((group) => (
            '<div class="discord-embed-field">' +
              '<div class="discord-embed-field-name"><u><strong>' + group.icon + ' ' + group.label + ' - (' + group.count + group.denominator + ')</strong></u></div>' +
              '<div class="discord-embed-field-value">No signups yet.</div>' +
            '</div>'
          )).join("");
          if (signupButtons) {
            signupButtons.innerHTML = roster
              .filter((group) => group.denominator)
              .map((group, index) => '<span class="discord-button ' + (index === 0 ? 'discord-button-primary' : 'discord-button-secondary') + '">' + group.icon + ' ' + (index === 0 ? 'FFA' : group.label) + '</span>')
              .join("");
          }
        }
      };

      document.querySelectorAll('.day-checks input[name="repeatDays"], .template-button, #announcementTime, input[name="announcementRoleIds"]').forEach((item) => {
        item.addEventListener("change", () => setTimeout(window.__updateNodeWarPreview, 0));
        item.addEventListener("click", () => setTimeout(window.__updateNodeWarPreview, 0));
        item.addEventListener("input", () => setTimeout(window.__updateNodeWarPreview, 0));
      });
      table?.addEventListener("input", () => setTimeout(window.__updateNodeWarPreview, 0));
      window.__updateNodeWarPreview();
    })();
  </script>`;
}
