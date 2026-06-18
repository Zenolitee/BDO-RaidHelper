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
  const isDefault = ["mainball", "defense", "zerker", "shai"].includes(group.key);
  return `<div class="form-group${isDefault ? "" : " custom-role"}" data-key="${escapeHtml(group.key)}" data-label="${escapeHtml(group.label)}" data-emoji="${escapeHtml(group.emoji ?? "")}" style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border);">
    <div style="display:flex;align-items:center;gap:var(--space-3);">
      ${renderGroupIcon(group.key, group.emoji)}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-1);">
          ${isDefault
            ? `<strong style="font-size:var(--text-sm);">${escapeHtml(group.label)}</strong>`
            : `<input class="role-label-input input" style="flex:1;min-width:0;padding:var(--space-1) var(--space-2);font-size:var(--text-sm);" aria-label="Custom role name" value="${escapeHtml(group.label)}" placeholder="Role name">
               <input class="role-emoji-input input" style="width:80px;padding:var(--space-1) var(--space-2);font-size:var(--text-sm);" aria-label="Emote for role" value="${escapeHtml(group.emoji ?? "")}" placeholder=":mage: or &lt;:mage:id&gt;">
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
      };
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
        row.innerHTML = '<div style="display:flex;align-items:center;gap:var(--space-3);"><span class="role-emoji" style="font-size:var(--text-lg);">+</span><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-1);"><input class="role-label-input input" style="flex:1;min-width:0;padding:var(--space-1) var(--space-2);font-size:var(--text-sm);" aria-label="Custom role name" placeholder="Role name"><input class="role-emoji-input input" style="width:80px;padding:var(--space-1) var(--space-2);font-size:var(--text-sm);" aria-label="Emote for role" placeholder=":mage: or &lt;:mage:id&gt;"><button class="remove-role button button-danger button-sm" type="button" aria-label="Remove custom role">Remove</button></div><div style="display:flex;align-items:center;gap:var(--space-3);"><input aria-label="Custom role slots" type="range" min="0" max="' + capacity + '" value="0" style="flex:1;accent-color:var(--accent);"><output style="font-size:var(--text-sm);color:var(--accent);font-weight:600;min-width:2.5rem;text-align:right;">0</output></div></div></div>';
        table.append(row);
        bind(row);
        serialize();
      });
      ${useTemplates ? `const syncTemplateCapacity = () => {
        const day = document.querySelector('.day-checks input[name="repeatDays"]:checked')?.value;
        if (!day || !tierInput?.value) return;
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
