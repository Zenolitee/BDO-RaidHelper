import { escapeHtml } from '../utils.js';
import { renderApp } from './layout.js';
import type { WebSession, GuildDashboardSummary } from '../types.js';

export function renderDocsPage(
  session: WebSession,
  summaries?: GuildDashboardSummary[]
): string {
  const sidebarNav = [
    { id: "setup", label: "Bot Setup", icon: "⚙️", color: "var(--color-indigo)" },
    { id: "events", label: "Events & Rosters", icon: "📋", color: "var(--color-cyan)" },
    { id: "gbr", label: "Guild Boss Raid", icon: "🐉", color: "var(--color-amber)" },
    { id: "scores", label: "Scoreboard OCR", icon: "📊", color: "var(--color-emerald)" },
    { id: "ikusa", label: "Ikusa Combat Logs", icon: "⚔️", color: "var(--color-rose)" },
    { id: "performance", label: "Guild Performance", icon: "📈", color: "var(--color-violet)" },
    { id: "attendance", label: "Attendance", icon: "✅", color: "var(--color-teal)" },
    { id: "guild-activity", label: "Guild Activity", icon: "🏰", color: "var(--color-orange)" },
    { id: "dashboard", label: "Web Dashboard", icon: "🌐", color: "var(--color-sky)" },
    { id: "commands", label: "Commands", icon: "⌨️", color: "var(--color-pink)" },
    { id: "faq", label: "FAQ", icon: "❓", color: "var(--color-lime)" },
  ].map(item => 
    `<li>
      <a href="#" class="docs-nav-link" data-section="${item.id}" style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);color:var(--text-secondary);text-decoration:none;font-size:var(--text-sm);border-radius:var(--radius-md);transition:all 0.2s ease;border-left:3px solid transparent;">
        <span style="font-size:1.1em;">${item.icon}</span>
        <span>${item.label}</span>
      </a>
    </li>`
  ).join("");

  const content = `
    <section class="page-content" style="max-width:1200px;">
      <!-- Header with gradient -->
      <div style="background:linear-gradient(135deg, var(--color-indigo) 0%, var(--color-violet) 100%);border-radius:var(--radius-xl);padding:var(--space-8);margin-bottom:var(--space-6);color:white;">
        <a class="button button-ghost button-sm" href="/dashboard" style="color:white;border:1px solid rgba(255,255,255,0.3);margin-bottom:var(--space-4);">← Dashboard</a>
        <h1 style="font-size:var(--text-2xl);font-weight:700;margin:0;">📖 Project Athena Docs</h1>
        <p style="color:rgba(255,255,255,0.85);margin-top:var(--space-2);font-size:var(--text-sm);">Everything you need to set up and use the bot for your guild.</p>
      </div>

      <div style="display:flex;gap:var(--space-6);align-items:flex-start;">
        <!-- Sidebar Navigation -->
        <nav class="docs-sidebar" style="position:sticky;top:var(--space-8);min-width:220px;max-width:240px;flex-shrink:0;padding:var(--space-4);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);background:var(--surface);">
          <strong style="display:block;font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--space-3);padding-left:var(--space-3);">Navigation</strong>
          <ul style="list-style:none;padding:0;margin:0;">
            ${sidebarNav}
          </ul>
        </nav>

        <!-- Main Content -->
        <div class="docs-content" style="flex:1;min-width:0;">

      <!-- Bot Setup -->
      <article id="section-setup" class="docs-section" style="display:block;">
        <div style="background:linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(139,92,246,0.1) 100%);border-left:4px solid var(--color-indigo);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:var(--space-6);margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <span style="font-size:2em;">⚙️</span>
            <h2 style="margin:0;color:var(--color-indigo);">Bot Setup</h2>
          </div>
          <p>Project Athena is a Discord bot that manages node war rosters, tracks attendance, and provides analytics for your BDO guild.</p>
        </div>
        
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:var(--space-4);">
          <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-5);">
            <h3 style="margin-top:0;color:var(--color-indigo);">🚀 Installation</h3>
            <ol style="padding-left:var(--space-5);line-height:2.2;font-size:var(--text-sm);margin:0;">
              <li>Invite the bot to your Discord server using the OAuth2 link</li>
              <li>Assign the bot a role with <strong>Manage Channels</strong> permission</li>
              <li>Use <code style="background:var(--surface-elevated);padding:2px 8px;border-radius:4px;font-size:0.85em;color:var(--color-indigo);">/setup</code> in your announcement channel</li>
            </ol>
          </div>
          <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-5);">
            <h3 style="margin-top:0;color:var(--color-violet);">🔧 Configuration</h3>
            <p style="font-size:var(--text-sm);line-height:1.7;">Set your node war channel, announcement roles, and war schedule through the dashboard or bot commands.</p>
          </div>
        </div>
      </article>

      <!-- Events & Rosters -->
      <article id="section-events" class="docs-section" style="display:none;">
        <div style="background:linear-gradient(135deg, rgba(6,182,212,0.1) 0%, rgba(34,211,238,0.1) 100%);border-left:4px solid var(--color-cyan);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:var(--space-6);margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <span style="font-size:2em;">📋</span>
            <h2 style="margin:0;color:var(--color-cyan);">Events & Rosters</h2>
          </div>
          <p>Events represent individual node wars or siege sessions. Each event has signups organized into groups.</p>
        </div>
        
        <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-5);">
          <h3 style="margin-top:0;color:var(--color-cyan);">📝 How it works</h3>
          <ul style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);list-style:none;">
            <li style="position:relative;padding-left:var(--space-6);">• Officers create events with <code style="background:var(--surface-elevated);padding:2px 8px;border-radius:4px;font-size:0.85em;color:var(--color-cyan);">/event create</code></li>
            <li style="position:relative;padding-left:var(--space-6);">• Members sign up by clicking buttons on the event message</li>
            <li style="position:relative;padding-left:var(--space-6);">• Groups have capacity limits — once full, new signups go to a bench</li>
            <li style="position:relative;padding-left:var(--space-6);">• Announcements can be auto-posted to your war channel</li>
          </ul>
        </div>
        
        <div style="background:linear-gradient(135deg, rgba(6,182,212,0.05) 0%, rgba(34,211,238,0.05) 100%);border:1px solid rgba(6,182,212,0.2);border-radius:var(--radius-lg);padding:var(--space-5);margin-top:var(--space-4);">
          <h3 style="margin-top:0;color:var(--color-cyan);">👥 Groups</h3>
          <p style="font-size:var(--text-sm);line-height:1.7;">Default groups are Main, Alt, and Bench. Officers can customize group names, capacity, and emojis.</p>
        </div>
      </article>

      <!-- Guild Boss Raid (GBR) -->
      <article id="section-gbr" class="docs-section" style="display:none;">
        <div style="background:linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(251,191,36,0.1) 100%);border-left:4px solid var(--color-amber);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:var(--space-6);margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <span style="font-size:2em;">🐉</span>
            <h2 style="margin:0;color:var(--color-amber);">Guild Boss Raid (GBR)</h2>
          </div>
          <p>Guild Boss Raids are scheduled boss encounters with a configurable kill order. The bot posts an announcement with a countdown and pings roles 5 minutes before the raid.</p>
        </div>
        
        <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-5);margin-bottom:var(--space-4);">
          <h3 style="margin-top:0;color:var(--color-amber);">🎯 Creating a GBR Event</h3>
          <ol style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);margin:0;">
            <li>Use <code style="background:var(--surface-elevated);padding:2px 8px;border-radius:4px;font-size:0.85em;color:var(--color-amber);">/event create</code> and select <strong>Guild Boss Raid (GBR)</strong></li>
            <li>Select the day(s) for the raid (including Saturday)</li>
            <li>Arrange the 5 bosses in your desired kill order</li>
            <li>Set the event time (the bot announces 5 minutes before)</li>
            <li>Choose to repeat weekly or run once</li>
            <li>Select roles to ping (optional)</li>
            <li>Confirm to schedule the event</li>
          </ol>
        </div>
        
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:var(--space-3);margin-bottom:var(--space-4);">
          <div style="background:linear-gradient(135deg, var(--color-amber) 0%, var(--color-orange) 100%);border-radius:var(--radius-lg);padding:var(--space-4);text-align:center;color:white;">
            <div style="font-size:1.5em;margin-bottom:var(--space-1);">1️⃣</div>
            <div style="font-weight:600;font-size:var(--text-sm);">Org</div>
          </div>
          <div style="background:linear-gradient(135deg, var(--color-amber) 0%, var(--color-orange) 100%);border-radius:var(--radius-lg);padding:var(--space-4);text-align:center;color:white;">
            <div style="font-size:1.5em;margin-bottom:var(--space-1);">2️⃣</div>
            <div style="font-weight:600;font-size:var(--text-sm);">Mudster</div>
          </div>
          <div style="background:linear-gradient(135deg, var(--color-amber) 0%, var(--color-orange) 100%);border-radius:var(--radius-lg);padding:var(--space-4);text-align:center;color:white;">
            <div style="font-size:1.5em;margin-bottom:var(--space-1);">3️⃣</div>
            <div style="font-weight:600;font-size:var(--text-sm);">Ferrid</div>
          </div>
          <div style="background:linear-gradient(135deg, var(--color-amber) 0%, var(--color-orange) 100%);border-radius:var(--radius-lg);padding:var(--space-4);text-align:center;color:white;">
            <div style="font-size:1.5em;margin-bottom:var(--space-1);">4️⃣</div>
            <div style="font-weight:600;font-size:var(--text-sm);">Moghulis</div>
          </div>
          <div style="background:linear-gradient(135deg, var(--color-amber) 0%, var(--color-orange) 100%);border-radius:var(--radius-lg);padding:var(--space-4);text-align:center;color:white;">
            <div style="font-size:1.5em;margin-bottom:var(--space-1);">5️⃣</div>
            <div style="font-weight:600;font-size:var(--text-sm);">Khan</div>
          </div>
        </div>
        
        <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-5);">
          <h3 style="margin-top:0;color:var(--color-amber);">⚡ How it works</h3>
          <ul style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);list-style:none;">
            <li>• The bot posts an announcement embed showing the date, time, and boss order</li>
            <li>• 5 minutes before the raid, the bot <strong>edits the same message</strong> to add role pings</li>
            <li>• This keeps everything in one message — no duplicates!</li>
            <li>• After the raid window closes, the event is marked as closed</li>
            <li>• Weekly events automatically roll to the next occurrence</li>
          </ul>
        </div>
      </article>

      <!-- Scoreboard OCR -->
      <article id="section-scores" class="docs-section" style="display:none;">
        <div style="background:linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(52,211,153,0.1) 100%);border-left:4px solid var(--color-emerald);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:var(--space-6);margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <span style="font-size:2em;">📊</span>
            <h2 style="margin:0;color:var(--color-emerald);">Scoreboard OCR</h2>
          </div>
          <p>Upload a screenshot of the post-war scoreboard and Project Athena will extract player stats automatically.</p>
        </div>
        
        <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-5);margin-bottom:var(--space-4);">
          <h3 style="margin-top:0;color:var(--color-emerald);">📤 How to upload</h3>
          <ol style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);margin:0;">
            <li>Go to the dashboard → your server → Player Stats or War History</li>
            <li>Click "Upload Scoreboard"</li>
            <li>Select your screenshot (PNG/JPG)</li>
            <li>Set the war date and result (win/loss)</li>
            <li>Review the extracted data and confirm</li>
          </ol>
        </div>
        
        <div style="background:linear-gradient(135deg, rgba(16,185,129,0.05) 0%, rgba(52,211,153,0.05) 100%);border:1px solid rgba(16,185,129,0.2);border-radius:var(--radius-lg);padding:var(--space-5);">
          <h3 style="margin-top:0;color:var(--color-emerald);">📈 Extracted data</h3>
          <p style="font-size:var(--text-sm);line-height:1.7;">For each player: kills, deaths, assists, damage dealt/taken, CCs, healing, support, structure damage, siege stats, and time alive.</p>
        </div>
      </article>

      <!-- Ikusa -->
      <article id="section-ikusa" class="docs-section" style="display:none;">
        <div style="background:linear-gradient(135deg, rgba(244,63,94,0.1) 0%, rgba(251,113,133,0.1) 100%);border-left:4px solid var(--color-rose);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:var(--space-6);margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <span style="font-size:2em;">⚔️</span>
            <h2 style="margin:0;color:var(--color-rose);">Ikusa Combat Logs</h2>
          </div>
          <p><a href="https://github.com/sch-28/ikusa_logger" style="color:var(--color-rose);font-weight:500;" target="_blank">Ikusa Logger</a> is an open-source network sniffer that captures full combat events during node wars.</p>
        </div>
        
        <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-5);margin-bottom:var(--space-4);">
          <h3 style="margin-top:0;color:var(--color-rose);">🛠️ Setup</h3>
          <ol style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);margin:0;">
            <li>Install prerequisites: <a href="https://npcap.com/dist/" style="color:var(--color-rose);">Npcap 1.7.8</a>, Node.js 16+, Python 3+</li>
            <li>Clone the <a href="https://github.com/sch-28/ikusa_logger" style="color:var(--color-rose);">ikusa_logger</a> repository</li>
            <li>Run <code style="background:var(--surface-elevated);padding:2px 8px;border-radius:4px;font-size:0.85em;color:var(--color-rose);">build.bat</code> (Windows) or <code style="background:var(--surface-elevated);padding:2px 8px;border-radius:4px;font-size:0.85em;color:var(--color-rose);">build.sh</code> (Linux)</li>
            <li>Start the logger before node war begins</li>
            <li>After war, save or upload the logs</li>
          </ol>
        </div>
        
        <div style="background:linear-gradient(135deg, rgba(244,63,94,0.05) 0%, rgba(251,113,133,0.05) 100%);border:1px solid rgba(244,63,94,0.2);border-radius:var(--radius-lg);padding:var(--space-5);">
          <h3 style="margin-top:0;color:var(--color-rose);">🎯 What it captures</h3>
          <p style="font-size:var(--text-sm);line-height:1.7;">Kill/death events with timestamps, player names, guild names, and the full event timeline. This data feeds into the Guild Performance dashboard.</p>
        </div>
      </article>

      <!-- Guild Performance -->
      <article id="section-performance" class="docs-section" style="display:none;">
        <div style="background:linear-gradient(135deg, rgba(139,92,246,0.1) 0%, rgba(167,139,250,0.1) 100%);border-left:4px solid var(--color-violet);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:var(--space-6);margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <span style="font-size:2em;">📈</span>
            <h2 style="margin:0;color:var(--color-violet);">Guild Performance</h2>
          </div>
          <p>Analytics dashboard powered by score reports and combat logs.</p>
        </div>
        
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:var(--space-4);">
          <div style="background:linear-gradient(135deg, var(--color-violet) 0%, var(--color-purple) 100%);border-radius:var(--radius-lg);padding:var(--space-5);color:white;">
            <div style="font-size:1.5em;margin-bottom:var(--space-2);">🏆</div>
            <h4 style="margin:0 0 var(--space-1);">Win Rate</h4>
            <p style="margin:0;font-size:var(--text-xs);opacity:0.9;">Percentage of wars won</p>
          </div>
          <div style="background:linear-gradient(135deg, var(--color-violet) 0%, var(--color-purple) 100%);border-radius:var(--radius-lg);padding:var(--space-5);color:white;">
            <div style="font-size:1.5em;margin-bottom:var(--space-2);">💀</div>
            <h4 style="margin:0 0 var(--space-1);">Avg K/D</h4>
            <p style="margin:0;font-size:var(--text-xs);opacity:0.9;">Guild-wide kill/death ratio</p>
          </div>
          <div style="background:linear-gradient(135deg, var(--color-violet) 0%, var(--color-purple) 100%);border-radius:var(--radius-lg);padding:var(--space-5);color:white;">
            <div style="font-size:1.5em;margin-bottom:var(--space-2);">🎯</div>
            <h4 style="margin:0 0 var(--space-1);">Top Fragger</h4>
            <p style="margin:0;font-size:var(--text-xs);opacity:0.9;">Player with most total kills</p>
          </div>
          <div style="background:linear-gradient(135deg, var(--color-violet) 0%, var(--color-purple) 100%);border-radius:var(--radius-lg);padding:var(--space-5);color:white;">
            <div style="font-size:1.5em;margin-bottom:var(--space-2);">📋</div>
            <h4 style="margin:0 0 var(--space-1);">Leaderboard</h4>
            <p style="margin:0;font-size:var(--text-xs);opacity:0.9;">Ranked by kills, K/D, damage</p>
          </div>
        </div>
      </article>

      <!-- Attendance -->
      <article id="section-attendance" class="docs-section" style="display:none;">
        <div style="background:linear-gradient(135deg, rgba(20,184,166,0.1) 0%, rgba(45,212,191,0.1) 100%);border-left:4px solid var(--color-teal);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:var(--space-6);margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <span style="font-size:2em;">✅</span>
            <h2 style="margin:0;color:var(--color-teal);">Attendance Tracking</h2>
          </div>
          <p>Visual attendance grid showing player participation across node wars.</p>
        </div>
        
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
          <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-5);">
            <h3 style="margin-top:0;color:var(--color-teal);">📊 How it works</h3>
            <p style="font-size:var(--text-sm);line-height:1.7;">The grid shows dates as rows and players as columns. Green cells indicate attendance (from signups or score reports). The attendance rate shows what percentage of wars each player attended.</p>
          </div>
          <div style="background:linear-gradient(135deg, rgba(20,184,166,0.05) 0%, rgba(45,212,191,0.05) 100%);border:1px solid rgba(20,184,166,0.2);border-radius:var(--radius-lg);padding:var(--space-5);">
            <h3 style="margin-top:0;color:var(--color-teal);">🔗 Data sources</h3>
            <ul style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);list-style:none;margin:0;">
              <li>• <strong>Event signups</strong> — who signed up for each war</li>
              <li>• <strong>Score reports</strong> — who appeared in the post-war scoreboard</li>
            </ul>
          </div>
        </div>
      </article>

      <!-- Guild Activity -->
      <article id="section-guild-activity" class="docs-section" style="display:none;">
        <div style="background:linear-gradient(135deg, rgba(249,115,22,0.1) 0%, rgba(251,146,60,0.1) 100%);border-left:4px solid var(--color-orange);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:var(--space-6);margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <span style="font-size:2em;">🏰</span>
            <h2 style="margin:0;color:var(--color-orange);">Guild Activity (BDO API)</h2>
          </div>
          <p>View your BDO guild profile pulled from the official Pearl Abyss website or the BDO Community API.</p>
        </div>
        
        <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-5);margin-bottom:var(--space-4);">
          <h3 style="margin-top:0;color:var(--color-orange);">🌍 Supported regions</h3>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
            <span style="background:var(--color-orange);color:white;padding:4px 12px;border-radius:var(--radius-full);font-size:var(--text-xs);font-weight:500;">EU</span>
            <span style="background:var(--color-orange);color:white;padding:4px 12px;border-radius:var(--radius-full);font-size:var(--text-xs);font-weight:500;">NA</span>
            <span style="background:var(--color-orange);color:white;padding:4px 12px;border-radius:var(--radius-full);font-size:var(--text-xs);font-weight:500;">SA</span>
            <span style="background:var(--color-orange);color:white;padding:4px 12px;border-radius:var(--radius-full);font-size:var(--text-xs);font-weight:500;">KR</span>
            <span style="background:var(--color-orange);color:white;padding:4px 12px;border-radius:var(--radius-full);font-size:var(--text-xs);font-weight:500;">ASIA</span>
          </div>
        </div>
        
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
          <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-5);">
            <h3 style="margin-top:0;color:var(--color-orange);">⚙️ Setup</h3>
            <p style="font-size:var(--text-sm);line-height:1.7;">Go to Guild Activity in the dashboard, enter your BDO guild name and region. The guild must exist on the BDO website for that region.</p>
          </div>
          <div style="background:linear-gradient(135deg, rgba(249,115,22,0.05) 0%, rgba(251,146,60,0.05) 100%);border:1px solid rgba(249,115,22,0.2);border-radius:var(--radius-lg);padding:var(--space-5);">
            <h3 style="margin-top:0;color:var(--color-orange);">📋 Data shown</h3>
            <p style="font-size:var(--text-sm);line-height:1.7;">Guild name, region, creation date, guild master, member count, and territory occupation.</p>
          </div>
        </div>
      </article>

      <!-- Dashboard -->
      <article id="section-dashboard" class="docs-section" style="display:none;">
        <div style="background:linear-gradient(135deg, rgba(14,165,233,0.1) 0%, rgba(56,189,248,0.1) 100%);border-left:4px solid var(--color-sky);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:var(--space-6);margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <span style="font-size:2em;">🌐</span>
            <h2 style="margin:0;color:var(--color-sky);">Web Dashboard</h2>
          </div>
          <p>The dashboard is your central hub for managing everything.</p>
        </div>
        
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:var(--space-3);">
          <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-4);text-align:center;">
            <div style="font-size:1.5em;margin-bottom:var(--space-2);">📋</div>
            <div style="font-weight:600;font-size:var(--text-sm);">Events</div>
            <div style="font-size:var(--text-xs);color:var(--text-muted);">Manage rosters</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-4);text-align:center;">
            <div style="font-size:1.5em;margin-bottom:var(--space-2);">📊</div>
            <div style="font-weight:600;font-size:var(--text-sm);">Player Stats</div>
            <div style="font-size:var(--text-xs);color:var(--text-muted);">Individual performance</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-4);text-align:center;">
            <div style="font-size:1.5em;margin-bottom:var(--space-2);">📜</div>
            <div style="font-weight:600;font-size:var(--text-sm);">War History</div>
            <div style="font-size:var(--text-xs);color:var(--text-muted);">Past scoreboards</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-4);text-align:center;">
            <div style="font-size:1.5em;margin-bottom:var(--space-2);">📈</div>
            <div style="font-weight:600;font-size:var(--text-sm);">Performance</div>
            <div style="font-size:var(--text-xs);color:var(--text-muted);">War analytics</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-4);text-align:center;">
            <div style="font-size:1.5em;margin-bottom:var(--space-2);">✅</div>
            <div style="font-weight:600;font-size:var(--text-sm);">Attendance</div>
            <div style="font-size:var(--text-xs);color:var(--text-muted);">Participation grid</div>
          </div>
        </div>
        
        <div style="background:linear-gradient(135deg, rgba(14,165,233,0.05) 0%, rgba(56,189,248,0.05) 100%);border:1px solid rgba(14,165,233,0.2);border-radius:var(--radius-lg);padding:var(--space-5);margin-top:var(--space-4);">
          <h3 style="margin-top:0;color:var(--color-sky);">🔐 Access</h3>
          <p style="font-size:var(--text-sm);line-height:1.7;">Sign in with your Discord account. Admin features (score uploads, settings) require Manage Server or Administrator permissions.</p>
        </div>
      </article>

      <!-- Commands -->
      <article id="section-commands" class="docs-section" style="display:none;">
        <div style="background:linear-gradient(135deg, rgba(236,72,153,0.1) 0%, rgba(244,114,182,0.1) 100%);border-left:4px solid var(--color-pink);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:var(--space-6);margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <span style="font-size:2em;">⌨️</span>
            <h2 style="margin:0;color:var(--color-pink);">Bot Commands</h2>
          </div>
          <p>All available slash commands for managing your guild.</p>
        </div>
        
        <div style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-5);overflow-x:auto;">
          <table class="table" style="font-size:var(--text-sm);margin:0;">
            <thead>
              <tr style="border-bottom:2px solid var(--color-pink);">
                <th style="color:var(--color-pink);">Command</th>
                <th style="color:var(--color-pink);">Description</th>
                <th style="color:var(--color-pink);">Permission</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code style="background:rgba(236,72,153,0.1);padding:4px 10px;border-radius:4px;font-size:0.85em;color:var(--color-pink);">/event create</code></td><td>Create a new event (Node War, GBR, or Custom)</td><td><span style="background:var(--color-pink);color:white;padding:2px 8px;border-radius:var(--radius-full);font-size:var(--text-xs);">Admin</span></td></tr>
              <tr><td><code style="background:rgba(236,72,153,0.1);padding:4px 10px;border-radius:4px;font-size:0.85em;color:var(--color-pink);">/event edit</code></td><td>Edit an existing event</td><td><span style="background:var(--color-pink);color:white;padding:2px 8px;border-radius:var(--radius-full);font-size:var(--text-xs);">Admin</span></td></tr>
              <tr><td><code style="background:rgba(236,72,153,0.1);padding:4px 10px;border-radius:4px;font-size:0.85em;color:var(--color-pink);">/event list</code></td><td>List upcoming events</td><td><span style="background:var(--color-emerald);color:white;padding:2px 8px;border-radius:var(--radius-full);font-size:var(--text-xs);">Anyone</span></td></tr>
              <tr><td><code style="background:rgba(236,72,153,0.1);padding:4px 10px;border-radius:4px;font-size:0.85em;color:var(--color-pink);">/event show</code></td><td>Show event information</td><td><span style="background:var(--color-emerald);color:white;padding:2px 8px;border-radius:var(--radius-full);font-size:var(--text-xs);">Anyone</span></td></tr>
              <tr><td><code style="background:rgba(236,72,153,0.1);padding:4px 10px;border-radius:4px;font-size:0.85em;color:var(--color-pink);">/event delete</code></td><td>Delete an event</td><td><span style="background:var(--color-pink);color:white;padding:2px 8px;border-radius:var(--radius-full);font-size:var(--text-xs);">Admin</span></td></tr>
              <tr><td><code style="background:rgba(236,72,153,0.1);padding:4px 10px;border-radius:4px;font-size:0.85em;color:var(--color-pink);">/event close</code></td><td>Close an event to prevent new signups</td><td><span style="background:var(--color-pink);color:white;padding:2px 8px;border-radius:var(--radius-full);font-size:var(--text-xs);">Admin</span></td></tr>
              <tr><td><code style="background:rgba(236,72,153,0.1);padding:4px 10px;border-radius:4px;font-size:0.85em;color:var(--color-pink);">/event repost</code></td><td>Repost an event to the war channel</td><td><span style="background:var(--color-pink);color:white;padding:2px 8px;border-radius:var(--radius-full);font-size:var(--text-xs);">Admin</span></td></tr>
              <tr><td><code style="background:rgba(236,72,153,0.1);padding:4px 10px;border-radius:4px;font-size:0.85em;color:var(--color-pink);">/set-nwchannel</code></td><td>Set current channel as Node War channel</td><td><span style="background:var(--color-pink);color:white;padding:2px 8px;border-radius:var(--radius-full);font-size:var(--text-xs);">Admin</span></td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <!-- FAQ -->
      <article id="section-faq" class="docs-section" style="display:none;">
        <div style="background:linear-gradient(135deg, rgba(132,204,22,0.1) 0%, rgba(163,230,53,0.1) 100%);border-left:4px solid var(--color-lime);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:var(--space-6);margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <span style="font-size:2em;">❓</span>
            <h2 style="margin:0;color:var(--color-lime);">FAQ</h2>
          </div>
          <p>Frequently asked questions about Project Athena.</p>
        </div>

        <div style="display:flex;flex-direction:column;gap:var(--space-3);">
          <details style="padding:var(--space-4);border:1px solid rgba(132,204,22,0.3);border-radius:var(--radius-lg);background:var(--surface);transition:all 0.2s ease;">
            <summary style="cursor:pointer;font-weight:600;font-size:var(--text-sm);color:var(--color-lime);list-style:none;display:flex;align-items:center;gap:var(--space-2);">
              <span>🔗</span> How do I link my Discord to my BDO character?
            </summary>
            <p style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--text-muted);line-height:1.7;">Currently, attendance uses your Discord display name. Score reports use BDO family names from OCR. A name mapping feature is planned to link Discord accounts to BDO characters.</p>
          </details>

          <details style="padding:var(--space-4);border:1px solid rgba(132,204,22,0.3);border-radius:var(--radius-lg);background:var(--surface);transition:all 0.2s ease;">
            <summary style="cursor:pointer;font-weight:600;font-size:var(--text-sm);color:var(--color-lime);list-style:none;display:flex;align-items:center;gap:var(--space-2);">
              <span>🌍</span> What regions are supported for Guild Activity?
            </summary>
            <p style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--text-muted);line-height:1.7;">EU, NA, SA, KR via the BDO Community API, and ASIA (TH/SEA) via direct scraping of the Pearl Abyss website.</p>
          </details>

          <details style="padding:var(--space-4);border:1px solid rgba(132,204,22,0.3);border-radius:var(--radius-lg);background:var(--surface);transition:all 0.2s ease;">
            <summary style="cursor:pointer;font-weight:600;font-size:var(--text-sm);color:var(--color-lime);list-style:none;display:flex;align-items:center;gap:var(--space-2);">
              <span>📸</span> How accurate is the scoreboard OCR?
            </summary>
            <p style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--text-muted);line-height:1.7;">Accuracy depends on screenshot quality. Clear, full-screen screenshots work best. You can review and edit the extracted data before saving.</p>
          </details>

          <details style="padding:var(--space-4);border:1px solid rgba(132,204,22,0.3);border-radius:var(--radius-lg);background:var(--surface);transition:all 0.2s ease;">
            <summary style="cursor:pointer;font-weight:600;font-size:var(--text-sm);color:var(--color-lime);list-style:none;display:flex;align-items:center;gap:var(--space-2);">
              <span>⚔️</span> Can I use this for siege wars?
            </summary>
            <p style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--text-muted);line-height:1.7;">Yes. Create an event with kind "siege" and the workflow is the same as node wars.</p>
          </details>

          <details style="padding:var(--space-4);border:1px solid rgba(132,204,22,0.3);border-radius:var(--radius-lg);background:var(--surface);transition:all 0.2s ease;">
            <summary style="cursor:pointer;font-weight:600;font-size:var(--text-sm);color:var(--color-lime);list-style:none;display:flex;align-items:center;gap:var(--space-2);">
              <span>💾</span> Where is the data stored?
            </summary>
            <p style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--text-muted);line-height:1.7;">Events and settings are stored locally in a JSON file. Score reports and images are stored in Supabase (PostgreSQL + S3).</p>
          </details>
        </div>
      </article>

        </div>
      </div>
    </section>

    <style>
      .docs-nav-link:hover {
        background: var(--surface-elevated) !important;
        color: var(--accent) !important;
        border-left-color: var(--accent) !important;
      }
      .docs-nav-link.active {
        background: var(--surface-elevated) !important;
        color: var(--accent) !important;
        font-weight: 500;
        border-left-color: var(--accent) !important;
      }
      .docs-section {
        animation: fadeIn 0.3s ease;
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @media (max-width: 768px) {
        .docs-sidebar { display: none !important; }
        .docs-content { padding: 0 !important; }
      }
    </style>
    <script>
      (function() {
        const navLinks = document.querySelectorAll('.docs-nav-link');
        const sections = document.querySelectorAll('.docs-section');
        
        function showSection(sectionId) {
          // Hide all sections
          sections.forEach(s => s.style.display = 'none');
          // Show the target section
          const target = document.getElementById('section-' + sectionId);
          if (target) target.style.display = 'block';
          
          // Update active state on nav links
          navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.dataset.section === sectionId) {
              link.classList.add('active');
            }
          });
        }
        
        // Add click handlers to nav links
        navLinks.forEach(link => {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = link.dataset.section;
            showSection(sectionId);
            // Save to localStorage
            localStorage.setItem('docs-active-section', sectionId);
          });
        });
        
        // Restore from localStorage or default to 'setup'
        const savedSection = localStorage.getItem('docs-active-section') || 'setup';
        showSection(savedSection);
      })();
    </script>
  `;

  return renderApp('Documentation — Project Athena', content, { session, summaries, activeNav: 'dashboard' });
}
