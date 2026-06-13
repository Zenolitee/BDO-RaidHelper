import { escapeHtml } from '../utils.js';
import { renderApp } from './layout.js';
import type { WebSession, GuildDashboardSummary } from '../types.js';
import type { DiscordGuild } from '../types.js';

/* ── Player Search Page ─────────────────────────────────────── */

export function renderPlayerSearchPage(
  guild: DiscordGuild,
  session: WebSession,
  summaries?: GuildDashboardSummary[]
): string {
  const backLink = `<a class="button button-ghost button-sm" href="/stats?guild=${encodeURIComponent(guild.id)}">← Back to Stats</a>`;

  const content = `<section class="page-content dash-layout" style="max-width:780px;">
    <div class="dash-header">
      ${backLink}
      <p class="landing-kicker" style="margin-top:var(--space-4);">Adventurer Lookup</p>
      <h1>Player Search</h1>
      <p style="color:var(--text-muted);margin-top:var(--space-2);">Search for any BDO player by family name across all regions.</p>
    </div>

    <div style="margin-top:var(--space-6);">
      <div style="display:flex;gap:var(--space-3);align-items:flex-end;">
        <div style="flex:1;position:relative;">
          <label class="label" for="playerSearchInput">Family Name</label>
          <input type="text" id="playerSearchInput" class="input" placeholder="Enter family name..." autocomplete="off" autofocus>
          <div id="playerSearchResults" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg-card,#1a1a2e);border:1px solid var(--border);border-radius:var(--radius-md);max-height:280px;overflow-y:auto;z-index:50;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,0.4);"></div>
        </div>
        <div style="width:130px;">
          <label class="label" for="playerRegionSelect">Region</label>
          <select id="playerRegionSelect" class="select">
            <option value="EU">EU</option>
            <option value="NA" selected>NA</option>
            <option value="SA">SA</option>
            <option value="KR">KR</option>
            <option value="ASIA">ASIA (TH/SEA)</option>
          </select>
        </div>
      </div>
    </div>

    <div id="playerProfile" style="display:none;margin-top:var(--space-6);"></div>
  </section>

  <script>
  (function() {
    var searchInput = document.getElementById('playerSearchInput');
    var resultsDiv = document.getElementById('playerSearchResults');
    var regionSelect = document.getElementById('playerRegionSelect');
    var profileDiv = document.getElementById('playerProfile');
    var debounceTimer = null;
    var lastQuery = '';

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
      if (searchInput.value.trim().length >= 2) doSearch(searchInput.value.trim());
    });

    function doSearch(query) {
      var region = regionSelect.value;
      fetch('/api/bdo/players/search?q=' + encodeURIComponent(query) + '&region=' + encodeURIComponent(region))
        .then(function(r) { return r.json(); })
        .then(function(results) {
          resultsDiv.innerHTML = '';
          if (!results.length) {
            resultsDiv.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:var(--text-sm);">No players found</div>';
            resultsDiv.style.display = 'block';
            return;
          }
          results.forEach(function(p) {
            var item = document.createElement('div');
            item.style.cssText = 'padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s;';
            var guildText = p.guild ? '<span style="color:var(--text-muted);font-size:11px;"> · ' + escHtml(p.guild) + '</span>' : '';
            var mainText = p.mainCharacter ? '<div style="font-size:11px;color:var(--text-muted);">' + escHtml(p.mainCharacter) + '</div>' : '';
            item.innerHTML = '<div><strong style="color:var(--text-primary);">' + escHtml(p.familyName) + '</strong>' + guildText + mainText + '</div>';
            item.addEventListener('mouseenter', function() { this.style.background = 'rgba(255,255,255,0.04)'; });
            item.addEventListener('mouseleave', function() { this.style.background = 'transparent'; });
            item.addEventListener('click', function() {
              resultsDiv.style.display = 'none';
              searchInput.value = p.familyName;
              loadProfile(p.profileTarget, region);
            });
            resultsDiv.appendChild(item);
          });
          resultsDiv.style.display = 'block';
        })
        .catch(function() { resultsDiv.style.display = 'none'; });
    }

    function loadProfile(profileTarget, region) {
      profileDiv.style.display = 'block';
      profileDiv.innerHTML = '<div style="padding:var(--space-8);text-align:center;color:var(--text-muted);">Loading profile...</div>';

      fetch('/api/bdo/players/' + encodeURIComponent(profileTarget) + '?region=' + encodeURIComponent(region))
        .then(function(r) { return r.json(); })
        .then(function(p) {
          if (p.error) {
            profileDiv.innerHTML = '<div style="padding:var(--space-6);text-align:center;color:var(--text-muted);">' + escHtml(p.error) + '</div>';
            return;
          }

          var chars = '';
          if (p.characters && p.characters.length) {
            chars = '<div style="margin-top:var(--space-4);">' +
              '<h4 style="margin:0 0 var(--space-2);font-size:var(--text-sm);color:var(--text-muted);text-transform:uppercase;">Characters</h4>' +
              '<div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">' +
              p.characters.map(function(c) {
                var mainBadge = c.main ? ' <span style="font-size:10px;background:rgba(34,197,94,0.15);color:var(--color-green,#22c55e);padding:2px 6px;border-radius:99px;">MAIN</span>' : '';
                return '<div style="padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius-md);font-size:var(--text-sm);">' +
                  '<strong>' + escHtml(c.name) + '</strong>' + mainBadge +
                  '<div style="font-size:11px;color:var(--text-muted);">' + escHtml(c.class) + (c.level ? ' · Lv.' + c.level : '') + '</div>' +
                '</div>';
              }).join('') +
            '</div></div>';
          }

          var stats = '';
          var statsItems = [];
          if (p.gs) statsItems.push({ label: 'Gear Score', value: String(p.gs) });
          if (p.combatFame) statsItems.push({ label: 'Combat Fame', value: String(p.combatFame) });
          if (p.lifeFame) statsItems.push({ label: 'Life Fame', value: String(p.lifeFame) });
          if (p.contributionPoints) statsItems.push({ label: 'Contribution', value: String(p.contributionPoints) });
          if (p.energy) statsItems.push({ label: 'Energy', value: String(p.energy) });

          if (statsItems.length) {
            stats = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:var(--space-3);margin-top:var(--space-4);">' +
              statsItems.map(function(s) {
                return '<div style="padding:var(--space-3);background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius-md);text-align:center;">' +
                  '<div style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;">' + escHtml(s.label) + '</div>' +
                  '<div style="font-size:var(--text-lg);font-weight:700;margin-top:2px;">' + escHtml(s.value) + '</div>' +
                '</div>';
              }).join('') +
            '</div>';
          }

          var createdDate = p.createdOn ? new Date(p.createdOn).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown';
          var profileUrl = region === 'ASIA'
            ? 'https://blackdesert.pearlabyss.com/Asia/en-US/Game/Profile/Search?_keyword=' + encodeURIComponent(p.familyName)
            : 'https://www.naeu.playblackdesert.com/en-US/Profile?_target=' + encodeURIComponent(p.profileTarget);

          profileDiv.innerHTML =
            '<div class="card" style="padding:var(--space-6);">' +
              '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
                '<div>' +
                  '<h2 style="margin:0;font-size:var(--text-xl);font-weight:700;">' + escHtml(p.familyName) + '</h2>' +
                  '<div style="margin-top:var(--space-1);display:flex;gap:var(--space-3);color:var(--text-muted);font-size:var(--text-sm);">' +
                    (p.guild ? '<span>Guild: <strong style="color:var(--text-primary);">' + escHtml(p.guild) + '</strong></span>' : '') +
                    '<span>Region: ' + escHtml(p.region) + '</span>' +
                  '</div>' +
                '</div>' +
                '<a href="' + profileUrl + '" target="_blank" rel="noopener" class="button button-ghost button-sm" style="text-decoration:none;">View on PA ↗</a>' +
              '</div>' +
              '<div style="margin-top:var(--space-2);font-size:var(--text-sm);color:var(--text-muted);">Joined ' + createdDate + '</div>' +
              chars +
              stats +
            '</div>';
        })
        .catch(function() {
          profileDiv.innerHTML = '<div style="padding:var(--space-6);text-align:center;color:var(--text-muted);">Failed to load profile</div>';
        });
    }

    function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  })();
  </script>`;

  return renderApp(`Player Search — ${guild.name}`, content, { session, summaries, activeNav: "stats" });
}
