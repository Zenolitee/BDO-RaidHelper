import { escapeHtml, scheduleTitle, isEventActive, formatAnnouncementLabel, formatAnnouncementDateTime, formatDateLabel, formatRaidDays, labelRecurrence, orderedGroups, renderGroupIcon, renderSignupIcon, getUpcomingAnnouncements, announcementTimestamp, eventSortTimestamp, renderInviteButton } from '../utils.js';
import { renderApp, renderPageHeader, renderStatGrid, renderEmptyState } from './layout.js';
import { canManageGuild } from '../sessions.js';
import { config } from '../../config.js';
import { labelWarDay, NODE_WAR_PRESETS, labelTier } from '../../nodewar-presets.js';
import type { WebSession, GuildDashboardSummary, GuildDeliveryOptions } from '../types.js';
import type { WarEvent } from '../../types.js';
import { activeRosterCapacity, activeRosterSignupCount, isRosterGroup } from '../../store.js';
import { formatClockTime } from '../../time-format.js';

/* ── Helpers ──────────────────────────────────────────────────── */

function esc(value: string): string {
  return escapeHtml(value);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

/* ── 1. Raids List Page ──────────────────────────────────────── */

export function renderRaidsPage(
  events: WarEvent[],
  session?: WebSession,
  guildId?: string,
  summaries?: GuildDashboardSummary[]
): string {
  if (!session) {
    const content = `
      <div class="page-content" style="padding-top:var(--space-16);">
        ${renderEmptyState(
          "Sign in to view raids",
          "Connect your Discord account to see raid schedules across your servers.",
          `<div style="display:flex;justify-content:center;margin-top:var(--space-4);">
            <a href="/auth/discord" class="button button-primary">Sign in with Discord</a>
          </div>`
        )}
      </div>`;
    return renderApp("All Raids", content, { activeNav: "raids" });
  }

  const selectedGuild = session.guilds.find((guild) => guild.id === guildId);
  const selectedCanManage = Boolean(session && guildId && canManageGuild(session, guildId));

  const visibleEvents = events.filter((event) => !event.closed || (event.recurrence === "once" && event.active === false));
  const activeEvents = visibleEvents.filter(isEventActive);
  const totalSignups = activeEvents.reduce((sum, event) => sum + activeRosterSignupCount(event), 0);
  const weeklyPosts = activeEvents.filter((event) => event.recurrence === "weekly").length;

  const nextAnnouncement = [...activeEvents]
    .filter((event) => event.announcementDate && event.announcementTime && !event.announcedAt)
    .sort((left, right) => `${left.announcementDate} ${left.announcementTime}`.localeCompare(`${right.announcementDate} ${right.announcementTime}`))[0];

  const statStats = [
    { label: "Active Raids", value: String(activeEvents.length) },
    { label: "Weekly Posts", value: String(weeklyPosts) },
    { label: "Total Signups", value: String(totalSignups) },
    { label: "Next Announcement", value: nextAnnouncement ? `${formatDateLabel(nextAnnouncement.announcementDate as string)} ${formatClockTime(nextAnnouncement.announcementTime as string)}` : "None queued" },
  ];

  const cards = visibleEvents
    .map((event) => {
      const signed = activeRosterSignupCount(event);
      const capacity = activeRosterCapacity(event);
      const active = isEventActive(event);
      const percent = capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0;
      const eventGuild = session.guilds.find((g) => g.id === event.guildId);
      const canManage = session && event.guildId && canManageGuild(session, event.guildId);

      return `<a href="/events/${enc(event.id)}" class="card" style="text-decoration:none;color:inherit;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-3);">
          <span class="badge ${active ? "badge-active" : "badge-inactive"}">${active ? "Active" : "Scheduled"}</span>
          <span style="font-size:var(--text-xs);color:var(--text-muted);">${formatDateLabel(event.date)}</span>
        </div>
        <h3 style="margin-bottom:var(--space-2);">${esc(scheduleTitle(event))}</h3>
        <p style="font-size:var(--text-sm);color:var(--text-muted);margin-bottom:var(--space-1);">${eventGuild ? esc(eventGuild.name) : "Unknown server"}</p>
        <p style="font-size:var(--text-sm);color:var(--text-muted);margin-bottom:var(--space-3);">${event.tier ? esc(labelTier(event.tier)) : event.kind === "siege" ? "Siege" : "Node War"} · ${esc(formatRaidDays(event))}</p>
        <div class="progress" style="margin-bottom:var(--space-3);">
          <div class="progress-bar ${percent >= 80 ? "success" : percent >= 50 ? "" : "warning"}" style="width:${percent}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:var(--text-sm);font-weight:600;">${signed}/${capacity} signed</span>
          <span style="font-size:var(--text-sm);color:var(--text-muted);">${formatClockTime(event.time)}</span>
        </div>
      </a>`;
    })
    .join("");

  const headerActions = selectedCanManage
    ? `<a href="/create?guild=${enc(selectedGuild?.id ?? "")}" class="button button-primary">+ Create Raid</a>`
    : "";

  const pageTitle = selectedGuild ? esc(selectedGuild.name) : "All Raids";
  const pageSubtitle = selectedGuild
    ? "Upcoming Node War rosters and recurring schedules."
    : "All raids across your servers.";

  const content = [
    renderPageHeader(pageTitle, pageSubtitle, headerActions),
    selectedGuild
      ? `<div class="page-content" style="padding-top:var(--space-4);padding-bottom:0;">
          ${renderStatGrid(statStats)}
        </div>`
      : "",
    `<div class="page-content">
      <div class="grid grid-3">
        ${cards || renderEmptyState(
          "No raids scheduled",
          selectedCanManage
            ? "Create a roster or use the Discord wizard to get started."
            : "No active raids are posted for this server yet.",
          selectedCanManage && selectedGuild
            ? `<div style="display:flex;justify-content:center;margin-top:var(--space-4);"><a href="/create?guild=${enc(selectedGuild.id)}" class="button button-primary">Create Raid</a></div>`
            : undefined
        )}
      </div>
    </div>`,
  ].join("\n");

  return renderApp("All Raids", content, { session, summaries, activeNav: "raids" });
}

/* ── 2. Event Detail Page ────────────────────────────────────── */

export function renderEventDetailPage(
  event: WarEvent,
  canManage: boolean,
  session?: WebSession,
  deliveryOptions?: GuildDeliveryOptions
): string {
  const signed = activeRosterSignupCount(event);
  const capacity = activeRosterCapacity(event);
  const percent = capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0;
  const active = isEventActive(event);
  const territory = event.tier ? NODE_WAR_PRESETS[event.tier].territoryGroup : event.kind;
  const guild = session?.guilds.find((candidate) => candidate.id === event.guildId);
  const announcement = getUpcomingAnnouncements(event, 1)[0];

  // Delivery info
  const channelId = event.announcementChannelId ?? event.channelId;
  const channel = deliveryOptions?.channels.find((candidate) => candidate.id === channelId);
  const roleIds = event.announcementRoleIds?.length ? event.announcementRoleIds : event.announcementRoleId ? [event.announcementRoleId] : [];
  const roles = roleIds.map((id) => deliveryOptions?.roles.find((candidate) => candidate.id === id)?.name ?? id);
  const postStatus = event.announcedAt
    ? "Signup post sent"
    : event.announcementDate && event.announcementTime
      ? `Queues ${formatDateLabel(event.announcementDate)} ${formatClockTime(event.announcementTime)}`
      : "Not queued";

  // Upcoming announcements
  const upcoming = getUpcomingAnnouncements(event, 5);

  // Weekly day rail
  const days = event.recurrence === "weekly" && event.repeatDays?.length ? event.repeatDays : event.day ? [event.day] : [];

  const headerActions = [
    `<a href="/?guild=${enc(event.guildId ?? "")}" class="button button-secondary">Dashboard</a>`,
    canManage ? `<a href="/events/${enc(event.id)}/edit" class="button button-primary">Edit Raid</a>` : "",
    canManage && session
      ? `<form method="post" action="/events/${enc(event.id)}/delete" style="display:inline;" onsubmit="return confirm('Delete this raid event?')">
          <input type="hidden" name="csrfToken" value="${esc(session.csrfToken)}">
          <button class="button button-ghost" style="color:var(--text-danger);" type="submit">Delete</button>
        </form>`
      : "",
  ].filter(Boolean).join("");

  const content = [
    // Page header
    renderPageHeader(
      esc(scheduleTitle(event)),
      guild ? esc(guild.name) : "Node War",
      headerActions
    ),

    // Event info grid
    `<div class="page-content" style="padding-top:var(--space-4);">
      <div class="grid grid-4" style="margin-bottom:var(--space-6);">
        <div class="stat-card">
          <div class="stat-card-label">Territory</div>
          <div class="stat-card-value">${esc(territory)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">Date</div>
          <div class="stat-card-value">${formatDateLabel(event.date)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">War Start</div>
          <div class="stat-card-value">${formatClockTime(event.time)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">Announcement</div>
          <div class="stat-card-value">${formatAnnouncementLabel(event)}</div>
        </div>
      </div>
    </div>`,

    // Signup commitment
    `<div class="page-content" style="padding-bottom:0;">
      <div class="card" style="margin-bottom:var(--space-6);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3);">
          <div>
            <span class="badge ${active ? "badge-active" : "badge-inactive"}">${active ? "Active" : "Scheduled"}</span>
            <h3 style="margin-top:var(--space-2);">Roster commitment</h3>
          </div>
          <span style="font-size:var(--text-2xl);font-weight:700;">${signed}/${capacity}</span>
        </div>
        <div class="progress">
          <div class="progress-bar ${percent >= 80 ? "success" : percent >= 50 ? "" : "warning"}" style="width:${percent}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:var(--space-2);">
          <span style="font-size:var(--text-xs);color:var(--text-muted);">Schedule: ${labelRecurrence(event.recurrence)} · ${formatRaidDays(event)}</span>
          <span style="font-size:var(--text-xs);color:var(--text-muted);">Auto repost: ${(event.autoRepost ?? event.recurrence === "weekly") ? "On" : "Off"}</span>
        </div>
      </div>
    </div>`,

    // Delivery info
    `<div class="page-content" style="padding-bottom:0;">
      <div class="card" style="margin-bottom:var(--space-6);">
        <h3 style="margin-bottom:var(--space-3);">Discord Delivery</h3>
        <div class="grid grid-4" style="gap:var(--space-4);">
          <div>
            <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Server</span>
            <p style="font-weight:600;margin-top:var(--space-1);">${esc(guild?.name ?? event.guildId ?? "Not assigned")}</p>
          </div>
          <div>
            <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Channel</span>
            <p style="font-weight:600;margin-top:var(--space-1);">${esc(channel ? `#${channel.name}` : channelId ?? "Not assigned")}</p>
          </div>
          <div>
            <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Ping Roles</span>
            <p style="font-weight:600;margin-top:var(--space-1);">${roles.length ? roles.map((role) => `@${esc(role)}`).join(", ") : "No role ping"}</p>
          </div>
          <div>
            <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Post Status</span>
            <p style="font-weight:600;margin-top:var(--space-1);">${esc(postStatus)}</p>
          </div>
        </div>
      </div>
    </div>`,

    // Weekly day rail
    days.length > 0
      ? `<div class="page-content" style="padding-bottom:0;">
          <div style="margin-bottom:var(--space-6);">
            <h3 style="margin-bottom:var(--space-3);">Schedule</h3>
            <div class="grid grid-${Math.min(days.length, 6)}" style="gap:var(--space-3);">
              ${days
                .map(
                  (day) => `<div class="card" style="text-align:center;">
                    <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;">${labelWarDay(day).slice(0, 3)}</span>
                    <h4 style="margin:var(--space-1) 0;">${labelWarDay(day)}</h4>
                    <p style="font-size:var(--text-sm);color:var(--text-muted);">${esc(territory)}</p>
                    <div style="margin-top:var(--space-2);font-size:var(--text-xs);color:var(--text-muted);">
                      <div>War: ${formatClockTime(event.time)}</div>
                      <div>Post: ${formatClockTime(event.announcementTime ?? config.nodeWarPostTime)}</div>
                    </div>
                  </div>`
                )
                .join("")}
            </div>
          </div>
        </div>`
      : "",

    // Upcoming announcements
    upcoming.length > 0
      ? `<div class="page-content" style="padding-bottom:0;">
          <div style="margin-bottom:var(--space-6);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3);">
              <h3>Upcoming Announcements</h3>
              <span style="font-size:var(--text-sm);color:var(--text-muted);">Next ${upcoming.length} scheduled</span>
            </div>
            <div class="grid grid-3" style="gap:var(--space-3);">
              ${upcoming
                .map(
                  (a, index) => `<div class="card" style="${index === 0 ? "border-color:var(--accent);" : ""}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2);">
                      <span class="badge ${index === 0 ? "badge-accent" : "badge-inactive"}">${index === 0 ? "Next Post" : labelWarDay(a.day)}</span>
                      <time style="font-size:var(--text-xs);color:var(--text-muted);" data-countdown="${announcementTimestamp(a)}">${formatAnnouncementDateTime(a)}</time>
                    </div>
                    <h4 style="margin-bottom:var(--space-2);">${esc(a.title)}</h4>
                    <div style="font-size:var(--text-sm);color:var(--text-muted);">
                      <div>War date: ${formatDateLabel(a.date)}</div>
                      <div>Capacity: ${a.totalCapacity} players</div>
                    </div>
                  </div>`
                )
                .join("")}
            </div>
          </div>
        </div>`
      : "",

    // Roster columns
    `<div class="page-content" style="padding-bottom:var(--space-12);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
        <div>
          <h3>Current Roster</h3>
          <p style="font-size:var(--text-sm);color:var(--text-muted);margin-top:var(--space-1);">${esc(event.title)} · ${formatDateLabel(event.date)} | ${formatClockTime(event.time)}</p>
        </div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(${Math.min(orderedGroups(event).length, 4)}, 1fr);gap:var(--space-4);">
        ${renderRosterColumns(event, canManage)}
      </div>
    </div>`,
  ].join("\n");

  const headExtra = canManage && session ? renderRosterMoveScript(event.id, session.csrfToken) : "";
  return renderApp(event.title, content, { session, headExtra });
}

/* ── Roster columns ──────────────────────────────────────────── */

function renderRosterColumns(event: WarEvent, canManage = false): string {
  return orderedGroups(event)
    .map((group) => {
      const signups = event.signups.filter((signup) => signup.group === group.key);
      const count = isRosterGroup(group.key) ? `${signups.length}/${group.capacity}` : String(signups.length);

      return `<div class="card ${canManage ? "roster-dropzone" : ""}" data-group="${esc(group.key)}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3);">
          <h4>${renderGroupIcon(group.key, group.emoji)} ${esc(group.label)}</h4>
          <span class="badge badge-inactive">${count}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--space-1);">
          ${signups
            .map(
              (signup, index) => `<div class="signup-row ${canManage ? "draggable-signup" : ""}" 
                data-user-id="${esc(signup.userId)}" 
                data-group="${esc(group.key)}"
                ${canManage ? 'draggable="true" style="cursor:grab;"' : ""}
                style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);border-radius:var(--radius-sm);background:var(--bg-surface);font-size:var(--text-sm);">
                <span>${renderSignupIcon(event, group.key, signup.requestedGroup)}</span>
                <span style="color:var(--text-muted);min-width:1.5rem;text-align:right;">${index + 1}</span>
                <span style="font-weight:500;">${esc(signup.displayName)}</span>
              </div>`
            )
            .join("") || `<p style="color:var(--text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-4);">No signups yet</p>`}
        </div>
      </div>`;
    })
    .join("");
}

/* ── Roster move script (drag-and-drop) ──────────────────────── */

function renderRosterMoveScript(eventId: string, csrfToken: string): string {
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
          draggedRow.style.opacity = "0.5";
        });

        row.addEventListener("dragend", () => {
          draggedRow?.classList.remove("is-dragging");
          if (draggedRow) draggedRow.style.opacity = "";
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

/* ── 3. Servers Page ─────────────────────────────────────────── */

export function renderServersPage(session: WebSession, summaries: GuildDashboardSummary[]): string {
  const cards = summaries.map((summary) => {
    const ready = summary.setupWarnings.length === 0;
    return `<div class="card">
      <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);">
        <span class="badge ${ready ? "badge-active" : "badge-warning"}">${ready ? "Ready" : "Attention"}</span>
      </div>
      <h3 style="margin-bottom:var(--space-2);">${esc(summary.guild.name)}</h3>
      <p style="font-size:var(--text-sm);color:var(--text-muted);margin-bottom:var(--space-3);">${summary.activeRaids} active · ${summary.upcomingRaids} upcoming</p>
      <div style="display:flex;gap:var(--space-2);">
        <a href="/raids?guild=${enc(summary.guild.id)}" class="button button-secondary button-sm">Raids</a>
        <a href="/stats?guild=${enc(summary.guild.id)}" class="button button-secondary button-sm">Stats</a>
      </div>
    </div>`;
  }).join("");

  const content = [
    renderPageHeader("Servers", "Manage your Discord servers and raid schedules."),
    `<div class="page-content">
      <div class="grid grid-3">
        ${cards || renderEmptyState(
          "No servers found",
          "Invite the bot to your Discord server to get started.",
          `<div style="display:flex;justify-content:center;margin-top:var(--space-4);">
            ${renderInviteButton("Invite Bot")}
          </div>`
        )}
      </div>
    </div>`,
  ].join("\n");

  return renderApp("Servers", content, { session, summaries, activeNav: "servers" });
}

/* ── 4. Member Login Page ────────────────────────────────────── */

export function renderMemberLoginPage(): string {
  const content = `
    <div class="page-content" style="padding-top:var(--space-16);">
      ${renderEmptyState(
        "Member View",
        "Sign in with Discord to view your raid signups and shared servers.",
        `<div style="display:flex;justify-content:center;margin-top:var(--space-4);">
          <a href="/auth/discord" class="button button-primary">Sign in with Discord</a>
        </div>`
      )}
    </div>`;

  return renderApp("Member View", content);
}

/* ── 5. Member Dashboard Page ────────────────────────────────── */

export function renderMemberDashboardPage(session: WebSession, summaries: GuildDashboardSummary[]): string {
  const raids = summaries
    .flatMap((s) => s.events.map((e) => ({ summary: s, event: e, sortTime: eventSortTimestamp(e) })))
    .sort((a, b) => a.sortTime - b.sortTime);

  const cards = raids.map(({ summary, event }) => {
    const signed = activeRosterSignupCount(event);
    const capacity = activeRosterCapacity(event);
    const active = isEventActive(event);
    const percent = capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0;

    return `<a href="/events/${enc(event.id)}" class="card" style="text-decoration:none;color:inherit;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-3);">
        <span class="badge ${active ? "badge-active" : "badge-inactive"}">${active ? "Active" : "Scheduled"}</span>
        <span style="font-size:var(--text-xs);color:var(--text-muted);">${formatDateLabel(event.date)}</span>
      </div>
      <h3 style="margin-bottom:var(--space-2);">${esc(scheduleTitle(event))}</h3>
      <p style="font-size:var(--text-sm);color:var(--text-muted);margin-bottom:var(--space-3);">${esc(summary.guild.name)}</p>
      <div class="progress" style="margin-bottom:var(--space-3);">
        <div class="progress-bar ${percent >= 80 ? "success" : percent >= 50 ? "" : "warning"}" style="width:${percent}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:var(--text-sm);font-weight:600;">${signed}/${capacity} signed</span>
        <span style="font-size:var(--text-sm);color:var(--text-muted);">${formatClockTime(event.time)}</span>
      </div>
    </a>`;
  }).join("");

  const content = [
    renderPageHeader("Member View", "Raids across your shared servers."),
    `<div class="page-content">
      <div class="grid grid-3">
        ${cards || renderEmptyState(
          "No raids found",
          "There are no upcoming raids across your shared servers."
        )}
      </div>
    </div>`,
  ].join("\n");

  return renderApp("Member View", content, { session, summaries });
}

/* ── 6. Login Required Page ──────────────────────────────────── */

export function renderLoginRequiredPage(): string {
  const content = `
    <div class="page-content" style="padding-top:var(--space-16);">
      ${renderEmptyState(
        "Login Required",
        "You need to sign in with Discord to access this page.",
        `<div style="display:flex;justify-content:center;margin-top:var(--space-4);">
          <a href="/auth/discord" class="button button-primary">Sign in with Discord</a>
        </div>`
      )}
    </div>`;

  return renderApp("Login Required", content);
}

/* ── 7. Login Failed Page ────────────────────────────────────── */

export function renderLoginPage(error?: string): string {
  const content = `
    <div class="page-content" style="padding-top:var(--space-16);">
      ${renderEmptyState(
        "Login Failed",
        error ? `Something went wrong: ${esc(error)}` : "We couldn't sign you in. Please try again.",
        `<div style="display:flex;justify-content:center;margin-top:var(--space-4);">
          <a href="/auth/discord" class="button button-primary">Try Again</a>
        </div>`
      )}
    </div>`;

  return renderApp("Login Failed", content);
}
