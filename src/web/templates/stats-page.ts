import { escapeHtml, formatDateLabel, formatStatNumber } from '../utils.js';
import { renderApp, renderPageHeader, renderStatGrid, renderEmptyState } from './layout.js';
import { aggregateScoreRows, calculateImpactScores, sortScoreAggregates, parseScoreSortKey } from '../score.js';
import { formatClockTime } from '../../time-format.js';
import type { WebSession, GuildDashboardSummary, DiscordGuild, PlayerScoreAggregate, PlayerImpactScore, ScoreSortKey } from '../types.js';
import type { ScoreReport, ScoreRow, ScoreReportResult } from '../../score-types.js';

/* ── Server picker ──────────────────────────────────────────── */

export function renderStatsServerPickerPage(
  session: WebSession,
  summaries: GuildDashboardSummary[]
): string {
  if (!summaries.length) {
    const content = [
      renderPageHeader("Stats", "Server performance and scoreboards"),
      renderEmptyState("No servers yet", "Join a server with NW Helper installed to view stats."),
    ].join("\n");
    return renderApp("Stats", content, { session, activeNav: "stats" });
  }

  const cards = summaries.map((summary) => {
    const hasStats = summary.activeRaids > 0 || summary.weeklyRaids > 0;
    const iconUrl = summary.guild.icon
      ? `https://cdn.discordapp.com/icons/${summary.guild.id}/${summary.guild.icon}.png?size=64`
      : null;
    const fallback = summary.guild.name.charAt(0).toUpperCase();
    return `<a href="/stats?guild=${enc(summary.guild.id)}" class="card" style="text-decoration:none;color:inherit;">
      <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);">
        <div style="width:48px;height:48px;border-radius:var(--radius-lg);background:var(--bg-surface);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
          ${iconUrl ? `<img src="${iconUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : `<span style="font-size:var(--text-xl);font-weight:700;color:var(--text-muted);">${fallback}</span>`}
        </div>
        <div style="flex:1;min-width:0;">
          <h3 style="margin-bottom:var(--space-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(summary.guild.name)}</h3>
          <p style="font-size:var(--text-xs);color:var(--text-muted);">${summary.activeRaids} active raids · ${summary.upcomingRaids} upcoming</p>
        </div>
        <span class="badge ${hasStats ? "badge-active" : "badge-inactive"}">${hasStats ? "Active" : "No data"}</span>
      </div>
      <div style="display:flex;gap:var(--space-2);">
        <span class="button button-secondary button-sm">View Stats</span>
      </div>
    </a>`;
  }).join("");

  const content = [
    renderPageHeader("Stats", "Server performance and scoreboards"),
    `<div class="page-content">
      <div class="grid grid-3">${cards}</div>
    </div>`,
  ].join("\n");

  return renderApp("Stats", content, { session, summaries, activeNav: "stats" });
}

/* ── Main stats page ────────────────────────────────────────── */

export function renderStatsPage(
  guild: DiscordGuild,
  session: WebSession,
  reports: ScoreReport[],
  notice?: "uploaded" | "rescanned" | "saved" | "deleted" | "renamed",
  sortKey: ScoreSortKey = "wars",
  canManage = false,
  summaries?: GuildDashboardSummary[]
): string {
  const rows = reports.flatMap((r) => r.rows);
  const players = sortScoreAggregates(aggregateScoreRows(rows), sortKey);
  const topDamage = Math.max(1, ...players.map((p) => p.damageDealt));
  const totalKills = rows.reduce((sum, r) => sum + r.kills, 0);
  const totalDeaths = rows.reduce((sum, r) => sum + r.deaths, 0);
  const totalWars = reports.length;

  const uploadButton = canManage
    ? `<button type="button" class="button button-primary button-sm" onclick="document.getElementById('upload-modal').classList.add('open')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Upload
      </button>
      <button type="button" class="button button-secondary button-sm" onclick="document.getElementById('manual-modal').classList.add('open')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Manual Entry
      </button>`
    : "";

  const headerActions = `<a class="button button-ghost button-sm" href="/?guild=${enc(guild.id)}">Raids</a><a class="button button-ghost button-sm" href="/stats/history?guild=${enc(guild.id)}">Score History</a><a class="button button-ghost button-sm" href="/stats/compare?guild=${enc(guild.id)}">Compare</a><a class="button button-ghost button-sm" href="/stats/export.csv?guild=${enc(guild.id)}">Export CSV</a>${uploadButton}`;

  const content = [
    `<div class="dashboard">
      <div class="dashboard-header">
        <div>
          <h1 style="font-size:var(--text-xl);font-weight:700;">${esc(guild.name)}</h1>
          <p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:2px;">War stats — scoreboards, player participation, and performance trends.</p>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2);">${headerActions}</div>
      </div>

      ${renderStatGrid([
        { label: "Scoreboards", value: String(totalWars), color: "var(--color-indigo)" },
        { label: "Players", value: String(players.length), color: "var(--color-cyan)" },
        { label: "Total kills", value: formatStatNumber(totalKills), color: "var(--color-rose)" },
        { label: "Team K/D", value: totalDeaths ? (totalKills / totalDeaths).toFixed(2) : formatStatNumber(totalKills), color: "var(--color-amber)" },
      ])}

      ${canManage ? renderUploadForm(guild, session) : ""}
      ${canManage ? renderManualEntryForm(guild, session, reports.length ? [...new Set(reports.sort((a, b) => b.warDate.localeCompare(a.warDate))[0].rows.map((r) => r.familyName))] : undefined) : ""}

      ${players.length
        ? renderScoreSection(players, reports, topDamage, sortKey, guild.id, session.csrfToken, canManage)
        : `<div style="flex:1;display:flex;align-items:center;justify-content:center;">
            ${renderEmptyState(
              "No score data yet",
              canManage ? "Upload a scoreboard screenshot to start tracking player performance." : "No score data has been uploaded for this server yet.",
            )}
          </div>`}
    </div>`,
  ].filter(Boolean).join("\n");

  return renderApp(`Stats — ${guild.name}`, content, { session, summaries, activeNav: "stats" });
}

/* ── Notice banner ──────────────────────────────────────────── */

function renderNoticeBanner(notice: "uploaded" | "rescanned" | "saved" | "deleted" | "renamed"): string {
  const messages: Record<string, { text: string; badge: string }> = {
    uploaded: { text: "Scoreboard uploaded and parsed. Review the extracted rows before using them for final calls.", badge: "badge-active" },
    rescanned: { text: "OCR rescan complete. The scoreboard has been re-processed.", badge: "badge-accent" },
    saved: { text: "Scoreboard edits saved.", badge: "badge-active" },
    deleted: { text: "Scoreboard removed.", badge: "badge-danger" },
    renamed: { text: "Player name updated across all scoreboards.", badge: "badge-accent" },
  };
  const { text, badge } = messages[notice] ?? { text: "Operation complete.", badge: "badge-active" };
  return `<div class="page-content">
    <div class="card" style="border-left:3px solid var(--accent);display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);">
      <span class="badge ${badge}">${esc(notice)}</span>
      <span style="font-size:var(--text-sm);color:var(--text-secondary);">${esc(text)}</span>
    </div>
  </div>`;
}

/* ── Upload form ────────────────────────────────────────────── */

function renderUploadForm(guild: DiscordGuild, session: WebSession): string {
  const today = new Date().toISOString().slice(0, 10);
  return `<div class="upload-modal-overlay" id="upload-modal">
    <div class="upload-modal" style="max-width:680px;">
      <div class="upload-modal-header">
        <div>
          <span class="badge badge-accent" style="margin-bottom:var(--space-2);display:inline-block;">SCREENSHOT OCR</span>
          <h3 style="margin-top:var(--space-1);">Upload Scoreboard</h3>
        </div>
        <button type="button" class="upload-modal-close" onclick="document.getElementById('upload-modal').classList.remove('open');document.getElementById('upload-step-1').style.display='';document.getElementById('upload-step-2').style.display='none';">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <!-- Step 1: File input -->
      <div id="upload-step-1">
        <div class="form-grid">
          <div class="form-group">
            <label class="label" for="upload-war-date">War date</label>
            <input class="input" type="date" id="upload-war-date" value="${today}" required>
          </div>
          <div class="form-group">
            <label class="label" for="upload-result">Result</label>
            <select class="select" id="upload-result">
              <option value="unknown">Unknown</option>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
            </select>
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="label" for="upload-title">Title</label>
            <input class="input" type="text" id="upload-title" maxlength="120" placeholder="Optional war label">
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="label" for="upload-screenshot">Screenshot</label>
            <input class="input" type="file" id="upload-screenshot" accept="image/png,image/jpeg,image/webp" required>
          </div>
          <div style="grid-column:1/-1;padding:var(--space-3);background:var(--bg-surface);border:1px solid var(--border-default);border-radius:var(--radius-sm);font-size:var(--text-xs);color:var(--text-muted);line-height:1.5;">
            <strong style="color:var(--text-secondary);">Disclaimer:</strong> OCR and AI image extraction may produce incorrect values. Review extracted rows before saving.
          </div>
          <div style="grid-column:1/-1;display:flex;gap:var(--space-3);justify-content:flex-end;">
            <button type="button" class="button button-ghost" onclick="document.getElementById('upload-modal').classList.remove('open')">Cancel</button>
            <button type="button" class="button button-primary" id="upload-preview-btn" onclick="window.__uploadPreview()">Scan screenshot</button>
          </div>
        </div>
      </div>

      <!-- Step 2: Preview extracted rows -->
      <div id="upload-step-2" style="display:none;">
        <div id="upload-preview-status" style="margin-bottom:var(--space-3);font-size:var(--text-sm);color:var(--text-muted);"></div>
        <div id="upload-preview-table" style="max-height:350px;overflow-y:auto;margin-bottom:var(--space-4);"></div>
        <div style="display:flex;gap:var(--space-3);justify-content:flex-end;">
          <button type="button" class="button button-ghost" onclick="document.getElementById('upload-step-1').style.display='';document.getElementById('upload-step-2').style.display='none';">← Back</button>
          <button type="button" class="button button-primary" id="upload-confirm-btn" onclick="window.__uploadConfirm()">Save scores</button>
        </div>
      </div>
    </div>

    <script>
    (function() {
      var csrfToken = ${JSON.stringify(session.csrfToken)};
      var guildId = ${JSON.stringify(guild.id)};
      var extractedRows = [];

      window.__uploadPreview = function() {
        var fileInput = document.getElementById('upload-screenshot');
        if (!fileInput.files.length) { alert('Select a screenshot first.'); return; }
        var btn = document.getElementById('upload-preview-btn');
        btn.disabled = true; btn.textContent = 'Scanning...';
        var fd = new FormData();
        fd.append('screenshot', fileInput.files[0]);
        fd.append('csrfToken', csrfToken);
        fd.append('guildId', guildId);
        fetch('/stats/upload/preview', { method: 'POST', body: fd })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.error) { alert(data.error); btn.disabled = false; btn.textContent = 'Scan screenshot'; return; }
            extractedRows = data.rows || [];
            document.getElementById('upload-preview-status').innerHTML =
              '<span class="badge badge-active">' + extractedRows.length + ' players</span> ' +
              '<span style="margin-left:var(--space-2);">Engine: ' + (data.engine || 'unknown') + '</span>' +
              (data.confidence ? ' · Confidence: ' + Math.round(data.confidence) + '%' : '');
            var html = '<table class="table" style="min-width:500px;"><thead><tr>' +
              '<th>Player</th><th>K</th><th>D</th><th>A</th><th>DMG</th><th>CC</th><th>Fort</th>' +
              '</tr></thead><tbody>';
            extractedRows.forEach(function(row, i) {
              html += '<tr>' +
                '<td><input class="input" style="width:120px;padding:2px 6px;font-size:12px;" data-field="familyName" data-idx="' + i + '" value="' + (row.familyName||'').replace(/"/g,'&quot;') + '"></td>' +
                '<td><input class="input" style="width:50px;padding:2px 6px;font-size:12px;text-align:right;" data-field="kills" data-idx="' + i + '" type="number" value="' + (row.kills||0) + '"></td>' +
                '<td><input class="input" style="width:50px;padding:2px 6px;font-size:12px;text-align:right;" data-field="deaths" data-idx="' + i + '" type="number" value="' + (row.deaths||0) + '"></td>' +
                '<td><input class="input" style="width:50px;padding:2px 6px;font-size:12px;text-align:right;" data-field="assists" data-idx="' + i + '" type="number" value="' + (row.assists||0) + '"></td>' +
                '<td><input class="input" style="width:70px;padding:2px 6px;font-size:12px;text-align:right;" data-field="damageDealt" data-idx="' + i + '" type="number" value="' + (row.damageDealt||0) + '"></td>' +
                '<td><input class="input" style="width:50px;padding:2px 6px;font-size:12px;text-align:right;" data-field="crowdControls" data-idx="' + i + '" type="number" value="' + (row.crowdControls||0) + '"></td>' +
                '<td><input class="input" style="width:70px;padding:2px 6px;font-size:12px;text-align:right;" data-field="structureDamage" data-idx="' + i + '" type="number" value="' + (row.structureDamage||0) + '"></td>' +
                '</tr>';
            });
            html += '</tbody></table>';
            document.getElementById('upload-preview-table').innerHTML = html;
            document.getElementById('upload-step-1').style.display = 'none';
            document.getElementById('upload-step-2').style.display = '';
            btn.disabled = false; btn.textContent = 'Scan screenshot';
          })
          .catch(function(e) { alert('Scan failed: ' + e.message); btn.disabled = false; btn.textContent = 'Scan screenshot'; });
      };

      window.__uploadConfirm = function() {
        // Read edited values from inputs
        document.querySelectorAll('#upload-preview-table input[data-idx]').forEach(function(input) {
          var idx = parseInt(input.dataset.idx);
          var field = input.dataset.field;
          if (extractedRows[idx]) {
            if (field === 'familyName') extractedRows[idx][field] = input.value;
            else extractedRows[idx][field] = parseInt(input.value) || 0;
          }
        });
        // Build form data
        var fd = new FormData();
        fd.append('csrfToken', csrfToken);
        fd.append('guildId', guildId);
        fd.append('warDate', document.getElementById('upload-war-date').value);
        fd.append('result', document.getElementById('upload-result').value);
        fd.append('title', document.getElementById('upload-title').value);
        fd.append('rows', JSON.stringify(extractedRows));
        var btn = document.getElementById('upload-confirm-btn');
        btn.disabled = true; btn.textContent = 'Saving...';
        fetch('/stats/upload', { method: 'POST', body: fd })
          .then(function(r) { if (r.redirected) window.location.href = r.url; else return r.text(); })
          .then(function() { window.location.reload(); })
          .catch(function(e) { alert('Save failed: ' + e.message); btn.disabled = false; btn.textContent = 'Save'; });
      };
    })();
    </script>
  </div>`;
}
/* ── Manual entry form ──────────────────────────────────────── */

function renderManualEntryForm(guild: DiscordGuild, session: WebSession, lastWarPlayers?: string[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const templatePlayers = lastWarPlayers?.length
    ? lastWarPlayers.map((name) => `    { "name": "${esc(name)}", "kills": 0, "deaths": 0, "assists": 0, "damage": 0, "taken": 0, "cc": 0, "healed": 0, "support": 0, "fort": 0 }`).join(",\n")
    : `    { "name": "PlayerName", "kills": 0, "deaths": 0, "assists": 0, "damage": 0, "taken": 0, "cc": 0, "healed": 0, "support": 0, "fort": 0 }`;
  const templateJson = JSON.stringify({
    warDate: today,
    result: "loss",
    title: "Node War",
    players: lastWarPlayers?.length
      ? lastWarPlayers.map((name) => ({ name, kills: 0, deaths: 0, assists: 0, damage: 0, taken: 0, cc: 0, healed: 0, support: 0, fort: 0 }))
      : [{ name: "PlayerName", kills: 0, deaths: 0, assists: 0, damage: 0, taken: 0, cc: 0, healed: 0, support: 0, fort: 0 }]
  }, null, 2);

  return `<div class="upload-modal-overlay" id="manual-modal">
    <div class="upload-modal" style="max-width:720px;">
      <div class="upload-modal-header">
        <div>
          <span class="badge badge-accent" style="margin-bottom:var(--space-2);display:inline-block;">MANUAL ENTRY</span>
          <h3 style="margin-top:var(--space-1);">Enter Score Data (JSON)</h3>
        </div>
        <button type="button" class="upload-modal-close" onclick="document.getElementById('manual-modal').classList.remove('open')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <form method="post" action="/stats/manual" class="form-grid">
        <input type="hidden" name="csrfToken" value="${esc(session.csrfToken)}">
        <input type="hidden" name="guildId" value="${esc(guild.id)}">
        <input type="hidden" name="format" value="json">
        <div style="grid-column:1/-1;padding:var(--space-3);background:var(--bg-surface);border:1px solid var(--border-default);border-radius:var(--radius-sm);font-size:var(--text-xs);color:var(--text-muted);line-height:1.6;">
          <strong style="color:var(--text-secondary);">How it works:</strong> Click <strong>Copy JSON Template</strong> to get the format with pre-filled player names, fill in the stats, then paste the entire JSON below and submit.
          <br><br>
          <strong>Fields:</strong> kills, deaths, assists, damage, taken, cc, healed, support, fort
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label class="label" for="manual-data">JSON data</label>
          <textarea class="input" id="manual-data" name="scoreData" rows="18" style="font-family:var(--font-mono);font-size:11px;resize:vertical;line-height:1.5;" placeholder='{"warDate":"2026-06-07","result":"loss","players":[{"name":"Player","kills":0,"deaths":0,"assists":0,"damage":0,"taken":0,"cc":0,"healed":0,"support":0,"fort":0}]}' required></textarea>
        </div>
        <div style="grid-column:1/-1;display:flex;gap:var(--space-3);justify-content:flex-end;align-items:center;">
          <button type="button" class="button button-ghost button-sm" onclick="navigator.clipboard.writeText(document.getElementById('json-template').textContent).then(function(){var b=event.target;b.textContent='Copied!';setTimeout(function(){b.textContent='Copy JSON Template'},1500)})">Copy JSON Template</button>
          <div style="flex:1;"></div>
          <button type="button" class="button button-ghost" onclick="document.getElementById('manual-modal').classList.remove('open')">Cancel</button>
          <button type="submit" class="button button-primary">Save scores</button>
        </div>
      </form>
      <pre id="json-template" style="display:none;">${esc(JSON.stringify({
    warDate: today,
    result: "loss",
    title: "Node War",
    players: lastWarPlayers?.length
      ? lastWarPlayers.map((name) => ({ name, kills: 0, deaths: 0, assists: 0, damage: 0, taken: 0, cc: 0, healed: 0, support: 0, fort: 0 }))
      : [{ name: "PlayerName", kills: 0, deaths: 0, assists: 0, damage: 0, taken: 0, cc: 0, healed: 0, support: 0, fort: 0 }]
  }, null, 2))}</pre>
    </div>
  </div>`;
}

/* ── Score section (analysis + tables) ──────────────────────── */

function renderScoreSection(
  players: PlayerScoreAggregate[],
  reports: ScoreReport[],
  topDamage: number,
  sortKey: ScoreSortKey,
  guildId: string,
  csrfToken: string,
  canManage: boolean
): string {
  const impactScores = calculateImpactScores(players);
  const wins = reports.filter(r => r.result === 'win').length;
  const losses = reports.filter(r => r.result === 'loss').length;
  const unknowns = reports.filter(r => r.result === 'unknown').length;
  const top5Impact = impactScores.slice(0, 5);
  const top10 = [...players].sort((a, b) => b.kills - a.kills).slice(0, 10);

  return `
    ${renderLeaderboardGrid(players)}

    <div class="dashboard-split">
      <div class="dashboard-split-main">
        ${renderCompactScoreTable(players, topDamage, sortKey, guildId, csrfToken, canManage, impactScores)}
      </div>
      <div class="dashboard-split-side">
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">Battle Results</span>
            <span class="chart-card-subtitle">${String(reports.length)} reports</span>
          </div>
          <div class="chart-container">
            <canvas id="resultsChart"></canvas>
          </div>
        </div>
        ${top5Impact.length > 0 ? `<div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">Impact Leaders</span>
            <span class="chart-card-subtitle">Composite</span>
          </div>
          <div class="chart-container">
            <canvas id="impactChart"></canvas>
          </div>
        </div>` : ''}
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">Team Performance</span>
            <span class="chart-card-subtitle">Top ${String(Math.min(10, players.length))}</span>
          </div>
          <div class="chart-container">
            <canvas id="performanceChart"></canvas>
          </div>
        </div>
      </div>
    </div>

    ${renderChartsScript(players, reports, impactScores)}
  `;
}

/* ── Leaderboard cards grid ─────────────────────────────────── */

function renderLeaderboardGrid(players: PlayerScoreAggregate[]): string {
  const leaderboards = [
    { title: "Damage", eyebrow: "Pressure", metric: (p: PlayerScoreAggregate) => p.damageDealt, color: "var(--color-rose)" },
    { title: "Attendance", eyebrow: "Wars", metric: (p: PlayerScoreAggregate) => p.participations, color: "var(--color-indigo)" },
    { title: "Support", eyebrow: "Healed", metric: (p: PlayerScoreAggregate) => p.allySupport, color: "var(--color-emerald)" },
    { title: "CC", eyebrow: "Control", metric: (p: PlayerScoreAggregate) => p.crowdControls, color: "var(--color-violet)" },
  ];

  const cards = leaderboards.map((lb) => {
    const leaders = [...players].sort((a, b) => lb.metric(b) - lb.metric(a)).slice(0, 3);
    return `<div class="stat-card" style="border-left:2px solid ${lb.color};opacity:1;">
      <div style="margin-bottom:var(--space-2);">
        <span style="font-size:9px;color:${lb.color};text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">${esc(lb.eyebrow)}</span>
        <div style="font-size:var(--text-sm);font-weight:600;margin-top:2px;color:var(--text-primary);">${esc(lb.title)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-2);">
        ${leaders.map((player, i) => `<div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-xs);">
          <span style="color:${i === 0 ? lb.color : 'var(--text-muted)'};font-weight:700;width:14px;font-size:11px;">${i + 1}</span>
          <span style="flex:1;font-weight:500;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(player.familyName)}</span>
          <span style="color:var(--text-muted);font-variant-numeric:tabular-nums;font-weight:500;">${formatStatNumber(lb.metric(player))}</span>
        </div>`).join("")}
      </div>
    </div>`;
  }).join("");

  return `<div class="dashboard-stats">${cards}</div>`;
}

/* ── Score table tabs ───────────────────────────────────────── */

function renderScoreTableTabs(
  players: PlayerScoreAggregate[],
  topDamage: number,
  sortKey: ScoreSortKey,
  guildId: string,
  csrfToken: string,
  canManage: boolean,
  impactScores: PlayerImpactScore[]
): string {
  return `<div data-score-tabs class="card" style="padding:0;overflow:hidden;">
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);background:var(--bg-elevated);">
      <button type="button" class="tab-btn is-active" data-tab-target="scoreboard-totals">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
        Scoreboard totals
      </button>
      <button type="button" class="tab-btn" data-tab-target="impact-formula">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        Impact formula
      </button>
      <span style="margin-left:auto;font-size:var(--text-xs);color:var(--text-muted);align-self:center;padding-right:var(--space-4);">Kills 20% · Assists 10% · Damage 20% · Fort 30% · Obj 10% · Survive 10%</span>
    </div>
    <div style="padding:var(--space-5);">
      <div class="score-tab-panel is-active" data-tab-panel="scoreboard-totals">
        ${renderScoreTable(players, topDamage, sortKey, guildId, csrfToken, canManage)}
      </div>
      <div class="score-tab-panel" data-tab-panel="impact-formula" hidden>
        ${renderImpactSection(impactScores)}
      </div>
    </div>
  </div>
  ${renderScoreTabsScript()}${renderScoreSortScript()}`;
}

/* ── Score table ────────────────────────────────────────────── */

function renderScoreTable(
  players: PlayerScoreAggregate[],
  topDamage: number,
  sortKey: ScoreSortKey,
  guildId: string,
  csrfToken: string,
  canManage: boolean
): string {
  const sortColumns: Array<{ label: string; key: string }> = [
    { label: "Player", key: "player" },
    { label: "Wars", key: "wars" },
    { label: "K", key: "kills" },
    { label: "D", key: "deaths" },
    { label: "K/D", key: "kd" },
    { label: "Damage", key: "damage" },
    { label: "Taken", key: "taken" },
    { label: "CC", key: "cc" },
    { label: "Healed", key: "healed" },
    { label: "Structure", key: "structure" },
  ];

  const thead = `<thead><tr>${sortColumns.map((col) =>
    `<th>${renderSortButton(col.label, col.key, sortKey)}</th>`
  ).join("")}</tr></thead>`;

  const tbody = `<tbody>${players.map((player) => {
    const healed = player.allySupport;
    const kd = player.deaths ? player.kills / player.deaths : player.kills;
    const kdTone = player.deaths ? (kd >= 2 ? "badge-active" : kd >= 1 ? "badge-warning" : "badge-danger") : "badge-inactive";
    return `<tr data-player="${esc(player.familyName.toLowerCase())}" data-wars="${player.participations}" data-kills="${player.kills}" data-deaths="${player.deaths}" data-kd="${kd}" data-damage="${player.damageDealt}" data-taken="${player.damageTaken}" data-cc="${player.crowdControls}" data-healed="${healed}" data-structure="${player.structureDamage}">
      <td>
        <div style="display:flex;flex-direction:column;gap:var(--space-1);">
          <span style="font-weight:600;color:var(--text-primary);">${esc(player.familyName)}</span>
          <div style="width:100%;height:4px;background:var(--border-subtle);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${Math.max(4, Math.round((player.damageDealt / topDamage) * 100))}%;background:var(--accent);border-radius:2px;"></div>
          </div>
          ${canManage ? renderInlineRenameControl(player.familyName, guildId, csrfToken) : ""}
        </div>
      </td>
      <td>${player.participations}</td>
      <td>${formatStatNumber(player.kills)}</td>
      <td>${formatStatNumber(player.deaths)}</td>
      <td><span class="badge ${kdTone}">${player.deaths ? kd.toFixed(2) : formatStatNumber(player.kills)}</span></td>
      <td>${formatStatNumber(player.damageDealt)}</td>
      <td>${formatStatNumber(player.damageTaken)}</td>
      <td>${formatStatNumber(player.crowdControls)}</td>
      <td>${formatStatNumber(healed)}</td>
      <td>${formatStatNumber(player.structureDamage)}</td>
    </tr>`;
  }).join("")}</tbody>`;

  return `<div class="table-wrap"><table class="table" data-score-table data-score-sort="${sortKey}">
    ${thead}${tbody}
  </table></div>`;
}

/* ── Compact score table (dashboard) ───────────────────────── */

function renderCompactScoreTable(
  players: PlayerScoreAggregate[],
  topDamage: number,
  sortKey: ScoreSortKey,
  guildId: string,
  csrfToken: string,
  canManage: boolean,
  impactScores: PlayerImpactScore[]
): string {
  const sortColumns: Array<{ label: string; key: string }> = [
    { label: "", key: "" },
    { label: "Player", key: "player" },
    { label: "Wars", key: "wars" },
    { label: "K", key: "kills" },
    { label: "D", key: "deaths" },
    { label: "K/D", key: "kd" },
    { label: "DMG", key: "damage" },
    { label: "CC", key: "cc" },
  ];

  const thead = `<thead><tr>${sortColumns.map((col) =>
    col.key ? `<th>${renderSortButton(col.label, col.key, sortKey)}</th>` : `<th style="width:40px;text-align:center;">#</th>`
  ).join("")}</tr></thead>`;

  const tbody = `<tbody>${players.map((player, index) => {
    const kd = player.deaths ? player.kills / player.deaths : player.kills;
    const kdTone = player.deaths ? (kd >= 2 ? "badge-active" : kd >= 1 ? "badge-warning" : "badge-danger") : "badge-inactive";
    const rank = index + 1;

    // Rank colors
    const rankColors: Record<number, { bg: string; border: string; text: string; glow: string }> = {
      1: { bg: "linear-gradient(135deg,rgba(245,158,11,0.08),rgba(245,158,11,0.02))", border: "#f59e0b", text: "#f59e0b", glow: "rgba(245,158,11,0.06)" },
      2: { bg: "linear-gradient(135deg,rgba(56,189,248,0.06),rgba(56,189,248,0.01))", border: "#38bdf8", text: "#38bdf8", glow: "rgba(56,189,248,0.04)" },
      3: { bg: "linear-gradient(135deg,rgba(244,63,94,0.06),rgba(244,63,94,0.01))", border: "#f43f5e", text: "#f43f5e", glow: "rgba(244,63,94,0.04)" },
      4: { bg: "linear-gradient(135deg,rgba(139,92,246,0.05),rgba(139,92,246,0.01))", border: "#8b5cf6", text: "#8b5cf6", glow: "rgba(139,92,246,0.03)" },
      5: { bg: "linear-gradient(135deg,rgba(16,185,129,0.05),rgba(16,185,129,0.01))", border: "#10b981", text: "#10b981", glow: "rgba(16,185,129,0.03)" },
    };
    const rc = rankColors[rank] ?? { bg: "transparent", border: "transparent", text: "var(--text-muted)", glow: "transparent" };

    // Rank badge with crown for #1
    const crownSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4l3 12h14l3-12-6 4-4-5-4 5z"/><rect x="3" y="18" width="18" height="2" rx="1"/></svg>`;
    const rankBadge = rank === 1
      ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--radius-full);background:linear-gradient(135deg,rgba(245,158,11,0.15),rgba(245,158,11,0.05));color:var(--color-amber);border:1.5px solid rgba(245,158,11,0.3);font-weight:800;font-size:var(--text-xs);">${crownSvg}</span>`
      : rank <= 5
        ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--radius-full);background:${rc.bg};color:${rc.text};border:1.5px solid ${rc.border}22;font-weight:700;font-size:var(--text-xs);">${rank}</span>`
        : `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--radius-full);color:var(--text-muted);font-weight:500;font-size:var(--text-xs);">${rank}</span>`;

    // Nameplate: Discord-style with rank color accent
    const nameAccent = rank <= 5 ? rc.text : "var(--text-primary)";
    const rowBg = rank <= 5 ? rc.bg : "transparent";
    const rowBorder = rank <= 5 ? `border-left:2.5px solid ${rc.border}33;` : "";

    return `<tr data-table="scoreboard" data-rank="${rank}" data-player="${esc(player.familyName.toLowerCase())}" data-wars="${player.participations}" data-kills="${player.kills}" data-deaths="${player.deaths}" data-kd="${kd}" data-damage="${player.damageDealt}" data-taken="${player.damageTaken}" data-cc="${player.crowdControls}" data-healed="${player.allySupport}" data-structure="${player.structureDamage}" style="background:${rowBg};${rowBorder}">
      <td style="text-align:center;" data-rank-cell>${rankBadge}</td>
      <td>
        <div style="display:flex;align-items:center;gap:var(--space-2);">
          <a href="/stats/players/${enc(player.familyName)}?guild=${enc(guildId)}" style="font-weight:600;color:${nameAccent};font-size:var(--text-sm);text-decoration:none;transition:opacity 0.15s;" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">${esc(player.familyName)}</a>
          ${canManage ? renderInlineRenameControl(player.familyName, guildId, csrfToken) : ""}
        </div>
      </td>
      <td style="font-weight:500;">${player.participations}</td>
      <td style="font-weight:500;">${formatStatNumber(player.kills)}</td>
      <td style="color:var(--text-secondary);">${formatStatNumber(player.deaths)}</td>
      <td><span class="badge ${kdTone}" style="font-size:10px;">${player.deaths ? kd.toFixed(1) : formatStatNumber(player.kills)}</span></td>
      <td style="font-weight:500;">${formatStatNumber(player.damageDealt)}</td>
      <td style="font-weight:500;">${formatStatNumber(player.crowdControls)}</td>
    </tr>`;
  }).join("")}</tbody>`;

  return `<div class="dashboard-table-wrap">
    <div class="dashboard-table-header">
      <span class="chart-card-title">Scoreboard Totals</span>
      <span class="chart-card-subtitle">Fort 35% · Damage 25% · Objective 20% · Kills 10% · Assist 5% · Surv 5%</span>
    </div>
    <div class="dashboard-table-scroll">
      <table class="table" data-score-table data-score-sort="${sortKey}">
        ${thead}${tbody}
      </table>
    </div>
  </div>
  ${renderScoreSortScript()}`;
}

function renderSortButton(label: string, key: string, sortKey: string): string {
  const active = key === sortKey;
  return `<button class="button button-ghost button-sm${active ? " is-active" : ""}" type="button" data-score-sort-key="${esc(key)}" aria-label="Sort by ${esc(label)}" aria-sort="${active ? "descending" : "none"}">${esc(label)}${active ? " ↓" : ""}</button>`;
}

/* ── Impact section ─────────────────────────────────────────── */

function renderImpactSection(impactScores: PlayerImpactScore[]): string {
  const topScore = Math.max(1, ...impactScores.map((i) => i.score));

  const thead = `<thead><tr>
    <th>${renderSortButton("Player", "player", "impact")}</th>
    <th>${renderSortButton("Impact", "impact", "impact")}</th>
    <th>${renderSortButton("Fort", "structure", "impact")}</th>
    <th>${renderSortButton("Obj", "objective", "impact")}</th>
    <th>${renderSortButton("Surv", "survival", "impact")}</th>
  </tr></thead>`;

  const tbody = `<tbody>${impactScores.map((impact, index) => {
    const player = impact.player;
    const topClass = index < 3 ? ` style="background:${index === 0 ? "rgba(99,102,241,0.08)" : index === 1 ? "rgba(99,102,241,0.04)" : "rgba(99,102,241,0.02)"}"` : "";
    return `<tr${topClass} data-player="${esc(player.familyName.toLowerCase())}" data-impact="${impact.score}" data-structure="${impact.structureScore}" data-objective="${impact.objectiveScore}" data-survival="${impact.survivalScore}">
      <td>
        <div style="display:flex;align-items:center;gap:var(--space-2);">
          <span class="badge ${index < 3 ? "badge-accent" : "badge-inactive"}" style="min-width:24px;text-align:center;">${index + 1}</span>
          <span style="font-weight:500;">${esc(player.familyName)}</span>
        </div>
        <div style="width:100%;height:3px;background:var(--border-subtle);border-radius:2px;overflow:hidden;margin-top:var(--space-1);">
          <div style="height:100%;width:${Math.max(4, Math.round((impact.score / topScore) * 100))}%;background:var(--accent);border-radius:2px;"></div>
        </div>
      </td>
      <td><strong>${impact.score.toFixed(1)}</strong></td>
      <td>${impact.structureScore.toFixed(0)}</td>
      <td>${impact.objectiveScore.toFixed(0)}</td>
      <td>${impact.survivalScore.toFixed(0)}</td>
    </tr>
    <tr class="impact-breakdown" data-player="${esc(player.familyName.toLowerCase())}" data-impact="${impact.score}" data-structure="${impact.structureScore}" data-objective="${impact.objectiveScore}" data-survival="${impact.survivalScore}">
      <td colspan="5" style="padding:var(--space-2) var(--space-4);">
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
          ${renderImpactChip("K", impact.killsScore, "kills")}
          ${renderImpactChip("A", impact.assistsScore, "assists")}
          ${renderImpactChip("DMG", impact.damageScore, "damage")}
          ${renderImpactChip("FORT", impact.structureScore, "structure")}
          ${renderImpactChip("OBJ", impact.objectiveScore, "objective")}
          ${renderImpactChip("LIFE", impact.survivalScore, "survival")}
        </div>
      </td>
    </tr>`;
  }).join("")}</tbody>`;

  return `<div style="margin-bottom:var(--space-3);display:flex;gap:var(--space-4);font-size:var(--text-sm);">
    <span><strong>${impactScores.length}</strong> <span style="color:var(--text-muted);">ranked players</span></span>
    <span><strong>${impactScores[0] ? impactScores[0].score.toFixed(1) : "0.0"}</strong> <span style="color:var(--text-muted);">top impact</span></span>
  </div>
  <div class="table-wrap"><table class="table" data-score-table data-score-sort="impact">
    ${thead}${tbody}
  </table></div>`;
}

function renderImpactChip(label: string, score: number, tone: string): string {
  return `<span class="badge badge-${tone === "kills" || tone === "damage" ? "active" : tone === "survival" ? "warning" : "accent"}" style="font-size:var(--text-xs);">${esc(label)} ${score.toFixed(0)}</span>`;
}

/* ── Inline player rename control ───────────────────────────── */

function renderInlineRenameControl(familyName: string, guildId: string, csrfToken: string): string {
  return `<details style="margin-top:var(--space-1);">
    <summary style="font-size:var(--text-xs);color:var(--accent);cursor:pointer;">Edit</summary>
    <form method="post" action="/stats/players/rename" style="margin-top:var(--space-1);display:flex;gap:var(--space-2);align-items:center;">
      <input type="hidden" name="csrfToken" value="${esc(csrfToken)}">
      <input type="hidden" name="guildId" value="${esc(guildId)}">
      <input type="hidden" name="oldName" value="${esc(familyName)}">
      <input class="input" type="text" name="familyName" value="${esc(familyName)}" maxlength="80" required style="width:160px;padding:var(--space-1) var(--space-2);font-size:var(--text-xs);">
      <button type="submit" class="button button-primary button-sm" style="padding:var(--space-1) var(--space-2);font-size:var(--text-xs);">Save</button>
    </form>
  </details>`;
}

/* ── Report cards section ───────────────────────────────────── */

function renderReportCardsSection(reports: ScoreReport[], csrfToken: string, canManage: boolean): string {
  if (!reports.length) {
    return `<div class="page-content">${renderEmptyState("No reports stored", "Uploaded screenshots will appear here.")}</div>`;
  }

  const sorted = [...reports].sort((a, b) => b.warDate.localeCompare(a.warDate));

  const cards = sorted.map((report) => renderReportCard(report, csrfToken, canManage)).join("");

  return `<div class="page-content">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
      <div>
        <span class="badge badge-accent" style="margin-bottom:var(--space-2);display:inline-block;">REPORTS</span>
        <h2 style="margin-top:var(--space-1);">Recent scoreboards</h2>
      </div>
      <span style="font-size:var(--text-sm);color:var(--text-muted);">${reports.length} stored</span>
    </div>
    <div class="grid grid-2">${cards}</div>
  </div>`;
}

function renderReportCard(report: ScoreReport, csrfToken: string, canManage: boolean): string {
  const { rows } = report;
  const kills = rows.reduce((sum, r) => sum + r.kills, 0);
  const deaths = rows.reduce((sum, r) => sum + r.deaths, 0);
  const damage = rows.reduce((sum, r) => sum + r.damageDealt, 0);
  const killDeathPercent = deaths ? Math.round((kills / deaths) * 100) : kills ? 100 : 0;
  const kdTone = killDeathPercent >= 200 ? "badge-active" : killDeathPercent >= 100 ? "badge-warning" : "badge-danger";
  const resultTone = report.result === "win" ? "badge-active" : report.result === "loss" ? "badge-danger" : "badge-inactive";
  const confidence = report.ocrConfidence === undefined ? "n/a" : `${Math.round(report.ocrConfidence)}%`;
  const truncatedEngine = report.ocrEngine.length > 18 ? report.ocrEngine.slice(0, 15) + "…" : report.ocrEngine;

  return `<div class="card">
    <div class="card-header">
      <div>
        <span class="badge ${resultTone}" style="margin-bottom:var(--space-2);display:inline-block;">${esc(report.result)}</span>
        <h3 style="margin-top:var(--space-1);">${esc(report.title || formatDateLabel(report.warDate))}</h3>
      </div>
    </div>

    <div style="display:flex;gap:var(--space-4);font-size:var(--text-sm);margin-bottom:var(--space-4);flex-wrap:wrap;">
      <span style="color:var(--text-muted);">date <strong style="color:var(--text-secondary);">${formatDateLabel(report.warDate)}</strong></span>
      <span style="color:var(--text-muted);">ocr <strong style="color:var(--text-secondary);" title="${esc(report.ocrEngine)}">${esc(truncatedEngine)}</strong></span>
      <span style="color:var(--text-muted);">conf <strong style="color:var(--text-secondary);">${esc(confidence)}</strong></span>
      <span style="color:var(--text-muted);">by <strong style="color:var(--text-secondary);">${esc((report.uploadedBy ?? "Unknown").slice(0, 14))}</strong></span>
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:var(--space-3);margin-bottom:var(--space-4);">
      <div>
        <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;">Players</span>
        <p style="font-weight:600;margin-top:var(--space-1);">${rows.length}</p>
      </div>
      <div>
        <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;">Kills</span>
        <p style="font-weight:600;margin-top:var(--space-1);">${formatStatNumber(kills)}</p>
      </div>
      <div>
        <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;">Deaths</span>
        <p style="font-weight:600;margin-top:var(--space-1);">${formatStatNumber(deaths)}</p>
      </div>
      <div>
        <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;">K/D</span>
        <p style="margin-top:var(--space-1);"><span class="badge ${kdTone}">${killDeathPercent}%</span></p>
      </div>
      <div>
        <span style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;">Damage</span>
        <p style="font-weight:600;margin-top:var(--space-1);">${formatStatNumber(damage)}</p>
      </div>
    </div>

    <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
      <a class="button button-secondary button-sm" href="/stats/reports/${enc(report.id)}/preview?guild=${enc(report.guildId)}" target="_blank" rel="noopener">Preview</a>
      ${canManage ? `
        <a class="button button-secondary button-sm" href="/stats/reports/${enc(report.id)}/edit?guild=${enc(report.guildId)}">Edit</a>
        <button class="button button-ghost button-sm" type="button" data-report-action="rescan" data-report-id="${esc(report.id)}" data-guild-id="${esc(report.guildId)}" data-csrf="${esc(csrfToken)}">Rescan</button>
        <button class="button button-ghost button-sm" type="button" data-report-action="delete" data-report-id="${esc(report.id)}" data-guild-id="${esc(report.guildId)}" data-csrf="${esc(csrfToken)}" style="color:var(--danger,#ef4444);">Delete</button>
      ` : ""}
    </div>
  </div>`;
}

/* ── Score report editor page ───────────────────────────────── */

export function renderScoreReportEditorPage(
  guild: DiscordGuild,
  session: WebSession,
  report: ScoreReport,
  allReports: ScoreReport[] = []
): string {
  const rows = [...report.rows, ...Array.from({ length: 3 }, () => undefined)];
  const sorted = [...allReports].sort((a, b) => b.warDate.localeCompare(a.warDate));

  const headerActions = `<a class="button button-ghost button-sm" href="/stats/history?guild=${enc(guild.id)}">← Score History</a><a class="button button-secondary button-sm" href="/stats?guild=${enc(guild.id)}">Back to Stats</a>`;

  // Sidebar: list of war dates
  const sidebarItems = sorted.map((r) => {
    const isActive = r.id === report.id;
    const tone = r.result === "win" ? "var(--color-emerald)" : r.result === "loss" ? "var(--color-rose)" : "var(--text-muted)";
    return `<a href="/stats/reports/${enc(r.id)}/edit?guild=${enc(guild.id)}"
      style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);text-decoration:none;font-size:var(--text-sm);${isActive ? "background:var(--bg-surface-hover);color:var(--text-primary);font-weight:600;" : "color:var(--text-secondary);"}"
      title="${esc(r.title || formatDateLabel(r.warDate))}">
      <span style="width:6px;height:6px;border-radius:50%;background:${tone};flex-shrink:0;"></span>
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(formatDateLabel(r.warDate))}</span>
    </a>`;
  }).join("");

  const content = [
    renderPageHeader(
      report.title || formatDateLabel(report.warDate),
      "Correct OCR rows and save the scoreboard totals.",
      headerActions
    ),

    `<div class="page-content" style="display:flex;gap:var(--space-4);align-items:flex-start;">
      <div style="flex:0 0 180px;position:sticky;top:var(--space-4);max-height:calc(100vh - 120px);overflow-y:auto;border-right:1px solid var(--border-default);padding-right:var(--space-3);">
        <p style="font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;margin-bottom:var(--space-2);padding-left:var(--space-3);">War dates</p>
        <nav style="display:flex;flex-direction:column;gap:2px;">
          ${sidebarItems}
        </nav>
      </div>
      <div style="flex:1;min-width:0;">
        <form method="post" action="/stats/reports/${enc(report.id)}/edit" enctype="multipart/form-data">
        <input type="hidden" name="csrfToken" value="${esc(session.csrfToken)}">
        <input type="hidden" name="guildId" value="${esc(guild.id)}">

        <div class="card" style="margin-bottom:var(--space-6);">
          <div class="card-header">
            <div>
              <span class="badge badge-accent" style="margin-bottom:var(--space-2);display:inline-block;">EDIT SCOREBOARD</span>
              <h2 style="margin-top:var(--space-1);">Metadata</h2>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:var(--space-4);max-width:720px;">
            <div class="form-group">
              <label class="label" for="edit-war-date">War date</label>
              <input class="input" type="date" id="edit-war-date" name="warDate" value="${esc(report.warDate)}" required>
            </div>
            <div class="form-group">
              <label class="label" for="edit-result">Result</label>
              <select class="select" id="edit-result" name="result">${renderScoreResultOptions(report.result)}</select>
            </div>
            <div class="form-group">
              <label class="label" for="edit-title">Title</label>
              <input class="input" type="text" id="edit-title" name="title" maxlength="120" value="${esc(report.title ?? "")}">
            </div>
            <div class="form-group" style="grid-column:1/-1;">
              <label class="label" for="edit-screenshot">Replace screenshot <span style="color:var(--text-muted);">(optional)</span></label>
              <input class="input" type="file" id="edit-screenshot" name="newScreenshot" accept="image/png,image/jpeg,image/webp">
              <p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:var(--space-1);">Upload a new screenshot to replace the existing one.</p>
            </div>
          </div>

        <div class="card" style="margin-bottom:var(--space-6);">
          <div class="card-header">
            <div>
              <span class="badge badge-accent" style="margin-bottom:var(--space-2);display:inline-block;">SCORE ROWS</span>
              <h2 style="margin-top:var(--space-1);">Player scores</h2>
            </div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>K</th>
                  <th>D</th>
                  <th>A</th>
                  <th>Damage</th>
                  <th>Taken</th>
                  <th>Structure</th>
                  <th>CC</th>
                  <th>Healed</th>
                  <th>Allies</th>
                  <th>Revives</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((row, index) => renderScoreEditRow(row, index)).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div style="display:flex;gap:var(--space-3);padding-bottom:var(--space-12);">
          <button type="submit" class="button button-primary">Save edits</button>
          <a class="button button-secondary" href="/stats?guild=${enc(guild.id)}">Cancel</a>
        </div>
      </form>

      ${report.imagePath ? `
      <form method="post" action="/stats/reports/${enc(report.id)}/rescan" style="margin-top:var(--space-2);">
        <input type="hidden" name="csrfToken" value="${esc(session.csrfToken)}">
        <input type="hidden" name="guildId" value="${esc(guild.id)}">
        <button type="submit" class="button button-ghost button-sm" onclick="return confirm('Re-run OCR on the existing screenshot? This will replace all current score rows.')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Re-evaluate with OCR
        </button>
      </form>` : ""}
      </div>
    </div>`,
  ].join("\n");

  return renderApp("Edit Score Report", content, { session });
}

function renderScoreResultOptions(selected: ScoreReportResult): string {
  return (["unknown", "win", "loss"] as ScoreReportResult[])
    .map((result) => `<option value="${result}"${selected === result ? " selected" : ""}>${result[0].toUpperCase()}${result.slice(1)}</option>`)
    .join("");
}

function renderScoreEditRow(row: ScoreRow | undefined, index: number): string {
  const num = index + 1;
  return `<tr>
    <td style="color:var(--text-muted);font-size:var(--text-xs);">${String(num).padStart(2, "0")}</td>
    <td><input class="input" type="text" name="familyName" value="${esc(row?.familyName ?? "")}" placeholder="Family name" maxlength="80" style="width:140px;padding:var(--space-1) var(--space-2);font-size:var(--text-xs);"></td>
    <td>${renderEditNumberInput("kills", row?.kills ?? 0)}</td>
    <td>${renderEditNumberInput("deaths", row?.deaths ?? 0)}</td>
    <td>${renderEditNumberInput("assists", row?.assists ?? 0)}</td>
    <td>${renderEditNumberInput("damageDealt", row?.damageDealt ?? 0)}</td>
    <td>${renderEditNumberInput("damageTaken", row?.damageTaken ?? 0)}</td>
    <td>${renderEditNumberInput("structureDamage", row?.structureDamage ?? 0)}</td>
    <td>${renderEditNumberInput("crowdControls", row?.crowdControls ?? 0)}</td>
    <td>${renderEditNumberInput("hpHealed", row?.hpHealed ?? 0)}</td>
    <td>${renderEditNumberInput("allySupport", row?.allySupport ?? 0)}</td>
    <td>${renderEditNumberInput("resurrections", row?.resurrections ?? 0)}</td>
  </tr>`;
}

function renderEditNumberInput(name: string, value: number | string): string {
  const strVal = typeof value === "number" ? String(value) : (value ?? "");
  return `<input class="input" type="number" name="${esc(name)}" value="${esc(strVal)}" min="0" step="1" placeholder="0" style="width:72px;padding:var(--space-1) var(--space-2);font-size:var(--text-xs);">`;
}

/* ── Client-side scripts ────────────────────────────────────── */

function renderScoreTabsScript(): string {
  return `<script>
