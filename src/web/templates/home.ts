import { escapeHtml, buildGuildDashboardSummaries, eventSortTimestamp, warStartTimestamp, formatAnnouncementLabel, formatAnnouncementDateTime, formatDateLabel, scheduleTitle, isEventActive, renderInviteButton, botInviteUrl, getUpcomingAnnouncements, announcementTimestamp } from '../utils.js';
import { formatClockTime } from '../../time-format.js';
import { renderApp, renderPageHeader, renderStatGrid, renderEmptyState } from './layout.js';
import { canManageGuild } from '../sessions.js';
import { config } from '../../config.js';
import { labelWarDay, NODE_WAR_PRESETS } from '../../nodewar-presets.js';
import type { WebSession, GuildDashboardSummary } from '../types.js';
import type { BotSettings, WarEvent } from '../../types.js';
import { activeRosterCapacity, activeRosterSignupCount } from '../../store.js';

/* ── Home page ──────────────────────────────────────────────── */

export function renderHome(events: WarEvent[], session?: WebSession, settings: BotSettings = {}): string {
  if (!session) {
    return renderLoggedOutHome();
  }

  const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);
  if (!summaries.length) {
    return renderNoServersHome(session);
  }

  const content = [
    renderHomeHeader(),
    renderGlobalStats(summaries),
    renderNextWarFocus(summaries, session),
    renderUpcomingRaidCards(summaries),
    renderServerCards(summaries),
    renderQuickActions(session),
  ].join("\n");

  return renderApp("Dashboard", content, { session, summaries, activeNav: "home" });
}

/* ── Sections ───────────────────────────────────────────────── */

function renderLoggedOutHome(): string {
  const content = `
    <div class="page-header">
      <div class="page-header-inner">
        <div>
          <h1 class="page-title">NW Helper</h1>
          <p class="page-subtitle">Raid rosters, war schedules, and stats — organized.</p>
        </div>
        <div style="display:flex;gap:var(--space-3);">
          <a href="/auth/discord" class="button button-primary">Sign in with Discord</a>
          ${botInviteUrl() ? renderInviteButton("Invite Bot") : ""}
        </div>
      </div>
    </div>
    <div class="page-content">
      <div class="grid grid-3" style="margin-top:var(--space-8);">
        <div class="card">
          <h3>Raid Scheduling</h3>
          <p style="margin-top:var(--space-2);">Create and manage Node War rosters with tier-based capacity presets and weekly recurrence.</p>
        </div>
        <div class="card">
          <h3>Discord Integration</h3>
          <p style="margin-top:var(--space-2);">Post announcements to your server channels. Members sign up directly from Discord.</p>
        </div>
        <div class="card">
          <h3>Score Tracking</h3>
          <p style="margin-top:var(--space-2);">Upload scoreboard screenshots or enter stats manually. Track kills, deaths, assists, and impact.</p>
        </div>
      </div>
    </div>`;

  return renderApp("Welcome", content, { activeNav: "home" });
}

function renderNoServersHome(session: WebSession): string {
  const content = `
    ${renderPageHeader("No Shared Servers", "Invite the bot to your Discord server to get started.")}
    <div class="page-content">
      ${renderEmptyState(
        "No Discord servers found",
        "NW Helper only lists servers where your Discord account has access and the bot is installed.",
        `<div style="display:flex;gap:var(--space-3);justify-content:center;margin-top:var(--space-4);">
          ${renderInviteButton("Invite Bot")}
          <a href="/auth/discord" class="button button-secondary">Refresh Login</a>
        </div>`
      )}
    </div>`;

  return renderApp("No Servers", content, { session, activeNav: "home" });
}

function renderHomeHeader(): string {
  const now = new Date();
  const hours = now.getHours();
  const greeting = hours < 12 ? "Good morning" : hours < 18 ? "Good afternoon" : "Good evening";
  return renderPageHeader(greeting, "Here's what's happening across your servers.");
}

function renderGlobalStats(summaries: GuildDashboardSummary[]): string {
  const activeRaids = summaries.reduce((sum, s) => sum + s.activeRaids, 0);
  const upcomingRaids = summaries.reduce((sum, s) => sum + s.upcomingRaids, 0);
  const totalSignups = summaries.reduce((sum, s) => sum + s.totalSignups, 0);
  const ready = summaries.filter((s) => s.setupWarnings.length === 0).length;

  return `<div class="page-content" style="padding-top:var(--space-4);padding-bottom:0;">
    ${renderStatGrid([
      { label: "Shared Servers", value: String(summaries.length) },
      { label: "Active Raids", value: String(activeRaids) },
      { label: "Total Signups", value: String(totalSignups) },
      { label: "Setup Status", value: `${ready}/${summaries.length}`, change: ready === summaries.length ? "All ready" : "Needs attention" },
    ])}
  </div>`;
}

