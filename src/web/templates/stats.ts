import { escapeHtml, formatDateLabel, formatStatNumber, orderedGroups, renderGroupIcon } from '../utils.js';
import { renderPage, renderWindow } from './helpers.js';
import { renderGuildAvatar } from './nav.js';
import { aggregateScoreRows, calculateImpactScores, sortScoreAggregates } from '../score.js';
import { formatClockTime } from '../../time-format.js';
import type { WebSession, GuildDashboardSummary, DiscordGuild, PlayerScoreAggregate, PlayerImpactScore, ScoreSortKey } from '../types.js';
import type { ScoreReport, ScoreRow, ScoreReportResult } from '../../score-types.js';
import type { WarEvent } from '../../types.js';
import { NODE_WAR_PRESETS } from '../../nodewar-presets.js';
import { isRosterGroup } from '../../store.js';

export function renderStatsDashboard(
  guild: DiscordGuild,
  session: WebSession,
  reports: ScoreReport[],
  notice?: "uploaded" | "rescanned" | "saved" | "deleted" | "renamed",
  sortKey: ScoreSortKey = "wars",
  canManage = false,
  summaries?: GuildDashboardSummary[]
): string {
  const rows = reports.flatMap((report) => report.rows);
  const players = sortScoreAggregates(aggregateScoreRows(rows), sortKey);
  const latest = reports[0];
  const topDamage = Math.max(1, ...players.map((player) => player.damageDealt));
  const totalKills = rows.reduce((sum, row) => sum + row.kills, 0);
  const totalDeaths = rows.reduce((sum, row) => sum + row.deaths, 0);

  return `<main class="shell stats-shell">
    <section class="dashboard-head">
      <div class="guild-heading">${renderGuildAvatar(guild)}<div><p class="eyebrow">War stats</p><h1>${escapeHtml(guild.name)}</h1><p>Uploaded scoreboards, player participation, and performance trends.</p></div></div>
      <a class="button button-secondary" href="/?guild=${encodeURIComponent(guild.id)}">Raids</a>
    </section>
    ${notice ? `<section class="notice">${renderStatsNotice(notice)}</section>` : ""}
    ${renderStatsTerminalSummary([
      { label: "Scoreboards", value: String(reports.length) },
      { label: "Players tracked", value: String(players.length) },
      { label: "Total kills", value: formatStatNumber(totalKills) },
      { label: "Team K/D", value: totalDeaths ? (totalKills / totalDeaths).toFixed(2) : formatStatNumber(totalKills) },
      { label: "Latest war", value: latest ? formatDateLabel(latest.warDate) : "No uploads" }
    ])}
    ${canManage ? `<section class="stats-workspace">
      <form class="stats-upload-panel" method="post" action="/stats/upload" enctype="multipart/form-data">
        <input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}">
        <input type="hidden" name="guildId" value="${escapeHtml(guild.id)}">
        <header><p class="eyebrow">Screenshot OCR</p><h2>Upload Scoreboard</h2></header>
        <label>War date<input type="date" name="warDate" value="${new Date().toISOString().slice(0, 10)}" required></label>
        <label>Result<select name="result"><option value="unknown">Unknown</option><option value="win">Win</option><option value="loss">Loss</option></select></label>
        <label>Title<input name="title" maxlength="120" placeholder="Optional war label"></label>
        <label>Screenshot<input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp" required></label>
        <button type="submit">Upload and scan</button>
      </form>
    </section>` : ""}
    <section class="stats-analysis-panel">
      <header><p class="eyebrow">Player analysis</p><h2>Participation and performance</h2></header>
      ${players.length ? `${renderScoreGraphics(players, reports)}${renderScoreTables(players, topDamage, sortKey, guild.id, session.csrfToken, canManage)}` : `<div class="empty-state compact-empty"><h2>No score data yet</h2><p>${canManage ? "Upload a scoreboard screenshot to start tracking player performance." : "No score data has been uploaded for this server yet."}</p></div>`}
    </section>
    <section class="section-title stats-title"><div><p class="eyebrow">Reports</p><h2>Recent scoreboards</h2></div><span>${reports.length} stored</span></section>
    ${renderReportsTerminal(reports, session.csrfToken, canManage)}
  </main>`;
}

export function renderStatsNotice(notice: "uploaded" | "rescanned" | "saved" | "deleted" | "renamed"): string {
  if (notice === "uploaded") return "Scoreboard uploaded and parsed. Review the extracted rows before using them for final calls.";
  if (notice === "rescanned") return "Scoreboard rescanned from the stored image. Review the extracted rows before using them for final calls.";
  if (notice === "saved") return "Scoreboard edits saved.";
  if (notice === "renamed") return "Player name updated across matching score rows.";
  return "Scoreboard deleted.";
}

export function renderStatsTerminalSummary(items: Array<{ label: string; value: string }>): string {
  return `<section class="stats-row">
    <header><h3>Stats overview</h3></header>
    <div class="report-terminal-output stats-terminal-output">
      <div class="terminal-line"><span class="t-success">nwhelper</span><span class="t-muted">@</span><span class="t-success">stats</span><span class="t-muted">:</span><span class="t-path">~</span><span class="t-muted">$</span> cat summary</div>
      ${items
        .map(
          (item) =>
            `<div class="terminal-line stats-terminal-line"><span class="t-key">${escapeHtml(item.label.toLowerCase())}</span><span class="t-muted">=</span><span class="t-val">${escapeHtml(item.value)}</span></div>`
        )
        .join("")}
      <div class="terminal-line"><span class="t-muted">status:</span> <span class="t-success">ready</span><span class="t-cursor">▮</span></div>
    </div>
  </section>`;
}

