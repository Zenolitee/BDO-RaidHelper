import { escapeHtml, buildGuildDashboardSummaries, eventSortTimestamp, warStartTimestamp, formatAnnouncementLabel, formatAnnouncementDateTime, formatDateLabel, scheduleTitle, isEventActive, renderInviteButton, botInviteUrl, getUpcomingAnnouncements, announcementTimestamp } from '../utils.js';
import { formatClockTime } from '../../time-format.js';
import { renderApp, renderPageHeader, renderStatGrid, renderEmptyState } from './layout.js';
import { bdoCommunityApi } from '../../integrations/bdo-community.js';
import { ikusaLogger } from '../../integrations/ikusa-logger.js';
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
    renderCommandCenterHero(summaries, session),
    renderFeatureOverview(),
    renderAthenaFooter(),
  ].join("\n");

  return renderApp("Command Center", content, { session, summaries, activeNav: "home" });
}

/* ── Sections ───────────────────────────────────────────────── */

function renderLoggedOutHome(): string {
  const content = `
    <section class="athena-hero-bg">
      <div class="athena-hero-content">
        <img src="/assets/project_athena.png" alt="Project Athena" class="athena-hero-logo">
        <p class="athena-hero-kicker">COMMAND CENTER</p>
        <h1 class="athena-hero-title">Project Athena</h1>
        <p class="athena-hero-sub">Strategic Command Center</p>
        <p class="athena-hero-desc">Node war coordination, roster management, combat intelligence, and guild analytics — unified in one tactical operations platform.</p>
        <div class="athena-hero-actions">
          <a href="/auth/discord" class="button button-primary">Enter the War Room</a>
          ${botInviteUrl() ? renderInviteButton("Deploy Bot") : ""}
        </div>
      </div>
    </section>`;

  return renderApp("Welcome", content, { activeNav: "home" });
}

function renderNoServersHome(session: WebSession): string {
  const content = `
    <section class="athena-hero-bg">
      <div class="athena-hero-content">
        <img src="/assets/project_athena.png" alt="Project Athena" class="athena-hero-logo">
        <p class="athena-hero-kicker">COMMAND CENTER</p>
        <h1 class="athena-hero-title">Project Athena</h1>
        <p class="athena-hero-sub">No Guilds Connected</p>
        <p class="athena-hero-desc">Deploy Project Athena to your Discord server to begin operations.</p>
        <div class="athena-hero-actions">
          ${renderInviteButton("Deploy Bot")}
          <a href="/auth/discord" class="button button-secondary">Refresh Session</a>
        </div>
      </div>
    </section>`;

  return renderApp("No Servers", content, { session, activeNav: "home" });
}

/* ── 1. Command Center Hero ─────────────────────────────────── */

function renderCommandCenterHero(summaries: GuildDashboardSummary[], session: WebSession): string {
  const activeRaids = summaries.reduce((sum, s) => sum + s.activeRaids, 0);
  const upcomingRaids = summaries.reduce((sum, s) => sum + s.upcomingRaids, 0);
  const totalSignups = summaries.reduce((sum, s) => sum + s.totalSignups, 0);
  const ready = summaries.filter((s) => s.setupWarnings.length === 0).length;
  const user = session.user;

  // Find last war
  const pastEvents = summaries
    .flatMap((s) => s.events.map((e) => ({ summary: s, event: e, sortTime: eventSortTimestamp(e) })))
    .filter((e) => e.sortTime < Date.now())
    .sort((a, b) => b.sortTime - a.sortTime);
  const lastWar = pastEvents[0];

  // Find next war
  const futureEvents = summaries
    .flatMap((s) => s.events.map((e) => ({ summary: s, event: e, sortTime: eventSortTimestamp(e) })))
    .filter((e) => e.sortTime >= Date.now())
    .sort((a, b) => a.sortTime - b.sortTime);
  const nextWar = futureEvents[0];

  return `<section class="athena-hero-bg">

    <div class="athena-hero-content">
      <img src="/assets/project_athena.png" alt="Project Athena" class="athena-hero-logo">
      <p class="athena-hero-kicker">COMMAND CENTER</p>
      <h1 class="athena-hero-title">Project Athena</h1>
      <p class="athena-hero-sub">Strategic Command Center</p>
    </div>
    <div class="athena-hero-actions">
      <a href="/dashboard" class="button button-primary">View Dashboard</a>
    </div>
  </section>`;
}

