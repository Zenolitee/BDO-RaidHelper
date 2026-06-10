import { escapeHtml, botInviteUrl } from '../utils.js';
import { buildGuildDashboardSummaries } from '../utils.js';
import type { WebSession, DiscordGuild, GuildDashboardSummary } from '../types.js';

export function renderAccountControls(session?: WebSession, selectedGuildId?: string): string {
  if (!session) {
    return `<a class="button button-secondary" href="/auth/discord">Log in with Discord</a>`;
  }

  return `<div class="account-panel">
    <span class="account-name">${escapeHtml(session.user.global_name ?? session.user.username)}</span>
    ${selectedGuildId ? `<a href="/">Switch server</a>` : ""}
    <a href="/logout">Log out</a>
  </div>`;
}

export function renderNav(session?: WebSession, guildId?: string, summaries?: GuildDashboardSummary[]): string {
  const summaryList = summaries ?? (session ? buildGuildDashboardSummaries(session.guilds, []) : []);
  return `<header class="app-nav">
    <div class="nav-brand-row"><a class="brand" href="/"><span>NW</span><strong>NW Helper</strong></a></div>
    <nav>
      <a class="top-nav-link" href="/">${renderNavIcon("home")}<span>Home</span></a>
      ${session ? renderNavDropdown("Stats", "stats", summaryList, "stats") : `<a class="top-nav-link" href="/stats">${renderNavIcon("stats")}<span>Stats</span></a>`}
      ${session ? renderNavDropdown("Raids", "raids", summaryList, "raids") : `<a class="top-nav-link" href="/">${renderNavIcon("raids")}<span>Raids</span></a>`}
      ${session ? renderNavDropdown("Servers", "servers", summaryList, "servers") : ""}
    </nav>
    <div class="nav-actions">${renderAccountControls(session, guildId)}</div>
  </header>`;
}

export function renderNavDropdown(label: string, icon: "stats" | "raids" | "servers", summaries: GuildDashboardSummary[], mode: "stats" | "raids" | "servers"): string {
  const items = summaries.map((summary) => renderNavGuildItem(summary, mode)).join("");
  return `<div class="nav-group nav-dropdown">
    <button class="nav-trigger" type="button" aria-haspopup="true">${renderNavIcon(icon)}<span>${escapeHtml(label)}</span><span class="nav-chevron" aria-hidden="true">${renderNavIcon("chevron")}</span></button>
    <div class="nav-menu">${items || "<span class=\"nav-empty\">No shared servers found</span>"}</div>
  </div>`;
}

export function renderNavGuildItem(summary: GuildDashboardSummary, mode: "stats" | "raids" | "servers"): string {
  const href =
    mode === "stats"
      ? `/guilds/${encodeURIComponent(summary.guild.id)}/stats`
      : mode === "raids"
        ? `/guilds/${encodeURIComponent(summary.guild.id)}/raids`
        : `/?guild=${encodeURIComponent(summary.guild.id)}`;
  const meta =
    mode === "stats"
      ? `${summary.activeRaids} active | ${summary.totalSignups} signups`
      : mode === "raids"
        ? `${summary.activeRaids} active raids`
        : `${summary.weeklyRaids ? `${summary.weeklyRaids} weekly` : "Setup ready"} | ${summary.activeRaids} active`;
  return `<a class="nav-guild-item" href="${href}">${renderGuildAvatar(summary.guild)}<span><b>${escapeHtml(summary.guild.name)}</b><small>${escapeHtml(meta)}</small></span></a>`;
}

export function renderNavIcon(name: "home" | "stats" | "raids" | "servers" | "chevron"): string {
  const paths: Record<typeof name, string> = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    stats: '<path d="M4 19V5"/><path d="M4 19h17"/><path d="M8 16V9"/><path d="M13 16V6"/><path d="M18 16v-4"/>',
    raids: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/>',
    servers: '<rect x="4" y="5" width="16" height="5" rx="1.5"/><rect x="4" y="14" width="16" height="5" rx="1.5"/><path d="M8 7.5h.01"/><path d="M8 16.5h.01"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
  };
  return `<svg class="nav-icon nav-icon-${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

export function renderGuildAvatar(guild: DiscordGuild): string {
  const avatar = guild.icon ? `https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=128` : undefined;
  return avatar
    ? `<img class="server-mark server-avatar" src="${escapeHtml(avatar)}" alt="">`
    : `<span class="server-mark">${escapeHtml(guild.name.slice(0, 1).toUpperCase())}</span>`;
}

export function renderStat(label: string, value: string): string {
  return `<article class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

export function renderHomeStat(label: string, value: string, eyebrow: string): string {
  return `<article class="telemetry-module"><span>${escapeHtml(eyebrow)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></article>`;
}