function renderNextWarFocus(summaries: GuildDashboardSummary[], session: WebSession): string {
  const focused = summaries
    .flatMap((s) => s.events.map((e) => ({ summary: s, event: e, sortTime: eventSortTimestamp(e) })))
    .sort((a, b) => a.sortTime - b.sortTime)[0];

  if (!focused) {
    const guild = summaries[0].guild;
    return `<div class="page-content">
      <div class="card" style="text-align:center;padding:var(--space-10);">
        <h2>No raids scheduled yet</h2>
        <p style="margin:var(--space-2) 0 var(--space-4);">Create a Node War schedule for ${esc(guild.name)}.</p>
        <div style="display:flex;gap:var(--space-3);justify-content:center;">
          <a href="/create?guild=${enc(guild.id)}" class="button button-primary">Create Raid</a>
          <a href="/raids" class="button button-secondary">View Raids</a>
        </div>
      </div>
    </div>`;
  }

  const { summary, event } = focused;
  const signed = activeRosterSignupCount(event);
  const capacity = activeRosterCapacity(event);
  const percent = capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0;
  const territory = event.tier ? NODE_WAR_PRESETS[event.tier].territoryGroup : event.kind;
  const announcement = getUpcomingAnnouncements(event, 1)[0];
  const manageHref = canManageGuild(session, summary.guild.id) ? `/events/${enc(event.id)}/edit` : `/?guild=${enc(summary.guild.id)}`;

  return `<div class="page-content">
    <div class="card">
      <div class="card-header">
        <div>
          <span class="badge badge-accent" style="margin-bottom:var(--space-2);display:inline-block;">NEXT ${announcement ? "ANNOUNCEMENT" : "NODE WAR"}</span>
          <h2 style="margin-top:var(--space-1);">${esc(scheduleTitle(event))}</h2>
          <p style="margin-top:var(--space-1);">${esc(summary.guild.name)} · ${esc(territory)}</p>
        </div>
        <span data-countdown="${announcement ? announcementTimestamp(announcement) : warStartTimestamp(event)}" class="badge badge-warning" style="font-size:var(--text-sm);">
          ${announcement ? formatAnnouncementDateTime(announcement) : `${formatDateLabel(event.date)} ${formatClockTime(event.time)}`}
        </span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-4);margin:var(--space-4) 0;">
        <div>
          <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Territory</span>
          <p style="font-weight:600;margin-top:var(--space-1);">${esc(territory)}</p>
        </div>
        <div>
          <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Date</span>
          <p style="font-weight:600;margin-top:var(--space-1);">${formatDateLabel(event.date)}</p>
        </div>
        <div>
          <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">War Start</span>
          <p style="font-weight:600;margin-top:var(--space-1);">${formatClockTime(event.time)}</p>
        </div>
        <div>
          <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Announcement</span>
          <p style="font-weight:600;margin-top:var(--space-1);">${formatAnnouncementLabel(event)}</p>
        </div>
      </div>

      <div style="margin:var(--space-4) 0;">
        <div style="display:flex;justify-content:space-between;margin-bottom:var(--space-2);">
          <span style="font-size:var(--text-sm);color:var(--text-secondary);">Roster commitment</span>
          <span style="font-size:var(--text-sm);font-weight:600;">${signed}/${capacity}</span>
        </div>
        <div class="progress">
          <div class="progress-bar ${percent >= 80 ? "success" : percent >= 50 ? "" : "warning"}" style="width:${percent}%"></div>
        </div>
      </div>

      <div style="display:flex;gap:var(--space-3);">
        <a href="/events/${enc(event.id)}" class="button button-primary">Open Raid</a>
        <a href="${manageHref}" class="button button-secondary">Manage</a>
      </div>
    </div>
  </div>`;
}

function renderUpcomingRaidCards(summaries: GuildDashboardSummary[]): string {
  const raids = summaries
    .flatMap((s) => s.events.map((e) => ({ summary: s, event: e, sortTime: eventSortTimestamp(e) })))
    .sort((a, b) => a.sortTime - b.sortTime)
    .slice(0, 6);

  if (!raids.length) return "";

  return `<div class="page-content">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
      <h2>Upcoming Raids</h2>
      <a href="/raids" class="button button-ghost button-sm">View all</a>
    </div>
    <div class="grid grid-3">
      ${raids.map(({ summary, event }) => {
        const signed = activeRosterSignupCount(event);
        const capacity = activeRosterCapacity(event);
        const active = isEventActive(event);
        return `<a href="/events/${enc(event.id)}" class="card" style="text-decoration:none;color:inherit;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-3);">
            <span class="badge ${active ? "badge-active" : "badge-inactive"}">${active ? "Active" : "Scheduled"}</span>
            <span style="font-size:var(--text-xs);color:var(--text-muted);">${formatDateLabel(event.date)}</span>
          </div>
          <h3 style="margin-bottom:var(--space-2);">${esc(scheduleTitle(event))}</h3>
          <p style="font-size:var(--text-sm);color:var(--text-muted);margin-bottom:var(--space-3);">${esc(summary.guild.name)}</p>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:var(--text-sm);">${signed}/${capacity} signed</span>
            <span style="font-size:var(--text-sm);color:var(--text-muted);">${formatClockTime(event.time)}</span>
          </div>
        </a>`;
      }).join("")}
    </div>
  </div>`;
}

function renderServerCards(summaries: GuildDashboardSummary[]): string {
  return `<div class="page-content">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
      <h2>Servers</h2>
      <a href="/servers" class="button button-ghost button-sm">Manage</a>
    </div>
    <div class="grid grid-3">
      ${summaries.map((summary) => {
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
      }).join("")}
    </div>
  </div>`;
}

function renderQuickActions(session: WebSession): string {
  const actions = [
    { href: "/create", label: "Create Raid", primary: true },
    { href: "/raids", label: "View All Raids", primary: false },
    { href: "/stats", label: "View Stats", primary: false },
  ];

  return `<div class="page-content" style="padding-bottom:var(--space-12);">
    <div style="display:flex;gap:var(--space-3);">
      ${actions.map((a) => `<a href="${a.href}" class="button ${a.primary ? "button-primary" : "button-secondary"}">${a.label}</a>`).join("")}
    </div>
  </div>`;
}

/* ── Helpers ──────────────────────────────────────────────────── */

function esc(value: string): string {
  return escapeHtml(value);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}
