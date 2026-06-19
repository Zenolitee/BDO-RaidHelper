import {
  escapeHtml,
  buildGuildDashboardSummaries,
  eventSortTimestamp,
  warStartTimestamp,
  formatAnnouncementLabel,
  formatAnnouncementDateTime,
  formatDateLabel,
  scheduleTitle,
  isEventActive,
  formatRaidDays,
  renderInviteButton,
  botInviteUrl,
  orderedGroups,
  renderGroupIcon,
  renderSignupIcon,
  getUpcomingAnnouncements,
  announcementTimestamp,
  labelRecurrence
} from '../utils.js';
import {
  renderPage,
  renderWindow,
  renderPromptLine,
  renderTerminal,
  renderCountdownScript
} from './helpers.js';
import { renderGuildAvatar, renderStat, renderHomeStat, renderAccountControls } from './nav.js';
import { canManageGuild } from '../sessions.js';
import { config } from '../../config.js';
import { labelWarDay, NODE_WAR_PRESETS } from '../../nodewar-presets.js';
import type { WebSession, GuildDashboardSummary } from '../types.js';
import type { BotSettings, WarEvent } from '../../types.js';
import { activeRosterCapacity, activeRosterSignupCount } from '../../store.js';
import { formatClockTime } from '../../time-format.js';

export function renderFetchPanel(summaries: GuildDashboardSummary[], session: WebSession): string {
  const totalActive = summaries.reduce((sum, s) => sum + s.activeRaids, 0);
  const totalUpcoming = summaries.reduce((sum, s) => sum + s.upcomingRaids, 0);
  const totalSignups = summaries.reduce((sum, s) => sum + s.totalSignups, 0);
  const next = summaries
    .filter((s) => s.nextWarStartTime)
    .sort((a, b) => (a.nextWarStartTime ?? 0) - (b.nextWarStartTime ?? 0))[0];
  const nextAnnounce = summaries
    .filter((s) => s.nextAnnouncementTime)
    .sort((a, b) => (a.nextAnnouncementTime ?? 0) - (b.nextAnnouncementTime ?? 0))[0];
  const ready = summaries.filter((s) => s.setupWarnings.length === 0).length;
  const node = process.version;
  const uptimeHours = Math.floor(process.uptime() / 3600);
  const uptimeMin = Math.floor((process.uptime() % 3600) / 60);
  const totalGuilds = summaries.length;
  const colors = [
    { name: "bg", hex: "#2E3440" },
    { name: "pink", hex: "#FA5AA4" },
    { name: "green", hex: "#2BE491" },
    { name: "yellow", hex: "#EBCB8B" },
    { name: "cyan", hex: "#63C5EA" },
    { name: "magenta", hex: "#CF8EF4" },
    { name: "aqua", hex: "#8FBCBB" },
    { name: "white", hex: "#F9F9F9" }
  ];
  return `<aside class="fetch-panel">
    <pre class="fetch-ascii" aria-hidden="true">${"  "}     /\\
${"  "}    /  \\
${"  "}   /    \\
${"  "}  /      \\
${"  "} /  /\\    \\
${"  "}/  /  \\    \\
${"  "}/  /    \\    \\
${"  "}\\  \\    /  /
${"  "} \\  \\  /  /
${"  "}  \\  \\/  /
${"  "}   \\    /
${"  "}    \\  /
${"  "}     \\/</pre>
    <dl class="fetch-info">
      <div><dt>user</dt><dd>${escapeHtml(session.user.username)}</dd></div>
      <div><dt>host</dt><dd>athena-os</dd></div>
      <div><dt>shell</dt><dd>zsh 5.9</dd></div>
      <div><dt>wm</dt><dd>pinknord</dd></div>
      <div><dt>kernel</dt><dd>${escapeHtml(node)}</dd></div>
      <div><dt>uptime</dt><dd>${uptimeHours}h ${uptimeMin}m</dd></div>
      <div><dt>guilds</dt><dd>${totalGuilds}</dd></div>
      <div><dt>theme</dt><dd>PinkNord</dd></div>
      <div><dt>accent</dt><dd>#FA5AA4</dd></div>
    </dl>
    <div class="fetch-divider" aria-hidden="true"></div>
    <div class="fetch-telemetry">
      <p class="fetch-section-label">telemetry</p>
      <dl class="fetch-telemetry-grid">
        <div><dt>shared</dt><dd>${totalGuilds}</dd></div>
        <div><dt>active</dt><dd>${totalActive}</dd></div>
        <div><dt>queued</dt><dd>${totalUpcoming}</dd></div>
        <div><dt>signups</dt><dd>${totalSignups}</dd></div>
        <div><dt>ready</dt><dd>${ready}/${totalGuilds}</dd></div>
        <div><dt>announce</dt><dd>${nextAnnounce ? escapeHtml(nextAnnounce.nextAnnouncement ?? "queued") : "none"}</dd></div>
        <div><dt>war start</dt><dd>${next ? escapeHtml(next.nextWarStart ?? "queued") : "none"}</dd></div>
      </dl>
    </div>
    <div class="swatches" aria-hidden="true" style="grid-column: 1 / -1;">${colors.map((c) => `<span style="background:${c.hex}" title="${c.name} ${c.hex}"></span>`).join("")}</div>
  </aside>`;
}