/* ── 2. Operation Grid ──────────────────────────────────────── */

function renderOperationGrid(summaries: GuildDashboardSummary[], session: WebSession): string {
  const focused = summaries
    .flatMap((s) => s.events.map((e) => ({ summary: s, event: e, sortTime: eventSortTimestamp(e) })))
    .filter((e) => e.sortTime >= Date.now())
    .sort((a, b) => a.sortTime - b.sortTime)[0];

  if (!focused) {
    const guild = summaries[0].guild;
    return `<section class="page-content" style="max-width:820px;margin:0 auto;padding-top:var(--space-8);padding-bottom:var(--space-4);">
      <div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:var(--space-6);text-align:center;">
        <p style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:var(--accent);margin-bottom:var(--space-2);">No Campaigns Active</p>
        <h3 style="margin:0 0 var(--space-3);">Schedule a Node War for ${esc(guild.name)}</h3>
        <div style="display:flex;gap:var(--space-3);justify-content:center;">
          <a href="/create?guild=${enc(guild.id)}" class="button button-primary">Create Campaign</a>
          <a href="/events?guild=${enc(guild.id)}" class="button button-secondary">View Events</a>
        </div>
      </div>
    </section>`;
  }

  const { summary, event } = focused;
  const signed = activeRosterSignupCount(event);
  const capacity = activeRosterCapacity(event);
  const percent = capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0;
  const territory = event.tier ? NODE_WAR_PRESETS[event.tier].territoryGroup : event.kind;
  const announcement = getUpcomingAnnouncements(event, 1)[0];
  const manageHref = canManageGuild(session, summary.guild.id) ? `/events/${enc(event.id)}/edit` : `/?guild=${enc(summary.guild.id)}`;

  return `<section class="page-content" style="max-width:820px;margin:0 auto;padding-top:var(--space-6);padding-bottom:var(--space-4);">

    <div class="athena-op-card">
      <div class="athena-op-head">
        <div>
          <span class="athena-op-tag">Next Campaign</span>
          <h2 class="athena-op-title">${esc(scheduleTitle(event))}</h2>
          <p class="athena-op-sub">${esc(summary.guild.name)} · ${esc(territory)}</p>
        </div>
        <span data-countdown="${announcement ? announcementTimestamp(announcement) : warStartTimestamp(event)}" style="font-size:var(--text-xs);font-weight:600;color:var(--accent);background:var(--accent-muted);padding:var(--space-1) var(--space-3);border-radius:var(--radius-sm);white-space:nowrap;">
          ${announcement ? formatAnnouncementDateTime(announcement) : `${formatDateLabel(event.date)} ${formatClockTime(event.time)}`}
        </span>
      </div>

      <div class="athena-op-meta">
        <div class="athena-op-meta-cell">
          <span class="athena-op-meta-lbl">Territory</span>
          <span class="athena-op-meta-val">${esc(territory)}</span>
        </div>
        <div class="athena-op-meta-cell">
          <span class="athena-op-meta-lbl">Date</span>
          <span class="athena-op-meta-val">${formatDateLabel(event.date)}</span>
        </div>
        <div class="athena-op-meta-cell">
          <span class="athena-op-meta-lbl">War Start</span>
          <span class="athena-op-meta-val">${formatClockTime(event.time)}</span>
        </div>
        <div class="athena-op-meta-cell">
          <span class="athena-op-meta-lbl">Announcement</span>
          <span class="athena-op-meta-val">${formatAnnouncementLabel(event)}</span>
        </div>
      </div>

      <div class="athena-op-progress">
        <div style="display:flex;justify-content:space-between;">
          <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Roster Commitment</span>
          <span style="font-size:var(--text-xs);font-weight:700;color:${percent >= 80 ? "var(--success)" : percent >= 50 ? "var(--accent)" : "var(--danger)"};">${signed}/${capacity} · ${percent}%</span>
        </div>
        <div class="athena-op-bar">
          <div class="athena-op-fill" style="width:${percent}%;background:${percent >= 80 ? "var(--success)" : percent >= 50 ? "var(--accent)" : "var(--danger)"};"></div>
        </div>
      </div>

      <div class="athena-op-actions">
        <a href="/events/${enc(event.id)}" class="button button-primary button-sm">Open Campaign</a>
        <a href="${manageHref}" class="button button-secondary button-sm">Manage</a>
      </div>
    </div>
  </section>`;
}

