import { escapeHtml, buildGuildDashboardSummaries, eventSortTimestamp, scheduleTitle, isEventActive, formatDateLabel, formatAnnouncementLabel, formatAnnouncementDateTime, orderedGroups, renderGroupIcon, renderInviteButton, getUpcomingAnnouncements, announcementTimestamp, warStartTimestamp } from '../utils.js';
import { renderPage, renderWindow, renderCountdownScript } from './helpers.js';
import { renderGuildAvatar, renderStat } from './nav.js';
import { canManageGuild } from '../sessions.js';
import type { WebSession, GuildDashboardSummary, DiscordGuild } from '../types.js';
import type { WarEvent } from '../../types.js';
import { activeRosterCapacity, activeRosterSignupCount, isRosterGroup } from '../../store.js';
import { formatClockTime } from '../../time-format.js';
import { labelWarDay } from '../../nodewar-presets.js';

export function renderMemberLogin(): string {
  return `<main class="shell member-shell">
    <section class="member-hero member-login-hero">
      <div><p class="eyebrow">Member roster view</p><h1>Check your guild's Node War roster without admin controls.</h1><p>Log in with Discord to see only servers you share with NW Helper and the current raid rosters available to your account.</p><div class="button-row"><a class="button" href="/auth/discord">Log in with Discord</a>${renderInviteButton("Invite Bot")}</div></div>
    </section>
  </main>`;
}

export function renderAllRaidsDashboard(session: WebSession, summaries: GuildDashboardSummary[]): string {
  const raids = summaries
    .flatMap((summary) => summary.events.map((event) => ({ summary, event, sortTime: eventSortTimestamp(event) })))
    .sort((left, right) => left.sortTime - right.sortTime);
  const inner = `<main class="shell member-shell">
    <section class="member-hero">
      <div><p class="eyebrow">All raids</p><h1>Raid board across your shared servers</h1><p>Aggregated read-only raid schedule for every server you share with NW Helper.</p></div>
      <dl class="member-telemetry">
        <div><dt>Servers</dt><dd>${summaries.length}</dd></div>
        <div><dt>Total raids</dt><dd>${raids.length}</dd></div>
        <div><dt>Active</dt><dd>${raids.filter(({ event }) => isEventActive(event)).length}</dd></div>
        <div><dt>Signups</dt><dd>${summaries.reduce((sum, summary) => sum + summary.totalSignups, 0)}</dd></div>
      </dl>
    </section>
    <section class="member-section">
      <div class="section-title"><div><p class="eyebrow">Raid operations</p><h2>All visible schedules</h2></div><span>${raids.length} raids</span></div>
      <div class="member-raid-grid">${raids.map(({ summary, event }) => renderMemberRaidCard(summary, event)).join("") || `<div class="empty-state compact-empty"><h2>No raids found</h2><p>No raid schedules are available for your shared servers yet.</p></div>`}</div>
    </section>
  </main>`;
  return `${renderWindow("ls ~/raids", inner, { prompt: "nwhelper@os" })}${renderCountdownScript()}`;
}

