import type { WebSession, GuildDashboardSummary } from '../types.js';

/* ── Page shell ──────────────────────────────────────────────── */

export function renderApp(title: string, body: string, opts: {
  session?: WebSession;
  summaries?: GuildDashboardSummary[];
  activeNav?: string;
  headExtra?: string;
  bodyClass?: string;
} = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | Project Athena</title>
  <link rel="stylesheet" href="/assets/css/tokens.css">
  <link rel="stylesheet" href="/assets/css/base.css">
  <link rel="stylesheet" href="/assets/css/layout.css">
  <link rel="stylesheet" href="/assets/css/components.css">
  ${opts.headExtra ?? ""}
</head>
<body${opts.bodyClass ? ` class="${esc(opts.bodyClass)}"` : ""}>
  <div class="app">
    ${renderTopNav(opts.session, opts.summaries, opts.activeNav)}
    <main class="main">
      ${body}
    </main>
  </div>
  <script>
    (function () {
      var topNav = document.querySelector('.top-nav');
      var mobileToggle = document.querySelector('[data-mobile-nav]');
      var mobileMenu = document.querySelector('[data-mobile-menu]');

      if (mobileToggle && mobileMenu) {
        mobileToggle.addEventListener('click', function () {
          var expanded = mobileToggle.getAttribute('aria-expanded') === 'true';
          mobileToggle.setAttribute('aria-expanded', String(!expanded));
          topNav.classList.toggle('mobile-open', !expanded);
        });
      }

      var accountMenu = document.querySelector('[data-account-menu]');
      var accountToggle = document.querySelector('[data-account-toggle]');
      if (accountToggle && accountMenu) {
        accountToggle.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          var expanded = accountToggle.getAttribute('aria-expanded') === 'true';
          accountToggle.setAttribute('aria-expanded', String(!expanded));
          accountMenu.classList.toggle('open', !expanded);
        });
        document.addEventListener('click', function (event) {
          var target = event.target instanceof Element ? event.target : null;
          if (!target || target.closest('[data-account-menu]')) return;
          accountToggle.setAttribute('aria-expanded', 'false');
          accountMenu.classList.remove('open');
        });
      }

      var path = window.location.pathname;
      document.querySelectorAll('.top-nav-link').forEach(function (item) {
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
      // ── Scroll-triggered feature reveal ──
      if ('IntersectionObserver' in window) {
        var revealEls = document.querySelectorAll('.athena-section-heading, .athena-feature-grid article, .athena-support-panel');
        if (revealEls.length) {
          var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
                observer.unobserve(entry.target);
              }
            });
          }, { threshold: 0.15 });
          revealEls.forEach(function (el) { observer.observe(el); });
        }
      }
    })();
  </script>
</body>
</html>`;
}

/* ── Top navigation ───────────────────────────────────────────── */

function renderTopNav(session?: WebSession, summaries?: GuildDashboardSummary[], activeNav?: string): string {
  const isLoggedIn = Boolean(session);
  const user = session?.user;
  const initials = user ? (user.global_name || user.username || "U").slice(0, 2).toUpperCase() : "?";
  const primaryItems = [
    { href: "/", label: "Home", key: "home" },
    ...(isLoggedIn ? [
      { href: "/dashboard", label: "Dashboard", key: "dashboard" },
    ] : []),
    { href: "/docs", label: "Docs", key: "docs" },
  ];

  return `<header class="top-nav" role="banner">
    <a class="top-brand" href="/" aria-label="Project Athena home">
      <img src="/assets/project_athena.png" alt="Project Athena" class="top-brand-logo">
      <span class="top-brand-text">PROJECT ATHENA</span>
    </a>

    <button class="top-nav-toggle" type="button" data-mobile-nav aria-expanded="false" aria-controls="top-nav-menu">
      <span></span><span></span><span></span>
    </button>
    <nav id="top-nav-menu" class="top-nav-menu" data-mobile-menu aria-label="Main navigation">
      ${primaryItems.map((item) => `<a class="top-nav-link${activeNav === item.key ? " active" : ""}" href="${esc(item.href)}">${esc(item.label)}</a>`).join("")}
    </nav>

    <div class="top-nav-actions">
      ${isLoggedIn && user ? `
        <div class="top-account" data-account-menu>
          <button class="top-user" type="button" data-account-toggle aria-expanded="false" aria-haspopup="menu" title="Account options">
            <span class="top-user-avatar">${user.avatar ? `<img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64" alt="">` : initials}</span>
            <span class="top-user-name">${esc(user.global_name || user.username)}</span>
          </button>
          <div class="top-account-menu" role="menu">
            <div class="top-account-name">${esc(user.global_name || user.username)}</div>
            <a href="/logout?next=/auth/discord" role="menuitem">Change account</a>
            <a href="/logout" role="menuitem">Log out</a>
          </div>
        </div>
      ` : `
        <a href="/auth/discord" class="button button-primary button-sm">Sign in</a>
      `}
    </div>
  </header>`;
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
      <div>
        <div class="landing-kicker">COMMAND CENTER</div>
        <h1 class="page-title">${esc(title)}</h1>
        ${subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : ""}
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
