import { escapeHtml, formatDateLabel, formatStatNumber } from '../utils.js';
import { renderApp } from './layout.js';
import type { WebSession, GuildDashboardSummary } from '../types.js';
import type { ScoreReport } from '../../score-types.js';
import type { DiscordGuild } from '../types.js';

/* ── Score History page ──────────────────────────────────────── */

export function renderScoreHistoryPage(
  guild: DiscordGuild,
  session: WebSession,
  reports: ScoreReport[],
  canManage = false,
  summaries?: GuildDashboardSummary[]
): string {
  const sorted = [...reports].sort((a, b) => b.warDate.localeCompare(a.warDate));

  const headerActions = `<a class="button button-ghost button-sm" href="/stats?guild=${enc(guild.id)}">← Back to Stats</a>`;

  const content = `<div class="dashboard">
    <div class="dashboard-header">
      <div>
        <h1 style="font-size:var(--text-xl);font-weight:700;">Score History</h1>
        <p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:2px;">All uploaded war scoreboards for ${esc(guild.name)}.</p>
      </div>
      <div style="display:flex;align-items:center;gap:var(--space-2);">${headerActions}</div>
    </div>

    ${sorted.length === 0
      ? `<div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:300px;">
          <div style="text-align:center;">
            <p style="font-size:var(--text-lg);color:var(--text-secondary);margin-bottom:var(--space-2);">No scoreboards uploaded yet</p>
            <p style="font-size:var(--text-sm);color:var(--text-muted);">Upload a scoreboard screenshot from the Stats page to start tracking.</p>
          </div>
        </div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:var(--space-4);">
          ${sorted.map(report => renderScoreHistoryCard(report, guild.id, session.csrfToken, canManage)).join("")}
        </div>`
    }
  </div>`;

  return renderApp(`Score History — ${guild.name}`, content, { session, summaries, activeNav: "stats" });
}

/* ── Individual score history card ───────────────────────────── */

function renderScoreHistoryCard(report: ScoreReport, guildId: string, csrfToken: string, canManage: boolean): string {
  const { rows } = report;
  const kills = rows.reduce((sum, r) => sum + r.kills, 0);
  const deaths = rows.reduce((sum, r) => sum + r.deaths, 0);
  const assists = rows.reduce((sum, r) => sum + r.assists, 0);
  const damage = rows.reduce((sum, r) => sum + r.damageDealt, 0);
  const structure = rows.reduce((sum, r) => sum + r.structureDamage, 0);
  const cc = rows.reduce((sum, r) => sum + r.crowdControls, 0);
  const kd = deaths ? (kills / deaths).toFixed(2) : "—";
  const resultTone = report.result === "win" ? "badge-active" : report.result === "loss" ? "badge-danger" : "badge-inactive";
  const confidence = report.ocrConfidence === undefined ? "n/a" : `${Math.round(report.ocrConfidence)}%`;

  const imageUrl = `/stats/reports/${enc(report.id)}/preview?guild=${enc(guildId)}`;
  const editUrl = `/stats/reports/${enc(report.id)}/edit?guild=${enc(guildId)}`;

  return `<div class="card" style="padding:0;">
    <div class="score-history-card">
      <div class="score-history-card-image">
        <img src="${imageUrl}" alt="Scoreboard screenshot" loading="lazy" />
      </div>
      <div class="score-history-card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <span class="badge ${resultTone}" style="margin-bottom:var(--space-1);display:inline-block;">${esc(report.result)}</span>
            <h3 style="margin-top:var(--space-1);font-size:var(--text-lg);">${esc(report.title || formatDateLabel(report.warDate))}</h3>
          </div>
          <div style="display:flex;gap:var(--space-2);">
            <a class="button button-secondary button-sm" href="${editUrl}">Edit</a>
            ${canManage ? `<button class="button button-ghost button-sm" type="button" data-report-action="delete" data-report-id="${esc(report.id)}" data-guild-id="${esc(guildId)}" data-csrf="${esc(csrfToken)}" style="color:var(--danger,#ef4444);">Delete</button>` : ""}
          </div>
        </div>

        <div style="font-size:var(--text-xs);color:var(--text-muted);display:flex;gap:var(--space-3);flex-wrap:wrap;">
          <span>${formatDateLabel(report.warDate)}</span>
          <span>${rows.length} players</span>
          <span>OCR: ${confidence}</span>
        </div>

        <div class="score-history-card-stats">
          <div>
            <span class="score-history-card-stat-label">K / D</span>
            <p class="score-history-card-stat-value">${formatStatNumber(kills)} / ${formatStatNumber(deaths)}</p>
          </div>
          <div>
            <span class="score-history-card-stat-label">Assists</span>
            <p class="score-history-card-stat-value">${formatStatNumber(assists)}</p>
          </div>
          <div>
            <span class="score-history-card-stat-label">Damage</span>
            <p class="score-history-card-stat-value">${formatStatNumber(damage)}</p>
          </div>
          <div>
            <span class="score-history-card-stat-label">Fort + CC</span>
            <p class="score-history-card-stat-value">${formatStatNumber(structure + cc)}</p>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/* ── Helpers ────────────────────────────────────────────────── */
function esc(value: string): string {
  return escapeHtml(value);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}