export function renderHome(events: WarEvent[], session?: WebSession, settings: BotSettings = {}): string {
  if (!session) {
    const heroBody = `
      <p class="eyebrow">~/welcome.md</p>
      <h1>Project Athena keeps raids, rosters, and war stats organized.</h1>
      <p class="summary">Connect Discord to manage shared servers, schedule weekly Node War signup posts, track active rosters, and review uploaded scoreboard stats from one dark dashboard.</p>
      ${renderPromptLine({ path: "~", suffix: "cat welcome.md" })}
      ${renderTerminal([
        { kind: "comment", text: "# launch the bot, then sign in with Discord to unlock" },
        { kind: "key", text: "discord.oauth " },
        { kind: "val", text: "--scopes=identify,guilds" },
        { kind: "success", text: "  // ready" }
      ])}
      <div class="button-row">${renderAccountControls()}${renderInviteButton("Invite Bot")}</div>
    `;
    return `${renderWindow("welcome", heroBody, { prompt: "athena@os" })}`;
  }

  const summaries = buildGuildDashboardSummaries(session.guilds, events, settings);

  if (!summaries.length) {
    return `${renderWindow("no-shared-servers", renderNoSharedServersHome(), { prompt: "athena@os" })}${renderCountdownScript()}`;
  }

  const body = `
    ${renderPromptLine({ path: "~", suffix: "./athena --dashboard" })}
    <section class="war-room-layout" aria-label="Project Athena war room">
      ${renderCommandRail()}
      ${renderPrimaryWarFocus(summaries, session)}
      ${renderReadinessPanel(summaries[0])}
    </section>
    <section class="fetch-strip">${renderFetchPanel(summaries, session)}</section>
    ${renderUpcomingRaidsTimeline(summaries)}
    ${renderServerFleetSection(summaries)}
    ${renderRecentActivitySection()}
  `;
  return `${renderWindow("athena --dashboard", body, { prompt: "athena@os" })}${renderCountdownScript()}`;
}

export function renderCommandRail(): string {
  return `<aside class="command-rail" aria-label="Command actions">
    <p class="eyebrow">Command rail</p>
    ${renderCommandRailAction("Create Raid", "/create", "Choose server")}
    ${renderCommandRailAction("View All Events", "/events", "All shared servers")}
    ${renderCommandRailAction("View Stats", "/stats", "Choose server")}
    ${renderCommandRailAction("Manage Servers", "/servers", "Choose server")}
    ${botInviteUrl() ? renderCommandRailAction("Invite Bot", botInviteUrl() as string, "Expand fleet", true) : ""}
  </aside>`;
}

export function renderCommandRailAction(label: string, href: string, meta: string, external = false): string {
  return `<a class="command-action" href="${escapeHtml(href)}"${external ? " target=\"_blank\" rel=\"noreferrer\"" : ""}><strong>${escapeHtml(label)}</strong><span>${escapeHtml(meta)}</span></a>`;
}