export function renderScoreGraphics(players: PlayerScoreAggregate[], reports: ScoreReport[]): string {
  const totalDamage = players.reduce((sum, player) => sum + player.damageDealt, 0);
  const totalTaken = players.reduce((sum, player) => sum + player.damageTaken, 0);
  const totalSupport = players.reduce((sum, player) => sum + player.allySupport, 0);
  const totalCc = players.reduce((sum, player) => sum + player.crowdControls, 0);
  const totalStructure = players.reduce((sum, player) => sum + player.structureDamage, 0);
  const totalKills = players.reduce((sum, player) => sum + player.kills, 0);
  const totalDeaths = players.reduce((sum, player) => sum + player.deaths, 0);
  const impactTotal = Math.max(1, totalDamage + totalSupport + totalTaken);
  const recentReports = reports.slice(0, 6).reverse();

  return `<section class="score-graphics">
    <div class="score-mix-card">
      <header><p class="eyebrow">Team profile</p><h3>War output mix</h3></header>
      <div class="score-mix-body">
        <div class="score-ring" style="--damage:${Math.round((totalDamage / impactTotal) * 100)}%; --support:${Math.round((totalSupport / impactTotal) * 100)}%;"><span>${totalDeaths ? (totalKills / totalDeaths).toFixed(2) : formatStatNumber(totalKills)}</span><small>Team K/D</small></div>
        <div class="mix-stats" role="list">
          ${renderMixStat("Damage", totalDamage, "damage")}
          ${renderMixStat("+ Ally Support", totalSupport, "support")}
          ${renderMixStat("Taken", totalTaken, "taken")}
          ${renderMixStat("CCs", totalCc, "cc")}
          ${renderMixStat("Fort Damage", totalStructure, "cc")}
        </div>
      </div>
    </div>
    ${renderMetricLeaderboard("Damage leaders", "Pressure", players, (player) => player.damageDealt)}
    ${renderMetricLeaderboard("Attendance leaders", "Wars joined", players, (player) => player.participations)}
    ${renderMetricLeaderboard("Support leaders", "+ Allies healed", players, (player) => player.allySupport)}
    ${renderMetricLeaderboard("Fort Damage leaders", "Structure", players, (player) => player.structureDamage)}
    ${renderMetricLeaderboard("CC leaders", "Crowd control", players, (player) => player.crowdControls)}
    <div class="score-trend-card">
      <header><p class="eyebrow">Kill chart</p><h3>Recent war kills</h3></header>
      ${renderKillChart(recentReports)}
    </div>
  </section>`;
}

export function renderMixStat(label: string, value: number, tone: string): string {
  return `<div class="mix-stat mix-${tone}" role="listitem"><b>${escapeHtml(label)}</b><small>${formatStatNumber(value)}</small></div>`;
}

export function renderRankBadge(rank: number): string {
  if (rank === 1) return `<span class="rank-badge rank-top" aria-label="Rank 1">&#x1F451;</span>`;
  return `<span class="rank-badge" aria-label="Rank ${rank}">${rank}</span>`;
}

export function renderMetricLeaderboard(
  title: string,
  eyebrow: string,
  players: PlayerScoreAggregate[],
  metric: (player: PlayerScoreAggregate) => number
): string {
  const leaders = [...players].sort((left, right) => metric(right) - metric(left)).slice(0, 4);
  return `<div class="score-leader-card">
    <header><p class="eyebrow">${escapeHtml(eyebrow)}</p><h3>${escapeHtml(title)}</h3></header>
    <div class="leader-stats" role="list">${leaders
      .map((player, index) => {
        const value = metric(player);
        return `<div class="leader-stat" role="listitem">${renderRankBadge(index + 1)}<b>${escapeHtml(player.familyName)}</b><small>${formatStatNumber(value)}</small></div>`;
      })
      .join("")}</div>
  </div>`;
}

export function renderKillChart(reports: ScoreReport[]): string {
  if (!reports.length) {
    return `<div class="kill-chart-empty">No recent war data.</div>`;
  }
  const series = reports.map((report) => ({
    label: formatDateLabel(report.warDate).split(",")[0],
    title: report.title || formatDateLabel(report.warDate),
    kills: report.rows.reduce((sum, row) => sum + row.kills, 0),
  }));
  const maxKills = Math.max(1, ...series.map((item) => item.kills));
  const width = 320;
  const height = 150;
  const points = series
    .map((item, index) => {
      const x = series.length === 1 ? width / 2 : Math.round((index / (series.length - 1)) * width);
      const y = Math.round(height - (item.kills / maxKills) * (height - 18) - 9);
      return { ...item, x, y };
    });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `0,${height} ${points.map((point) => `${point.x},${point.y}`).join(" ")} ${width},${height}`;
  return `<div class="kill-chart">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Recent war kill chart">
      <defs>
        <linearGradient id="kill-chart-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(116, 166, 255, 0.42)" />
          <stop offset="100%" stop-color="rgba(116, 166, 255, 0.02)" />
        </linearGradient>
      </defs>
      <path class="kill-chart-area" d="M ${area.replace(/ /g, " L ")} Z"></path>
      <polyline class="kill-chart-line" points="${polyline}"></polyline>
      ${points.map((point) => `<circle class="kill-chart-point" cx="${point.x}" cy="${point.y}" r="4"><title>${escapeHtml(point.title)}: ${formatStatNumber(point.kills)} kills</title></circle>`).join("")}
    </svg>
    <div class="kill-chart-labels">${points
      .map((point) => `<span><b>${formatStatNumber(point.kills)}</b><small>${escapeHtml(point.label)}</small></span>`)
      .join("")}</div>
  </div>`;
}

