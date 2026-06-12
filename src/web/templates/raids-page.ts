import { escapeHtml, scheduleTitle, isEventActive, formatAnnouncementLabel, formatAnnouncementDateTime, formatDateLabel, formatRaidDays, labelRecurrence, orderedGroups, renderGroupIcon, renderSignupIcon, getUpcomingAnnouncements, announcementTimestamp, eventSortTimestamp, renderInviteButton } from '../utils.js';
import { renderApp, renderPageHeader, renderStatGrid, renderEmptyState } from './layout.js';
import { renderGuildAvatar } from './nav.js';
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

/* ── 1. Dashboard Page ──────────────────────────────────────── */

function renderDashboardAccordion(summaries: GuildDashboardSummary[], session?: WebSession): string {
  return summaries
    .map((summary, index) => {
      const gid = enc(summary.guild.id);
      const isAdmin = session ? canManageGuild(session, summary.guild.id) : false;
      const ready = summary.setupWarnings.length === 0;
      const subItems = [
        { href: `/events?guild=${gid}`, label: "War Room", desc: "Open rosters and schedules" },
        { href: `/stats?guild=${gid}`, label: "Combat Ledger", desc: "Scoreboard trends and player performance" },
        { href: `/stats/history?guild=${gid}`, label: "Archives", desc: "Past war scoreboards and exports" },
        { href: `/guilds/${gid}/performance`, label: "Performance", desc: "War analytics and combat stats" },
        { href: `/guilds/${gid}/attendance`, label: "Attendance", desc: "Player participation tracking" },
        { href: `/guilds/${gid}/activity`, label: "Guild Activity", desc: "BDO guild profile and members" },
      ];

      const adminBadge = isAdmin
        ? `<span class="dash-admin-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>Admin</span>`
        : "";

      return `<article class="dash-server${isAdmin ? " is-admin" : ""}" data-index="${index}">
        <button class="dash-server-row" type="button" aria-expanded="false" onclick="toggleDashServer(this)">
          <span class="dash-server-status ${ready ? "ready" : "warn"}" aria-hidden="true"></span>
          ${renderGuildAvatar(summary.guild)}
          <span class="dash-server-main">
            <span class="dash-server-name">${esc(summary.guild.name)}</span>
            <span class="dash-server-sub">${ready ? "Operational" : `${summary.setupWarnings.length} setup warning${summary.setupWarnings.length !== 1 ? "s" : ""}`}</span>
          </span>
          <span class="dash-server-spacer"></span>
          ${adminBadge}
          <svg class="dash-chevron" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
        </button>
        <div class="dash-server-menu" aria-hidden="true">
          ${subItems.map((item) => `<a class="dash-menu-item" href="${esc(item.href)}">
            <span class="dash-menu-label">${esc(item.label)}</span>
            <span class="dash-menu-desc">${esc(item.desc)}</span>
            <svg class="dash-menu-arrow" viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd"/></svg>
          </a>`).join("")}
        </div>
      </article>`;
    })
    .join("");
}