/* ── 3. Next Operation ──────────────────────────────────────── */

function renderNextOperation(summaries: GuildDashboardSummary[], session: WebSession): string {
  return "";
}

/* ── 4. Upcoming Campaigns ──────────────────────────────────── */

function renderUpcomingCampaigns(summaries: GuildDashboardSummary[]): string {
  const raids = summaries
    .flatMap((s) => s.events.map((e) => ({ summary: s, event: e, sortTime: eventSortTimestamp(e) })))
    .filter((e) => e.sortTime >= Date.now())
    .sort((a, b) => a.sortTime - b.sortTime)
    .slice(0, 6);

  if (!raids.length) return "";

  return `<section class="page-content" style="max-width:820px;margin:0 auto;padding-top:var(--space-2);padding-bottom:var(--space-4);">

    <div class="athena-campaigns">
      <div class="athena-campaigns-head">
        <h3>Upcoming Campaigns</h3>
        <a href="/dashboard" style="font-size:var(--text-xs);color:var(--text-muted);text-decoration:none;">View all →</a>
      </div>
      ${raids.map(({ summary, event }) => {
        const signed = activeRosterSignupCount(event);
        const capacity = activeRosterCapacity(event);
        const active = isEventActive(event);
        return `<a href="/events/${enc(event.id)}" class="athena-campaign-row">
          <span class="athena-campaign-date">${formatDateLabel(event.date)}</span>
          <div class="athena-campaign-info">
            <span class="athena-campaign-name">${esc(scheduleTitle(event))}</span>
            <span class="athena-campaign-guild">${esc(summary.guild.name)} · ${signed}/${capacity} signed</span>
          </div>
          <span class="athena-campaign-time">${formatClockTime(event.time)}</span>
          <span class="athena-campaign-badge ${active ? "active" : "scheduled"}">${active ? "Active" : "Scheduled"}</span>
        </a>`;
      }).join("")}
    </div>
  </section>`;
}

/* ── 5. Guild Network ───────────────────────────────────────── */

function renderGuildNetwork(summaries: GuildDashboardSummary[]): string {
  return `<section class="page-content" style="max-width:820px;margin:0 auto;padding-top:var(--space-2);padding-bottom:var(--space-4);">

    <div class="athena-network">
      <div class="athena-network-head">
        <h3>Guild Network</h3>
        <a href="/servers" style="font-size:var(--text-xs);color:var(--text-muted);text-decoration:none;">Manage →</a>
      </div>
      ${summaries.map((summary) => {
        const ready = summary.setupWarnings.length === 0;
        return `<div class="athena-guild-row">
          <span class="athena-guild-dot ${ready ? "ready" : "warn"}"></span>
          <span class="athena-guild-name">${esc(summary.guild.name)}</span>
          <span class="athena-guild-stats">${summary.activeRaids} active · ${summary.upcomingRaids} upcoming</span>
          <div class="athena-guild-links">
            <a href="/events?guild=${enc(summary.guild.id)}" class="button button-ghost button-sm" style="font-size:var(--text-xs);padding:2px 8px;">Events</a>
            <a href="/stats?guild=${enc(summary.guild.id)}" class="button button-ghost button-sm" style="font-size:var(--text-xs);padding:2px 8px;">Stats</a>
          </div>
        </div>`;
      }).join("")}
    </div>
  </section>`;
}