export function renderScoreTables(players: PlayerScoreAggregate[], topDamage: number, sortKey: ScoreSortKey, guildId: string, csrfToken: string, canManage: boolean): string {
  const impactScores = calculateImpactScores(players);
  return `<section class="score-table-tabs" data-score-tabs>
    <div class="score-tab-bar" role="tablist">
      <button type="button" class="score-tab is-active" data-tab-target="scoreboard-totals" role="tab" aria-selected="true">▸ Scoreboard totals</button>
      <button type="button" class="score-tab" data-tab-target="impact-formula" role="tab" aria-selected="false">▸ Impact formula</button>
      <span class="score-tab-meta">Kills 20% · Streak 10% · Damage 20% · Fort 30% · Obj 10% · Survive 10%</span>
    </div>
    <div class="score-table-panel score-table-panel-main score-tab-panel is-active" data-tab-panel="scoreboard-totals" role="tabpanel">
      <header><h3>Raw stats</h3><small>Sort each column to inspect volume, pressure, and support.</small></header>
      ${renderScoreTable(players, topDamage, sortKey, guildId, csrfToken, canManage)}
    </div>
    <div class="score-table-panel impact-panel score-tab-panel" data-tab-panel="impact-formula" role="tabpanel" hidden>
      <header><p class="eyebrow">Impact formula</p><h3>Impact ranking</h3><small>Weighted score: Kills 20% | Streak 10% | Damage 20% | Fort 30% | Objectives 10% | Survival 10%</small></header>
      ${renderImpactTable(impactScores)}
    </div>
  </section>${renderScoreSortScript()}${renderScoreTabsScript()}`;
}

