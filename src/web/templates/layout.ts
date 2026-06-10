import type { WebSession, GuildDashboardSummary } from '../types.js';

/* ── Page shell ──────────────────────────────────────────────── */

export function renderApp(title: string, body: string, opts: {
  session?: WebSession;
  summaries?: GuildDashboardSummary[];
  activeNav?: string;
  headExtra?: string;
} = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | NW Helper</title>
  <link rel="stylesheet" href="/assets/css/tokens.css">
  <link rel="stylesheet" href="/assets/css/base.css">
  <link rel="stylesheet" href="/assets/css/layout.css">
  <link rel="stylesheet" href="/assets/css/components.css">
  ${opts.headExtra ?? ""}
</head>
<body>
  <div class="app">
    ${renderSidebar(opts.session, opts.summaries, opts.activeNav)}
    <main class="main">
      ${body}
    </main>
  </div>
  <script>
    (function () {
      var sidebar = document.querySelector('.sidebar');
      var toggle = document.querySelector('[data-sidebar-toggle]');
      var mobileToggle = document.querySelector('[data-mobile-sidebar]');
      var overlay = document.querySelector('.sidebar-overlay');

      if (toggle) toggle.addEventListener('click', function () { sidebar.classList.toggle('collapsed'); });
      if (mobileToggle) mobileToggle.addEventListener('click', function () { sidebar.classList.toggle('mobile-open'); });
      if (overlay) overlay.addEventListener('click', function () { sidebar.classList.remove('mobile-open'); });

      var path = window.location.pathname;
      document.querySelectorAll('.nav-item').forEach(function (item) {
        var href = item.getAttribute('href') || '';
        if (href === path || (href !== '/' && path.indexOf(href) === 0)) {
          item.classList.add('active');
        }
      });

      document.addEventListener('click', function (e) {
        var target = e.target instanceof Element ? e.target : null;
        if (!target) return;
        var reportBtn = target.closest('[data-report-action]');
        if (!reportBtn) return;
        e.preventDefault();
        var raction = reportBtn.getAttribute('data-report-action');
        var rid = reportBtn.getAttribute('data-report-id');
        var rgid = reportBtn.getAttribute('data-guild-id');
        var rcsrf = reportBtn.getAttribute('data-csrf');
        if (!raction || !rid || !rgid || !rcsrf) return;
        if (raction === 'delete') {
          if (!confirm('Delete this scoreboard and uploaded image?')) return;
        }
        reportBtn.disabled = true;
        var origText = reportBtn.textContent;
        reportBtn.textContent = raction === 'delete' ? 'Deleting\u2026' : 'Rescanning\u2026';
        var body = new URLSearchParams();
        body.set('csrfToken', rcsrf);
        body.set('guildId', rgid);
        fetch('/stats/reports/' + encodeURIComponent(rid) + '/' + raction, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          redirect: 'follow'
        }).then(function (resp) {
          if (resp.redirected) {
            window.location.href = resp.url;
            return;
          }
          if (!resp.ok) {
            reportBtn.disabled = false;
            reportBtn.textContent = origText;
            return resp.text().then(function (t) {
              alert((raction === 'delete' ? 'Delete' : 'Rescan') + ' failed: ' + (t || resp.statusText));
            });
          }
          window.location.reload();
        }).catch(function (err) {
          reportBtn.disabled = false;
          reportBtn.textContent = origText;
          alert('Network error: ' + (err && err.message ? err.message : err));
        });
      });
    })();
  </script>
