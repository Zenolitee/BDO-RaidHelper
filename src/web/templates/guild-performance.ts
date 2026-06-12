import { escapeHtml, formatStatNumber, formatDateLabel } from '../utils.js';
import { renderApp } from './layout.js';
import type { WebSession, DiscordGuild, GuildDashboardSummary } from '../types.js';
import type { ScoreReport } from '../../score-types.js';

/* ── Guild Performance Page ──────────────────────────────────── */

export function renderGuildPerformancePage(
  guild: DiscordGuild,
  session: WebSession,
  reports: ScoreReport[],
  summaries?: GuildDashboardSummary[]
): string {
  const backLink = `<a class="button button-ghost button-sm" href="/dashboard">← Dashboard</a>`;

  if (!reports.length) {
    const content = `<section class="page-content dash-layout athena-data-page guild-performance-page">
      <div class="dash-header" style="text-align:left;">
        ${backLink}
        <p class="landing-kicker" style="margin-top:var(--space-4);">Guild Performance</p>
        <h1>${escapeHtml(guild.name)}</h1>
      </div>
      <div class="empty-state compact-empty">
        <h2>No score data yet</h2>
        <p>Upload a scoreboard screenshot to start tracking guild performance.</p>
      </div>
    </section>`;
    return renderApp(`Guild Performance — ${guild.name}`, content, { session, summaries, activeNav: "dashboard" });
  }

  /* ── Compute aggregates ─────────────────────────────────────── */

  const sortedReports = [...reports].sort((a, b) => b.warDate.localeCompare(a.warDate));
  const allRows = reports.flatMap((r) => r.rows);
  const totalWars = reports.length;
  const wins = reports.filter((r) => r.result === "win").length;
  const winRate = totalWars ? Math.round((wins / totalWars) * 100) : 0;

  const totalKills = allRows.reduce((s, r) => s + r.kills, 0);
  const totalDeaths = allRows.reduce((s, r) => s + r.deaths, 0);
  const avgKD = totalDeaths ? (totalKills / totalDeaths) : totalKills;

  /* Top fragger: player with most total kills */
  const playerKills = new Map<string, number>();
  for (const row of allRows) {
    playerKills.set(row.familyName, (playerKills.get(row.familyName) ?? 0) + row.kills);
  }
  let topFraggerName = "—";
  let topFraggerKills = 0;
  for (const [name, kills] of playerKills) {
    if (kills > topFraggerKills) {
      topFraggerKills = kills;
      topFraggerName = name;
    }
  }

  /* ── Player leaderboard ─────────────────────────────────────── */

  const playerAgg = new Map<string, {
    kills: number;
    deaths: number;
    assists: number;
    damageDealt: number;
    wars: number;
  }>();
  for (const row of allRows) {
    const existing = playerAgg.get(row.familyName);
    if (existing) {
      existing.kills += row.kills;
      existing.deaths += row.deaths;
      existing.assists += row.assists;
      existing.damageDealt += row.damageDealt;
      existing.wars += 1;
    } else {
      playerAgg.set(row.familyName, {
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        damageDealt: row.damageDealt,
        wars: 1,
      });
    }
  }
  const leaderboard = [...playerAgg.entries()]
    .map(([name, data]) => ({
      name,
      ...data,
      kd: data.deaths ? data.kills / data.deaths : data.kills,
      avgDamage: data.wars ? Math.round(data.damageDealt / data.wars) : 0,
    }))
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 20);

  /* ── Recent wars (last 10) ──────────────────────────────────── */

  const recentWars = sortedReports.slice(0, 10).map((report) => {
    const rKills = report.rows.reduce((s, r) => s + r.kills, 0);
    const rDeaths = report.rows.reduce((s, r) => s + r.deaths, 0);
    return { report, kills: rKills, deaths: rDeaths };
  });

  /* ── Stat cards ─────────────────────────────────────────────── */

  const statsGrid = `<div class="guild-stats-grid">
    <article class="stat-card">
      <span>Total Wars</span>
      <strong>${totalWars}</strong>
    </article>
    <article class="stat-card">
      <span>Win Rate</span>
      <strong>${winRate}%</strong>
    </article>
    <article class="stat-card">
      <span>Avg K/D</span>
      <strong>${avgKD.toFixed(2)}</strong>
    </article>
    <article class="stat-card">
      <span>Top Fragger</span>
      <strong>${escapeHtml(topFraggerName)}</strong>
    </article>
  </div>`;

  /* ── Recent wars table ──────────────────────────────────────── */

  const warsTable = `<div class="score-table-wrap">
    <table class="score-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Result</th>
          <th>Title</th>
          <th>Players</th>
          <th>Kills</th>
          <th>Deaths</th>
        </tr>
      </thead>
      <tbody>${recentWars.map(({ report, kills, deaths }) => {
        const resultTone = report.result === "win" ? "win" : report.result === "loss" ? "loss" : "unknown";
        const title = report.title || formatDateLabel(report.warDate);
        return `<tr>
          <td>${escapeHtml(formatDateLabel(report.warDate))}</td>
          <td><span class="report-result-${escapeHtml(resultTone)}">${escapeHtml(report.result)}</span></td>
          <td>${escapeHtml(title)}</td>
          <td>${report.rows.length}</td>
          <td>${formatStatNumber(kills)}</td>
          <td>${formatStatNumber(deaths)}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  </div>`;

  /* ── Player leaderboard table ───────────────────────────────── */

  const leaderboardTable = `<div class="score-table-wrap">
    <table class="score-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Player</th>
          <th>Wars</th>
          <th>Kills</th>
          <th>Deaths</th>
          <th>Assists</th>
          <th>K/D</th>
          <th>Avg Damage</th>
        </tr>
      </thead>
      <tbody>${leaderboard.map((player, idx) => {
        const rankBadge = idx === 0 ? `&#x1F451;` : String(idx + 1);
        return `<tr>
          <td>${rankBadge}</td>
          <td><strong>${escapeHtml(player.name)}</strong></td>
          <td>${player.wars}</td>
          <td>${formatStatNumber(player.kills)}</td>
          <td>${formatStatNumber(player.deaths)}</td>
          <td>${formatStatNumber(player.assists)}</td>
          <td>${player.kd.toFixed(2)}</td>
          <td>${formatStatNumber(player.avgDamage)}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  </div>`;

  /* ── Page assembly ──────────────────────────────────────────── */

  const content = `<section class="page-content dash-layout athena-data-page guild-performance-page">
    <div class="dash-header" style="text-align:left;">
      ${backLink}
      <p class="landing-kicker" style="margin-top:var(--space-4);">Guild Performance</p>
      <h1>${escapeHtml(guild.name)}</h1>
      <p style="color:var(--text-muted);margin-top:var(--space-2);">Score report analytics across ${totalWars} node war${totalWars === 1 ? "" : "s"}</p>
    </div>

    ${statsGrid}

    <div class="guild-performance-tables">
      <section class="guild-performance-panel">
        <p class="eyebrow">Recent Wars</p>
        <h2>Last ${recentWars.length} wars</h2>
        ${warsTable}
      </section>

      <section class="guild-performance-panel">
        <p class="eyebrow">Player Leaderboard</p>
        <h2>Top ${leaderboard.length} players by kills</h2>
        ${leaderboardTable}
      </section>
    </div>
  </section>`;

  return renderApp(`Guild Performance — ${guild.name}`, content, { session, summaries, activeNav: "dashboard" });
}
