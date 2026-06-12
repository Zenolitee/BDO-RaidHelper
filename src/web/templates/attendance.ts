import { escapeHtml } from '../utils.js';
import { renderApp } from './layout.js';
import type { WebSession, DiscordGuild, GuildDashboardSummary } from '../types.js';
import type { WarEvent } from '../../types.js';
import type { ScoreReport } from '../../score-types.js';

/* ── Helpers ──────────────────────────────────────────────────── */

function shortDateLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d);
  const day = d.getUTCDate();
  return `${month} ${day}`;
}

function weekdayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d);
}

/** Normalizes a player name for deduplication — lowercases and collapses whitespace. */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/* ── Main page ─────────────────────────────────────────────────── */

export function renderAttendancePage(
  guild: DiscordGuild,
  session: WebSession,
  events: WarEvent[],
  reports: ScoreReport[],
  summaries?: GuildDashboardSummary[]
): string {
  /* 1. Collect all war dates. */
  const warDatesSet = new Set<string>();
  for (const ev of events) if (ev.date) warDatesSet.add(ev.date);
  for (const r of reports) if (r.warDate) warDatesSet.add(r.warDate);
  const sortedDates = [...warDatesSet].sort((a, b) => b.localeCompare(a)).slice(0, 20);

  /* 2. Build signup + score maps (normalized names). */
  const signupMap = new Map<string, Map<string, string>>(); // date → normalizedName → group
  for (const ev of events) {
    if (!ev.date || ev.guildId !== guild.id) continue;
    const playerMap = new Map<string, string>();
    for (const s of ev.signups) playerMap.set(normalizeName(s.displayName), s.group);
    signupMap.set(ev.date, playerMap);
  }
  const scoreMap = new Map<string, Set<string>>(); // date → normalizedName set
  for (const r of reports) {
    if (r.guildId !== guild.id || !r.warDate) continue;
    const names = new Set<string>();
    for (const row of r.rows) names.add(normalizeName(row.familyName));
    scoreMap.set(r.warDate, names);
  }

  /* 3. Canonical player list comes exclusively from score reports. */
  const scorePlayers = new Set<string>();
  for (const [, names] of scoreMap) for (const n of names) scorePlayers.add(n);

  const playerNames = [...scorePlayers].sort((a, b) => a.localeCompare(b));

  /* 4. Compute per-player attendance stats. */
  const playerStats = new Map<string, { attended: number; total: number }>();
  for (const name of playerNames) playerStats.set(name, { attended: 0, total: sortedDates.length });
  for (const date of sortedDates) {
    const signups = signupMap.get(date);
    const scores = scoreMap.get(date);
    for (const name of playerNames) {
      const inSignups = signups?.has(name) ?? false;
      const inScores = scores?.has(name) ?? false;
      if (inSignups || inScores) {
        const stat = playerStats.get(name)!;
        stat.attended++;
      }
    }
  }

  const finalEntries = playerNames
    .map((name): [string, { attended: number; total: number }] => [name, playerStats.get(name)!])
    .sort((a, b) => (b[1].attended / (b[1].total || 1)) - (a[1].attended / (a[1].total || 1)) || a[0].localeCompare(b[0]));

  const finalNames = finalEntries.map(([name]) => name);

  /* 5. Overall stats. */
  const totalPossible = sortedDates.length * finalNames.length;
  const totalAttended = finalEntries.reduce((s, [, p]) => s + p.attended, 0);
  const overallRate = totalPossible > 0 ? Math.round((totalAttended / totalPossible) * 100) : 0;

  /* 6. Build grid (dates as rows, players as columns). */
  let headerRow = '<tr><th class="att-date-col">Date</th>';
  for (const name of finalNames) {
    headerRow += `<th class="att-player-col" title="${escapeHtml(name)}"><span class="att-player-label">${escapeHtml(name.charAt(0).toUpperCase() + name.slice(1))}</span></th>`;
  }
  headerRow += '<th class="att-row-count">Present</th></tr>';

  let bodyRows = '';
  for (const date of sortedDates) {
    const signups = signupMap.get(date);
    const scores = scoreMap.get(date);
    let row = `<tr><td class="att-date-cell"><span class="att-date-day">${weekdayLabel(date)}</span> ${shortDateLabel(date)}</td>`;
    let presentCount = 0;
    for (const name of finalNames) {
      const group = signups?.get(name);
      const inScores = scores?.has(name) ?? false;
      const attended = !!group || inScores;
      if (attended) {
        presentCount++;
        row += `<td class="att-cell attended" title="${escapeHtml(name.charAt(0).toUpperCase() + name.slice(1))} — attended"></td>`;
      } else {
        row += `<td class="att-cell" title="${escapeHtml(name.charAt(0).toUpperCase() + name.slice(1))} — absent"></td>`;
      }
    }
    row += `<td class="att-row-count">${presentCount}/${finalNames.length}</td></tr>`;
    bodyRows += row;
  }

  const hasData = sortedDates.length > 0 && finalNames.length > 0;

  /* 7. Player stats rows. */
  let statsRows = '';
  for (const [name, stat] of finalEntries) {
    const pct = Math.round((stat.attended / (stat.total || 1)) * 100);
    statsRows += `<tr>
      <td class="att-stat-name">${escapeHtml(name.charAt(0).toUpperCase() + name.slice(1))}</td>
      <td class="att-stat-bar"><div class="att-bar" style="width:${pct}%"></div></td>
      <td class="att-stat-pct">${pct}%</td>
      <td class="att-stat-count">${stat.attended}/${stat.total}</td>
    </tr>`;
  }

  /* 8. Assemble page with tabs. */
  const content = `
    <style>
      .att-tabs { display:flex; gap:0; margin-top:var(--space-5); border-bottom:2px solid var(--border-subtle); }
      .att-tab { padding:var(--space-2) var(--space-4); font-size:var(--text-sm); font-weight:600; color:var(--text-muted); background:none; border:none; border-bottom:2px solid transparent; margin-bottom:-2px; cursor:pointer; transition:color 0.15s, border-color 0.15s; letter-spacing:0.03em; }
      .att-tab:hover { color:var(--text-secondary); }
      .att-tab.active { color:var(--text-primary); border-bottom-color:var(--accent); }
      .att-tab-panel { display:none; }
      .att-tab-panel.active { display:block; }

      .att-grid-wrap { overflow-x:auto; margin-top:var(--space-4); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface); }
      .att-grid { width:100%; border-collapse:collapse; font-size:0.85rem; }
      .att-grid th, .att-grid td { padding:8px 10px; border-bottom:1px solid var(--border-subtle); text-align:center; white-space:nowrap; }
      .att-grid thead th { position:sticky; top:0; z-index:2; background:var(--surface); font-weight:600; font-size:0.78rem; color:var(--text-muted); border-bottom:2px solid var(--border-subtle); }
      .att-grid tbody tr:hover { background:rgba(255,255,255,0.03); }
      .att-date-col { text-align:left !important; min-width:110px; font-weight:600; color:var(--text-secondary); }
      .att-player-col { min-width:52px; }
      .att-player-label { font-size:0.75rem; line-height:1.2; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .att-date-cell { text-align:left !important; font-weight:500; white-space:nowrap; }
      .att-date-day { color:var(--text-muted); font-weight:400; font-size:0.75rem; margin-right:4px; }
      .att-cell { width:40px; min-width:40px; border-radius:3px; }
      .att-cell.attended { background:rgba(34,197,94,0.22); }

      .att-stats { width:100%; border-collapse:collapse; font-size:0.82rem; }
      .att-stats th { text-align:left; font-size:0.75rem; font-weight:600; color:var(--text-muted); padding:8px 12px; border-bottom:2px solid var(--border-subtle); }
      .att-stats td { padding:7px 12px; border-bottom:1px solid var(--border-subtle); }
      .att-stats tr:hover { background:rgba(255,255,255,0.02); }
      .att-stat-name { font-weight:500; }
      .att-stat-bar { width:120px; }
      .att-bar { height:6px; border-radius:3px; background:rgba(34,197,94,0.25); }
      .att-stat-pct { font-weight:600; text-align:right; min-width:48px; }
      .att-stat-count { color:var(--text-muted); text-align:right; min-width:50px; font-size:0.78rem; }
    </style>

    <section class="page-content dash-layout athena-data-page athena-attendance-page" style="max-width:100%;padding:0 var(--space-5);">
      <div class="dash-header" style="text-align:left;">
        <a class="button button-ghost button-sm" href="/dashboard">← Dashboard</a>
        <p class="landing-kicker" style="margin-top:var(--space-4);">Attendance</p>
        <h1>${escapeHtml(guild.name)}</h1>
        <p style="color:var(--text-muted);margin-top:var(--space-1);font-size:var(--text-sm);">${sortedDates.length} wars · ${finalNames.length} players tracked · Overall rate: <strong>${overallRate}%</strong></p>
      </div>

      <div class="att-tabs" role="tablist">
        <button class="att-tab active" role="tab" onclick="switchAttTab(0)" aria-selected="true">ATTENDANCE GRID</button>
        <button class="att-tab" role="tab" onclick="switchAttTab(1)" aria-selected="false">PLAYER ATTENDANCE</button>
      </div>

      <!-- Tab 0: Grid -->
      <div class="att-tab-panel active" role="tabpanel">
        ${hasData ? `
        <div class="att-grid-wrap">
          <table class="att-grid">
            <thead><tr>${headerRow}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
        ` : `
        <div class="empty-state compact-empty">
          <h2>No attendance data</h2>
          <p>No wars found with signups or score reports yet.</p>
        </div>
        `}
      </div>

      <!-- Tab 1: Player stats -->
      <div class="att-tab-panel" role="tabpanel">
        ${finalEntries.length > 0 ? `
        <div style="margin-top:var(--space-4);">
          <table class="att-stats">
            <thead><tr><th>Player</th><th style="width:140px;">Distribution</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Wars</th></tr></thead>
            <tbody>${statsRows}</tbody>
          </table>
        </div>
        ` : `
        <div class="empty-state compact-empty">
          <h2>No attendance data</h2>
          <p>No players found with signups or score reports yet.</p>
        </div>
        `}
      </div>
    </section>

    <script>
      (function() {
        var tabs = document.querySelectorAll('.att-tab');
        var panels = document.querySelectorAll('.att-tab-panel');
        window.switchAttTab = function(idx) {
          tabs.forEach(function(t, i) { t.classList.toggle('active', i === idx); t.setAttribute('aria-selected', i === idx ? 'true' : 'false'); });
          panels.forEach(function(p, i) { p.classList.toggle('active', i === idx); });
        };
      })();
    </script>
  `;

  return renderApp(`Attendance — ${guild.name}`, content, { session, summaries, activeNav: 'dashboard' });
}