export function renderServersPicker(
  session: WebSession,
  summaries: GuildDashboardSummary[],
  options: { title?: string; prompt?: string; tone?: "cyan" | "pink" | "magenta" | "green" | "yellow" | "orange" | "aqua" | "blue"; targetTemplate?: string } = {}
): string {
  const targetTemplate = options.targetTemplate ?? "/guilds/{id}/stats";
  const title = options.title ?? "cd /servers";
  const prompt = options.prompt ?? "nwhelper@servers";
  const tone = options.tone ?? "cyan";

  const servers = summaries.map((summary, idx) => ({
    idx: idx + 1,
    id: summary.guild.id,
    name: summary.guild.name,
    icon: summary.guild.icon,
    active: summary.activeRaids,
    upcoming: summary.upcomingRaids,
    signups: summary.totalSignups,
    ready: summary.setupWarnings.length === 0,
    warnings: summary.setupWarnings
  }));

  const column = `<aside class="server-pick-rail">
    <p class="server-pick-eyebrow">fleet <span>${servers.length}</span></p>
    <ul class="server-pick-list" id="server-pick-list">${servers
      .map(
        (s) => `<li class="server-pick-item" data-server-id="${escapeHtml(s.id)}" data-server-name="${escapeHtml(s.name.toLowerCase())}" data-server-index="${s.idx}">
          <span class="server-pick-num">${String(s.idx).padStart(2, "0")}</span>
          <span class="server-pick-name">${escapeHtml(s.name)}</span>
          <span class="server-pick-meta">
            <span class="server-pick-dot ${s.ready ? "is-ready" : "is-warn"}" title="${s.ready ? "ready" : s.warnings[0] ?? "attention"}"></span>
            <span class="server-pick-count">${s.active}·${s.upcoming}</span>
          </span>
        </li>`
      )
      .join("") || `<li class="server-pick-empty">no shared servers</li>`}</ul>
    <p class="server-pick-hint">click any server or type a name</p>
  </aside>`;

  const serverDataJson = JSON.stringify(
    servers.map((s) => ({ idx: s.idx, id: s.id, name: s.name, lower: s.name.toLowerCase() }))
  ).replace(/"/g, "&quot;");

  const targetAttr = escapeHtml(targetTemplate);
  const terminal = `<section class="server-pick-terminal" data-servers="${serverDataJson}" data-target-template="${targetAttr}">
    <div class="terminal-output" id="server-pick-output" aria-live="polite">
      <div class="terminal-line t-info">┌── ${escapeHtml(prompt)}:~</div>
      <div class="terminal-line t-info">│ <span class="t-comment"># type </span><span class="t-key">ls</span><span class="t-comment"> to list servers, </span><span class="t-key">help</span><span class="t-comment"> for commands,</span></div>
      <div class="terminal-line t-info">│ <span class="t-comment"># or just type a server name / number to jump there.</span></div>
      <div class="terminal-line t-info">└─$ <span class="t-cursor">▮</span></div>
    </div>
    <form class="terminal-prompt-form" id="server-pick-form" action="javascript:void(0)" autocomplete="off" onsubmit="return false;">
      <span class="terminal-prompt-label">nwhelper<span class="t-muted">@</span><span class="t-success">servers</span><span class="t-muted">:</span><span class="t-path">~</span><span class="t-muted">$</span></span>
      <div class="terminal-prompt-input-wrap">
        <input type="text" id="server-pick-input" class="terminal-prompt-input" placeholder="ls | cd 1 | goto Zenolitee's server | help" autofocus spellcheck="false" autocapitalize="off" autocorrect="off" />
        <span class="t-cursor terminal-prompt-cursor" aria-hidden="true">▮</span>
      </div>
    </form>
  </section>`;

  const inner = `<main class="server-pick-shell">
    ${column}
    ${terminal}
  </main>`;
  return `${renderWindow(title, inner, { prompt: "nwhelper@os", tone })}`;
}

export function renderMemberDashboard(session: WebSession, summaries: GuildDashboardSummary[]): string {
  const events = summaries
    .flatMap((summary) => summary.events.filter(isEventActive).map((event) => ({ summary, event, sortTime: eventSortTimestamp(event) })))
    .sort((left, right) => left.sortTime - right.sortTime);
  const next = events[0];
  const totalSignups = summaries.reduce((sum, summary) => sum + summary.totalSignups, 0);
  const inner = `<main class="shell member-shell">
    ${summaries.length ? `<section class="member-hero">
      <div><p class="eyebrow">Member view</p><h1>Roster board for your shared servers</h1><p>Read-only raid schedule, signup counts, and roster composition. Admin configuration controls stay hidden here.</p></div>
      <dl class="member-telemetry">
        <div><dt>Servers</dt><dd>${summaries.length}</dd></div>
        <div><dt>Active raids</dt><dd>${events.length}</dd></div>
        <div><dt>Total signups</dt><dd>${totalSignups}</dd></div>
        <div><dt>Next</dt><dd>${next ? formatDateLabel(next.event.date) : "None"}</dd></div>
      </dl>
    </section>
    ${next ? renderMemberFeaturedRaid(next.summary, next.event) : renderMemberEmptyRaids(summaries[0].guild)}
    <section class="member-section">
      <div class="section-title"><div><p class="eyebrow">Available rosters</p><h2>Current raids</h2></div><span>${events.length} active</span></div>
      <div class="member-raid-grid">${events.map(({ summary, event }) => renderMemberRaidCard(summary, event)).join("") || `<div class="empty-state compact-empty"><h2>No active raids</h2><p>No current roster is available for your shared servers.</p></div>`}</div>
    </section>
    <section class="member-section">
      <div class="section-title"><div><p class="eyebrow">Server list</p><h2>Your NW Helper servers</h2></div><span>${summaries.length} visible</span></div>
      <div class="member-server-grid">${summaries.map(renderMemberServerCard).join("")}</div>
    </section>` : renderMemberNoServers()}
  </main>`;
  return `${renderWindow("member --roster", inner, { prompt: "nwhelper@os" })}${renderCountdownScript()}`;
}

export function renderMemberFeaturedRaid(summary: GuildDashboardSummary, event: WarEvent): string {
  const signed = activeRosterSignupCount(event);
  const capacity = activeRosterCapacity(event);
  const percent = capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0;
  const announcement = getUpcomingAnnouncements(event, 1)[0];
  return `<section class="member-focus">
    <div class="member-focus-main">
      <p class="eyebrow">Next roster</p>
      <div class="war-focus-title">${renderGuildAvatar(summary.guild)}<div><p>${escapeHtml(summary.guild.name)}</p><h1>${escapeHtml(scheduleTitle(event))}</h1></div></div>
      <dl class="war-focus-grid">
        <div><dt>Date</dt><dd>${formatDateLabel(event.date)}</dd></div>
        <div><dt>War start</dt><dd>${formatClockTime(event.time)}</dd></div>
        <div><dt>Announcement</dt><dd>${formatAnnouncementLabel(event)}</dd></div>
        <div><dt>Countdown</dt><dd data-countdown="${announcement ? announcementTimestamp(announcement) : warStartTimestamp(event)}">${announcement ? formatAnnouncementDateTime(announcement) : formatClockTime(event.time)}</dd></div>
      </dl>
      <div class="war-progress"><div><span>Roster signed</span><b>${signed}/${capacity}</b></div><span class="card-meter"><i style="width:${percent}%"></i></span></div>
      <div class="button-row"><a class="button" href="/events/${encodeURIComponent(event.id)}">Open Roster</a><a class="button button-secondary" href="/guilds/${encodeURIComponent(summary.guild.id)}/raids">Server Raids</a></div>
    </div>
    <aside class="member-composition">${renderMemberComposition(event)}</aside>
  </section>`;
}

export function renderMemberEmptyRaids(guild: DiscordGuild): string {
  return `<section class="member-focus member-empty-focus"><div><p class="eyebrow">Next roster</p><h1>No active raids scheduled</h1><p>${escapeHtml(guild.name)} does not have a current member-visible roster yet.</p><a class="button button-secondary" href="/guilds/${encodeURIComponent(guild.id)}/raids">View Server Raids</a></div></section>`;
}

export function renderMemberRaidCard(summary: GuildDashboardSummary, event: WarEvent): string {
  const signed = activeRosterSignupCount(event);
  const capacity = activeRosterCapacity(event);
  const percent = capacity ? Math.min(100, Math.round((signed / capacity) * 100)) : 0;
  return `<article class="member-raid-card">
    <div class="card-top"><span>${escapeHtml(summary.guild.name)}</span><span class="status-pill ${isEventActive(event) ? "status-active" : "status-inactive"}">${isEventActive(event) ? "Active" : "Inactive"}</span></div>
    <h3>${escapeHtml(scheduleTitle(event))}</h3>
    <p>${formatDateLabel(event.date)} | ${formatClockTime(event.time)} | Announces ${formatAnnouncementLabel(event)}</p>
    <span class="card-meter"><i style="width:${percent}%"></i></span>
    <div class="featured-raid-footer"><b>${signed}/${capacity} signed</b><a href="/events/${encodeURIComponent(event.id)}">Open</a></div>
    ${renderMemberComposition(event)}
  </article>`;
}

export function renderMemberComposition(event: WarEvent): string {
  return `<dl class="member-composition-grid">${orderedGroups(event)
    .map((group) => {
      const count = event.signups.filter((signup) => signup.group === group.key).length;
      const value = isRosterGroup(group.key) ? `${count}/${group.capacity}` : String(count);
      return `<div><dt>${renderGroupIcon(group.key, group.emoji)}${escapeHtml(group.label)}</dt><dd>${value}</dd></div>`;
    })
    .join("")}</dl>`;
}

export function renderMemberServerCard(summary: GuildDashboardSummary): string {
  return `<article class="member-server-card">
    <div class="fleet-head">${renderGuildAvatar(summary.guild)}<div><h3>${escapeHtml(summary.guild.name)}</h3><small>${summary.activeRaids} active raids | ${summary.totalSignups} signups</small></div></div>
    <span class="setup-pill ${summary.activeRaids ? "setup-pill-ready" : "setup-pill-warning"}">${summary.activeRaids ? "Roster live" : "No active raid"}</span>
    <div class="fleet-links"><a href="/guilds/${encodeURIComponent(summary.guild.id)}/raids">Raids</a><a href="/guilds/${encodeURIComponent(summary.guild.id)}/stats">Stats</a><a href="/?guild=${encodeURIComponent(summary.guild.id)}">Dashboard</a></div>
  </article>`;
}

export function renderMemberNoServers(): string {
  return `<section class="member-hero member-login-hero"><div><p class="eyebrow">No shared servers</p><h1>No member rosters are available yet</h1><p>NW Helper only lists Discord servers where your account has access and the bot is installed.</p><div class="button-row">${renderInviteButton("Invite Bot")}<a class="button button-secondary" href="/auth/discord">Refresh Login</a></div></div></section>`;
}

export function renderStatsServerPicker(session: WebSession, summaries?: GuildDashboardSummary[]): string {
  const list = summaries ?? buildGuildDashboardSummaries(session.guilds, [], {});
  return renderServersPicker(session, list, {
    title: "cat /stats/index",
    prompt: "nwhelper@stats",
    tone: "magenta",
    targetTemplate: "/stats?guild={id}"
  });
}
