import { escapeHtml } from '../utils.js';
import { renderApp } from './layout.js';
import type { WebSession, GuildDashboardSummary } from '../types.js';
import type { DiscordGuild } from '../types.js';

/* ── Guild / Player Lookup Page ─────────────────────────────── */

export function renderGuildActivityPage(
  guild: DiscordGuild,
  session: WebSession,
  _bdoGuildProfile: unknown | null,
  _configuredGuildName: string | null,
  configuredRegion: string | null,
  summaries?: GuildDashboardSummary[]
): string {
  const backLink = `<a class="button button-ghost button-sm" href="/dashboard">← Dashboard</a>`;
  const regionOptions = ["EU", "NA", "SA", "KR", "ASIA"].map((r) =>
    `<option value="${r}" ${(configuredRegion ?? "NA") === r ? "selected" : ""}>${r === "ASIA" ? "ASIA (TH/SEA)" : r}</option>`
  ).join("");

  const content = `<section class="page-content dash-layout" style="max-width:860px;">
    <div class="dash-header" style="text-align:left;">
      ${backLink}
      <p class="landing-kicker" style="margin-top:var(--space-4);">Look Up</p>
      <h1>Guild / Player</h1>
      <p style="color:var(--text-muted);margin-top:var(--space-2);">Search for any BDO guild or player across all regions.</p>
    </div>

    <!-- Tab Switcher -->
    <div style="display:flex;gap:var(--space-2);margin-top:var(--space-6);">
      <button class="tab-btn active" data-tab="guild" onclick="switchTab('guild')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        Guild
      </button>
      <button class="tab-btn" data-tab="player" onclick="switchTab('player')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Player
      </button>
    </div>

    <!-- Guild Tab -->
    <div id="tab-guild" class="tab-panel active" style="margin-top:var(--space-4);">
      <div class="card" style="padding:var(--space-5);">
        <h3 style="margin:0 0 var(--space-1);font-size:var(--text-base);font-weight:600;">Search Guild</h3>
        <p style="color:var(--text-muted);margin:0 0 var(--space-4);font-size:var(--text-sm);">Type a guild name to search across all regions.</p>

        <div style="display:flex;gap:var(--space-3);align-items:flex-end;">
          <div style="flex:1;position:relative;">
            <label class="label" for="guildSearchInput">Guild Name</label>
            <input type="text" id="guildSearchInput" class="input" placeholder="Type guild name..." autocomplete="off" autofocus>
            <div id="guildSearchResults" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg-card,#1a1a2e);border:1px solid var(--border);border-radius:var(--radius-md);max-height:280px;overflow-y:auto;z-index:50;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,0.4);"></div>
          </div>
          <div style="width:130px;">
            <label class="label" for="guildRegionSelect">Region</label>
            <select id="guildRegionSelect" class="select">${regionOptions}</select>
          </div>
        </div>

        <div id="guildProfile" style="display:none;margin-top:var(--space-4);"></div>
      </div>
    </div>

    <!-- Player Tab -->
    <div id="tab-player" class="tab-panel" style="display:none;margin-top:var(--space-4);">
      <div class="card" style="padding:var(--space-5);">
        <h3 style="margin:0 0 var(--space-1);font-size:var(--text-base);font-weight:600;">Search Player</h3>
        <p style="color:var(--text-muted);margin:0 0 var(--space-4);font-size:var(--text-sm);">Search for any BDO player by family name.</p>

        <div style="display:flex;gap:var(--space-3);align-items:flex-end;">
          <div style="flex:1;position:relative;">
            <label class="label" for="playerSearchInput">Family Name</label>
            <input type="text" id="playerSearchInput" class="input" placeholder="Enter family name..." autocomplete="off">
            <div id="playerSearchResults" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg-card,#1a1a2e);border:1px solid var(--border);border-radius:var(--radius-md);max-height:280px;overflow-y:auto;z-index:50;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,0.4);"></div>
          </div>
          <div style="width:130px;">
            <label class="label" for="playerRegionSelect">Region</label>
            <select id="playerRegionSelect" class="select">${regionOptions}</select>
          </div>
        </div>

        <div id="playerProfile" style="display:none;margin-top:var(--space-4);"></div>
      </div>
    </div>
  </section>

  <style>
    .tab-btn { display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:transparent;color:var(--text-muted);font-size:var(--text-sm);font-weight:500;cursor:pointer;transition:all 0.15s; }
    .tab-btn:hover { background:rgba(255,255,255,0.04);color:var(--text-primary); }
    .tab-btn.active { background:rgba(255,255,255,0.06);color:var(--text-primary);border-color:rgba(255,255,255,0.12); }
    .char-card { transition: border-color 0.15s, background 0.15s; }
    .char-card:hover { background: #1a2030; }
    .char-card.main-card:hover { border-color: #c99a2e; }
    .pa-link { transition: background 0.15s; }
    .pa-link:hover { background: rgba(242,184,75,0.2) !important; }
  </style>

  <script>
  (function() {
    // ── Tab switching ──
    window.switchTab = function(tab) {
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === tab); });
      document.getElementById('tab-guild').style.display = tab === 'guild' ? 'block' : 'none';
      document.getElementById('tab-player').style.display = tab === 'player' ? 'block' : 'none';
      // Focus the search input in the active tab
      var input = document.getElementById(tab === 'guild' ? 'guildSearchInput' : 'playerSearchInput');
      if (input) setTimeout(function() { input.focus(); }, 50);
    };

    // ── Guild search ──
    var guildInput = document.getElementById('guildSearchInput');
    var guildResults = document.getElementById('guildSearchResults');
    var guildRegionSelect = document.getElementById('guildRegionSelect');
    var guildProfile = document.getElementById('guildProfile');
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
              guildResults.style.display = 'none';
              loadGuildProfile(g.name, g.region);
            };
            guildResults.appendChild(item);
          });
          guildResults.style.display = 'block';
        })
        .catch(function() { guildResults.style.display = 'none'; });
    }

    function loadGuildProfile(name, region) {
      guildProfile.style.display = 'block';
      guildProfile.innerHTML = '<div style="padding:var(--space-8);text-align:center;color:var(--text-muted);">Loading guild profile...</div>';

      var url = '/api/bdo/guilds/search?q=' + encodeURIComponent(name) + '&region=' + encodeURIComponent(region);
      fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(results) {
          var g = results.find(function(r) { return r.name === name; }) || results[0];
          if (!g) { guildProfile.innerHTML = '<div style="padding:var(--space-4);text-align:center;color:var(--text-muted);">Guild not found</div>'; return; }

          var createdDate = g.createdOn ? new Date(g.createdOn).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown';
          var guildUrl = region === 'ASIA'
            ? 'https://blackdesert.pearlabyss.com/Asia/en-US/Game/Guild/Profile?_regionType=1&_guildName=' + encodeURIComponent(g.name)
            : '#';

          guildProfile.innerHTML =
            '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;">' +
              '<div style="padding:var(--space-5);background:linear-gradient(135deg,var(--bg-surface),var(--bg-elevated));border-bottom:1px solid var(--border);">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-4);">' +
                  '<div style="min-width:0;">' +
                    '<div style="font-size:var(--text-xl);font-weight:800;color:var(--text-primary);letter-spacing:-0.01em;">' + esc(g.name) + '</div>' +
                    '<div style="display:flex;flex-wrap:wrap;gap:var(--space-3);margin-top:var(--space-2);color:var(--text-secondary);font-size:var(--text-sm);">' +
                      '<span style="display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/></svg>' + esc(g.region) + '</span>' +
                      '<span style="display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>Founded ' + createdDate + '</span>' +
                    '</div>' +
                  '</div>' +
                  (region === 'ASIA' ? '<a href="' + guildUrl + '" target="_blank" rel="noopener" class="pa-link" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:rgba(201,154,46,0.1);border:1px solid rgba(201,154,46,0.3);border-radius:var(--radius-md);color:#c99a2e;font-size:var(--text-xs);font-weight:600;text-decoration:none;white-space:nowrap;">View on PA <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>' : '') +
                '</div>' +
              '</div>' +
              '<div style="padding:var(--space-5);display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:var(--space-3);">' +
                '<div style="padding:var(--space-3) var(--space-4);background:linear-gradient(135deg,rgba(201,154,46,0.06),rgba(201,154,46,0.02));border:1px solid var(--accent-border);border-radius:var(--radius-md);text-align:center;">' +
                  '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Members</div>' +
                  '<div style="font-size:var(--text-lg);font-weight:800;color:var(--accent);">' + (g.population || '—') + '</div>' +
                '</div>' +
                (g.master ? '<div style="padding:var(--space-3) var(--space-4);background:linear-gradient(135deg,rgba(139,92,246,0.06),rgba(139,92,246,0.02));border:1px solid rgba(139,92,246,0.2);border-radius:var(--radius-md);text-align:center;">' +
                  '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Guild Master</div>' +
                  '<div style="font-weight:700;color:var(--text-primary);">' + esc(g.master) + '</div>' +
                '</div>' : '') +
                '<div style="padding:var(--space-3) var(--space-4);background:linear-gradient(135deg,rgba(65,182,255,0.06),rgba(65,182,255,0.02));border:1px solid rgba(65,182,255,0.2);border-radius:var(--radius-md);text-align:center;">' +
                  '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Region</div>' +
                  '<div style="font-weight:700;color:var(--text-primary);">' + esc(g.region) + '</div>' +
                '</div>' +
              '</div>' +
            '</div>';
        })
        .catch(function() { guildProfile.innerHTML = '<div style="padding:var(--space-4);text-align:center;color:var(--text-muted);">Failed to load guild</div>'; });
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
    playerRegionSelect.addEventListener('change', function() {
      if (playerInput.value.trim().length >= 2) searchPlayers(playerInput.value.trim());
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
              // For ASIA, pass family name instead of encrypted profileTarget
              var target = region === 'ASIA' ? p.familyName : p.profileTarget;
              loadProfile(target, region, p.familyName);
            };
            playerResults.appendChild(item);
          });
          playerResults.style.display = 'block';
        })
        .catch(function() { playerResults.style.display = 'none'; });
    }

    function loadProfile(profileTarget, region, familyName) {
      profileDiv.style.display = 'block';
      profileDiv.innerHTML = '<div style="padding:var(--space-8);text-align:center;color:var(--text-muted);">Loading profile...</div>';

      var nameParam = familyName ? '&name=' + encodeURIComponent(familyName) : '';
      fetch('/api/bdo/players/' + encodeURIComponent(profileTarget) + '?region=' + encodeURIComponent(region) + nameParam)
        .then(function(r) { return r.json(); })
        .then(function(p) {
          if (p.error) { profileDiv.innerHTML = '<div style="padding:var(--space-4);text-align:center;color:var(--text-muted);">' + esc(p.error) + '</div>'; return; }

          var createdDate = p.createdOn ? new Date(p.createdOn).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
          var profileUrl = region === 'ASIA'
            ? 'https://blackdesert.pearlabyss.com/Asia/en-US/Game/Profile/Search?_keyword=' + encodeURIComponent(p.familyName)
            : 'https://www.naeu.playblackdesert.com/en-US/Profile?_target=' + encodeURIComponent(p.profileTarget);

          // ── Stats row ──
          var gs = p.gs || p.gearScore;
          var contrib = p.contributionPoints || p.contribution;
          var statsHtml = '';
          var statsItems = [];
          if (gs) statsItems.push({ l: 'Gear Score', v: String(gs), color: '#f59e0b' });
          if (contrib) statsItems.push({ l: 'Contribution', v: String(contrib), color: '#8b5cf6' });
          if (p.energy) statsItems.push({ l: 'Energy', v: String(p.energy), color: '#3b82f6' });
          if (p.combatFame) statsItems.push({ l: 'Combat Fame', v: String(p.combatFame), color: '#ef4444' });
          if (p.lifeFame) statsItems.push({ l: 'Life Fame', v: String(p.lifeFame), color: '#22c55e' });
          if (statsItems.length) {
            statsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:var(--space-3);margin-top:var(--space-4);">' +
              statsItems.map(function(s) {
                return '<div style="padding:var(--space-3) var(--space-4);background:linear-gradient(135deg,' + s.color + '08,' + s.color + '03);border:1px solid ' + s.color + '25;border-radius:var(--radius-md);text-align:center;">' +
                  '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">' + esc(s.l) + '</div>' +
                  '<div style="font-size:var(--text-lg);font-weight:800;color:' + s.color + ';">' + esc(s.v) + '</div>' +
                '</div>';
              }).join('') + '</div>';
          }

          // ── Characters grid ──
          var charsHtml = '';
          if (p.characters && p.characters.length) {
            // Sort: main first, then by level desc
            var sorted = p.characters.slice().sort(function(a, b) {
              if (a.main && !b.main) return -1;
              if (!a.main && b.main) return 1;
              return (b.level || 0) - (a.level || 0);
            });
            charsHtml = '<div style="margin-top:var(--space-5);">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3);">' +
                '<h4 style="margin:0;font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Characters</h4>' +
                '<span style="font-size:var(--text-xs);color:var(--text-muted);">' + p.characters.length + ' total</span>' +
              '</div>' +
              '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-2);">' +
                sorted.map(function(c) {
                  var mainBadge = c.main ? '<span style="display:inline-block;font-size:9px;font-weight:700;background:linear-gradient(135deg,rgba(34,197,94,0.18),rgba(34,197,94,0.08));color:#22c55e;padding:1px 6px;border-radius:99px;margin-left:6px;letter-spacing:0.04em;vertical-align:middle;">MAIN</span>' : '';
                  var levelBar = c.level ? '<div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:#3a2b18;border-radius:0 0 6px 6px;overflow:hidden;"><div style="height:100%;width:' + Math.min(100, (c.level / 70) * 100) + '%;background:linear-gradient(90deg,#c99a2e,#f2b84b);border-radius:0 0 6px 6px;"></div></div>' : '';
                  return '<div class="char-card' + (c.main ? ' main-card' : '') + '" style="position:relative;padding:var(--space-3);background:#121722;border:1px solid #3a2b18;border-radius:var(--radius-sm);overflow:hidden;cursor:default;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                      '<div style="min-width:0;">' +
                        '<div style="font-weight:600;font-size:var(--text-sm);color:#f5f7fb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(c.name) + mainBadge + '</div>' +
                        '<div style="font-size:11px;color:#6d7580;margin-top:1px;">' + esc(c.class) + '</div>' +
                      '</div>' +
                      (c.level ? '<div style="font-size:var(--text-sm);font-weight:700;color:#c99a2e;white-space:nowrap;">Lv. ' + c.level + '</div>' : '') +
                    '</div>' +
                    levelBar +
                  '</div>';
                }).join('') +
              '</div>' +
            '</div>';
          }

          // ── Profile card ──
          profileDiv.innerHTML =
            '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;">' +
              // Header banner
              '<div style="padding:var(--space-5) var(--space-5) var(--space-4);background:linear-gradient(135deg,var(--bg-surface),var(--bg-elevated));border-bottom:1px solid var(--border);">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-4);">' +
                  '<div style="min-width:0;">' +
                    '<div style="font-size:var(--text-xl);font-weight:800;color:var(--text-primary);letter-spacing:-0.01em;">' + esc(p.familyName) + '</div>' +
                    '<div style="display:flex;flex-wrap:wrap;gap:var(--space-3);margin-top:var(--space-2);color:var(--text-secondary);font-size:var(--text-sm);">' +
                      (p.guild ? '<span style="display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>' + esc(p.guild) + '</span>' : '') +
                      '<span style="display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/></svg>' + esc(p.region) + '</span>' +
                      (createdDate ? '<span style="display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' + esc(createdDate) + '</span>' : '') +
                    '</div>' +
                  '</div>' +
                  '<a href="' + profileUrl + '" target="_blank" rel="noopener" class="pa-link" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:rgba(201,154,46,0.1);border:1px solid rgba(201,154,46,0.3);border-radius:var(--radius-md);color:#c99a2e;font-size:var(--text-xs);font-weight:600;text-decoration:none;white-space:nowrap;">' +
                    'View on PA <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
                  '</a>' +
                '</div>' +
              '</div>' +
              // Body
              '<div style="padding:var(--space-5);">' +
                statsHtml +
                charsHtml +
              '</div>' +
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

  return renderApp(`Look Up — ${guild.name}`, content, { session, summaries, activeNav: "dashboard" });
}
