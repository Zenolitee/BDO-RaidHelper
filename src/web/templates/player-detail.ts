import { escapeHtml, formatDateLabel, formatStatNumber } from '../utils.js';
import { renderApp, renderPageHeader, renderStatGrid } from './layout.js';
import type { WebSession, GuildDashboardSummary, PlayerScoreAggregate } from '../types.js';
import type { ScoreReport, ScoreRow } from '../../score-types.js';
import type { DiscordGuild } from '../types.js';

/* ── Player Detail Page ─────────────────────────────────────── */

export function renderPlayerDetailPage(
  guild: DiscordGuild,
  session: WebSession,
  playerName: string,
  reports: ScoreReport[],
  summaries?: GuildDashboardSummary[]
): string {
  // Find all rows for this player (case-insensitive)
  const playerKey = playerName.toLowerCase();
  const playerRows: Array<{ report: ScoreReport; row: ScoreRow }> = [];

  for (const report of reports) {
    const row = report.rows.find((r) => r.familyName.toLowerCase() === playerKey);
    if (row) {
      playerRows.push({ report, row });
    }
  }

  if (!playerRows.length) {
    const content = [
      renderPageHeader(`Player — ${playerName}`, "No score data found for this player."),
      `<div class="page-content">
        <div class="empty-state-enhanced">
          <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg></div>
          <h3>No data for "${esc(playerName)}"</h3>
          <p>This player hasn't participated in any uploaded scoreboards yet.</p>
        </div>
      </div>`,
    ].join("\n");
    return renderApp(`Player — ${playerName}`, content, { session, summaries, activeNav: "stats" });
  }

  // Aggregate stats
  const totalKills = playerRows.reduce((sum, pr) => sum + pr.row.kills, 0);
  const totalDeaths = playerRows.reduce((sum, pr) => sum + pr.row.deaths, 0);
  const totalAssists = playerRows.reduce((sum, pr) => sum + pr.row.assists, 0);
  const totalDamage = playerRows.reduce((sum, pr) => sum + pr.row.damageDealt, 0);
  const totalCC = playerRows.reduce((sum, pr) => sum + pr.row.crowdControls, 0);
  const totalStructure = playerRows.reduce((sum, pr) => sum + pr.row.structureDamage, 0);
  const totalHealed = playerRows.reduce((sum, pr) => sum + pr.row.hpHealed + pr.row.allySupport, 0);
  const kd = totalDeaths ? (totalKills / totalDeaths).toFixed(2) : formatStatNumber(totalKills);
  const avgKills = (totalKills / playerRows.length).toFixed(1);
  const avgDeaths = (totalDeaths / playerRows.length).toFixed(1);

  // Sort by date ascending for chart
  const sorted = [...playerRows].sort((a, b) => a.report.warDate.localeCompare(b.report.warDate));

  // Chart data
  const chartLabels = sorted.map((pr) => formatDateLabel(pr.report.warDate));
  const chartKills = sorted.map((pr) => pr.row.kills);
  const chartDeaths = sorted.map((pr) => pr.row.deaths);
  const chartDamage = sorted.map((pr) => Math.round(pr.row.damageDealt / 1_000_000 * 10) / 10);

  // Per-war history table rows
  const historyRows = [...playerRows]
    .sort((a, b) => b.report.warDate.localeCompare(a.report.warDate))
    .map((pr) => {
      const { row, report } = pr;
      const rowKd = row.deaths ? (row.kills / row.deaths).toFixed(1) : formatStatNumber(row.kills);
      const resultTone = report.result === "win" ? "badge-active" : report.result === "loss" ? "badge-danger" : "badge-inactive";
      return `<tr>
        <td style="white-space:nowrap;">${formatDateLabel(report.warDate)}</td>
        <td><span class="badge ${resultTone}" style="font-size:10px;">${esc(report.result)}</span></td>
        <td style="font-weight:500;">${row.kills}</td>
        <td style="color:var(--text-secondary);">${row.deaths}</td>
        <td><span class="badge ${Number(rowKd) >= 2 ? "badge-active" : Number(rowKd) >= 1 ? "badge-warning" : "badge-danger"}" style="font-size:10px;">${rowKd}</span></td>
        <td style="color:var(--text-secondary);">${row.assists}</td>
        <td style="font-weight:500;">${formatStatNumber(row.damageDealt)}</td>
        <td>${row.crowdControls}</td>
        <td style="color:var(--text-secondary);">${formatStatNumber(row.structureDamage)}</td>
      </tr>`;
    }).join("");

  const headerActions = `<a class="button button-ghost button-sm" href="/stats?guild=${enc(guild.id)}">← Back to Stats</a>`;

  const chartScript = `
<script>
(function() {
  var ctx = document.getElementById('player-trend-chart');
  if (!ctx) return;
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: ${JSON.stringify(chartLabels)},
      datasets: [
        {
          label: 'Kills',
          data: ${JSON.stringify(chartKills)},
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6
        },
        {
          label: 'Deaths',
          data: ${JSON.stringify(chartDeaths)},
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: '#a1a1aa', font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' } }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#71717a', font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#71717a', font: { size: 10 } }, beginAtZero: true }
      }
    }
  });
})();
</script>`;

  const content = `<div class="dashboard">
    ${renderPageHeader(`${esc(playerName)}`, `${playerRows.length} wars played`, headerActions)}

    ${renderStatGrid([
      { label: "Wars", value: String(playerRows.length), color: "var(--color-indigo)" },
      { label: "Kills", value: formatStatNumber(totalKills), color: "var(--color-cyan)" },
      { label: "Deaths", value: formatStatNumber(totalDeaths), color: "var(--color-rose)" },
      { label: "K/D", value: kd, color: "var(--color-amber)" },
    ])}

    <div class="dashboard-split">
      <div class="dashboard-split-main">
        <div class="dashboard-table-wrap">
          <div class="dashboard-table-header">
            <span class="chart-card-title">War History</span>
            <span class="chart-card-subtitle">${playerRows.length} wars · ${avgKills} avg kills · ${avgDeaths} avg deaths</span>
          </div>
          <div class="dashboard-table-scroll table-responsive">
            <table class="table">
              <thead><tr>
                <th>Date</th>
                <th>Result</th>
                <th>K</th>
                <th>D</th>
                <th>K/D</th>
                <th>A</th>
                <th>DMG</th>
                <th>CC</th>
                <th>Fort</th>
              </tr></thead>
              <tbody>${historyRows}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="dashboard-split-side">
        <div class="chart-card" style="flex:none;">
          <div class="chart-card-header">
            <span class="chart-card-title">Performance Trend</span>
          </div>
          <div class="chart-container" style="height:200px;">
            <canvas id="player-trend-chart"></canvas>
          </div>
        </div>

        <div class="card" style="flex:none;">
          <div class="chart-card-header">
            <span class="chart-card-title">Lifetime Stats</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);font-size:var(--text-sm);">
            <div>
              <span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Total Damage</span>
              <p style="font-weight:600;margin-top:2px;">${formatStatNumber(totalDamage)}</p>
            </div>
            <div>
              <span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Total CC</span>
              <p style="font-weight:600;margin-top:2px;">${formatStatNumber(totalCC)}</p>
            </div>
            <div>
              <span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Fort Damage</span>
              <p style="font-weight:600;margin-top:2px;">${formatStatNumber(totalStructure)}</p>
            </div>
            <div>
              <span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Healed + Support</span>
              <p style="font-weight:600;margin-top:2px;">${formatStatNumber(totalHealed)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  ${chartScript}`;

  return renderApp(`${playerName} — Stats`, content, { session, summaries, activeNav: "stats" });
}

/* ── Helpers ────────────────────────────────────────────────── */
function esc(value: string): string {
  return escapeHtml(value);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}
