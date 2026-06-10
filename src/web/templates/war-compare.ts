import { escapeHtml, formatDateLabel, formatStatNumber } from '../utils.js';
import { renderApp, renderPageHeader, renderStatGrid } from './layout.js';
import type { WebSession, GuildDashboardSummary } from '../types.js';
import type { ScoreReport } from '../../score-types.js';
import type { DiscordGuild } from '../types.js';

/* ── War Comparison Page ────────────────────────────────────── */

export function renderWarComparePage(
  guild: DiscordGuild,
  session: WebSession,
  reports: ScoreReport[],
  warAId?: string,
  warBId?: string,
  summaries?: GuildDashboardSummary[]
): string {
  const sorted = [...reports].sort((a, b) => b.warDate.localeCompare(a.warDate));

  const reportA = warAId ? reports.find((r) => r.id === warAId) : sorted[0];
  const reportB = warBId ? reports.find((r) => r.id === warBId) : sorted[1];

  const headerActions = `<a class="button button-ghost button-sm" href="/stats?guild=${enc(guild.id)}">← Back to Stats</a>`;

  if (!reportA || !reportB) {
    const content = [
      renderPageHeader("War Comparison", "Compare two wars side by side", headerActions),
      `<div class="page-content">
        <div class="empty-state-enhanced">
          <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 8v8M8 12h8"/></svg></div>
          <h3>Need at least 2 wars</h3>
          <p>Upload at least two scoreboard screenshots to compare wars.</p>
        </div>
      </div>`,
    ].join("\n");
    return renderApp("War Comparison", content, { session, summaries, activeNav: "stats" });
  }

  // Build player maps for both wars
  const mapA = new Map(reportA.rows.map((r) => [r.familyName.toLowerCase(), r]));
  const mapB = new Map(reportB.rows.map((r) => [r.familyName.toLowerCase(), r]));

  // All unique player names
  const allPlayers = [...new Set([...mapA.keys(), ...mapB.keys()])].sort();

  // Team totals
  const totalsA = sumReport(reportA);
  const totalsB = sumReport(reportB);

  // Per-player comparison rows
  const playerRows = allPlayers.map((key) => {
    const rowA = mapA.get(key);
    const rowB = mapB.get(key);
    const name = rowA?.familyName ?? rowB?.familyName ?? key;

    const killsA = rowA?.kills ?? 0;
    const killsB = rowB?.kills ?? 0;
    const deathsA = rowA?.deaths ?? 0;
    const deathsB = rowB?.deaths ?? 0;
    const dmgA = rowA?.damageDealt ?? 0;
    const dmgB = rowB?.damageDealt ?? 0;
    const ccA = rowA?.crowdControls ?? 0;
    const ccB = rowB?.crowdControls ?? 0;

    return { name, killsA, killsB, deathsA, deathsB, dmgA, dmgB, ccA, ccB, inA: !!rowA, inB: !!rowB };
  });

  // Sort by kill delta descending
  playerRows.sort((a, b) => (b.killsB - b.killsA) - (a.killsB - a.killsA));

  const warADate = formatDateLabel(reportA.warDate);
  const warBDate = formatDateLabel(reportB.warDate);
  const warAResult = reportA.result;
  const warBResult = reportB.result;

  const delta = (a: number, b: number) => {
    const diff = b - a;
    if (diff > 0) return `<span style="color:var(--success);">+${formatStatNumber(diff)}</span>`;
    if (diff < 0) return `<span style="color:var(--danger);">${formatStatNumber(diff)}</span>`;
    return `<span style="color:var(--text-muted);">0</span>`;
  };

  const playerTableRows = playerRows.map((p) => {
    const killsDelta = p.killsB - p.killsA;
    const rowStyle = !p.inA ? "background:rgba(59,130,246,0.05);" : !p.inB ? "background:rgba(239,68,68,0.05);" : "";
    return `<tr style="${rowStyle}">
      <td style="font-weight:500;">${esc(p.name)}</td>
      <td style="text-align:center;">${p.inA ? p.killsA : "—"}</td>
      <td style="text-align:center;">${p.inB ? p.killsB : "—"}</td>
      <td style="text-align:center;">${delta(p.killsA, p.killsB)}</td>
      <td style="text-align:center;">${p.inA ? p.deathsA : "—"}</td>
      <td style="text-align:center;">${p.inB ? p.deathsB : "—"}</td>
      <td style="text-align:center;">${delta(p.deathsA, p.deathsB)}</td>
      <td style="text-align:center;">${p.inA ? formatStatNumber(p.dmgA) : "—"}</td>
      <td style="text-align:center;">${p.inB ? formatStatNumber(p.dmgB) : "—"}</td>
      <td style="text-align:center;">${delta(p.dmgA, p.dmgB)}</td>
    </tr>`;
  }).join("");

  // War selector
  const warOptions = sorted.map((r) => {
    const label = `${formatDateLabel(r.warDate)} (${r.result})`;
    return `<option value="${enc(r.id)}">${esc(label)}</option>`;
  }).join("");

  const selectorForm = `
<div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;margin-bottom:var(--space-4);">
  <form method="get" action="/stats/compare" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;">
    <input type="hidden" name="guild" value="${enc(guild.id)}">
    <div style="display:flex;align-items:center;gap:var(--space-2);">
      <label style="font-size:var(--text-sm);color:var(--text-muted);">War A:</label>
      <select name="warA" class="select" style="width:200px;">${warOptions.replace(`value="${enc(reportA.id)}"`, `value="${enc(reportA.id)}" selected`)}</select>
    </div>
    <span style="color:var(--text-muted);font-size:var(--text-sm);">vs</span>
    <div style="display:flex;align-items:center;gap:var(--space-2);">
      <label style="font-size:var(--text-sm);color:var(--text-muted);">War B:</label>
      <select name="warB" class="select" style="width:200px;">${warOptions.replace(`value="${enc(reportB.id)}"`, `value="${enc(reportB.id)}" selected`)}</select>
    </div>
    <button type="submit" class="button button-primary button-sm">Compare</button>
  </form>
</div>`;

  const content = `<div class="dashboard">
    ${renderPageHeader("War Comparison", "Compare two wars side by side", headerActions)}

    ${selectorForm}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);margin-bottom:var(--space-4);">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3);">
          <div>
            <span class="badge ${warAResult === "win" ? "badge-active" : warAResult === "loss" ? "badge-danger" : "badge-inactive"}" style="margin-bottom:var(--space-1);display:inline-block;">${esc(warAResult)}</span>
            <h3 style="margin-top:var(--space-1);">${warADate}</h3>
          </div>
          <span style="font-size:var(--text-xs);color:var(--text-muted);">War A</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3);font-size:var(--text-sm);">
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Players</span><p style="font-weight:600;">${reportA.rows.length}</p></div>
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Kills</span><p style="font-weight:600;">${formatStatNumber(totalsA.kills)}</p></div>
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">K/D</span><p style="font-weight:600;">${totalsA.kills && totalsA.deaths ? (totalsA.kills / totalsA.deaths).toFixed(2) : "—"}</p></div>
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Damage</span><p style="font-weight:600;">${formatStatNumber(totalsA.damage)}</p></div>
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">CC</span><p style="font-weight:600;">${formatStatNumber(totalsA.cc)}</p></div>
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Fort</span><p style="font-weight:600;">${formatStatNumber(totalsA.structure)}</p></div>
        </div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3);">
          <div>
            <span class="badge ${warBResult === "win" ? "badge-active" : warBResult === "loss" ? "badge-danger" : "badge-inactive"}" style="margin-bottom:var(--space-1);display:inline-block;">${esc(warBResult)}</span>
            <h3 style="margin-top:var(--space-1);">${warBDate}</h3>
          </div>
          <span style="font-size:var(--text-xs);color:var(--text-muted);">War B</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3);font-size:var(--text-sm);">
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Players</span><p style="font-weight:600;">${reportB.rows.length}</p></div>
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Kills</span><p style="font-weight:600;">${formatStatNumber(totalsB.kills)}</p></div>
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">K/D</span><p style="font-weight:600;">${totalsB.kills && totalsB.deaths ? (totalsB.kills / totalsB.deaths).toFixed(2) : "—"}</p></div>
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Damage</span><p style="font-weight:600;">${formatStatNumber(totalsB.damage)}</p></div>
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">CC</span><p style="font-weight:600;">${formatStatNumber(totalsB.cc)}</p></div>
          <div><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;">Fort</span><p style="font-weight:600;">${formatStatNumber(totalsB.structure)}</p></div>
        </div>
      </div>
    </div>

    <div class="dashboard-table-wrap">
      <div class="dashboard-table-header">
        <span class="chart-card-title">Player Comparison</span>
        <span class="chart-card-subtitle">${allPlayers.length} players · deltas = War B − War A</span>
      </div>
      <div class="dashboard-table-scroll table-responsive">
        <table class="table">
          <thead><tr>
            <th>Player</th>
            <th colspan="2" style="text-align:center;border-left:1px solid var(--border-subtle);">Kills</th>
            <th style="text-align:center;border-left:1px solid var(--border-subtle);">Δ</th>
            <th colspan="2" style="text-align:center;border-left:1px solid var(--border-subtle);">Deaths</th>
            <th style="text-align:center;border-left:1px solid var(--border-subtle);">Δ</th>
            <th colspan="2" style="text-align:center;border-left:1px solid var(--border-subtle);">Damage</th>
            <th style="text-align:center;border-left:1px solid var(--border-subtle);">Δ</th>
          </tr>
          <tr style="font-size:var(--text-xs);color:var(--text-muted);">
            <th></th>
            <th style="text-align:center;">A</th>
            <th style="text-align:center;">B</th>
            <th style="text-align:center;border-left:1px solid var(--border-subtle);"></th>
            <th style="text-align:center;">A</th>
            <th style="text-align:center;">B</th>
            <th style="text-align:center;border-left:1px solid var(--border-subtle);"></th>
            <th style="text-align:center;">A</th>
            <th style="text-align:center;">B</th>
            <th style="text-align:center;border-left:1px solid var(--border-subtle);"></th>
          </tr></thead>
          <tbody>${playerTableRows}</tbody>
        </table>
      </div>
    </div>
  </div>`;

  return renderApp("War Comparison", content, { session, summaries, activeNav: "stats" });
}

/* ── Helpers ────────────────────────────────────────────────── */

function sumReport(report: ScoreReport) {
  const kills = report.rows.reduce((s, r) => s + r.kills, 0);
  const deaths = report.rows.reduce((s, r) => s + r.deaths, 0);
  const damage = report.rows.reduce((s, r) => s + r.damageDealt, 0);
  const cc = report.rows.reduce((s, r) => s + r.crowdControls, 0);
  const structure = report.rows.reduce((s, r) => s + r.structureDamage, 0);
  return { kills, deaths, damage, cc, structure };
}

function esc(value: string): string {
  return escapeHtml(value);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}