(() => {
  function bind() {
    document.querySelectorAll("[data-score-tabs]").forEach(function (root) {
      if (root.dataset.tabsBound === "1") return;
      root.dataset.tabsBound = "1";
      var buttons = root.querySelectorAll("[data-tab-target]");
      var panels = root.querySelectorAll("[data-tab-panel]");
      buttons.forEach(function (btn) {
        btn.addEventListener("click", function () {
          var target = btn.getAttribute("data-tab-target");
          buttons.forEach(function (b) {
            var on = b === btn;
            b.classList.toggle("is-active", on);
          });
          panels.forEach(function (p) {
            var on = p.getAttribute("data-tab-panel") === target;
            p.classList.toggle("is-active", on);
            if (on) { p.removeAttribute("hidden"); } else { p.setAttribute("hidden", ""); }
          });
        });
      });
    });
  }
  bind();
  try { new MutationObserver(bind).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
})();
</script>`;
}
function renderScoreSortScript(): string {
  return `<script>
(function () {
  document.querySelectorAll("[data-score-table]").forEach(function (table) {
    var tbody = table.tBodies[0];
    if (!tbody) return;
    var buttons = Array.from(table.querySelectorAll("[data-score-sort-key]"));
    var activeKey = table.dataset.scoreSort || "wars";
    var direction = activeKey === "player" ? "asc" : "desc";
    var readValue = function (row, key) { return key === "player" ? (row.dataset.player || "") : Number(row.dataset[key] || 0); };
    var rowGroups = function () {
      var groups = [];
      for (var index = 0; index < tbody.rows.length; index += 1) {
        var row = tbody.rows[index];
        var nextRow = tbody.rows[index + 1];
        if (nextRow && nextRow.classList.contains("impact-breakdown")) {
          groups.push([row, nextRow]);
          index += 1;
        } else {
          groups.push([row]);
        }
      }
      return groups;
    };
    var rankColors = {
      1: { bg: 'linear-gradient(135deg,rgba(245,158,11,0.08),rgba(245,158,11,0.02))', border: '#f59e0b', text: '#f59e0b' },
      2: { bg: 'linear-gradient(135deg,rgba(56,189,248,0.06),rgba(56,189,248,0.01))', border: '#38bdf8', text: '#38bdf8' },
      3: { bg: 'linear-gradient(135deg,rgba(244,63,94,0.06),rgba(244,63,94,0.01))', border: '#f43f5e', text: '#f43f5e' },
      4: { bg: 'linear-gradient(135deg,rgba(139,92,246,0.05),rgba(139,92,246,0.01))', border: '#8b5cf6', text: '#8b5cf6' },
      5: { bg: 'linear-gradient(135deg,rgba(16,185,129,0.05),rgba(16,185,129,0.01))', border: '#10b981', text: '#10b981' }
    };
    var crownSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4l3 12h14l3-12-6 4-4-5-4 5z"/><rect x="3" y="18" width="18" height="2" rx="1"/></svg>';
    var rankBadgeHtml = function (rank) {
      var rc = rankColors[rank];
      if (rank === 1) return '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--radius-full);background:linear-gradient(135deg,rgba(245,158,11,0.15),rgba(245,158,11,0.05));color:var(--color-amber);border:1.5px solid rgba(245,158,11,0.3);font-weight:800;font-size:var(--text-xs);">' + crownSvg + '</span>';
      if (rc) return '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--radius-full);background:' + rc.bg + ';color:' + rc.text + ';border:1.5px solid ' + rc.border + '22;font-weight:700;font-size:var(--text-xs);">' + rank + '</span>';
      return '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--radius-full);color:var(--text-muted);font-weight:500;font-size:var(--text-xs);">' + rank + '</span>';
    };
    var crownSvgInner = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4l3 12h14l3-12-6 4-4-5-4 5z"/><rect x="3" y="18" width="18" height="2" rx="1"/></svg>';
    var rerank = function () {
      var rows = Array.from(tbody.querySelectorAll(":scope > tr[data-table='scoreboard'][data-player]"));
      rows.forEach(function (row, i) {
        var rank = i + 1;
        row.setAttribute("data-rank", String(rank));
        var rc = rankColors[rank];
        var cell = row.querySelector("[data-rank-cell]");
        if (cell) cell.innerHTML = rankBadgeHtml(rank);
        row.style.background = rc ? rc.bg : "transparent";
        row.style.borderLeft = rc ? "2.5px solid " + rc.border + "33" : "2.5px solid transparent";
        var nameTd = row.querySelectorAll("td")[1];
        if (nameTd) {
          var spans = nameTd.querySelectorAll("span");
          for (var s = 0; s < spans.length; s++) {
            var fw = spans[s].style.fontWeight || "";
            if (fw === "600" || fw === "700") {
              spans[s].style.color = rc ? rc.text : "var(--text-primary)";
              break;
            }
          }
        }
      });
    };
    var applySort = function (key, nextDirection) {
      var groups = rowGroups();
      groups.sort(function (leftGroup, rightGroup) {
        var left = leftGroup[0];
        var right = rightGroup[0];
        var leftValue = readValue(left, key);
        var rightValue = readValue(right, key);
        var compared = typeof leftValue === "string" ? leftValue.localeCompare(String(rightValue)) : leftValue - Number(rightValue);
        return nextDirection === "asc" ? compared : -compared;
      });
      groups.forEach(function (group) { group.forEach(function (row) { tbody.appendChild(row); }); });
      rerank();
      activeKey = key;
      direction = nextDirection;
      buttons.forEach(function (button) {
        var active = button.dataset.scoreSortKey === activeKey;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-sort", active ? direction : "none");
      });
    };
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        var key = button.dataset.scoreSortKey || "wars";
        var nextDirection = key === activeKey && direction === "desc" ? "asc" : key === "player" ? "asc" : "desc";
        applySort(key, nextDirection);
      });
    });
  });
})();
</script>`;
}

/* ── Chart.js initialization script ─────────────────────────── */

function renderChartsScript(players: PlayerScoreAggregate[], reports: ScoreReport[], impactScores: PlayerImpactScore[]): string {
  const wins = reports.filter(r => r.result === 'win').length;
  const losses = reports.filter(r => r.result === 'loss').length;
  const unknowns = reports.filter(r => r.result === 'unknown').length;

  const top10 = [...players].sort((a, b) => b.kills - a.kills).slice(0, 10);
  const top5Impact = impactScores.slice(0, 5);

  return `<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script>
  document.addEventListener('DOMContentLoaded', function() {
    if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }
    // Performance bar chart
    var perfCtx = document.getElementById('performanceChart');
    if (perfCtx) {
      new Chart(perfCtx, {
        type: 'bar',
        data: {
          labels: ${JSON.stringify(top10.map(p => p.familyName))},
          datasets: [
            { label: 'Kills', data: ${JSON.stringify(top10.map(p => p.kills))}, backgroundColor: 'rgba(99, 102, 241, 0.85)', borderColor: '#6366f1', borderWidth: 0, borderRadius: 4 },
            { label: 'Deaths', data: ${JSON.stringify(top10.map(p => p.deaths))}, backgroundColor: 'rgba(244, 63, 94, 0.85)', borderColor: '#f43f5e', borderWidth: 0, borderRadius: 4 },
            { label: 'Assists', data: ${JSON.stringify(top10.map(p => p.assists))}, backgroundColor: 'rgba(16, 185, 129, 0.85)', borderColor: '#10b981', borderWidth: 0, borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#a5a5c8', padding: 12, usePointStyle: true, pointStyleWidth: 8 } } },
          scales: {
            x: { ticks: { color: '#6b6b95', maxRotation: 45, font: { size: 10 } }, grid: { color: 'rgba(37, 37, 80, 0.5)' } },
            y: { ticks: { color: '#6b6b95', font: { size: 10 } }, grid: { color: 'rgba(37, 37, 80, 0.5)' } }
          }
        }
      });
    }

    // Results doughnut chart
    var resultsCtx = document.getElementById('resultsChart');
    if (resultsCtx && (${wins} + ${losses} + ${unknowns}) > 0) {
      new Chart(resultsCtx, {
        type: 'doughnut',
        data: {
          labels: ['Wins', 'Losses', 'Unknown'],
          datasets: [{
            data: [${wins}, ${losses}, ${unknowns}],
            backgroundColor: ['rgba(16, 185, 129, 0.85)', 'rgba(244, 63, 94, 0.85)', 'rgba(107, 107, 149, 0.5)'],
            borderWidth: 0,
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: { legend: { position: 'bottom', labels: { color: '#a5a5c8', padding: 10, usePointStyle: true, pointStyleWidth: 8, font: { size: 10 } } } }
        }
      });
    }

    // Impact horizontal bar chart
    var impactCtx = document.getElementById('impactChart');
    if (impactCtx && ${top5Impact.length} > 0) {
      new Chart(impactCtx, {
        type: 'bar',
        data: {
          labels: ${JSON.stringify(top5Impact.map(i => i.player.familyName))},
          datasets: [{
            label: 'Impact Score',
            data: ${JSON.stringify(top5Impact.map(i => i.score))},
            backgroundColor: [
              'rgba(99, 102, 241, 0.85)',
              'rgba(6, 182, 212, 0.85)',
              'rgba(139, 92, 246, 0.85)',
              'rgba(245, 158, 11, 0.85)',
              'rgba(244, 63, 94, 0.85)'
            ],
            borderRadius: 4
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#6b6b95', font: { size: 10 } }, grid: { color: 'rgba(37, 37, 80, 0.5)' } },
            y: { ticks: { color: '#a5a5c8', font: { size: 10 } }, grid: { display: false } }
          }
        }
      });
    }
  });
  </script>`;
}
/* ── Helpers ────────────────────────────────────────────────── */

function esc(value: string): string {
  return escapeHtml(value);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}