export function renderPrimaryWarFocus(summaries: GuildDashboardSummary[], session: WebSession): string {
  const focused = summaries
    .flatMap((summary) => summary.events.map((event) => ({ summary, event, sortTime: eventSortTimestamp(event) })))
    .sort((left, right) => left.sortTime - right.sortTime)[0];
  if (!focused) {
    const guild = summaries[0].guild;
    return `<section class="primary-war-focus empty-war-focus">
      <p class="eyebrow">Next node war</p>
      <h1>No raids scheduled yet</h1>
      <p>Start by creating a Node War schedule for ${escapeHtml(guild.name)}.</p>
      <div class="button-row"><a class="button" href="/create?guild=${encodeURIComponent(guild.id)}">Create Event</a><a class="button button-secondary" href="/guilds/${encodeURIComponent(guild.id)}/events">View Events</a></div>
    </section>`;
  }
  const { summary, event } = focused;
  const signed = activeRosterSignupCount(event);
  const capacity = activeRosterCapacity(event);
  const percent = capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0;
  const territory = event.tier ? NODE_WAR_PRESETS[event.tier].territoryGroup : event.kind;
  const announcement = getUpcomingAnnouncements(event, 1)[0];
  const manageHref = canManageGuild(session, summary.guild.id) ? `/events/${encodeURIComponent(event.id)}/edit` : `/?guild=${encodeURIComponent(summary.guild.id)}`;
  return `<section class="primary-war-focus">
    <div class="war-focus-kicker"><span>NEXT ${announcement ? "ANNOUNCEMENT" : "NODE WAR"}</span><b data-countdown="${announcement ? announcementTimestamp(announcement) : warStartTimestamp(event)}">${announcement ? formatAnnouncementDateTime(announcement) : `${formatDateLabel(event.date)} ${formatClockTime(event.time)}`}</b></div>
    <div class="war-focus-title">
      ${renderGuildAvatar(summary.guild)}
      <div><p>${escapeHtml(summary.guild.name)}</p><h1>${escapeHtml(scheduleTitle(event))}</h1></div>
    </div>
    <dl class="war-focus-grid">
      <div><dt>Territory</dt><dd>${escapeHtml(territory)}</dd></div>
      <div><dt>Date</dt><dd>${formatDateLabel(event.date)}</dd></div>
      <div><dt>War start</dt><dd>${formatClockTime(event.time)}</dd></div>
      <div><dt>Announcement</dt><dd>${formatAnnouncementLabel(event)}</dd></div>
    </dl>
    <div class="war-progress"><div><span>Roster commitment</span><b>${signed}/${capacity}</b></div><span class="card-meter"><i style="width:${percent}%"></i></span></div>
    <div class="button-row"><a class="button" href="/events/${encodeURIComponent(event.id)}">Open Raid</a><a class="button button-secondary" href="${manageHref}">Manage</a></div>
  </section>`;
}

export function renderReadinessPanel(summary: GuildDashboardSummary): string {
  return `<aside class="readiness-panel">
    <div class="readiness-head">${renderGuildAvatar(summary.guild)}<div><p class="eyebrow">Server readiness</p><h2>${escapeHtml(summary.guild.name)}</h2></div></div>
    <dl class="readiness-metrics">
      <div><dt>Active raids</dt><dd>${summary.activeRaids}</dd></div>
      <div><dt>Upcoming</dt><dd>${summary.upcomingRaids}</dd></div>
      <div><dt>Signups</dt><dd>${summary.totalSignups}</dd></div>
    </dl>
    <ul class="readiness-list">
      ${renderSetupLine(summary.botInstalled, "Bot Installed", "Bot unavailable")}
      ${renderSetupLine(summary.channelConfigured, "Channel Configured", "Channel not configured")}
      ${renderSetupLine(summary.roleConfigured, "Role Configured", "Role not configured")}
      ${renderSetupLine(summary.schedulerActive, "Scheduler Active", "No active schedule")}
    </ul>
  </aside>`;
}

export function renderUpcomingRaidsTimeline(summaries: GuildDashboardSummary[]): string {
  const raids = summaries
    .flatMap((summary) => summary.events.map((event) => ({ summary, event, sortTime: eventSortTimestamp(event) })))
    .sort((left, right) => left.sortTime - right.sortTime)
    .slice(0, 6);
  return `<section class="timeline-section">
    <div class="section-title"><div><p class="eyebrow">Mission timeline</p><h2>Upcoming events</h2></div><a href="/events">View all events</a></div>
    <div class="raid-timeline">${raids
      .map(({ summary, event }) => {
        const signed = activeRosterSignupCount(event);
        const capacity = activeRosterCapacity(event);
        return `<article class="timeline-item">
          <time>${formatDateLabel(event.date)}</time>
          <span class="timeline-node"></span>
          <div><div class="card-top"><b>${escapeHtml(summary.guild.name)}</b><span class="status-pill ${isEventActive(event) ? "status-active" : "status-inactive"}">${isEventActive(event) ? "Active" : "Inactive"}</span></div><h3>${escapeHtml(scheduleTitle(event))}</h3><p>${signed}/${capacity} signed | Announces ${formatAnnouncementLabel(event)} | War ${formatClockTime(event.time)}</p></div>
        </article>`;
      })
      .join("") || `<article class="empty-state compact-empty"><h2>No upcoming raids</h2><p>Create a raid from the command rail to start building the schedule.</p></article>`}</div>
  </section>`;
}

