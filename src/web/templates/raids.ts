import { escapeHtml, buildGuildDashboardSummaries, scheduleTitle, isEventActive, formatAnnouncementLabel, formatAnnouncementDateTime, formatDateLabel, formatRaidDays, labelRecurrence, orderedGroups, renderGroupIcon, renderSignupIcon, getUpcomingAnnouncements, announcementTimestamp, warStartTimestamp, eventSortTimestamp, defaultNextWarDay, renderInviteButton } from '../utils.js';
import { renderWindow, renderCountdownScript } from './helpers.js';
import { renderGuildAvatar, renderStat } from './nav.js';
import { canManageGuild } from '../sessions.js';
import { config } from '../../config.js';
import { NODE_WAR_PRESETS, labelWarDay, labelTier } from '../../nodewar-presets.js';
import { getGroupLabel } from '../../emojis.js';
import type { WebSession, GuildDashboardSummary, GuildDeliveryOptions, DiscordGuild } from '../types.js';
import type { WarEvent, WarDay, GroupConfig } from '../../types.js';
import { activeRosterCapacity, activeRosterSignupCount, isRosterGroup } from '../../store.js';
import { formatClockTime } from '../../time-format.js';

const WEB_WAR_DAYS: WarDay[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];

export function renderEventList(events: WarEvent[], session?: WebSession, guildId?: string, summaries?: GuildDashboardSummary[]): string {
  const selectedGuild = session?.guilds.find((guild) => guild.id === guildId);
  const selectedCanManage = Boolean(session && guildId && canManageGuild(session, guildId));
  const visibleEvents = events.filter((event) => !event.closed || (event.recurrence === "once" && event.active === false));
  const activeEvents = visibleEvents.filter(isEventActive);
  const totalSignups = activeEvents.reduce((sum, event) => sum + activeRosterSignupCount(event), 0);
  const weeklyPosts = activeEvents.filter((event) => event.recurrence === "weekly").length;
  const nextAnnouncement = [...activeEvents]
    .filter((event) => event.announcementDate && event.announcementTime && !event.announcedAt)
    .sort((left, right) => `${left.announcementDate} ${left.announcementTime}`.localeCompare(`${right.announcementDate} ${right.announcementTime}`))[0];
  const cards = visibleEvents
    .map((event) => {
      const signed = activeRosterSignupCount(event);
      const capacity = activeRosterCapacity(event);
      const active = isEventActive(event);
      const autoRepost = event.autoRepost ?? event.recurrence === "weekly";
      const canManage = Boolean(session && event.guildId && canManageGuild(session, event.guildId));
      return `<article class="event-card group relative overflow-hidden">
        <div class="card-top"><span class="type-pill">${event.tier ? labelTier(event.tier) : event.kind === "siege" ? "Siege" : "Node War"}</span><span class="status-pill ${active ? "status-active" : "status-inactive"}">${active ? "Active" : "Inactive"}</span></div>
        <a class="event-title" href="/events/${event.id}"><strong>${escapeHtml(scheduleTitle(event))}</strong></a>
        <small>Created ${formatDateLabel(event.createdAt.slice(0, 10))}</small>
        <small>Current roster ${escapeHtml(event.title)}</small>
        <small>Following signup post ${formatAnnouncementLabel(event)}</small>
        <small>War starts ${formatClockTime(event.time)} ${escapeHtml(config.timezone)}</small>
        <small>Schedule ${labelRecurrence(event.recurrence)} | ${formatRaidDays(event)}</small>
        <span class="card-meter"><i style="width:${capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0}%"></i></span>
        <div class="card-switches">${canManage && session ? `${renderCardToggle(event, session.csrfToken, "status", "Status", active)}${renderCardToggle(event, session.csrfToken, "auto-repost", "Auto repost", autoRepost, event.recurrence !== "weekly")}` : ""}</div>
        <div class="card-footer"><b>${signed}/${capacity} signed</b><span class="card-actions"><a href="/events/${event.id}">Open</a>${canManage && session ? `<a href="/events/${event.id}/edit">Manage</a><form method="post" action="/events/${event.id}/delete" onsubmit="return confirm('Delete this raid event?')"><input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}"><button class="link-button danger-link" type="submit">Delete</button></form>` : ""}</span></div>
      </article>`;
    })
    .join("");
  const inner = `<main class="shell">
    ${selectedGuild ? `<section class="dashboard-head"><div class="guild-heading">${renderGuildAvatar(selectedGuild)}<div><p class="eyebrow">Raid dashboard</p><h1>${escapeHtml(selectedGuild.name)}</h1><p>Upcoming Node War rosters and recurring schedules.</p></div></div>${selectedCanManage ? `<a class="button" href="/create?guild=${encodeURIComponent(selectedGuild.id)}">+ Create raid</a>` : ""}</section>
    <section class="stats-row">
      ${renderStat("Active raids", String(activeEvents.length))}
      ${renderStat("Weekly posts", String(weeklyPosts))}
      ${renderStat("Total signups", String(totalSignups))}
      ${renderStat("Next announcement", nextAnnouncement ? `${formatDateLabel(nextAnnouncement.announcementDate as string)} ${formatClockTime(nextAnnouncement.announcementTime as string)}` : "None queued")}
    </section>` : ""}
    ${selectedGuild ? `<section class="event-grid">${cards || `<div class="empty-state"><h2>No raids scheduled</h2><p>${selectedCanManage ? "Create a roster or use the Discord wizard to get started." : "No active raids are posted for this server yet."}</p></div>`}</section>` : ""}
  </main>`;
  return `${renderWindow(selectedGuild ? `ls /guilds/${escapeHtml(selectedGuild.name)}/raids` : "raids", inner, { prompt: "nwhelper@os" })}`;
}

export function renderEventDetail(event: WarEvent, canManage: boolean, session?: WebSession, deliveryOptions?: GuildDeliveryOptions): string {
  const signed = activeRosterSignupCount(event);
  const guild = session?.guilds.find((candidate) => candidate.id === event.guildId);

  const inner = `<main class="shell detail-shell">
    <section class="event-summary">
      <div>
        <p class="eyebrow">${event.tier ? `${labelTier(event.tier)} schedule` : event.kind === "siege" ? "Siege schedule" : "Node War schedule"}</p>
        <h1>${escapeHtml(scheduleTitle(event))}</h1>
        <div class="summary-meta"><span>Created ${formatDateLabel(event.createdAt.slice(0, 10))}</span><span>${formatClockTime(event.time)} war start</span><span>${labelRecurrence(event.recurrence)}</span><span>Status: ${isEventActive(event) ? "Active" : "Inactive"}</span><span>Auto repost: ${(event.autoRepost ?? event.recurrence === "weekly") ? "On" : "Off"}</span></div>
      </div>
      <div class="hero-count">
        <strong>${signed}/${activeRosterCapacity(event)}</strong>
        <span>current roster signed</span>
      </div>
    </section>
    <div class="detail-actions"><a class="button button-secondary" href="/?guild=${encodeURIComponent(event.guildId ?? "")}">Dashboard</a>${canManage ? `<a class="button" href="/events/${event.id}/edit">Edit raid</a>` : ""}</div>
    ${renderDeliverySummary(event, guild, deliveryOptions)}
    ${renderCurrentRosterSummary(event)}
    ${renderUpcomingAnnouncements(event)}
    ${renderDayRail(event)}
    <section class="section-title roster-title"><div><p class="eyebrow">Current roster</p><h2>${escapeHtml(event.title)}</h2></div><span>${formatDateLabel(event.date)} | ${formatClockTime(event.time)}</span></section>
    <section class="roster-grid">${renderRosterColumns(event, canManage)}</section>
  </main>`;
  return `${renderWindow(`cat /events/${escapeHtml(event.id)}`, inner, { prompt: "nwhelper@os" })}${canManage && session ? renderRosterMoveScript(event.id, session.csrfToken) : ""}`;
}

export function renderCurrentRosterSummary(event: WarEvent): string {
  const signed = activeRosterSignupCount(event);
  const postStatus = event.announcedAt
    ? "Signup post sent"
    : event.announcementDate && event.announcementTime
      ? `Queues ${formatDateLabel(event.announcementDate)} ${formatClockTime(event.announcementTime)}`
      : "Not queued";
  return `<section class="current-roster-summary">
    <div><p class="eyebrow">Current live roster</p><h2>${escapeHtml(event.title)}</h2><p>This remains the active signup roster until the one-hour Node War ends.</p></div>
    <dl>
      <div><dt>War date</dt><dd>${formatDateLabel(event.date)}</dd></div>
      <div><dt>War time</dt><dd>${formatClockTime(event.time)}</dd></div>
      <div><dt>Signup post</dt><dd>${escapeHtml(postStatus)}</dd></div>
      <div><dt>Signed</dt><dd>${signed}/${activeRosterCapacity(event)}</dd></div>
    </dl>
  </section>`;
}

export function renderDeliverySummary(event: WarEvent, guild?: DiscordGuild, options?: GuildDeliveryOptions): string {
  const channelId = event.announcementChannelId ?? event.channelId;
  const channel = options?.channels.find((candidate) => candidate.id === channelId);
  const roleIds = event.announcementRoleIds?.length ? event.announcementRoleIds : event.announcementRoleId ? [event.announcementRoleId] : [];
  const roles = roleIds.map((id) => options?.roles.find((candidate) => candidate.id === id)?.name ?? id);
  return `<section class="delivery-summary">
    <div><p class="eyebrow">Discord delivery</p><h2>Announcement route</h2></div>
    <dl>
      <div><dt>Server</dt><dd>${escapeHtml(guild?.name ?? event.guildId ?? "Not assigned")}</dd></div>
      <div><dt>Channel</dt><dd>${escapeHtml(channel ? `#${channel.name}` : channelId ?? "Not assigned")}</dd></div>
      <div><dt>Ping roles</dt><dd>${roles.length ? roles.map((role) => `@${escapeHtml(role)}`).join(", ") : "No role ping"}</dd></div>
      <div><dt>Post time</dt><dd>${formatClockTime(event.announcementTime ?? config.nodeWarPostTime)} ${escapeHtml(config.timezone)}</dd></div>
    </dl>
  </section>`;
}

export function renderUpcomingAnnouncements(event: WarEvent): string {
  const upcoming = getUpcomingAnnouncements(event, 5);
  return `<section class="preview-section">
    <div class="section-title"><div><p class="eyebrow">After the current roster</p><h2>Future signup announcement queue</h2></div><span>Next ${upcoming.length} scheduled posts</span></div>
    <div class="preview-rail">${upcoming
      .map(
        (announcement, index) => `<article class="preview-card${index === 0 ? " preview-card-next" : ""}">
          <div class="preview-top"><span>${index === 0 ? "Next post" : labelWarDay(announcement.day)}</span><time data-countdown="${announcementTimestamp(announcement)}">${formatAnnouncementDateTime(announcement)}</time></div>
          <h3>${escapeHtml(announcement.title)}</h3>
          <dl><div><dt>War date</dt><dd>${formatDateLabel(announcement.date)}</dd></div><div><dt>Capacity</dt><dd>${announcement.totalCapacity} players</dd></div><div><dt>Announces</dt><dd>${formatAnnouncementDateTime(announcement)}</dd></div></dl>
        </article>`
      )
      .join("") || "<p class=\"empty\">No upcoming announcement is scheduled.</p>"}</div>
  </section>${renderCountdownScript()}`;
}

export function renderDayRail(event: WarEvent): string {
  const days = event.recurrence === "weekly" && event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
  return `<section class="day-section"><div class="section-title"><div><p class="eyebrow">Schedule</p><h2>${event.recurrence === "weekly" ? "Weekly raid days" : "Raid day"}</h2></div><span>Announces ${formatClockTime(event.announcementTime ?? config.nodeWarPostTime)}</span></div><div class="day-rail">${days
    .map(
      (day) => `<article class="day-card relative overflow-hidden">
        <span>${labelWarDay(day).slice(0, 3)}</span>
        <strong>${labelWarDay(day)}</strong>
        <small>${event.tier ? NODE_WAR_PRESETS[event.tier].territoryGroup : event.kind}</small>
        <dl><div><dt>Roster</dt><dd>${day === event.day ? `${activeRosterSignupCount(event)}/${activeRosterCapacity(event)} signed` : "Fresh roster"}</dd></div><div><dt>War</dt><dd>${formatClockTime(event.time)}</dd></div><div><dt>Post</dt><dd>${formatClockTime(event.announcementTime ?? config.nodeWarPostTime)}</dd></div></dl>
      </article>`
    )
    .join("") || "<p>No raid days selected.</p>"}</div></section>`;
}

export function renderRosterColumns(event: WarEvent, canManage = false): string {
  return orderedGroups(event)
    .map((group) => {
      const signups = event.signups.filter((signup) => signup.group === group.key);
      return `<section class="roster-column${canManage ? " roster-dropzone" : ""}" data-group="${escapeHtml(group.key)}">
        <header><h2>${renderGroupIcon(group.key, group.emoji)}${escapeHtml(group.label)}</h2><b>${isRosterGroup(group.key) ? `${signups.length}/${group.capacity}` : signups.length}</b></header>
        <div class="signup-list">${signups
          .map(
            (signup, index) => `<div class="signup-row${canManage ? " draggable-signup" : ""}" data-user-id="${escapeHtml(signup.userId)}" data-group="${escapeHtml(group.key)}"${canManage ? " draggable=\"true\" title=\"Drag to move role\"" : ""}><span class="class-badge">${renderSignupIcon(event, group.key, signup.requestedGroup)}</span><span class="slot">${index + 1}</span><span class="name">${escapeHtml(signup.displayName)}</span></div>`
          )
          .join("") || "<p class=\"empty\">No signups yet</p>"}</div>
      </section>`;
    })
    .join("");
}

export function renderRosterMoveScript(eventId: string, csrfToken: string): string {
  return `<script>
    (() => {
      const eventId = ${JSON.stringify(eventId)};
      const csrfToken = ${JSON.stringify(csrfToken)};
      let draggedRow;

      document.querySelectorAll(".draggable-signup").forEach((row) => {
        row.addEventListener("dragstart", (event) => {
          draggedRow = row;
          if (!draggedRow || !event.dataTransfer) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", draggedRow.dataset.userId || "");
          draggedRow.classList.add("is-dragging");
        });

        row.addEventListener("dragend", () => {
          draggedRow?.classList.remove("is-dragging");
          document.querySelectorAll(".roster-dropzone.is-drag-over").forEach((zone) => zone.classList.remove("is-drag-over"));
          draggedRow = undefined;
        });
      });

      document.querySelectorAll(".roster-dropzone").forEach((zone) => {
        zone.addEventListener("dragover", (event) => {
          if (!draggedRow || draggedRow.dataset.group === zone.dataset.group) return;
          event.preventDefault();
          zone.classList.add("is-drag-over");
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        });

        zone.addEventListener("dragleave", (event) => {
          if (!zone.contains(event.relatedTarget)) {
            zone.classList.remove("is-drag-over");
          }
        });

        zone.addEventListener("drop", async (event) => {
          event.preventDefault();
          zone.classList.remove("is-drag-over");
          const userId = event.dataTransfer?.getData("text/plain") || draggedRow?.dataset.userId;
          const group = zone.dataset.group;
          if (!userId || !group || draggedRow?.dataset.group === group) return;

          zone.classList.add("is-saving");
          try {
            const response = await fetch(\`/events/\${eventId}/signups/move\`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ csrfToken, userId, group })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || "Could not move signup.");
            window.location.reload();
          } catch (error) {
            alert(error instanceof Error ? error.message : "Could not move signup.");
          } finally {
            zone.classList.remove("is-saving");
          }
        });
      });
    })();
  </script>`;
}

export function renderCardToggle(event: WarEvent, csrfToken: string, action: "status" | "auto-repost", label: string, enabled: boolean, disabled = false): string {
  const field = action === "status" ? "active" : "autoRepost";
  return `<form method="post" action="/events/${event.id}/${action}"><input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}"><input type="hidden" name="${field}" value="${enabled ? "false" : "true"}"><button class="switch-button${enabled ? " switch-on" : ""}" type="submit"${disabled ? " disabled" : ""}><span>${escapeHtml(label)}</span><i></i><b>${enabled ? "On" : "Off"}</b></button></form>`;
}

export function renderCreateRaid(
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

  const inner = `<main class="shell create-shell">
    <div class="page-nav"><a href="/?guild=${encodeURIComponent(guildId)}">Back to raids</a></div>
    <section class="builder-head">
      <div>
        <p class="eyebrow">Node War template builder</p>
        <h1>Create Raid</h1>
        <p class="summary">Schedule one Node War roster. The bot publishes it in Discord at the configured announcement time.</p>
      </div>
      <div class="capacity-box"><span>Capacity</span><strong id="capacity-value">30</strong></div>
    </section>
    <form method="post" action="/create" id="allocation-form">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="guildId" value="${escapeHtml(guildId)}">
      <input type="hidden" name="tier" id="tier-value" value="tier1">
      <input type="hidden" name="groups" id="groups-value">
      <section class="schedule-panel">
        <label>Repeat mode<select name="recurrence" id="recurrence-value"><option value="once">One-time event</option><option value="weekly">Repeat weekly</option></select></label>
        <label>Announcement time <input type="time" name="announcementTime" value="${escapeHtml(config.nodeWarPostTime)}" required></label>
        <p>The event starts at ${escapeHtml(config.nodeWarStartTime)} ${escapeHtml(config.timezone)}. One-time raids use one day; weekly schedules can use multiple days.</p>
        <fieldset><legend>Raid days</legend><div class="day-checks">${renderDayChecks([defaultNextWarDay()])}</div></fieldset>
      </section>
      ${renderDeliveryEditor(deliveryOptions, configuredChannelId)}
      <section class="template-grid" aria-label="Node War templates">
        ${templates.map((template, index) => `<button class="template-button${index === 0 ? " active" : ""}" type="button" data-capacity="${template.capacity}" data-tier="${template.tier}">
          <span>${escapeHtml(template.name)}</span><b>Preset capacity by weekday</b>
        </button>`).join("")}
      </section>
      ${renderAllocationEditor(groups)}
      <div class="editor-actions"><button type="submit">Schedule Raid</button></div>
    </form>
  </main>`;
  return `${renderWindow("create --new-raid", inner, { prompt: "nwhelper@os" })}${renderRecurrenceDayScript()}${renderAllocationScript(true)}`;
}

export function renderEditRaid(event: WarEvent, csrfToken: string, session: WebSession): string {
  const repeatDays = event.recurrence === "weekly" && event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];
  const inner = `<main class="shell create-shell">
    <nav class="page-nav"><a href="/events/${event.id}">Back to roster</a><a href="/?guild=${encodeURIComponent(event.guildId ?? "")}">Server raids</a></nav>
    <section class="builder-head">
      <div><p class="eyebrow">Raid settings</p><h1>Edit raid</h1><p class="summary">${escapeHtml(event.title)}</p></div>
      <div class="capacity-box"><span>Capacity</span><strong id="capacity-value">${event.totalCapacity}</strong></div>
    </section>
    <form method="post" action="/events/${event.id}/composition" id="allocation-form">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="groups" id="groups-value">
      <section class="schedule-editor">
        <div><p class="eyebrow">Schedule</p><h2>Announcement timing</h2></div>
        <label>Repeat mode<select name="recurrence" id="recurrence-value"><option value="once"${event.recurrence !== "weekly" ? " selected" : ""}>One-time event</option><option value="weekly"${event.recurrence === "weekly" ? " selected" : ""}>Repeat weekly</option></select></label>
        <label>Announcement time<input name="announcementTime" type="time" value="${escapeHtml(event.announcementTime ?? config.nodeWarPostTime)}" required></label>
        <fieldset><legend>Raid days</legend><div class="day-checks">${renderDayChecks(repeatDays)}</div></fieldset>
      </section>
      ${renderAllocationEditor(event.groups.filter((group) => isRosterGroup(group.key)))}
      <div class="editor-actions"><button type="submit">Save raid settings</button></div>
    </form>
  </main>`;
  return `${renderWindow(`edit /events/${escapeHtml(event.id)}`, inner, { prompt: "nwhelper@os" })}${renderRecurrenceDayScript()}${renderAllocationScript(false)}`;
}

export function renderCreateServerPicker(session: WebSession, summaries: GuildDashboardSummary[]): string {
  const manageable = summaries.filter((summary) => canManageGuild(session, summary.guild.id));
  const inner = `<main class="shell member-shell">
    <section class="member-hero">
      <div><p class="eyebrow">Create raid</p><h1>Choose a server first</h1><p>Create permissions depend on Discord permissions. Pick the server where you want to schedule the roster.</p></div>
      <dl class="member-telemetry">
        <div><dt>Available</dt><dd>${manageable.length}</dd></div>
        <div><dt>Shared</dt><dd>${summaries.length}</dd></div>
        <div><dt>Active raids</dt><dd>${manageable.reduce((sum, summary) => sum + summary.activeRaids, 0)}</dd></div>
        <div><dt>Permission</dt><dd>Required</dd></div>
      </dl>
    </section>
    <section class="member-section">
      <div class="section-title"><div><p class="eyebrow">Server picker</p><h2>Where should this raid live?</h2></div><span>${manageable.length} manageable</span></div>
      <div class="member-server-grid">${manageable
        .map(
          (summary) => `<article class="member-server-card">
            <div class="fleet-head">${renderGuildAvatar(summary.guild)}<div><h3>${escapeHtml(summary.guild.name)}</h3><small>${summary.activeRaids} active raids | ${escapeHtml(summary.nextAnnouncement)}</small></div></div>
            <span class="setup-pill ${summary.setupWarnings.length ? "setup-pill-warning" : "setup-pill-ready"}">${summary.setupWarnings.length ? "Setup warnings" : "Ready"}</span>
            <div class="fleet-links"><a href="/create?guild=${encodeURIComponent(summary.guild.id)}">Create Raid</a><a href="/guilds/${encodeURIComponent(summary.guild.id)}/raids">Raids</a><a href="/?guild=${encodeURIComponent(summary.guild.id)}">Dashboard</a></div>
          </article>`
        )
        .join("") || `<div class="empty-state compact-empty"><h2>No manageable servers</h2><p>Your Discord account needs Administrator, Manage Server, Manage Channels, Manage Roles, or Manage Messages on a shared server to create raids.</p></div>`}</div>
    </section>
  </main>`;
  return `${renderWindow("create --select-server", inner, { prompt: "nwhelper@os" })}`;
}

export function renderDeliveryEditor(options: GuildDeliveryOptions, configuredChannelId?: string): string {
  return `<section class="delivery-editor">
    <header><div><p class="eyebrow">Discord delivery</p><h2>Announcement destination</h2></div><p>Choose where the roster posts and which roles receive the signup ping.</p></header>
    <label>Roster channel
      <select name="announcementChannelId" required>
        <option value="">Select a Discord channel</option>
        ${options.channels
          .map((channel) => `<option value="${escapeHtml(channel.id)}"${channel.id === configuredChannelId ? " selected" : ""}># ${escapeHtml(channel.name)}</option>`)
          .join("")}
      </select>
    </label>
    <fieldset>
      <legend>Ping roles <span>Optional, select any number</span></legend>
      <div class="ping-role-grid">${
        options.roles
          .map(
            (role) =>
              `<label><input type="checkbox" name="announcementRoleIds" value="${escapeHtml(role.id)}"${role.id === config.nodeWarRoleId ? " checked" : ""}><span>@${escapeHtml(role.name)}</span></label>`
          )
          .join("") || "<p class=\"empty\">No selectable server roles found.</p>"
      }</div>
    </fieldset>
  </section>`;
}

export function renderAllocationEditor(groups: GroupConfig[]): string {
  return `<section class="slot-editor">
    <header>
      <div><p class="eyebrow">Composition</p><h2>Linked slot allocation</h2></div>
      <button type="button" id="add-role">Add custom role</button>
    </header>
    <div id="role-table" class="role-table">${groups.map((group) => renderSliderRow(group)).join("")}</div>
    <p class="editor-note">Increasing a specialist role reduces Mainball / FFA automatically.</p>
  </section>`;
}

export function renderSliderRow(group: GroupConfig): string {
  const custom = !["mainball", "defense", "zerker", "shai"].includes(group.key);
  return `<div class="role-row${custom ? " custom-role" : ""}" data-key="${escapeHtml(group.key)}" data-label="${escapeHtml(group.label)}" data-emoji="${escapeHtml(group.emoji ?? "")}">
    <div class="role-name">${renderGroupIcon(group.key, group.emoji)}${
      custom
        ? `<input class="role-label-input" aria-label="Custom role name" value="${escapeHtml(group.label)}" placeholder="Role name"><input class="role-emoji-input" aria-label="Emote for role" value="${escapeHtml(group.emoji ?? "")}" placeholder=":mage: or &lt;:mage:id&gt;"><button class="remove-role" type="button" aria-label="Remove custom role">Remove</button>`
        : `<strong>${escapeHtml(group.label)}</strong>`
    }</div>
    <input aria-label="${escapeHtml(group.label)} slots" type="range" min="0" max="100" value="${group.capacity}"${group.key === "mainball" ? " disabled" : ""}>
    <output>${group.capacity}</output>
  </div>`;
}

export function renderAllocationScript(useTemplates: boolean): string {
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
      const rows = () => [...table.querySelectorAll(".role-row")];
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
        row.className = "role-row custom-role";
        row.dataset.key = key;
        row.dataset.label = "Custom role";
        row.innerHTML = '<div class="role-name"><span class="role-emoji">+</span><input class="role-label-input" aria-label="Custom role name" placeholder="Role name"><input class="role-emoji-input" aria-label="Emote for role" placeholder=":mage: or &lt;:mage:id&gt;"><button class="remove-role" type="button" aria-label="Remove custom role">Remove</button></div><input aria-label="Custom role slots" type="range" min="0" max="' + capacity + '" value="0"><output>0</output>';
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
        document.querySelectorAll(".template-button").forEach((candidate) => candidate.classList.remove("active"));
        button.classList.add("active");
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

export function renderDayChecks(selectedDays: WarDay[]): string {
  return WEB_WAR_DAYS.map((day) => `<label><input type="checkbox" name="repeatDays" value="${day}"${selectedDays.includes(day) ? " checked" : ""}><span>${labelWarDay(day).slice(0, 3)}</span></label>`).join("");
}

export function renderRecurrenceDayScript(): string {
  return `<script>
    (() => {
      const recurrence = document.querySelector("#recurrence-value");
      const checks = [...document.querySelectorAll('.day-checks input[name="repeatDays"]')];
      const enforce = (changed) => {
        if (recurrence.value !== "once") return;
        if (changed?.checked) checks.forEach((check) => { if (check !== changed) check.checked = false; });
        if (!checks.some((check) => check.checked)) (changed || checks[0]).checked = true;
      };
      checks.forEach((check) => check.addEventListener("change", () => enforce(check)));
      recurrence.addEventListener("change", () => enforce());
      enforce();
    })();
  </script>`;
}