export function renderScoreTabsScript(): string {
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
            b.setAttribute("aria-selected", on ? "true" : "false");
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

export function renderScoreTable(players: PlayerScoreAggregate[], topDamage: number, sortKey: ScoreSortKey, guildId: string, csrfToken: string, canManage: boolean): string {
  return `<div class="score-table-wrap"><table class="score-table" data-score-table data-score-sort="${sortKey}">
    <thead><tr><th>${renderScoreSortButton("Player", "player", sortKey)}</th><th>${renderScoreSortButton("Wars", "wars", sortKey)}</th><th>${renderScoreSortButton("K", "kills", sortKey)}</th><th>${renderScoreSortButton("D", "deaths", sortKey)}</th><th>${renderScoreSortButton("K/D", "kd", sortKey)}</th><th>${renderScoreSortButton("Damage", "damage", sortKey)}</th><th>${renderScoreSortButton("Taken", "taken", sortKey)}</th><th>${renderScoreSortButton("CC", "cc", sortKey)}</th><th>${renderScoreSortButton("Healed", "healed", sortKey)}</th><th>${renderScoreSortButton("Structure", "structure", sortKey)}</th></tr></thead>
    <tbody>${players
      .map(
        (player) => {
          const healed = player.allySupport;
          const kd = player.deaths ? player.kills / player.deaths : player.kills;
          return `<tr data-player="${escapeHtml(player.familyName.toLowerCase())}" data-wars="${player.participations}" data-kills="${player.kills}" data-deaths="${player.deaths}" data-kd="${kd}" data-damage="${player.damageDealt}" data-taken="${player.damageTaken}" data-cc="${player.crowdControls}" data-healed="${healed}" data-structure="${player.structureDamage}">
          <td><span class="player-cell"><strong>${escapeHtml(player.familyName)}</strong>${canManage ? renderPlayerRenameControl(player.familyName, guildId, csrfToken) : ""}</span><span class="damage-bar"><i style="width:${Math.max(4, Math.round((player.damageDealt / topDamage) * 100))}%"></i></span></td>
          <td>${player.participations}</td>
          <td>${formatStatNumber(player.kills)}</td>
          <td>${formatStatNumber(player.deaths)}</td>
          <td>${player.deaths ? kd.toFixed(2) : formatStatNumber(player.kills)}</td>
          <td>${formatStatNumber(player.damageDealt)}</td>
          <td>${formatStatNumber(player.damageTaken)}</td>
          <td>${formatStatNumber(player.crowdControls)}</td>
          <td>${formatStatNumber(healed)}</td>
          <td>${formatStatNumber(player.structureDamage)}</td>
        </tr>`;
        }
      )
      .join("")}</tbody>
  </table></div>`;
}

export function renderScoreSortButton(label: string, key: string, sortKey: string): string {
  const active = key === sortKey ? " active" : "";
  return `<button class="score-sort-button${active}" type="button" data-score-sort-key="${escapeHtml(key)}" aria-label="Sort by ${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}

export function renderScoreSortScript(): string {
  return `<script>
(() => {
  document.querySelectorAll("[data-score-table]").forEach((table) => {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const buttons = [...table.querySelectorAll("[data-score-sort-key]")];
    let activeKey = table.dataset.scoreSort || "wars";
    let direction = activeKey === "player" ? "asc" : "desc";
    const readValue = (row, key) => key === "player" ? row.dataset.player || "" : Number(row.dataset[key] || 0);
    const rowGroups = () => {
      const groups = [];
      for (let index = 0; index < tbody.rows.length; index += 1) {
        const row = tbody.rows[index];
        const nextRow = tbody.rows[index + 1];
        if (nextRow && nextRow.classList.contains("impact-breakdown")) {
          groups.push([row, nextRow]);
          index += 1;
        } else {
          groups.push([row]);
        }
      }
      return groups;
    };
    const applySort = (key, nextDirection) => {
      const groups = rowGroups();
      groups.sort((leftGroup, rightGroup) => {
        const left = leftGroup[0];
        const right = rightGroup[0];
        const leftValue = readValue(left, key);
        const rightValue = readValue(right, key);
        const compared = typeof leftValue === "string" ? leftValue.localeCompare(String(rightValue)) : leftValue - Number(rightValue);
        return nextDirection === "asc" ? compared : -compared;
      });
      groups.flat().forEach((row) => tbody.appendChild(row));
      activeKey = key;
      direction = nextDirection;
      buttons.forEach((button) => {
        const active = button.dataset.scoreSortKey === activeKey;
        button.classList.toggle("active", active);
        button.setAttribute("aria-sort", active ? direction : "none");
      });
    };
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.scoreSortKey || "wars";
        const nextDirection = key === activeKey && direction === "desc" ? "asc" : key === "player" ? "asc" : "desc";
        applySort(key, nextDirection);
      });
    });
  });
})();
</script>`;
}

export function renderImpactTable(impactScores: PlayerImpactScore[]): string {
  const topScore = Math.max(1, ...impactScores.map((impact) => impact.score));
  return `<div class="impact-summary">
    <span><b>${impactScores.length}</b><small>ranked players</small></span>
    <span><b>${impactScores[0] ? impactScores[0].score.toFixed(1) : "0.0"}</b><small>top impact</small></span>
  </div>
  <div class="score-table-wrap impact-table-wrap"><table class="score-table impact-table" data-score-table data-score-sort="impact">
    <thead><tr><th>${renderScoreSortButton("Player", "player", "impact")}</th><th>${renderScoreSortButton("Impact", "impact", "impact")}</th><th>${renderScoreSortButton("Fort", "structure", "impact")}</th><th>${renderScoreSortButton("Obj", "objective", "impact")}</th><th>${renderScoreSortButton("Surv", "survival", "impact")}</th></tr></thead>
    <tbody>${impactScores
      .map((impact, index) => {
        const player = impact.player;
        const topClass = index < 3 ? ` impact-rank-top impact-rank-${index + 1}` : "";
        return `<tr class="${topClass}" data-player="${escapeHtml(player.familyName.toLowerCase())}" data-impact="${impact.score}" data-structure="${impact.structureScore}" data-objective="${impact.objectiveScore}" data-survival="${impact.survivalScore}">
          <td><span class="impact-player"><b>${index + 1}</b><strong>${escapeHtml(player.familyName)}</strong></span><span class="impact-bar"><i style="width:${Math.max(4, Math.round((impact.score / topScore) * 100))}%"></i></span></td>
          <td><strong>${impact.score.toFixed(1)}</strong></td>
          <td>${impact.structureScore.toFixed(0)}</td>
          <td>${impact.objectiveScore.toFixed(0)}</td>
          <td>${impact.survivalScore.toFixed(0)}</td>
        </tr>
        <tr class="impact-breakdown" data-player="${escapeHtml(player.familyName.toLowerCase())}" data-impact="${impact.score}" data-structure="${impact.structureScore}" data-objective="${impact.objectiveScore}" data-survival="${impact.survivalScore}">
          <td colspan="5">
            <div>
              ${renderImpactChip("K", impact.killsScore, "kills")}
              ${renderImpactChip("STK", impact.assistsScore, "streak")}
              ${renderImpactChip("DMG", impact.damageScore, "damage")}
              ${renderImpactChip("FORT", impact.structureScore, "structure")}
              ${renderImpactChip("OBJ", impact.objectiveScore, "objective")}
              ${renderImpactChip("LIFE", impact.survivalScore, "survival")}
            </div>
          </td>
        </tr>`;
      })
      .join("")}</tbody>
  </table></div>`;
}

export function renderImpactChip(label: string, score: number, tone: string): string {
  return `<span class="impact-chip impact-chip-${escapeHtml(tone)}"><b>${escapeHtml(label)}</b><small>${score.toFixed(0)}</small></span>`;
}

export function renderPlayerRenameControl(familyName: string, guildId: string, csrfToken: string): string {
  return `<details class="player-rename">
    <summary>Edit</summary>
    <form method="post" action="/stats/players/rename">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="guildId" value="${escapeHtml(guildId)}">
      <input type="hidden" name="oldName" value="${escapeHtml(familyName)}">
      <input name="familyName" value="${escapeHtml(familyName)}" maxlength="80" required>
      <button type="submit">Save</button>
    </form>
  </details>`;
}

export function renderScoreReportEditor(guild: DiscordGuild, session: WebSession, report: ScoreReport): string {
  const rows = [...report.rows, ...Array.from({ length: 3 }, () => undefined)];
  const inner = `<main class="shell stats-shell">
    <section class="dashboard-head">
      <div class="guild-heading">${renderGuildAvatar(guild)}<div><p class="eyebrow">Edit scoreboard</p><h1>${escapeHtml(report.title || formatDateLabel(report.warDate))}</h1><p>Correct OCR rows and save the scoreboard totals.</p></div></div>
      <a class="button button-secondary" href="/stats?guild=${encodeURIComponent(guild.id)}">Stats</a>
    </section>
    <form class="score-edit-form" method="post" action="/stats/reports/${encodeURIComponent(report.id)}/edit">
      <input type="hidden" name="csrfToken" value="${escapeHtml(session.csrfToken)}">
      <input type="hidden" name="guildId" value="${escapeHtml(guild.id)}">
      <section class="stats-upload-panel score-edit-meta">
        <label>War date<input type="date" name="warDate" value="${escapeHtml(report.warDate)}" required></label>
        <label>Result<select name="result">${renderScoreResultOptions(report.result)}</select></label>
        <label>Title<input name="title" maxlength="120" value="${escapeHtml(report.title ?? "")}"></label>
        <button type="submit">Save edits</button>
      </section>
      <section class="score-edit-grid">${rows.map((row, index) => renderScoreEditCard(row, index)).join("")}</section>
      <div class="detail-actions"><a class="button button-secondary" href="/stats?guild=${encodeURIComponent(guild.id)}">Cancel</a><button type="submit">Save edits</button></div>
    </form>
  </main>`;
  return `${renderWindow(`vim /stats/reports/${escapeHtml(report.id)}`, inner, { prompt: "nwhelper@os" })}`;
}

export function renderScoreResultOptions(selected: ScoreReportResult): string {
  return (["unknown", "win", "loss"] as ScoreReportResult[])
    .map((result) => `<option value="${result}"${selected === result ? " selected" : ""}>${result[0].toUpperCase()}${result.slice(1)}</option>`)
    .join("");
}

export function renderScoreEditCard(row: ScoreRow | undefined, index: number): string {
  const rowNumber = String(index + 1).padStart(2, "0");
  const playerName = row?.familyName?.trim() || "New row";
  const title = `${rowNumber} ${playerName}`;
  return `<article class="score-edit-card" data-row-number="${escapeHtml(rowNumber)}" data-terminal-title="${escapeHtml(title)}">
    <div class="score-edit-player-row">
      <span class="score-edit-row-number">${escapeHtml(rowNumber)}</span>
      ${renderScoreEditField("Player", "familyName", row?.familyName ?? "", "text", "Family name")}
    </div>
    <div class="score-edit-group score-edit-core">
      ${renderScoreEditField("K", "kills", row?.kills ?? 0)}
      ${renderScoreEditField("D", "deaths", row?.deaths ?? 0)}
      ${renderScoreEditField("Streak", "assists", row?.assists ?? 0)}
    </div>
    <div class="score-edit-group">
      ${renderScoreEditField("Damage", "damageDealt", row?.damageDealt ?? 0)}
      ${renderScoreEditField("Taken", "damageTaken", row?.damageTaken ?? 0)}
      ${renderScoreEditField("Structure", "structureDamage", row?.structureDamage ?? 0)}
    </div>
    <div class="score-edit-group">
      ${renderScoreEditField("CC", "crowdControls", row?.crowdControls ?? 0)}
      ${renderScoreEditField("Healed", "hpHealed", row?.hpHealed ?? 0)}
      ${renderScoreEditField("Allies", "allySupport", row?.allySupport ?? 0)}
      ${renderScoreEditField("Revives", "resurrections", row?.resurrections ?? 0)}
    </div>
    <div class="score-edit-group">
      ${renderScoreEditField("Lynch", "lynchCannonKills", row?.lynchCannonKills ?? 0)}
      ${renderScoreEditField("Siege", "siegeAssists", row?.siegeAssists ?? 0)}
      ${renderScoreEditField("Siege D", "siegeDeaths", row?.siegeDeaths ?? 0)}
      ${renderScoreEditField("Special", "specialKills", row?.specialKills ?? 0)}
      ${renderScoreEditField("Alive", "timeAlive", row?.timeAlive ?? "", "text", "00:00")}
      ${renderScoreEditField("Total", "totalWarTime", row?.totalWarTime ?? "", "text", "00:00")}
    </div>
    <small>${escapeHtml(title)}</small>
  </article>`;
}

export function renderScoreEditField(label: string, name: string, value: string | number, type = "number", placeholder = "0"): string {
  return `<label>${escapeHtml(label)}<input name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(String(value))}" placeholder="${escapeHtml(placeholder)}"${type === "number" ? " min=\"0\" step=\"1\"" : ""}></label>`;
}

export function renderReportCard(report: ScoreReport, csrfToken: string, canManage: boolean): string {
  const rows = report.rows;
  const kills = rows.reduce((sum, row) => sum + row.kills, 0);
  const deaths = rows.reduce((sum, row) => sum + row.deaths, 0);
  const damage = rows.reduce((sum, row) => sum + row.damageDealt, 0);
  const killDeathPercent = deaths ? Math.round((kills / deaths) * 100) : kills ? 100 : 0;
  const kdTone = killDeathPercent >= 200 ? "good" : killDeathPercent >= 100 ? "ok" : "low";
  const confidence = report.ocrConfidence === undefined ? "n/a" : `${Math.round(report.ocrConfidence)}%`;
  const resultTone = report.result === "win" ? "win" : report.result === "loss" ? "loss" : "unknown";
  const truncatedEngine = report.ocrEngine.length > 18 ? report.ocrEngine.slice(0, 15) + "…" : report.ocrEngine;
  return `<article class="report-card">
    <div class="report-card-head">
      <p class="eyebrow report-result report-result-${resultTone}">${escapeHtml(report.result)}</p>
      <h3>${escapeHtml(report.title || formatDateLabel(report.warDate))}</h3>
      <div class="report-card-meta">
        <span class="report-meta-row"><span class="t-muted">date</span><b>${formatDateLabel(report.warDate)}</b></span>
        <span class="report-meta-row"><span class="t-muted">ocr</span><b title="${escapeHtml(report.ocrEngine)}">${escapeHtml(truncatedEngine)}</b></span>
        <span class="report-meta-row"><span class="t-muted">conf</span><b>${escapeHtml(confidence)}</b></span>
        <span class="report-meta-row"><span class="t-muted">by</span><b>${escapeHtml((report.uploadedBy ?? "Unknown").slice(0, 14))}</b></span>
      </div>
    </div>
    <dl>
      <div><dt>Players</dt><dd>${rows.length}</dd></div>
      <div><dt>Kills</dt><dd>${formatStatNumber(kills)}</dd></div>
      <div><dt>Deaths</dt><dd>${formatStatNumber(deaths)}</dd></div>
      <div><dt>K/D %</dt><dd><span class="kd-pill kd-${kdTone}">${killDeathPercent}%</span></dd></div>
      <div><dt>Damage</dt><dd>${formatStatNumber(damage)}</dd></div>
    </dl>
    <div class="report-actions${canManage ? " report-actions-manage" : " report-actions-view"}">
      <span class="report-actions-prompt">nwhelper<span class="t-muted">@</span>reports<span class="t-muted">:</span><span class="t-path">~</span><span class="t-muted">$</span></span>
      <a class="report-action" href="/stats/reports/${encodeURIComponent(report.id)}/preview?guild=${encodeURIComponent(report.guildId)}" target="_blank" rel="noopener"><span class="report-action-prompt">&gt;</span> preview</a>
      ${canManage ? `<a class="report-action" href="/stats/reports/${encodeURIComponent(report.id)}/edit?guild=${encodeURIComponent(report.guildId)}"><span class="report-action-prompt">&gt;</span> edit</a>
      <button class="report-action" type="button" data-report-action="rescan" data-report-id="${escapeHtml(report.id)}" data-guild-id="${escapeHtml(report.guildId)}" data-csrf="${escapeHtml(csrfToken)}"><span class="report-action-prompt">&gt;</span> rescan</button>
      <button class="report-action report-action-danger" type="button" data-report-action="delete" data-report-id="${escapeHtml(report.id)}" data-guild-id="${escapeHtml(report.guildId)}" data-csrf="${escapeHtml(csrfToken)}"><span class="report-action-prompt">&gt;</span> delete</button>` : ""}
    </div>
  </article>`;
}

export function renderReportsTerminal(reports: ScoreReport[], csrfToken: string, canManage: boolean): string {
  if (!reports.length) {
    return `<div class="empty-state compact-empty"><h2>No reports stored</h2><p>Uploaded screenshots will appear here.</p></div>`;
  }
  const sorted = [...reports].sort((a, b) => b.warDate.localeCompare(a.warDate));
  const reportsJson = JSON.stringify(
    sorted.map((r) => ({
      id: r.id,
      guildId: r.guildId,
      title: r.title || formatDateLabel(r.warDate),
      warDate: formatDateLabel(r.warDate),
      ocrEngine: r.ocrEngine,
      confidence: r.ocrConfidence === undefined ? "n/a" : `${Math.round(r.ocrConfidence)}%`,
      uploadedBy: r.uploadedBy ?? "Unknown",
      result: r.result,
      rows: r.rows,
      csrfToken
    }))
  ).replace(/'/g, "&#39;").replace(/"/g, "&quot;");

  const rail = `<aside class="report-terminal-rail">
    <p class="report-terminal-eyebrow">scoreboards <span>${sorted.length}</span></p>
    <ul class="report-terminal-list" id="report-terminal-list">${sorted.map((r, idx) => {
      const kills = r.rows.reduce((s, row) => s + row.kills, 0);
      const deaths = r.rows.reduce((s, row) => s + row.deaths, 0);
      const resultTone = r.result === "win" ? "win" : r.result === "loss" ? "loss" : "unknown";
      return `<li class="report-terminal-item${idx === 0 ? " is-active" : ""}" data-report-idx="${idx}">
        <span class="report-terminal-pill report-result-${resultTone}">${escapeHtml(r.result)}</span>
        <span class="report-terminal-date">${escapeHtml(formatDateLabel(r.warDate))}</span>
        <span class="report-terminal-counts">${r.rows.length}p · ${formatStatNumber(kills)}k</span>
      </li>`;
    }).join("")}</ul>
    <p class="report-terminal-hint">click to select, then type a command</p>
  </aside>`;

  const panel = `<section class="report-terminal-panel" data-reports="${reportsJson}">
    <div class="report-terminal-output" id="report-terminal-output">
      <div class="terminal-line t-info">┌── nwhelper@reports:~</div>
      <div class="terminal-line t-info">│ <span class="t-comment"># click a scoreboard on the left, then type a command below.</span></div>
      <div class="terminal-line t-info">│ <span class="t-comment"># </span><span class="t-key">preview</span><span class="t-comment"> / </span><span class="t-key">edit</span><span class="t-comment"> / </span><span class="t-key">rescan</span><span class="t-comment"> / </span><span class="t-key">delete</span><span class="t-comment"> act on the selected one.</span></div>
      <div class="terminal-line t-info">│ <span class="t-comment"># add a number to target a different one, e.g. </span><span class="t-key">preview 2</span><span class="t-comment">.</span></div>
      <div class="terminal-line t-info">└─$ <span class="t-cursor">▮</span></div>
    </div>
    <form class="terminal-prompt-form report-terminal-prompt" id="report-terminal-form" action="javascript:void(0)" autocomplete="off" onsubmit="return false;">
      <span class="terminal-prompt-label">nwhelper<span class="t-muted">@</span>reports<span class="t-muted">:</span><span class="t-path">~</span><span class="t-muted">$</span></span>
      <div class="terminal-prompt-input-wrap">
        <input type="text" id="report-terminal-input" class="terminal-prompt-input" placeholder="preview | edit | rescan | delete | ls | help | clear" spellcheck="false" autocapitalize="off" autocorrect="off" />
        <span class="t-cursor terminal-prompt-cursor" aria-hidden="true">▮</span>
      </div>
    </form>
  </section>`;

  return `<section class="report-terminal-shell" data-report-terminal>
    ${rail}
    ${panel}
  </section>${renderReportsTerminalScript()}`;
}

export function renderReportsTerminalScript(): string {
  return `<script>