export function renderServerFleetSection(summaries: GuildDashboardSummary[]): string {
  return `<section class="fleet-section">
    <div class="section-title"><div><p class="eyebrow">Server fleet</p><h2>Shared Discord servers</h2></div><span>${summaries.filter((summary) => !summary.setupWarnings.length).length}/${summaries.length} ready</span></div>
    <div class="server-fleet-grid">${summaries
      .map(
        (summary) => `<article class="fleet-card">
          <div class="fleet-head">${renderGuildAvatar(summary.guild)}<div><h3>${escapeHtml(summary.guild.name)}</h3><small>${summary.activeRaids} active | ${escapeHtml(summary.nextAnnouncement)}</small></div></div>
          <span class="setup-pill ${summary.setupWarnings.length ? "setup-pill-warning" : "setup-pill-ready"}">${summary.setupWarnings.length ? "Attention" : "Ready"}</span>
          <div class="fleet-links"><a href="/guilds/${encodeURIComponent(summary.guild.id)}/events">Events</a><a href="/guilds/${encodeURIComponent(summary.guild.id)}/stats">Stats</a><a href="/?guild=${encodeURIComponent(summary.guild.id)}">Manage</a></div>
        </article>`
      )
      .join("")}</div>
  </section>`;
}

export function renderRecentActivitySection(): string {
  return `<section class="activity-section">
    <div><p class="eyebrow">Recent activity</p><h2>Latest dashboard changes</h2></div>
    <p>No recent activity yet</p>
  </section>`;
}

export function renderNoSharedServersHome(): string {
  return `<section class="home-hero logged-out-hero command-hero">
    <div><p class="eyebrow">No shared servers</p><h1>No Discord servers are available yet</h1><p>Project Athena only lists servers where your Discord account has access and the bot is installed. Invite the bot, then log in again to refresh your session.</p><div class="button-row">${renderInviteButton("Invite Bot")}<a class="button button-secondary" href="/auth/discord">Refresh Login</a></div></div>
  </section>`;
}

export function renderGlobalStatsStrip(summaries: GuildDashboardSummary[]): string {
  const activeRaids = summaries.reduce((sum, summary) => sum + summary.activeRaids, 0);
  const upcomingRaids = summaries.reduce((sum, summary) => sum + summary.upcomingRaids, 0);
  const totalSignups = summaries.reduce((sum, summary) => sum + summary.totalSignups, 0);
  const nextAnnouncement = summaries.filter((summary) => summary.nextAnnouncementTime).sort((left, right) => (left.nextAnnouncementTime ?? 0) - (right.nextAnnouncementTime ?? 0))[0];
  const nextWar = summaries.filter((summary) => summary.nextWarStartTime).sort((left, right) => (left.nextWarStartTime ?? 0) - (right.nextWarStartTime ?? 0))[0];
  return `<section class="ops-telemetry" aria-label="Global operations telemetry">
    ${renderHomeStat("Servers", String(summaries.length), "Shared")}
    ${renderHomeStat("Active", String(activeRaids), "Raids")}
    ${renderHomeStat("Upcoming", String(upcomingRaids), "Queue")}
    ${renderHomeStat("Signups", String(totalSignups), "Roster")}
    ${renderHomeStat("Announce", nextAnnouncement?.nextAnnouncement ?? "None queued", "Next")}
    ${renderHomeStat("War start", nextWar?.nextWarStart ?? "No war queued", "Next")}
  </section>`;
}

export function renderSetupLine(ok: boolean, ready: string, warning: string): string {
  return `<li class="${ok ? "is-ready" : "is-warning"}"><span>${ok ? "OK" : "!"}</span>${escapeHtml(ok ? ready : warning)}</li>`;
}
