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
  const regionOptions = ["EU", "NA", "SA", "KR", "ASIA"].map((r) =>
    `<option value="${r}" ${configuredRegion === r ? "selected" : ""}>${r === "ASIA" ? "ASIA (TH/SEA)" : r}</option>`
  ).join("");

  return `<section class="page-content dash-layout" style="max-width:680px;">
    <div class="dash-header">
      ${backLink}
      <p class="landing-kicker" style="margin-top:var(--space-4);">Guild Activity</p>
      <h1>No guild linked</h1>
      <p style="color:var(--text-muted);margin-top:var(--space-2);">No BDO guild is associated with <strong>${escapeHtml(guild.name)}</strong> yet. Search for your guild below.</p>
    </div>

    <div class="card guild-link-modal" style="margin-top:var(--space-6);">
      <div style="padding:var(--space-6);">
        <h3 style="margin:0 0 var(--space-2);font-size:var(--text-lg);">Link a BDO Guild</h3>
        <p style="color:var(--text-muted);margin:0 0 var(--space-5);font-size:var(--text-sm);">Start typing to search for your guild across all regions.</p>

        <form method="POST" action="/guilds/${encodeURIComponent(guild.id)}/activity" id="guild-link-form">
          <input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}">
          <input type="hidden" name="bdoGuildName" id="selectedGuildName" value="${configuredGuildName ? escapeHtml(configuredGuildName) : ""}">
          <input type="hidden" name="region" id="selectedGuildRegion" value="${configuredRegion ? escapeHtml(configuredRegion) : "NA"}">

          <div class="form-group" style="position:relative;">
            <label class="label" for="guildSearchInput">Search Guild</label>
            <input type="text" id="guildSearchInput" class="input" placeholder="Type guild name..." value="${configuredGuildName ? escapeHtml(configuredGuildName) : ""}" autocomplete="off" autofocus>
            <div id="guildSearchResults" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg-card,#1a1a2e);border:1px solid var(--border);border-radius:var(--radius-md);max-height:240px;overflow-y:auto;z-index:50;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,0.4);"></div>
          </div>

          <div class="form-group">
            <label class="label" for="regionSelect">Region</label>
            <select id="regionSelect" class="select" onchange="document.getElementById('selectedGuildRegion').value=this.value">
              ${regionOptions}
            </select>
          </div>

          <div id="selectedGuildDisplay" style="display:none;padding:var(--space-3);background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:var(--radius-md);margin-top:var(--space-3);">
            <span style="color:var(--color-green,#22c55e);font-size:var(--text-sm);">✓ Selected: <strong id="selectedGuildText"></strong></span>
          </div>

          <div style="display:flex;gap:var(--space-3);margin-top:var(--space-5);">
            <button type="submit" class="button button-primary" id="linkGuildBtn" disabled>Link Guild</button>
            <a href="/dashboard" class="button button-ghost">Cancel</a>
          </div>
        </form>
      </div>
    </div>
  </section>

  <script>
  (function() {
    var searchInput = document.getElementById('guildSearchInput');
    var resultsDiv = document.getElementById('guildSearchResults');
    var hiddenName = document.getElementById('selectedGuildName');
    var hiddenRegion = document.getElementById('selectedGuildRegion');
    var regionSelect = document.getElementById('regionSelect');
    var display = document.getElementById('selectedGuildDisplay');
    var displayText = document.getElementById('selectedGuildText');
    var linkBtn = document.getElementById('linkGuildBtn');
    var debounceTimer = null;

    searchInput.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      var query = this.value.trim();
      if (query.length < 2) { resultsDiv.style.display = 'none'; return; }
      debounceTimer = setTimeout(function() { doSearch(query); }, 300);
    });

    searchInput.addEventListener('focus', function() {
      if (resultsDiv.children.length > 0 && this.value.trim().length >= 2) resultsDiv.style.display = 'block';
    });

    document.addEventListener('click', function(e) {
      if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) resultsDiv.style.display = 'none';
    });

    regionSelect.addEventListener('change', function() {
      hiddenRegion.value = this.value;
      if (searchInput.value.trim().length >= 2) doSearch(searchInput.value.trim());
    });

    function doSearch(query) {
      var region = regionSelect.value;
      fetch('/api/bdo/guilds/search?q=' + encodeURIComponent(query) + '&region=' + encodeURIComponent(region))
        .then(function(r) { return r.json(); })
        .then(function(results) {
          resultsDiv.innerHTML = '';
          if (!results.length) {
            resultsDiv.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:var(--text-sm);">No guilds found</div>';
            resultsDiv.style.display = 'block';
            return;
          }
          results.forEach(function(g) {
            var item = document.createElement('div');
            item.style.cssText = 'padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;transition:background 0.15s;';
            item.innerHTML = '<div><strong style="color:var(--text-primary);">' + escHtml(g.name) + '</strong><div style="font-size:11px;color:var(--text-muted);">' + (g.master ? 'Master: ' + escHtml(g.master) : '') + (g.population ? ' · ' + g.population + ' members' : '') + '</div></div><span style="font-size:11px;color:var(--text-muted);">' + escHtml(g.region) + '</span>';
            item.addEventListener('mouseenter', function() { this.style.background = 'rgba(255,255,255,0.04)'; });
            item.addEventListener('mouseleave', function() { this.style.background = 'transparent'; });
            item.addEventListener('click', function() {
              searchInput.value = g.name;
              hiddenName.value = g.name;
              hiddenRegion.value = g.region;
              regionSelect.value = g.region;
              displayText.textContent = g.name + ' (' + g.region + ')';
              display.style.display = 'block';
              linkBtn.disabled = false;
              resultsDiv.style.display = 'none';
            });
            resultsDiv.appendChild(item);
          });
          resultsDiv.style.display = 'block';
        })
        .catch(function() { resultsDiv.style.display = 'none'; });
    }

    function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    if (hiddenName.value) {
      displayText.textContent = hiddenName.value + ' (' + hiddenRegion.value + ')';
      display.style.display = 'block';
      linkBtn.disabled = false;
    }
  })();
  </script>`;
}