(() => {
  function bind() {
    document.querySelectorAll("[data-report-terminal]").forEach(function (root) {
      if (root.dataset.terminalBound === "1") return;
      root.dataset.terminalBound = "1";
      var panel = root.querySelector(".report-terminal-panel");
      var output = root.querySelector("#report-terminal-output");
      var items = root.querySelectorAll(".report-terminal-item");
      var form = root.querySelector("#report-terminal-form");
      var input = root.querySelector("#report-terminal-input");
      if (!panel || !output || !items.length || !form || !input) return;

      var reports = [];
      try { reports = JSON.parse((panel.getAttribute("data-reports") || "").replace(/&quot;/g, '"').replace(/&#39;/g, "'")); } catch (e) { reports = []; }

      function escapeHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      }
      function clearOutput() {
        while (output.firstChild) output.removeChild(output.firstChild);
      }
      function line(text, kind) {
        var div = document.createElement("div");
        div.className = "terminal-line " + (kind ? "t-" + kind : "");
        div.textContent = text;
        output.appendChild(div);
        output.scrollTop = output.scrollHeight;
      }
      function lineHTML(html) {
        var div = document.createElement("div");
        div.className = "terminal-line";
        div.innerHTML = html;
        output.appendChild(div);
        output.scrollTop = output.scrollHeight;
      }
      function echoPrompt(text) {
        lineHTML(
          '<span class="t-success">nwhelper</span><span class="t-muted">@</span><span class="t-success">reports</span><span class="t-muted">:</span><span class="t-path">~</span><span class="t-muted">$</span> ' +
          '<span>' + escapeHtml(text) + '</span>'
        );
      }
      function findReport(query) {
        if (!query) return -1;
        var q = String(query).trim();
        var numeric = parseInt(q, 10);
        if (!isNaN(numeric) && String(numeric) === q) {
          if (numeric >= 1 && numeric <= reports.length) return numeric - 1;
        }
        var ql = q.toLowerCase();
        for (var i = 0; i < reports.length; i++) {
          if ((reports[i].title || "").toLowerCase() === ql) return i;
          if ((reports[i].warDate || "").toLowerCase() === ql) return i;
        }
        for (var j = 0; j < reports.length; j++) {
          if ((reports[j].title || "").toLowerCase().indexOf(ql) === 0) return j;
        }
        for (var k = 0; k < reports.length; k++) {
          if ((reports[k].title || "").toLowerCase().indexOf(ql) !== -1) return k;
        }
        return -1;
      }

      function showReport(idx) {
        var r = reports[idx];
        if (!r) return;
        clearOutput();
        items.forEach(function (el) { el.classList.toggle("is-active", Number(el.getAttribute("data-report-idx")) === idx); });
        var totalKills = r.rows.reduce(function (s, row) { return s + (row.kills || 0); }, 0);
        var totalDeaths = r.rows.reduce(function (s, row) { return s + (row.deaths || 0); }, 0);
        var totalDamage = r.rows.reduce(function (s, row) { return s + (row.damageDealt || 0); }, 0);
        var kd = totalDeaths ? Math.round((totalKills / totalDeaths) * 100) : (totalKills ? 100 : 0);
        line("━━ " + r.warDate + "  " + r.title + " ━━", "cyan");
        line("  result     " + r.result, r.result === "win" ? "success" : r.result === "loss" ? "error" : "muted");
        line("  ocr        " + r.ocrEngine + " (conf " + r.confidence + ")", "muted");
        line("  uploaded   " + r.uploadedBy, "muted");
        line("  players    " + r.rows.length, "info");
        line("  kills      " + totalKills.toLocaleString(), "info");
        line("  deaths     " + totalDeaths.toLocaleString(), "info");
        line("  k/d %      " + kd + "%", kd >= 200 ? "success" : kd >= 100 ? "warn" : "error");
        line("  damage     " + totalDamage.toLocaleString(), "info");
        line("", null);
        lineHTML(
          '<span class="t-comment">› selected · type one of:</span><br>' +
          '<span class="t-key">  preview</span><span class="t-muted">  ·  open the screenshot</span><br>' +
          '<span class="t-key">  edit</span><span class="t-muted">     ·  open the scoreboard editor</span><br>' +
          '<span class="t-key">  rescan</span><span class="t-muted">   ·  re-run OCR on the screenshot</span><br>' +
          '<span class="t-error">  delete</span><span class="t-muted">   ·  remove this scoreboard (asks first)</span>'
        );
        line("", null);
        line("> tip: click another scoreboard on the left, or add a number to target a different one (e.g. preview 2).", "muted");
      }

      function selectedReport() {
        var active = root.querySelector(".report-terminal-item.is-active");
        if (!active) return -1;
        return Number(active.getAttribute("data-report-idx"));
      }

      function runCommand(text) {
        var t = String(text || "").trim();
        echoPrompt(text);
        if (!t) return;
        var parts = t.split(/\\s+/);
        var cmd = parts[0].toLowerCase();
        var arg = parts.slice(1).join(" ");

        if (cmd === "help" || cmd === "?") {
          lineHTML(
            '<span class="t-info">Available commands</span><br>' +
            '<span class="t-comment">  click a scoreboard on the left to select it, then:</span><br>' +
            '<span class="t-key">  preview</span><span class="t-muted">          open the screenshot for the selected scoreboard</span><br>' +
            '<span class="t-key">  edit</span><span class="t-muted">             open the scoreboard editor</span><br>' +
            '<span class="t-key">  rescan</span><span class="t-muted">           re-run OCR on the screenshot</span><br>' +
            '<span class="t-error">  delete</span><span class="t-muted">           remove the selected scoreboard (asks first)</span><br>' +
            '<span class="t-key">  open &lt;n&gt;</span><span class="t-muted">       show details for scoreboard #n (alias: select, view)</span><br>' +
            '<span class="t-key">  preview &lt;n&gt; | edit &lt;n&gt; | rescan &lt;n&gt; | delete &lt;n&gt;</span><br>' +
            '<span class="t-muted">                       target a specific scoreboard by number, title, or date</span><br>' +
            '<span class="t-key">  ls</span><span class="t-muted">                 list scoreboards (alias: list)</span><br>' +
            '<span class="t-key">  clear</span><span class="t-muted">              clear the terminal (alias: cls)</span>'
          );
          return;
        }
        if (cmd === "ls" || cmd === "list") {
          line("idx  result  date            title                          players", "muted");
          reports.forEach(function (r, i) {
            line(
              String(i + 1).padStart(2, " ") + "   " +
              r.result.padEnd(7, " ") + "  " +
              (r.warDate || "").padEnd(15, " ") + "  " +
              (r.title || "").slice(0, 30).padEnd(30, " ") + "  " +
              r.rows.length + "p",
              "info"
            );
          });
          line(reports.length + " scoreboard" + (reports.length === 1 ? "" : "s"), "muted");
          return;
        }
        if (cmd === "clear" || cmd === "cls") {
          clearOutput();
          return;
        }
        var targetIdx = -1;
        if (cmd === "open" || cmd === "select" || cmd === "view") {
          targetIdx = arg ? findReport(arg) : selectedReport();
        } else if (cmd === "preview" || cmd === "edit" || cmd === "rescan" || cmd === "delete") {
          targetIdx = arg ? findReport(arg) : selectedReport();
        }
        if (["open", "select", "view", "preview", "edit", "rescan", "delete"].indexOf(cmd) !== -1) {
          if (targetIdx < 0) { line("no scoreboard matches '" + (arg || "current") + "'", "error"); return; }
          var r = reports[targetIdx];
          if (!r) { line("scoreboard not found", "error"); return; }
          if (cmd === "open" || cmd === "select" || cmd === "view") {
            showReport(targetIdx);
            return;
          }
          if (cmd === "preview") { window.location.href = "/stats/reports/" + encodeURIComponent(r.id) + "/preview?guild=" + encodeURIComponent(r.guildId || ""); return; }
          if (cmd === "edit") { window.location.href = "/stats/reports/" + encodeURIComponent(r.id) + "/edit?guild=" + encodeURIComponent(r.guildId || ""); return; }
          if (cmd === "delete") {
            if (!confirm("Delete scoreboard " + r.title + "?")) { line("delete cancelled", "muted"); return; }
            var formEl = document.createElement("form");
            formEl.method = "post";
            formEl.action = "/stats/reports/" + r.id + "/delete";
            var csrf = document.createElement("input");
            csrf.type = "hidden";
            csrf.name = "csrfToken";
            csrf.value = r.csrfToken || "";
            formEl.appendChild(csrf);
            var gid = document.createElement("input");
            gid.type = "hidden";
            gid.name = "guildId";
            gid.value = r.guildId || "";
            formEl.appendChild(gid);
            document.body.appendChild(formEl);
            formEl.submit();
            return;
          }
          if (cmd === "rescan") {
            var formEl2 = document.createElement("form");
            formEl2.method = "post";
            formEl2.action = "/stats/reports/" + r.id + "/rescan";
            var csrf2 = document.createElement("input");
            csrf2.type = "hidden";
            csrf2.name = "csrfToken";
            csrf2.value = r.csrfToken || "";
            formEl2.appendChild(csrf2);
            var gid2 = document.createElement("input");
            gid2.type = "hidden";
            gid2.name = "guildId";
            gid2.value = r.guildId || "";
            formEl2.appendChild(gid2);
            document.body.appendChild(formEl2);
            formEl2.submit();
            return;
          }
        }

        var direct = findReport(t);
        if (direct >= 0) { showReport(direct); return; }

        line("command not found: " + cmd, "error");
        line("type 'help' for the list of commands", "muted");
      }

      items.forEach(function (item) {
        item.addEventListener("click", function () {
          showReport(Number(item.getAttribute("data-report-idx")));
        });
      });

      form.addEventListener("submit", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        var val = input.value;
        input.value = "";
        runCommand(val);
        return false;
      });

      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          var val = input.value;
          input.value = "";
          runCommand(val);
        }
      });

      // Show first report by default
      showReport(0);
    });
  }
  bind();
  try { new MutationObserver(bind).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
})();
</script>`;
}