</body>
</html>`;
}

/* ── Sidebar ─────────────────────────────────────────────────── */

function renderSidebar(session?: WebSession, summaries?: GuildDashboardSummary[], activeNav?: string): string {
  const isLoggedIn = Boolean(session);
  const user = session?.user;
  const initials = user ? (user.global_name || user.username || "U").slice(0, 2).toUpperCase() : "?";

  return `<aside class="sidebar" role="navigation" aria-label="Main navigation">
    <div class="sidebar-brand">
      <span class="brand-icon">NW</span>
      <span class="brand-text">NW Helper</span>
    </div>

    <nav class="sidebar-nav">
      ${renderNavSection("Overview", [
        { href: "/", icon: homeIcon(), label: "Dashboard", key: "home" },
        ...(isLoggedIn ? [
          { href: "/raids", icon: shieldIcon(), label: "All Raids", key: "raids" },
        ] : []),
      ])}

      ${isLoggedIn && summaries?.length ? renderNavSection("Servers", summaries.map((s) => ({
        href: `/?guild=${s.guild.id}`,
        icon: serverIcon(),
        label: s.guild.name,
        key: `guild-${s.guild.id}`
      })).slice(0, 5)) : ""}

      ${isLoggedIn ? renderNavSection("Tools", [
        { href: "/stats", icon: chartIcon(), label: "Stats", key: "stats" },
      ]) : ""}
    </nav>

    <div class="sidebar-footer">
      ${isLoggedIn && user ? `
        <a href="/logout" class="sidebar-user" title="Sign out">
          <span class="sidebar-user-avatar">${user.avatar ? `<img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64" alt="">` : initials}</span>
          <span class="sidebar-user-info">
            <span class="sidebar-user-name">${esc(user.global_name || user.username)}</span>
            <span class="sidebar-user-role">Signed in</span>
          </span>
        </a>
      ` : `
        <a href="/auth/discord" class="nav-item">
          <span class="nav-item-icon">${loginIcon()}</span>
          <span class="nav-label">Sign in with Discord</span>
        </a>
      `}
      <button class="sidebar-toggle" data-sidebar-toggle title="Toggle sidebar">
        <span class="nav-item-icon">${collapseIcon()}</span>
        <span class="nav-label">Collapse</span>
      </button>
    </div>
  </aside>
  <div class="sidebar-overlay" aria-hidden="true"></div>`;
}

function renderNavSection(label: string, items: Array<{ href: string; icon: string; label: string; key: string }>): string {
  return `<div class="nav-section">
    <div class="nav-section-label">${esc(label)}</div>
    ${items.map((item) => `<a class="nav-item" href="${esc(item.href)}">
      <span class="nav-item-icon">${item.icon}</span>
      <span class="nav-label">${esc(item.label)}</span>
    </a>`).join("")}
  </div>`;
}

/* ── Page Header ─────────────────────────────────────────────── */

export function renderPageHeader(title: string, subtitle?: string, actions?: string): string {
  return `<div class="page-header">
    <div class="page-header-inner">
      <div style="display:flex;align-items:center;gap:var(--space-3);">
        <button class="mobile-menu-btn" data-mobile-sidebar style="display:none;background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:var(--space-1);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div>
          <h1 class="page-title">${esc(title)}</h1>
          ${subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : ""}
        </div>
      </div>
      ${actions ? `<div class="header-actions">${actions}</div>` : ""}
    </div>
  </div>`;
}

/* ── Reusable blocks ─────────────────────────────────────────── */

export function renderStatGrid(stats: Array<{ label: string; value: string; change?: string; color?: string }>): string {
  return `<div class="dashboard-stats">
    ${stats.map((s) => `<div class="stat-card"${s.color ? ` style="--card-accent:${s.color};border-top:2px solid ${s.color};"` : ""}>
      <div class="stat-card-label">${esc(s.label)}</div>
      <div class="stat-card-value"${s.color ? ` style="color:${s.color};"` : ""}>${esc(s.value)}</div>
      ${s.change ? `<div class="stat-card-change">${esc(s.change)}</div>` : ""}
    </div>`).join("")}
  </div>`;
}

export function renderEmptyState(title: string, description: string, action?: string): string {
  return `<div class="empty-state-enhanced">
    <div class="empty-state-icon">${emptyIcon()}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(description)}</p>
    ${action ? `<div class="empty-state-action">${action}</div>` : ""}
  </div>`;
}

/* ── SVG Icons ───────────────────────────────────────────────── */

function homeIcon(): string {
  return `<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>`;
}

function shieldIcon(): string {
  return `<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`;
}

function chartIcon(): string {
  return `<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
}

function serverIcon(): string {
  return `<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;
}

function stackIcon(): string {
  return `<svg viewBox="0 0 24 24"><polygon points="12,2 2,7 12,12 22,7"/><polyline points="2,17 12,22 22,17"/><polyline points="2,12 12,17 22,12"/></svg>`;
}

function loginIcon(): string {
  return `<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10,17 15,12 10,7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`;
}

function collapseIcon(): string {
  return `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`;
}

function emptyIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M8 8h5M8 16h6"/></svg>`;
}

/* ── Helpers ─────────────────────────────────────────────────── */

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