export function renderDashboardPage(
  events: WarEvent[],
  session?: WebSession,
  guildId?: string,
  summaries?: GuildDashboardSummary[]
): string {
  if (!session) {
    const content = `
      <div class="page-content" style="padding-top:var(--space-16);">
        ${renderEmptyState(
          "Sign in to view dashboard",
          "Connect your Discord account to open your Node War command dashboard.",
          `<div style="display:flex;justify-content:center;margin-top:var(--space-4);">
            <a href="/auth/discord" class="button button-primary">Sign in with Discord</a>
          </div>`
        )}
      </div>`;
    return renderApp("Dashboard", content, { activeNav: "dashboard" });
  }

  const dashboardSummaries = summaries ?? [];
  const serverCount = dashboardSummaries.length;
  const activeRaids = dashboardSummaries.reduce((sum, summary) => sum + summary.activeRaids, 0);
  const totalSignups = dashboardSummaries.reduce((sum, summary) => sum + summary.totalSignups, 0);
  const readyServers = dashboardSummaries.filter((summary) => summary.setupWarnings.length === 0).length;

  const content = `
    <section class="dash-command">
      <div class="dash-hero">
        <div class="dash-hero-copy">
          <p class="dash-kicker">Welcome, ${esc(session.user.global_name || session.user.username)}</p>
          <h1>Command the war room.</h1>
          <p class="dash-summary">Project Athena keeps strategy, rosters, guild intelligence, and post-war review in one place.</p>
        </div>
        <aside class="dash-overview" aria-label="Strategic overview">
          <h2>Strategic Overview</h2>
          <dl>
            <div><dt>Territory control</dt><dd><span><i style="width:${Math.min(100, serverCount * 18)}%"></i></span><b>${serverCount}</b></dd></div>
            <div><dt>Allied forces</dt><dd><span><i style="width:${serverCount ? Math.round((readyServers / serverCount) * 100) : 0}%"></i></span><b>${readyServers}/${serverCount}</b></dd></div>
            <div><dt>Active ops</dt><dd><span><i style="width:${Math.min(100, activeRaids * 24)}%"></i></span><b>${activeRaids}</b></dd></div>
            <div><dt>Roster flow</dt><dd><span><i style="width:${Math.min(100, totalSignups * 4)}%"></i></span><b>${totalSignups}</b></dd></div>
          </dl>
        </aside>
      </div>

      <div class="dash-network-panel">
        <div class="dash-section-head">
          <div>
            <p class="dash-panel-label">Guild Network</p>
            <h2>Choose a command channel</h2>
          </div>
          <span>${readyServers}/${serverCount} ready</span>
        </div>
        <div class="dash-server-list">
          ${dashboardSummaries.length ? renderDashboardAccordion(dashboardSummaries, session) : renderEmptyState(
            "No servers found",
            "Invite the bot to your Discord server to get started.",
            `<div style="display:flex;justify-content:center;margin-top:var(--space-4);">${renderInviteButton("Invite Bot")}</div>`
          )}
        </div>
      </div>
    </section>
    <script>
      (function () {
        function toggleDashServer(btn) {
          var server = btn.closest('.dash-server');
          var menu = server.querySelector('.dash-server-menu');
          var expanded = btn.getAttribute('aria-expanded') === 'true';

          // Close other open servers (accordion)
          document.querySelectorAll('.dash-server.is-open').forEach(function (other) {
            if (other !== server) {
              var otherBtn = other.querySelector('.dash-server-row');
              var otherMenu = other.querySelector('.dash-server-menu');
              otherBtn.setAttribute('aria-expanded', 'false');
              otherMenu.setAttribute('aria-hidden', 'true');
              other.classList.remove('is-open');
            }
          });

          btn.setAttribute('aria-expanded', String(!expanded));
          menu.setAttribute('aria-hidden', String(expanded));
          server.classList.toggle('is-open', !expanded);
        }
        window.toggleDashServer = toggleDashServer;
      })();
    </script>
  `;

  return renderApp("Dashboard", content, { session, summaries, activeNav: "dashboard" });
}

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
          "Sign in to view events",
          "Connect your Discord account to see event schedules across your servers.",
          `<div style="display:flex;justify-content:center;margin-top:var(--space-4);">
            <a href="/auth/discord" class="button button-primary">Sign in with Discord</a>
          </div>`
        )}
      </div>`;
    return renderApp("Events", content, { activeNav: "events" });
  }

  const selectedGuild = session.guilds.find((guild) => guild.id === guildId);
  const selectedCanManage = Boolean(session && guildId && canManageGuild(session, guildId));

  const visibleEvents = events.filter((event) => !event.closed || (event.recurrence === "once" && event.active === false));
  const activeEvents = visibleEvents.filter(isEventActive);
  const upcomingEvents = visibleEvents.filter((event) => !isEventActive(event));
  const totalSignups = activeEvents.reduce((sum, event) => sum + activeRosterSignupCount(event), 0);
  const weeklyPosts = activeEvents.filter((event) => event.recurrence === "weekly").length;

  const nextAnnouncement = [...activeEvents]
    .filter((event) => event.announcementDate && event.announcementTime && !event.announcedAt)
    .sort((left, right) => `${left.announcementDate} ${left.announcementTime}`.localeCompare(`${right.announcementDate} ${right.announcementTime}`))[0];

  const statStats = [
    { label: "Ongoing Events", value: String(activeEvents.length) },
    { label: "Upcoming Events", value: String(upcomingEvents.length) },
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

      return `<a href="/events/${enc(event.id)}" class="card" style="text-decoration:none;color:inherit;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-3);">
          <span class="badge ${active ? "badge-active" : "badge-inactive"}">${active ? "Ongoing" : "Upcoming"}</span>
          <span style="font-size:var(--text-xs);color:var(--text-muted);">${formatDateLabel(event.date)}</span>
        </div>
        <h3 style="margin-bottom:var(--space-2);">${esc(scheduleTitle(event))}</h3>
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

  const emptyEvents = renderEmptyState(
    "No events scheduled",
    selectedCanManage
      ? "Create a roster or use the Discord wizard to get started."
      : "No active events are posted for this server yet.",
    selectedCanManage && selectedGuild
      ? `<div style="display:flex;justify-content:center;margin-top:var(--space-4);"><a href="/create?guild=${enc(selectedGuild.id)}" class="button button-primary">Create Event</a></div>`
      : undefined
  );

  const createAction = selectedCanManage && selectedGuild
    ? `<a href="/create?guild=${enc(selectedGuild.id)}" class="button button-primary">Create Event</a>`
    : "";
  const content = [
    `<section class="page-content events-overview">
      <div class="section-heading">
        <p class="landing-kicker">Events</p>
        <h1>${selectedGuild ? esc(selectedGuild.name) : "Server Events"}</h1>
        <p>Upcoming and ongoing Node War events for this server.</p>
      </div>
      ${createAction}
    </section>`,
    `<div class="page-content" style="padding-top:0;padding-bottom:0;">
      ${renderStatGrid(statStats)}
    </div>`,
    `<section class="page-content raid-list-section">
      <div class="section-heading">
        <p class="landing-kicker">Events</p>
        <h2>Active and scheduled rosters</h2>
      </div>
      <div class="grid grid-3">
        ${cards || emptyEvents}
      </div>
    </section>`,
  ].join("\n");

  return renderApp("Events", content, { session, summaries, activeNav: "events" });
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
    `<a href="/dashboard" class="button button-secondary">Dashboard</a>`,
    canManage ? `<a href="/events/${enc(event.id)}/edit" class="button button-primary">Edit Raid</a>` : "",
    canManage && session
      ? `<form method="post" action="/events/${enc(event.id)}/delete" style="display:inline;" onsubmit="return confirm('Delete this raid event?')">
          <input type="hidden" name="csrfToken" value="${esc(session.csrfToken)}">
          <button class="button button-danger-outline" type="submit">Delete</button>
        </form>`
      : "",
  ].filter(Boolean).join("");
  const content = [
    // Page header
    renderPageHeader(
      esc(scheduleTitle(event)),
      guild ? esc(guild.name) : "Node War",
      `<div class="header-actions">${headerActions}</div>`
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
                ${canManage ? 'draggable="true"' : ""}>
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
    document.addEventListener("DOMContentLoaded", () => {
      const eventId = ${JSON.stringify(eventId)};
      const csrfToken = ${JSON.stringify(csrfToken)};
      let draggedRow;

      document.querySelectorAll(".draggable-signup").forEach((row) => {
        row.setAttribute("draggable", "true");

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
    });
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
        <a href="/events?guild=${enc(summary.guild.id)}" class="button button-secondary button-sm">Events</a>
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
