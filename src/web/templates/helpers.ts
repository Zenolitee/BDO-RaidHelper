import { escapeHtml } from '../utils.js';

export function renderPage(title: string, body: string, opts: { loggedIn?: boolean; path?: string } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Project Athena</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body class="antialiased" data-path="${escapeHtml(opts.path ?? "/")}">
  <div class="os-shell">
    ${renderPolybarClean(title, !!opts.loggedIn)}
    <div class="os-desktop">${body}</div>
  </div>
  ${renderOsShellScript()}
</body>
</html>`;
}

export function renderPolybarClean(currentTitle: string, isLoggedIn: boolean): string {
  const days = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const now = new Date();
  const jsDay = now.getDay();
  const isoDay = jsDay === 0 ? 6 : jsDay - 1;
  const dayTags = days
    .map((d, i) => {
      const isToday = i === isoDay;
      const isWeekend = i >= 5;
      return `<span class="pb-day${isToday ? " today" : ""}${isWeekend && !isToday ? " weekend" : ""}" title="${d}">${isToday ? "*" : d[0]}</span>`;
    })
    .join("");

  const navItems: { href: string; label: string; icon: string; tone: string }[] = [
    { href: "/", label: "home", icon: "", tone: "bg-pink" },
    { href: "/events", label: "events", icon: "", tone: "bg-cyan" },
    { href: "/servers", label: "servers", icon: "", tone: "bg-aqua" }
  ];
  if (isLoggedIn) {
    navItems.push({ href: "/create", label: "+new", icon: "", tone: "bg-yellow" });
  } else {
    navItems.push({ href: "/auth/discord", label: "login", icon: "", tone: "bg-green" });
  }

  const navTags = navItems
    .map((item) => `<a class="pb-tag ${item.tone}" data-pb-nav href="${escapeHtml(item.href)}" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</a>`)
    .join("");

  return `<div class="polybar" role="banner" aria-label="System bar">
    <section class="pb-left">
      ${navTags}
    </section>
    <section class="pb-center">
      <span class="pb-day-spacer"></span>
      <span class="pb-tag bg-cyan" title="Current window">${escapeHtml(currentTitle)}</span>
    </section>
    <section class="pb-right">
      ${dayTags}
      <span class="pb-day-spacer"></span>
      <span class="pb-tag bg-ghost" data-pb-uptime title="Uptime">up --</span>
      <span class="pb-tag bg-white" data-pb-clock title="Clock">--</span>
      ${isLoggedIn ? `<a class="pb-tag bg-red" href="/logout" title="Sign out">off</a>` : ""}
    </section>
  </div>`;
}

export function renderOsShellScript(): string {
  return `<script>
  (function () {
    try {
    if (window.__nwhelpBoot) return; window.__nwhelpBoot = true;
    console.log("[nwhelper] os shell booting…");
    var clockEl = document.querySelector("[data-pb-clock]");
    var uptimeEl = document.querySelector("[data-pb-uptime]");
    var raidsEl = document.querySelector("[data-pb-raids]");
    var boot = Date.now();
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    function fmt12(h, m) {
      var p = h >= 12 ? "PM" : "AM";
      var hh = h % 12; if (hh === 0) hh = 12;
      return pad(hh) + ":" + pad(m) + " " + p;
    }
    function tickClock() {
      if (!clockEl) return;
      var d = new Date();
      var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      clockEl.textContent = days[d.getDay()] + " " + months[d.getMonth()] + " " + d.getDate() + " " + fmt12(d.getHours(), d.getMinutes());
    }
    function tickUptime() {
      if (!uptimeEl) return;
      var s = Math.max(0, Math.floor((Date.now() - boot) / 1000));
      var h = Math.floor(s / 3600);
      var m = Math.floor((s % 3600) / 60);
      var sec = s % 60;
      uptimeEl.textContent = "up " + pad(h) + ":" + pad(m) + ":" + pad(sec);
    }
    function tickRaids() {
      if (!raidsEl || !raidsEl.dataset.static) return;
      raidsEl.textContent = raidsEl.dataset.static;
    }
    tickClock();
    tickUptime();
    tickRaids();
    setInterval(tickClock, 15000);
    setInterval(tickUptime, 1000);

    var navTags = document.querySelectorAll("[data-pb-nav]");
    var path = (document.body && document.body.getAttribute("data-path")) || (window.location.pathname || "/");
    navTags.forEach(function (tag) {
      var href = tag.getAttribute("href") || "";
      if (!href) return;
      var isExact = href === path;
      var isPrefix = !isExact && href !== "/" && path.indexOf(href + "/") === 0;
      if (isExact || isPrefix) tag.classList.add("active");
    });

    try {
      var stored = localStorage.getItem("nwhelper.bg");
      if (stored === "2" || (!stored && Math.random() < 0.5)) {
        document.body.classList.add("bg-variant-2");
      }
    } catch {}

    var CARD_TERMINAL_SELECTOR = [
      ".event-card", ".server-card", ".role-table", ".schedule-panel",
      ".schedule-editor", ".delivery-editor", ".slot-editor", ".empty-state",
      ".welcome-state", ".server-picker", ".score-table-panel", ".score-edit-card",
      ".score-leader-card", ".score-mix-card", ".score-trend-card", ".stats-upload-panel",
      ".stats-analysis-panel", ".report-card", ".day-card", ".impact-panel",
      ".member-server-card", ".member-raid-card", ".preview-card", ".template-grid",
      ".eyebrow-card", ".current-roster-summary", ".stats-row", ".command-rail",
      ".readiness-panel", ".primary-war-focus", ".telemetry-module", ".fetch-panel"
    ].join(",");

    var TONE_FOR_CLASS = {
      "stats-row": "pink",
      "stats-upload-panel": "magenta",
      "stats-analysis-panel": "cyan",
      "score-table-panel": "green",
      "score-mix-card": "magenta",
      "score-leader-card": "green",
      "score-trend-card": "cyan",
      "score-edit-card": "yellow",
      "impact-panel": "orange",
      "preview-card": "cyan",
      "event-card": "pink",
      "server-card": "aqua",
      "day-card": "yellow",
      "report-card": "green",
      "member-raid-card": "pink",
      "member-server-card": "aqua",
      "schedule-panel": "magenta",
      "schedule-editor": "magenta",
      "delivery-editor": "orange",
      "role-table": "blue",
      "fetch-panel": "pink",
      "command-rail": "magenta",
      "readiness-panel": "green",
      "primary-war-focus": "pink",
      "telemetry-module": "blue"
    };

    function escapeTitle(value) {
      return String(value || "").replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch;
      });
    }

    function deriveTitle(host) {
      var explicitTitle = (host.getAttribute("data-terminal-title") || "").trim();
      if (explicitTitle) return explicitTitle.slice(0, 48);
      var eyebrow = host.querySelector(":scope > .eyebrow, :scope > header .eyebrow, :scope > header h1, :scope > header h2, :scope > header h3, :scope > h1, :scope > h2, :scope > h3");
      if (eyebrow) {
        var t = (eyebrow.textContent || "").trim();
        if (t) return t.split("\\n")[0].slice(0, 32);
      }
      var h = host.querySelector("h1, h2, h3, h4, .server-name, .card-title-text, .title, header");
      if (h) {
        var t2 = (h.textContent || "").trim();
        if (t2) return t2.split("\\n")[0].slice(0, 32);
      }
      var cls = (host.className || "").split(/\\s+/).filter(function (c) { return c && c.indexOf("data-") !== 0; })[0] || "panel";
      return cls.replace(/-/g, " ").replace(/_/g, " ");
    }

    function deriveTone(host) {
      var classes = (host.className || "").split(/\\s+/);
      for (var i = 0; i < classes.length; i++) {
        if (TONE_FOR_CLASS[classes[i]]) return TONE_FOR_CLASS[classes[i]];
      }
      return "cyan";
    }

    function wrapTerminal(host) {
      if (host.dataset.terminalReady === "1") return;
      var tone = deriveTone(host);
      var title = deriveTitle(host);
      var id = host.id || ("term-" + Math.random().toString(36).slice(2, 9));

      host.id = id;
      host.dataset.terminalReady = "1";
      host.classList.add("is-terminal");
      if (getComputedStyle(host).position === "static") {
        host.style.position = "relative";
      }

      var titlebar = document.createElement("header");
      titlebar.className = "card-titlebar t-" + tone;
      titlebar.innerHTML =
        '<span class="card-title">' + escapeTitle(title) + '</span>' +
        '<span class="card-spacer"></span>' +
        '<button type="button" class="card-min" data-card-action="min" title="minimize" aria-label="minimize">─</button>' +
        '<button type="button" class="card-close" data-card-action="close" title="close" aria-label="close">×</button>';

      host.insertBefore(titlebar, host.firstChild);
    }

    function updateScoreEditTitle(input) {
      var host = input.closest && input.closest(".score-edit-card");
      if (!host) return;
      var row = host.getAttribute("data-row-number") || "";
      var value = (input.value || "").trim();
      var title = (row ? row + " " : "") + (value || "New row");
      host.setAttribute("data-terminal-title", title);
      var titleEl = host.querySelector(":scope > .card-titlebar .card-title");
      if (titleEl) titleEl.textContent = title.slice(0, 48);
    }

    function ensureTerminals(root) {
      var nodes = (root || document).querySelectorAll(CARD_TERMINAL_SELECTOR);
      nodes.forEach(wrapTerminal);
    }

    ensureTerminals(document);

    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches(CARD_TERMINAL_SELECTOR)) wrapTerminal(n);
          if (n.querySelectorAll) ensureTerminals(n);
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    function toggleMin(host) {
      var next = host.getAttribute("data-minimized") === "true" ? "false" : "true";
      host.setAttribute("data-minimized", next);
      var btn = host.querySelector('[data-card-action="min"]');
      if (btn) {
        btn.textContent = next === "true" ? "▢" : "─";
        btn.setAttribute("title", next === "true" ? "restore" : "minimize");
        btn.setAttribute("aria-label", next === "true" ? "restore" : "minimize");
      }
    }

    function closeTerminal(host) {
      host.style.transition = "opacity .25s ease, transform .25s ease, max-height .25s ease";
      host.style.opacity = "0";
      host.style.transform = "scale(.98)";
      setTimeout(function () { host.style.display = "none"; }, 260);
    }

    document.addEventListener("input", function (e) {
      var target = e.target;
      if (target && target.matches && target.matches(".score-edit-card input[name='familyName']")) {
        updateScoreEditTitle(target);
      }
    });

    document.addEventListener("click", function (e) {
      var target = e.target;
      if (!target || !target.closest) return;

      var winBtn = target.closest("[data-win-action]");
      if (winBtn) {
        var win = winBtn.closest("[data-window]");
        if (!win) return;
        var action = winBtn.getAttribute("data-win-action");
        if (action === "min") {
          var minimized = win.getAttribute("data-minimized") === "true";
          win.setAttribute("data-minimized", minimized ? "false" : "true");
          var wb = win.querySelector('[data-win-action="min"]');
          if (wb) {
            wb.textContent = minimized ? "─" : "▢";
            wb.setAttribute("title", minimized ? "minimize" : "restore");
          }
        } else if (action === "close") {
          win.style.transition = "opacity .25s ease, transform .25s ease, margin .25s ease, grid-template-rows .25s ease";
          win.style.opacity = "0";
          win.style.transform = "scale(.98)";
          setTimeout(function () { win.style.display = "none"; }, 260);
        }
        return;
      }

      var cardBtn = target.closest("[data-card-action]");
      if (cardBtn) {
        var card = cardBtn.closest(CARD_TERMINAL_SELECTOR);
        if (!card) return;
        var caction = cardBtn.getAttribute("data-card-action");
        if (caction === "min") {
          toggleMin(card);
        } else if (caction === "close") {
          closeTerminal(card);
        }
        return;
      }

      var reportBtn = target.closest("[data-report-action]");
      if (reportBtn) {
        e.preventDefault();
        var raction = reportBtn.getAttribute("data-report-action");
        var rid = reportBtn.getAttribute("data-report-id");
        var rgid = reportBtn.getAttribute("data-guild-id");
        var rcsrf = reportBtn.getAttribute("data-csrf");
        if (!raction || !rid || !rgid || !rcsrf) return;
        if (raction === "delete") {
          if (!confirm("Delete this scoreboard and uploaded image?")) return;
        }
        reportBtn.disabled = true;
        var origText = reportBtn.textContent;
        reportBtn.textContent = raction === "delete" ? "Deleting…" : "Rescanning…";
        var body = new URLSearchParams();
        body.set("csrfToken", rcsrf);
        body.set("guildId", rgid);
        fetch("/stats/reports/" + encodeURIComponent(rid) + "/" + raction, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          redirect: "follow"
        }).then(function (resp) {
          if (resp.redirected) {
            window.location.href = resp.url;
            return;
          }
          if (!resp.ok) {
            reportBtn.disabled = false;
            reportBtn.textContent = origText;
            return resp.text().then(function (t) {
              alert((raction === "delete" ? "Delete" : "Rescan") + " failed: " + (t || resp.statusText));
            });
          }
          window.location.reload();
        }).catch(function (err) {
          reportBtn.disabled = false;
          reportBtn.textContent = origText;
          alert("Network error: " + (err && err.message ? err.message : err));
        });
        return;
      }

      var cardTitlebar = target.closest(".card-titlebar");
      if (cardTitlebar) {
        var titlebarHost = cardTitlebar.parentElement;
        if (titlebarHost && titlebarHost.matches && titlebarHost.matches(CARD_TERMINAL_SELECTOR)) {
          if (target.closest("button")) return;
          toggleMin(titlebarHost);
        }
      }
    });

    (function initServerTerminal() {
      try {
      var form = document.getElementById("server-pick-form");
      var input = document.getElementById("server-pick-input");
      var output = document.getElementById("server-pick-output");
      var terminal = document.querySelector(".server-pick-terminal");
      var cursor = terminal ? terminal.querySelector(".terminal-prompt-cursor") : null;
      if (!form || !input || !output || !terminal) {
        console.warn("[nwhelper] server picker elements missing", { form: !!form, input: !!input, output: !!output, terminal: !!terminal });
        return;
      }

      var serversData = [];
      try {
        var raw = terminal.getAttribute("data-servers") || "";
        serversData = JSON.parse(raw.replace(/&quot;/g, '\\"'));
      } catch { serversData = []; }

      var targetTemplate = terminal.getAttribute("data-target-template") || "/guilds/{id}/stats";
      function buildTarget(id) { return targetTemplate.replace(/\{id\}/g, encodeURIComponent(id)); }

      var history = [];
      var histIdx = 0;

      function scrollToBottom() {
        output.scrollTop = output.scrollHeight;
      }

      function line(text, kind) {
        var div = document.createElement("div");
        div.className = "terminal-line " + (kind ? "t-" + kind : "");
        div.textContent = text;
        output.appendChild(div);
        scrollToBottom();
      }

      function lineHTML(html) {
        var div = document.createElement("div");
        div.className = "terminal-line";
        div.innerHTML = html;
        output.appendChild(div);
        scrollToBottom();
      }

      function echoPrompt(text) {
        lineHTML(
          '<span class="t-success">nwhelper</span><span class="t-muted">@</span><span class="t-success">servers</span><span class="t-muted">:</span><span class="t-path">~</span><span class="t-muted">$</span> ' +
          '<span>' + escapeHTMLForTerminal(text) + '</span>'
        );
      }

      function escapeHTMLForTerminal(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function findServer(query) {
        if (!query) return null;
        var q = String(query).trim().toLowerCase();
        if (!q) return null;
        var numeric = parseInt(q, 10);
        if (!isNaN(numeric) && String(numeric) === q) {
          for (var i = 0; i < serversData.length; i++) {
            if (serversData[i].idx === numeric) return serversData[i];
          }
        }
        var candidates = [q];
        var firstWord = q.split(/\\s+/)[0];
        if (firstWord && firstWord !== q) candidates.push(firstWord);
        var noSlash = q.replace(/\\s*\\/\\s*\\S+/g, "").trim();
        if (noSlash && noSlash !== q) candidates.push(noSlash);
        for (var c = 0; c < candidates.length; c++) {
          var cq = candidates[c];
          for (var j = 0; j < serversData.length; j++) {
            if (serversData[j].lower === cq) return serversData[j];
          }
        }
        for (var k = 0; k < serversData.length; k++) {
          if (serversData[k].lower.indexOf(q) === 0) return serversData[k];
        }
        for (var l = 0; l < serversData.length; l++) {
          if (serversData[l].lower.indexOf(q) !== -1) return serversData[l];
        }
        for (var m = 0; m < serversData.length; m++) {
          for (var n = 0; n < candidates.length; n++) {
            if (serversData[m].lower.indexOf(candidates[n]) === 0) return serversData[m];
          }
        }
        for (var o = 0; o < serversData.length; o++) {
          for (var p = 0; p < candidates.length; p++) {
            if (serversData[o].lower.indexOf(candidates[p]) !== -1) return serversData[o];
          }
        }
        return null;
      }

      function highlightServer(id) {
        var items = document.querySelectorAll(".server-pick-item");
        items.forEach(function (el) {
          if (el.getAttribute("data-server-id") === id) el.classList.add("is-active");
          else el.classList.remove("is-active");
        });
      }

      function navigateTo(server) {
        line("→ connecting to " + server.name + " (/" + server.id + "/stats)", "info");
        line("✓ routing to stats dashboard for #" + server.idx + " " + server.name, "success");
        setTimeout(function () {
          window.location.href = buildTarget(server.id);
        }, 380);
      }

      function selectServer(server) {
        highlightServer(server.id);
        line("• selected #" + server.idx + "  " + server.name, "pink");
        line("  press Enter or type a command to navigate. (try: goto, cd, ls, help, clear)", "muted");
      }

      var commands = {
        help: function () {
          lineHTML(
            '<span class="t-info">Available commands</span><br>' +
            '<span class="t-key">  ls</span><span class="t-muted">, </span><span class="t-key">list</span><span class="t-muted">                 list all shared servers</span><br>' +
            '<span class="t-key">  cd &lt;name|number&gt;</span><span class="t-muted">     select a server (highlights the row)</span><br>' +
            '<span class="t-key">  goto &lt;name|number&gt;</span><span class="t-muted">   open that server stats dashboard</span><br>' +
            '<span class="t-key">  open &lt;name|number&gt;</span><span class="t-muted">   alias for goto</span><br>' +
            '<span class="t-key">  stats</span><span class="t-muted">                 open stats for the currently selected server</span><br>' +
            '<span class="t-key">  raids</span><span class="t-muted">                 open raids for the currently selected server</span><br>' +
            '<span class="t-key">  clear</span><span class="t-muted">, </span><span class="t-key">cls</span><span class="t-muted">             clear the terminal</span><br>' +
            '<span class="t-key">  whoami</span><span class="t-muted">                 show current user</span><br>' +
            '<span class="t-key">  home</span><span class="t-muted">                   return to dashboard</span><br>' +
            '<span class="t-comment">  Tip: click any server in the column on the left to select it.</span>'
          );
        },
        ls: function () {
          if (!serversData.length) {
            line("no shared servers available", "warn");
            return;
          }
          lineHTML(
            '<span class="t-muted">idx  guild                                              id</span>'
          );
          serversData.forEach(function (s) {
            var name = s.name;
            if (name.length > 38) name = name.slice(0, 35) + "...";
            lineHTML(
              '<span class="t-cyan">  ' + String(s.idx).padStart(2, " ") + ' </span>' +
              '<span class="t-info">' + escapeHTMLForTerminal(name).padEnd(48, " ") + '</span>' +
              '<span class="t-muted">' + escapeHTMLForTerminal(s.id) + '</span>'
            );
          });
          lineHTML(
            '<span class="t-muted">' + serversData.length + ' server' + (serversData.length === 1 ? "" : "s") + ' available</span>'
          );
        },
        list: function () { commands.ls(); },
        clear: function () {
          while (output.firstChild) output.removeChild(output.firstChild);
        },
        cls: function () { commands.clear(); },
        whoami: function () {
          var u = (document.body && document.body.getAttribute("data-path")) || "/";
          line("user: " + (u || "nwhelper"), "info");
        },
        home: function () {
          line("→ returning to dashboard", "info");
          setTimeout(function () { window.location.href = "/"; }, 280);
        }
      };

      function selectedServer() {
        var active = document.querySelector(".server-pick-item.is-active");
        if (!active) return null;
        var id = active.getAttribute("data-server-id");
        for (var i = 0; i < serversData.length; i++) {
          if (serversData[i].id === id) return serversData[i];
        }
        return null;
      }

      function handleSubmit(raw) {
        try {
          var text = String(raw || "").trim();
          console.log("[nwhelper] handleSubmit:", JSON.stringify(text), "servers:", serversData.length);
          echoPrompt(text);
          if (!text) return;
          history.push(text);
          histIdx = history.length;
          var parts = text.split(/\\s+/);
          var cmd = parts[0].toLowerCase();
          var arg = parts.slice(1).join(" ");

          if (commands[cmd]) {
            commands[cmd](arg);
            return;
          }
          if (cmd === "cd" || cmd === "select") {
            if (!arg) {
              var sel = selectedServer();
              if (sel) line("current selection: " + sel.name + " (#" + sel.idx + ")", "info");
              else line("usage: cd <name|number> — or click a server on the left", "warn");
              return;
            }
            var s = findServer(arg);
            if (!s) { line("no server matches '" + arg + "'", "error"); return; }
            selectServer(s);
            return;
          }
          if (cmd === "goto" || cmd === "open") {
            if (!arg) {
              var sel2 = selectedServer();
              if (sel2) { navigateTo(sel2); return; }
              line("usage: goto <name|number>", "warn");
              return;
            }
            var s2 = findServer(arg);
            if (!s2) { line("no server matches '" + arg + "'", "error"); return; }
            highlightServer(s2.id);
            navigateTo(s2);
            return;
          }
          if (cmd === "stats") {
            var sel3 = selectedServer();
            if (!sel3) { line("no server selected. type: cd <name>", "warn"); return; }
            window.location.href = buildTarget(sel3.id);
            return;
          }
          if (cmd === "raids") {
            var sel4 = selectedServer();
            if (!sel4) { line("no server selected. type: cd <name>", "warn"); return; }
            window.location.href = "/guilds/" + encodeURIComponent(sel4.id) + "/events";
            return;
          }

          var direct = findServer(text);
          if (direct) {
            highlightServer(direct.id);
            navigateTo(direct);
            return;
          }

          line("command not found: " + cmd, "error");
          line("type 'help' for the list of commands", "muted");
        } catch (err) {
          console.error("[nwhelper] handleSubmit error:", err);
          try { line("internal error: " + (err && err.message ? err.message : String(err)), "error"); } catch {}
        }
      }

      form.addEventListener("submit", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        var val = input.value;
        input.value = "";
        handleSubmit(val);
        return false;
      });

      input.addEventListener("keypress", function (e) {
        if (e.key === "Enter" || e.keyCode === 13) {
          if (e && e.preventDefault) e.preventDefault();
          var val = input.value;
          input.value = "";
          handleSubmit(val);
        }
      });

      input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowUp") {
          if (!history.length) return;
          e.preventDefault();
          histIdx = Math.max(0, histIdx - 1);
          input.value = history[histIdx];
          setTimeout(function () { input.setSelectionRange(input.value.length, input.value.length); }, 0);
        } else if (e.key === "ArrowDown") {
          if (!history.length) return;
          e.preventDefault();
          histIdx = Math.min(history.length, histIdx + 1);
          input.value = histIdx === history.length ? "" : history[histIdx];
          setTimeout(function () { input.setSelectionRange(input.value.length, input.value.length); }, 0);
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          var val = input.value;
          input.value = "";
          console.log("[nwhelper] enter:", JSON.stringify(val));
          handleSubmit(val);
          if (cursor) cursor.classList.remove("is-typing");
        }
      });

      input.addEventListener("input", function () {
        if (cursor) cursor.classList.toggle("is-typing", input.value.length > 0);
      });

      function attachItemClick() {
        document.querySelectorAll(".server-pick-item").forEach(function (item) {
          if (item.dataset.pickBound === "1") return;
          item.dataset.pickBound = "1";
          item.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            var id = item.getAttribute("data-server-id");
            var s = null;
            for (var i = 0; i < serversData.length; i++) {
              if (serversData[i].id === id) { s = serversData[i]; break; }
            }
            if (!s) { line("could not resolve clicked server", "error"); return; }
            highlightServer(s.id);
            input.value = s.name;
            line("→ connecting to #" + s.idx + " " + s.name + "  (/" + s.id + "/stats)", "info");
            setTimeout(function () {
              window.location.href = buildTarget(s.id);
            }, 220);
          });
        });
      }
      attachItemClick();

      var moPick = new MutationObserver(function () { attachItemClick(); });
      moPick.observe(document.body, { childList: true, subtree: true });

      document.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var inTerminal = t.closest(".server-pick-terminal");
        var inRail = t.closest(".server-pick-rail");
        var inItem = t.closest(".server-pick-item");
        if ((inTerminal || inRail) && !inItem) {
          setTimeout(function () { input.focus(); }, 0);
        }
      });

      setTimeout(function () { input.focus(); }, 30);

      window.__nwhelpPick = { servers: serversData, run: handleSubmit, echo: line, goto: function (id) {
        for (var i = 0; i < serversData.length; i++) {
          if (serversData[i].id === id) { handleSubmit("goto " + serversData[i].name); return; }
        }
      }};
      console.log("[nwhelper] server picker ready:", serversData.length, "server(s)");
      } catch (err) {
        console.error("[nwhelper] server picker init failed:", err);
      }
    })();
    } catch (err) {
      console.error("[nwhelper] os shell error:", err);
    }
  })();
  </script>`;
}

export function renderWindow(title: string, body: string, options: { prompt?: string; tone?: "cyan" | "pink" | "magenta" | "green" | "yellow" | "orange" | "aqua" | "blue"; id?: string } = {}): string {
  const tone = options.tone ?? "cyan";
  const prompt = options.prompt ?? "nwhelper@os";
  const idAttr = options.id ? ` id="${escapeHtml(options.id)}" data-window-id="${escapeHtml(options.id)}"` : "";
  return `<section class="os-window" data-window${idAttr}>
    <header class="window-titlebar">
      <span class="win-tab t-${tone}"><span class="win-tab-icon">▶</span><span>${escapeHtml(title)}</span></span>
      <span class="win-spacer"></span>
      <span class="win-meta"><span class="sep">┌──(</span>${escapeHtml(prompt)}<span class="sep">)</span></span>
      <button class="win-min" type="button" data-win-action="min" title="minimize" aria-label="minimize">─</button>
      <button class="win-close" type="button" data-win-action="close" title="close" aria-label="close">×</button>
    </header>
    <div class="window-body">${body}</div>
  </section>`;
}

export function renderPromptLine(parts: { user?: string; host?: string; path?: string; suffix?: string } = {}): string {
  const user = parts.user ?? "nwhelper";
  const host = parts.host ?? "os";
  const path = parts.path ?? "~";
  return `<div class="prompt-line"><span class="user">${escapeHtml(user)}</span>@<span class="host">${escapeHtml(host)}</span>:<span class="path">${escapeHtml(path)}</span><span class="arrow">$</span>${parts.suffix ? `<span class="suffix">${escapeHtml(parts.suffix)}</span>` : ""}</div>`;
}

export function renderTerminal(lines: Array<{ kind?: "key" | "val" | "comment" | "success" | "warn" | "error" | "info" | "magenta" | "pink" | "plain"; text: string }>): string {
  return `<pre class="terminal-block">${lines.map((line) => `<span class="t-line"><span class="t-${line.kind ?? "plain"}">${escapeHtml(line.text)}</span></span>`).join("")}</pre>`;
}

export function renderCountdownScript(): string {
  return `<script>
    (() => {
      const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
      const update = () => document.querySelectorAll("[data-countdown]").forEach((node) => {
        const remaining = Number(node.dataset.countdown) - Date.now();
        const units = Math.abs(remaining) >= 86400000 ? ["day", 86400000] : Math.abs(remaining) >= 3600000 ? ["hour", 3600000] : ["minute", 60000];
        node.textContent = formatter.format(Math.round(remaining / units[1]), units[0]);
      });
      update();
      window.setInterval(update, 60000);
    })();
  </script>`;
}

export function renderWebError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The request could not be completed.";
  const inner = `<main class="shell narrow-shell"><section class="empty-state"><p class="eyebrow">Request failed</p><h1>Could not save raid</h1><p>${escapeHtml(message)}</p><a class="button button-secondary" href="/">Return to dashboard</a></section></main>`;
  return `${renderWindow("error", inner, { prompt: "athena@os" })}`;
}
