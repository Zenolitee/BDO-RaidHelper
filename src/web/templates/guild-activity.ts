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
  const regionOptions = ["EU", "NA", "SA", "KR", "ASIA"].map((r) =>
    `<option value="${r}" ${(configuredRegion ?? "NA") === r ? "selected" : ""}>${r === "ASIA" ? "ASIA (TH/SEA)" : r}</option>`
  ).join("");

  // Guild profile card (if linked)
  const profileCard = bdoGuildProfile
    ? renderGuildProfileCard(bdoGuildProfile)
    : `<div style="padding:var(--space-6);text-align:center;color:var(--text-muted);">No guild linked yet — search and link one below.</div>`;

  const content = `<section class="page-content dash-layout" style="max-width:860px;">
    <div class="dash-header" style="text-align:left;">
      ${backLink}
      <p class="landing-kicker" style="margin-top:var(--space-4);">Guild Activity</p>
      <h1>${bdoGuildProfile ? escapeHtml(bdoGuildProfile.name) : "Guild Lookup"}</h1>
      ${bdoGuildProfile ? `<p style="color:var(--text-muted);margin-top:var(--space-2);">${escapeHtml(bdoGuildProfile.region)} region · Founded ${bdoGuildProfile.createdOn ? new Date(bdoGuildProfile.createdOn).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "Unknown"}</p>` : ""}
    </div>

    <!-- Guild Stats -->
    <div class="guild-stats-grid">
      <article class="stat-card">
        <span>Members</span>
        <strong>${bdoGuildProfile?.population ?? 0}</strong>
      </article>
      <article class="stat-card">
        <span>Master</span>
        <strong>${bdoGuildProfile?.master ? escapeHtml(bdoGuildProfile.master.familyName) : "—"}</strong>
      </article>
      <article class="stat-card">
        <span>Territory</span>
        <strong>${bdoGuildProfile?.occupying ? escapeHtml(bdoGuildProfile.occupying) : "None"}</strong>
      </article>
      <article class="stat-card">
        <span>Region</span>
        <strong>${bdoGuildProfile ? escapeHtml(bdoGuildProfile.region) : "—"}</strong>
      </article>
    </div>

    <!-- Guild Search + Link -->
    <div class="card" style="margin-top:var(--space-6);">
      <div style="padding:var(--space-5);">
        <h3 style="margin:0 0 var(--space-1);font-size:var(--text-base);font-weight:600;">Link / Change BDO Guild</h3>
        <p style="color:var(--text-muted);margin:0 0 var(--space-4);font-size:var(--text-sm);">Type to search across all regions. Select a result to link.</p>

        <form method="POST" action="/guilds/${encodeURIComponent(guild.id)}/activity" id="guild-link-form">
          <input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}">
          <input type="hidden" name="bdoGuildName" id="selectedGuildName" value="${configuredGuildName ? escapeHtml(configuredGuildName) : ""}">
          <input type="hidden" name="region" id="selectedGuildRegion" value="${configuredRegion ? escapeHtml(configuredRegion) : "NA"}">

          <div style="display:flex;gap:var(--space-3);align-items:flex-end;">
            <div style="flex:1;position:relative;">
              <label class="label" for="guildSearchInput">Search Guild</label>
              <input type="text" id="guildSearchInput" class="input" placeholder="Type guild name..." value="${configuredGuildName ? escapeHtml(configuredGuildName) : ""}" autocomplete="off">
              <div id="guildSearchResults" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg-card,#1a1a2e);border:1px solid var(--border);border-radius:var(--radius-md);max-height:240px;overflow-y:auto;z-index:50;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,0.4);"></div>
            </div>
            <div style="width:130px;">
              <label class="label" for="regionSelect">Region</label>
              <select id="regionSelect" class="select" onchange="document.getElementById('selectedGuildRegion').value=this.value">
                ${regionOptions}
              </select>
            </div>
            <button type="submit" class="button button-primary button-sm" id="linkGuildBtn" style="height:38px;">${bdoGuildProfile ? "Update" : "Link"}</button>
          </div>

          <div id="selectedGuildDisplay" style="display:${bdoGuildProfile ? "block" : "none"};padding:var(--space-2) var(--space-3);background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:var(--radius-md);margin-top:var(--space-3);font-size:var(--text-sm);">
            <span style="color:var(--color-green,#22c55e);">✓ Selected: <strong id="selectedGuildText">${bdoGuildProfile ? escapeHtml(bdoGuildProfile.name) + " (" + escapeHtml(bdoGuildProfile.region) + ")" : ""}</strong></span>
          </div>
        </form>
      </div>
    </div>

    <!-- Player Search -->
    <div class="card" style="margin-top:var(--space-6);">
      <div style="padding:var(--space-5);">
        <h3 style="margin:0 0 var(--space-1);font-size:var(--text-base);font-weight:600;">Adventurer Lookup</h3>
        <p style="color:var(--text-muted);margin:0 0 var(--space-4);font-size:var(--text-sm);">Search for any BDO player by family name.</p>

        <div style="display:flex;gap:var(--space-3);align-items:flex-end;">
          <div style="flex:1;position:relative;">
            <label class="label" for="playerSearchInput">Family Name</label>
            <input type="text" id="playerSearchInput" class="input" placeholder="Enter family name..." autocomplete="off">
            <div id="playerSearchResults" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg-card,#1a1a2e);border:1px solid var(--border);border-radius:var(--radius-md);max-height:280px;overflow-y:auto;z-index:50;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,0.4);"></div>
          </div>
          <div style="width:130px;">
            <label class="label" for="playerRegionSelect">Region</label>
            <select id="playerRegionSelect" class="select">
              ${regionOptions}
            </select>
          </div>
        </div>

        <div id="playerProfile" style="display:none;margin-top:var(--space-4);"></div>
      </div>
    </div>
  </section>

  <script>
  (function() {
    // ── Guild search ──
    var guildInput = document.getElementById('guildSearchInput');
    var guildResults = document.getElementById('guildSearchResults');
    var guildHiddenName = document.getElementById('selectedGuildName');
    var guildHiddenRegion = document.getElementById('selectedGuildRegion');
    var guildRegionSelect = document.getElementById('regionSelect');
    var guildDisplay = document.getElementById('selectedGuildDisplay');
    var guildDisplayText = document.getElementById('selectedGuildText');
    var guildDebounce = null;

    guildInput.addEventListener('input', function() {
      clearTimeout(guildDebounce);
      var q = this.value.trim();
      if (q.length < 2) { guildResults.style.display = 'none'; return; }
      guildDebounce = setTimeout(function() { searchGuilds(q); }, 300);
    });
    guildInput.addEventListener('focus', function() {
      if (guildResults.children.length > 0 && this.value.trim().length >= 2) guildResults.style.display = 'block';
    });
    guildRegionSelect.addEventListener('change', function() {
      guildHiddenRegion.value = this.value;
      if (guildInput.value.trim().length >= 2) searchGuilds(guildInput.value.trim());
    });

    function searchGuilds(query) {
      var region = guildRegionSelect.value;
      fetch('/api/bdo/guilds/search?q=' + encodeURIComponent(query) + '&region=' + encodeURIComponent(region))
        .then(function(r) { return r.json(); })
        .then(function(results) {
          guildResults.innerHTML = '';
          if (!results.length) {
            guildResults.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:var(--text-sm);">No guilds found</div>';
            guildResults.style.display = 'block';
            return;
          }
          results.forEach(function(g) {
            var item = document.createElement('div');
            item.style.cssText = 'padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;transition:background 0.15s;';
            item.innerHTML = '<div><strong style="color:var(--text-primary);">' + esc(g.name) + '</strong><div style="font-size:11px;color:var(--text-muted);">' + (g.master ? 'Master: ' + esc(g.master) : '') + (g.population ? ' · ' + g.population + ' members' : '') + '</div></div><span style="font-size:11px;color:var(--text-muted);">' + esc(g.region) + '</span>';
            item.onmouseenter = function() { this.style.background = 'rgba(255,255,255,0.04)'; };
            item.onmouseleave = function() { this.style.background = 'transparent'; };
            item.onclick = function() {
              guildInput.value = g.name;
              guildHiddenName.value = g.name;
              guildHiddenRegion.value = g.region;
              guildRegionSelect.value = g.region;
              guildDisplayText.textContent = g.name + ' (' + g.region + ')';
              guildDisplay.style.display = 'block';
              guildResults.style.display = 'none';
            };
            guildResults.appendChild(item);
          });
          guildResults.style.display = 'block';
        })
        .catch(function() { guildResults.style.display = 'none'; });
    }

    // ── Player search ──
    var playerInput = document.getElementById('playerSearchInput');
    var playerResults = document.getElementById('playerSearchResults');
    var playerRegionSelect = document.getElementById('playerRegionSelect');
    var profileDiv = document.getElementById('playerProfile');
    var playerDebounce = null;

    playerInput.addEventListener('input', function() {
      clearTimeout(playerDebounce);
      var q = this.value.trim();
      if (q.length < 2) { playerResults.style.display = 'none'; return; }
      playerDebounce = setTimeout(function() { searchPlayers(q); }, 300);
    });
    playerInput.addEventListener('focus', function() {
      if (playerResults.children.length > 0 && this.value.trim().length >= 2) playerResults.style.display = 'block';
    });

    function searchPlayers(query) {
      var region = playerRegionSelect.value;
      fetch('/api/bdo/players/search?q=' + encodeURIComponent(query) + '&region=' + encodeURIComponent(region))
        .then(function(r) { return r.json(); })
        .then(function(results) {
          playerResults.innerHTML = '';
          if (!results.length) {
            playerResults.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:var(--text-sm);">No players found</div>';
            playerResults.style.display = 'block';
            return;
          }
          results.forEach(function(p) {
            var item = document.createElement('div');
            item.style.cssText = 'padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s;';
            var guildText = p.guild ? '<span style="color:var(--text-muted);font-size:11px;"> · ' + esc(p.guild) + '</span>' : '';
            var mainText = p.mainCharacter ? '<div style="font-size:11px;color:var(--text-muted);">' + esc(p.mainCharacter) + '</div>' : '';
            item.innerHTML = '<div><strong style="color:var(--text-primary);">' + esc(p.familyName) + '</strong>' + guildText + mainText + '</div>';
            item.onmouseenter = function() { this.style.background = 'rgba(255,255,255,0.04)'; };
            item.onmouseleave = function() { this.style.background = 'transparent'; };
            item.onclick = function() {
              playerResults.style.display = 'none';
              playerInput.value = p.familyName;
              loadProfile(p.profileTarget, region);
            };
            playerResults.appendChild(item);
          });
          playerResults.style.display = 'block';
        })
        .catch(function() { playerResults.style.display = 'none'; });
    }

    function loadProfile(profileTarget, region) {
      profileDiv.style.display = 'block';
      profileDiv.innerHTML = '<div style="padding:var(--space-6);text-align:center;color:var(--text-muted);">Loading profile...</div>';

      fetch('/api/bdo/players/' + encodeURIComponent(profileTarget) + '?region=' + encodeURIComponent(region))
        .then(function(r) { return r.json(); })
        .then(function(p) {
          if (p.error) { profileDiv.innerHTML = '<div style="padding:var(--space-4);text-align:center;color:var(--text-muted);">' + esc(p.error) + '</div>'; return; }

          var chars = '';
          if (p.characters && p.characters.length) {
            chars = '<div style="margin-top:var(--space-3);"><h4 style="margin:0 0 var(--space-2);font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Characters</h4><div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">' +
              p.characters.map(function(c) {
                var badge = c.main ? ' <span style="font-size:10px;background:rgba(34,197,94,0.15);color:var(--color-green,#22c55e);padding:1px 6px;border-radius:99px;">MAIN</span>' : '';
                return '<div style="padding:6px 10px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:var(--text-sm);"><strong>' + esc(c.name) + '</strong>' + badge + '<div style="font-size:11px;color:var(--text-muted);">' + esc(c.class) + (c.level ? ' · Lv.' + c.level : '') + '</div></div>';
              }).join('') + '</div></div>';
          }

          var statsItems = [];
          if (p.gs) statsItems.push({ l: 'GS', v: String(p.gs) });
          if (p.combatFame) statsItems.push({ l: 'Combat Fame', v: String(p.combatFame) });
          if (p.lifeFame) statsItems.push({ l: 'Life Fame', v: String(p.lifeFame) });
          if (p.contributionPoints) statsItems.push({ l: 'Contrib', v: String(p.contributionPoints) });
          if (p.energy) statsItems.push({ l: 'Energy', v: String(p.energy) });
          var stats = statsItems.length ? '<div style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-3);">' + statsItems.map(function(s) {
            return '<div style="padding:6px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center;min-width:80px;"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">' + esc(s.l) + '</div><div style="font-weight:700;">' + esc(s.v) + '</div></div>';
          }).join('') + '</div>' : '';

          var createdDate = p.createdOn ? new Date(p.createdOn).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
          var profileUrl = region === 'ASIA'
            ? 'https://blackdesert.pearlabyss.com/Asia/en-US/Game/Profile/Search?_keyword=' + encodeURIComponent(p.familyName)
            : 'https://www.naeu.playblackdesert.com/en-US/Profile?_target=' + encodeURIComponent(p.profileTarget);

          profileDiv.innerHTML =
            '<div style="padding:var(--space-4);background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:var(--radius-md);">' +
              '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
                '<div>' +
                  '<div style="font-size:var(--text-lg);font-weight:700;">' + esc(p.familyName) + '</div>' +
                  '<div style="margin-top:2px;display:flex;gap:var(--space-3);color:var(--text-muted);font-size:var(--text-sm);">' +
                    (p.guild ? '<span>Guild: <strong style="color:var(--text-primary);">' + esc(p.guild) + '</strong></span>' : '') +
                    '<span>' + esc(p.region) + '</span>' +
                    (createdDate ? '<span>Joined ' + createdDate + '</span>' : '') +
                  '</div>' +
                '</div>' +
                '<a href="' + profileUrl + '" target="_blank" rel="noopener" class="button button-ghost button-sm" style="text-decoration:none;font-size:var(--text-xs);">PA Profile ↗</a>' +
              '</div>' +
              chars + stats +
            '</div>';
        })
        .catch(function() { profileDiv.innerHTML = '<div style="padding:var(--space-4);text-align:center;color:var(--text-muted);">Failed to load profile</div>'; });
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    document.addEventListener('click', function(e) {
      if (!guildInput.contains(e.target) && !guildResults.contains(e.target)) guildResults.style.display = 'none';
      if (!playerInput.contains(e.target) && !playerResults.contains(e.target)) playerResults.style.display = 'none';
    });
  })();
  </script>`;

  return renderApp(`Guild Activity — ${guild.name}`, content, { session, summaries, activeNav: "dashboard" });
}

/* ── Guild profile stats card ────────────────────────────────── */

function renderGuildProfileCard(profile: BdoGuildProfile): string {
  const memberCount = profile.population ?? 0;
  return `<div class="guild-stats-grid">
    <article class="stat-card"><span>Members</span><strong>${memberCount}</strong></article>
    <article class="stat-card"><span>Master</span><strong>${profile.master ? escapeHtml(profile.master.familyName) : "—"}</strong></article>
    <article class="stat-card"><span>Territory</span><strong>${profile.occupying ? escapeHtml(profile.occupying) : "None"}</strong></article>
    <article class="stat-card"><span>Region</span><strong>${escapeHtml(profile.region)}</strong></article>
  </div>`;
}
