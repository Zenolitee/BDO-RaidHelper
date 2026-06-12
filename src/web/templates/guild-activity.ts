import { escapeHtml } from '../utils.js';
import { renderApp } from './layout.js';
import type { WebSession, GuildDashboardSummary } from '../types.js';
import type { DiscordGuild } from '../types.js';
import type { BdoGuildProfile } from '../../integrations/bdo-community.js';

/* ── Guild Activity Page ─────────────────────────────────────── */

export function renderGuildActivityPage(
  guild: DiscordGuild,
  session: WebSession,
  bdoGuildProfile: BdoGuildProfile | null,
  configuredGuildName: string | null,
  configuredRegion: string | null,
  summaries?: GuildDashboardSummary[]
): string {
  const backLink = `<a class="button button-ghost button-sm" href="/dashboard">← Dashboard</a>`;

  const content = bdoGuildProfile
    ? renderGuildProfile(bdoGuildProfile, guild, session, backLink, configuredRegion)
    : renderNoGuildModal(guild, session, configuredGuildName, configuredRegion, backLink);

  return renderApp(`Guild Activity — ${guild.name}`, content, { session, summaries, activeNav: "dashboard" });
}

/* ── Guild profile view ──────────────────────────────────────── */

function renderGuildProfile(
  profile: BdoGuildProfile,
  guild: DiscordGuild,
  session: WebSession,
  backLink: string,
  configuredRegion: string | null
): string {
  const createdDate = profile.createdOn
    ? new Date(profile.createdOn).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "Unknown";
  const memberCount = profile.population ?? 0;

  return `<section class="page-content dash-layout" style="max-width:820px;">
    <div class="dash-header" style="text-align:left;">
      ${backLink}
      <p class="landing-kicker" style="margin-top:var(--space-4);">Guild Activity</p>
      <h1>${escapeHtml(profile.name)}</h1>
      <p style="color:var(--text-muted);margin-top:var(--space-2);">${escapeHtml(profile.region)} region · Founded ${createdDate}</p>
    </div>

    <div class="guild-stats-grid">
      <article class="stat-card">
        <span>Members</span>
        <strong>${memberCount}</strong>
      </article>
      <article class="stat-card">
        <span>Master</span>
        <strong>${profile.master ? escapeHtml(profile.master.familyName) : "—"}</strong>
      </article>
      <article class="stat-card">
        <span>Territory</span>
        <strong>${profile.occupying ? escapeHtml(profile.occupying) : "None"}</strong>
      </article>
      <article class="stat-card">
        <span>Region</span>
        <strong>${escapeHtml(profile.region)}</strong>
      </article>
    </div>
    <div style="margin-top:var(--space-6);">
      <form method="POST" action="/guilds/${encodeURIComponent(guild.id)}/activity" style="display:flex;align-items:center;gap:var(--space-3);">
        <input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}">
        <label style="color:var(--text-muted);font-size:var(--text-sm);white-space:nowrap;">BDO Guild:</label>
        <input type="text" name="bdoGuildName" value="${escapeHtml(profile.name)}" class="input" style="max-width:240px;" required>
        <select name="region" class="select" style="max-width:120px;">
          <option value="EU" ${configuredRegion === "EU" ? "selected" : ""}>EU</option>
          <option value="NA" ${configuredRegion === "NA" ? "selected" : ""}>NA</option>
          <option value="SA" ${configuredRegion === "SA" ? "selected" : ""}>SA</option>
          <option value="KR" ${configuredRegion === "KR" ? "selected" : ""}>KR</option>
          <option value="ASIA" ${configuredRegion === "ASIA" ? "selected" : ""}>ASIA (TH/SEA)</option>
        </select>
        <button type="submit" class="button button-secondary button-sm">Update</button>
      </form>
    </div>
  </section>`;
}

/* ── No guild modal ──────────────────────────────────────────── */

function renderNoGuildModal(
  guild: DiscordGuild,
  session: WebSession,
  configuredGuildName: string | null,
  configuredRegion: string | null,
  backLink: string
): string {
  return `<section class="page-content dash-layout" style="max-width:680px;">
    <div class="dash-header">
      ${backLink}
      <p class="landing-kicker" style="margin-top:var(--space-4);">Guild Activity</p>
      <h1>No guild linked</h1>
      <p style="color:var(--text-muted);margin-top:var(--space-2);">No BDO guild is associated with <strong>${escapeHtml(guild.name)}</strong> yet. Enter your BDO guild name to pull profile data from the community API.</p>
    </div>

    <div class="card guild-link-modal" style="margin-top:var(--space-6);">
      <div style="padding:var(--space-6);">
        <h3 style="margin:0 0 var(--space-2);font-size:var(--text-lg);">Link a BDO Guild</h3>
        <p style="color:var(--text-muted);margin:0 0 var(--space-5);font-size:var(--text-sm);">Search results require an exact guild name match.</p>

        <form method="POST" action="/guilds/${encodeURIComponent(guild.id)}/activity">
          <input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}">

          <div class="form-group">
            <label class="label" for="bdoGuildName">BDO Guild Name</label>
            <input type="text" id="bdoGuildName" name="bdoGuildName" class="input" placeholder="Enter exact guild name..." value="${configuredGuildName ? escapeHtml(configuredGuildName) : ""}" required autofocus>
          </div>

          <div class="form-group">
            <label class="label" for="region">Region</label>
            <select id="region" name="region" class="select">
              <option value="EU" ${configuredRegion === "EU" ? "selected" : ""}>EU</option>
              <option value="NA" ${configuredRegion === "NA" ? "selected" : ""}>NA</option>
              <option value="SA" ${configuredRegion === "SA" ? "selected" : ""}>SA</option>
              <option value="KR" ${configuredRegion === "KR" ? "selected" : ""}>KR</option>
              <option value="ASIA" ${configuredRegion === "ASIA" ? "selected" : ""}>ASIA (TH/SEA)</option>
            </select>
          </div>

          <div style="display:flex;gap:var(--space-3);margin-top:var(--space-5);">
            <button type="submit" class="button button-primary">Link Guild</button>
            <a href="/dashboard" class="button button-ghost">Cancel</a>
          </div>
        </form>
      </div>
    </div>
  </section>`;
}