/* ── 6. Quick Nav ───────────────────────────────────────────── */

function renderQuickNav(session: WebSession): string {
  return `<section class="page-content" style="max-width:820px;margin:0 auto;padding-top:var(--space-2);padding-bottom:var(--space-10);">

    <div class="athena-nav">
      <a href="/create" class="athena-nav-item">
        <span class="athena-nav-icon" style="background:var(--accent-muted);color:var(--accent);">⚔</span>
        <span class="athena-nav-label">New Campaign</span>
      </a>
      <a href="/dashboard" class="athena-nav-item">
        <span class="athena-nav-icon" style="background:var(--accent-muted);color:var(--accent-hover);">📊</span>
        <span class="athena-nav-label">Dashboard</span>
      </a>
      <a href="/stats" class="athena-nav-item">
        <span class="athena-nav-icon" style="background:var(--success-muted);color:var(--success);">📋</span>
        <span class="athena-nav-label">Scoreboard</span>
      </a>
      <a href="/member" class="athena-nav-item">
        <span class="athena-nav-icon" style="background:var(--danger-muted);color:var(--danger);">🛡</span>
        <span class="athena-nav-label">Member View</span>
      </a>
      <a href="/docs" class="athena-nav-item">
        <span class="athena-nav-icon" style="background:rgba(255,255,255,0.05);color:var(--text-secondary);">📖</span>
        <span class="athena-nav-label">Docs</span>
      </a>
    </div>
  </section>`;
}

function renderFeatureOverview(): string {
  return `<section class="athena-feature-overview" aria-label="Project Athena features">
    <div class="athena-section-heading">
      <p class="athena-hero-kicker">WAR COUNCIL TOOLS</p>
      <h2>Everything your guild needs between signup and score review.</h2>
    </div>
    <div class="athena-feature-shell">
      <div class="athena-feature-grid">
        <article>
          <span>01</span>
          <h3>Campaign Planning</h3>
          <p>Create node war schedules, manage rosters, and keep war start and announcement timing visible.</p>
        </article>
        <article>
          <span>02</span>
          <h3>Guild Intelligence</h3>
          <p>Track guild activity, BDO profile context, roster health, and attendance from one command surface.</p>
        </article>
        <article>
          <span>03</span>
          <h3>Combat Ledger</h3>
          <p>Upload scoreboards, review player trends, compare wars, and preserve score history for debriefs.</p>
        </article>
        <article>
          <span>04</span>
          <h3>Discord Operations</h3>
          <p>Keep server-specific dashboards, event links, permissions, and command flows tied to each guild.</p>
        </article>
      </div>
      <aside class="athena-support-panel" aria-label="Supported integrations">
        <p class="athena-hero-kicker">SUPPORTED INTEL</p>
        <h3>Built for BDO war rooms.</h3>
        <ul>
          <li><strong>Ikusa Logger</strong><span>Combat log support path for richer war analysis.</span></li>
          <li><strong>BDO Community API</strong><span>Guild and player lookup for EU, NA, SA, and KR regions.</span></li>
          <li><strong>Pearl Abyss ASIA</strong><span>HTML scraper support for ASIA guild profiles.</span></li>
          <li><strong>Discord API</strong><span>Authentication, guild context, permissions, and bot workflows.</span></li>
          <li><strong>OCR Scoreboards</strong><span>Screenshot-to-score pipeline for combat reports.</span></li>
        </ul>
      </aside>
    </div>
  </section>`;
}

function renderAthenaFooter(): string {
  return `<footer class="athena-footer">
    <span>PROJECT ATHENA</span>
    <span>Made by Zeno · Discord 0xf4f4</span>
  </footer>`;
}

/* ── Helpers ──────────────────────────────────────────────────── */

function esc(value: string): string {
  return escapeHtml(value);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}
