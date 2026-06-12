import { escapeHtml } from '../utils.js';
import { renderApp } from './layout.js';
import type { WebSession, GuildDashboardSummary } from '../types.js';

export function renderDocsPage(
  session: WebSession,
  summaries?: GuildDashboardSummary[]
): string {
  const content = `
    <section class="page-content dash-layout" style="max-width:860px;">
      <div class="dash-header" style="text-align:left;">
        <a class="button button-ghost button-sm" href="/dashboard">← Dashboard</a>
        <p class="landing-kicker" style="margin-top:var(--space-4);">Documentation</p>
        <h1>Project Athena</h1>
        <p style="color:var(--text-muted);margin-top:var(--space-2);">Everything you need to set up and use the bot for your guild.</p>
      </div>

      <!-- Table of Contents -->
      <nav class="docs-toc" style="margin-top:var(--space-6);padding:var(--space-4) var(--space-5);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);background:var(--surface);">
        <strong style="font-size:var(--text-sm);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Contents</strong>
        <ul style="margin:var(--space-3) 0 0;padding-left:var(--space-5);list-style:disc;font-size:var(--text-sm);line-height:2;">
          <li><a href="#setup" style="color:var(--accent);text-decoration:none;">Bot Setup</a></li>
          <li><a href="#events" style="color:var(--accent);text-decoration:none;">Events &amp; Rosters</a></li>
          <li><a href="#scores" style="color:var(--accent);text-decoration:none;">Scoreboard OCR</a></li>
          <li><a href="#ikusa" style="color:var(--accent);text-decoration:none;">Ikusa Combat Logs</a></li>
          <li><a href="#performance" style="color:var(--accent);text-decoration:none;">Guild Performance</a></li>
          <li><a href="#attendance" style="color:var(--accent);text-decoration:none;">Attendance Tracking</a></li>
          <li><a href="#guild-activity" style="color:var(--accent);text-decoration:none;">Guild Activity (BDO API)</a></li>
          <li><a href="#dashboard" style="color:var(--accent);text-decoration:none;">Web Dashboard</a></li>
          <li><a href="#commands" style="color:var(--accent);text-decoration:none;">Bot Commands</a></li>
          <li><a href="#faq" style="color:var(--accent);text-decoration:none;">FAQ</a></li>
        </ul>
      </nav>

      <!-- Bot Setup -->
      <article id="setup" class="docs-section" style="margin-top:var(--space-8);">
        <h2>Bot Setup</h2>
        <p>Project Athena is a Discord bot that manages node war rosters, tracks attendance, and provides analytics for your BDO guild.</p>
        <h3>Installation</h3>
        <ol style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);">
          <li>Invite the bot to your Discord server using the OAuth2 link</li>
          <li>Assign the bot a role with <strong>Manage Channels</strong> permission</li>
          <li>Use <code style="background:var(--surface-elevated);padding:2px 6px;border-radius:4px;font-size:0.8em;">/setup</code> in your announcement channel</li>
        </ol>
        <h3>Configuration</h3>
        <p style="font-size:var(--text-sm);">Set your node war channel, announcement roles, and war schedule through the dashboard or bot commands.</p>
      </article>

      <!-- Events & Rosters -->
      <article id="events" class="docs-section" style="margin-top:var(--space-8);">
        <h2>Events &amp; Rosters</h2>
        <p>Events represent individual node wars or siege sessions. Each event has signups organized into groups.</p>
        <h3>How it works</h3>
        <ul style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);list-style:disc;">
          <li>Officers create events with <code style="background:var(--surface-elevated);padding:2px 6px;border-radius:4px;font-size:0.8em;">/create</code></li>
          <li>Members sign up by clicking buttons on the event message</li>
          <li>Groups have capacity limits — once full, new signups go to a bench</li>
          <li>Announcements can be auto-posted to your war channel</li>
        </ul>
        <h3>Groups</h3>
        <p style="font-size:var(--text-sm);">Default groups are Main, Alt, and Bench. Officers can customize group names, capacity, and emojis.</p>
      </article>

      <!-- Scoreboard OCR -->
      <article id="scores" class="docs-section" style="margin-top:var(--space-8);">
        <h2>Scoreboard OCR</h2>
        <p>Upload a screenshot of the post-war scoreboard and Project Athena will extract player stats automatically.</p>
        <h3>How to upload</h3>
        <ol style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);">
          <li>Go to the dashboard → your server → Player Stats or Score History</li>
          <li>Click "Upload Scoreboard"</li>
          <li>Select your screenshot (PNG/JPG)</li>
          <li>Set the war date and result (win/loss)</li>
          <li>Review the extracted data and confirm</li>
        </ol>
        <h3>Extracted data</h3>
        <p style="font-size:var(--text-sm);">For each player: kills, deaths, assists, damage dealt/taken, CCs, healing, support, structure damage, siege stats, and time alive.</p>
      </article>

      <!-- Ikusa -->
      <article id="ikusa" class="docs-section" style="margin-top:var(--space-8);">
        <h2>Ikusa Combat Logs</h2>
        <p><a href="https://github.com/sch-28/ikusa_logger" style="color:var(--accent);" target="_blank">Ikusa Logger</a> is an open-source network sniffer that captures full combat events during node wars.</p>
        <h3>Setup</h3>
        <ol style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);">
          <li>Install prerequisites: <a href="https://npcap.com/dist/" style="color:var(--accent);">Npcap 1.7.8</a>, Node.js 16+, Python 3+</li>
          <li>Clone the <a href="https://github.com/sch-28/ikusa_logger" style="color:var(--accent);">ikusa_logger</a> repository</li>
          <li>Run <code style="background:var(--surface-elevated);padding:2px 6px;border-radius:4px;font-size:0.8em;">build.bat</code> (Windows) or <code style="background:var(--surface-elevated);padding:2px 6px;border-radius:4px;font-size:0.8em;">build.sh</code> (Linux)</li>
          <li>Start the logger before node war begins</li>
          <li>After war, save or upload the logs</li>
        </ol>
        <h3>What it captures</h3>
        <p style="font-size:var(--text-sm);">Kill/death events with timestamps, player names, guild names, and the full event timeline. This data feeds into the Guild Performance dashboard.</p>
      </article>

      <!-- Guild Performance -->
      <article id="performance" class="docs-section" style="margin-top:var(--space-8);">
        <h2>Guild Performance</h2>
        <p>Analytics dashboard powered by score reports and combat logs.</p>
        <h3>Metrics</h3>
        <ul style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);list-style:disc;">
          <li><strong>Win Rate</strong> — percentage of wars won</li>
          <li><strong>Avg K/D</strong> — guild-wide kill/death ratio</li>
          <li><strong>Top Fragger</strong> — player with most total kills</li>
          <li><strong>Player Leaderboard</strong> — ranked by kills, with deaths, assists, K/D, and average damage</li>
          <li><strong>Recent Wars</strong> — last 10 wars with per-war stats</li>
        </ul>
      </article>

      <!-- Attendance -->
      <article id="attendance" class="docs-section" style="margin-top:var(--space-8);">
        <h2>Attendance Tracking</h2>
        <p>Visual attendance grid showing player participation across node wars.</p>
        <h3>How it works</h3>
        <p style="font-size:var(--text-sm);">The grid shows dates as rows and players as columns. Green cells indicate attendance (from signups or score reports). The attendance rate shows what percentage of wars each player attended.</p>
        <h3>Data sources</h3>
        <ul style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);list-style:disc;">
          <li><strong>Event signups</strong> — who signed up for each war</li>
          <li><strong>Score reports</strong> — who appeared in the post-war scoreboard</li>
        </ul>
      </article>

      <!-- Guild Activity -->
      <article id="guild-activity" class="docs-section" style="margin-top:var(--space-8);">
        <h2>Guild Activity (BDO API)</h2>
        <p>View your BDO guild profile pulled from the official Pearl Abyss website or the BDO Community API.</p>
        <h3>Supported regions</h3>
        <ul style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);list-style:disc;">
          <li><strong>EU / NA / SA / KR</strong> — via BDO Community API (man90es/BDO-REST-API)</li>
          <li><strong>ASIA (TH/SEA)</strong> — via direct HTML scraping of blackdesert.pearlabyss.com</li>
        </ul>
        <h3>Setup</h3>
        <p style="font-size:var(--text-sm);">Go to Guild Activity in the dashboard, enter your BDO guild name and region. The guild must exist on the BDO website for that region.</p>
        <h3>Data shown</h3>
        <p style="font-size:var(--text-sm);">Guild name, region, creation date, guild master, member count, and territory occupation.</p>
      </article>

      <!-- Dashboard -->
      <article id="dashboard" class="docs-section" style="margin-top:var(--space-8);">
        <h2>Web Dashboard</h2>
        <p>The dashboard is your central hub for managing everything.</p>
        <h3>Pages</h3>
        <ul style="padding-left:var(--space-5);line-height:2;font-size:var(--text-sm);list-style:disc;">
          <li><strong>Events</strong> — view and manage node war rosters</li>
          <li><strong>Player Stats</strong> — individual player performance from scoreboards</li>
          <li><strong>Score History</strong> — browse past war scoreboards</li>
          <li><strong>Guild Performance</strong> — aggregated war analytics</li>
          <li><strong>Attendance</strong> — participation tracking grid</li>
          <li><strong>Guild Activity</strong> — BDO guild profile from the official API</li>
        </ul>
        <h3>Access</h3>
        <p style="font-size:var(--text-sm);">Sign in with your Discord account. Admin features (score uploads, settings) require Manage Server or Administrator permissions.</p>
      </article>

      <!-- Commands -->
      <article id="commands" class="docs-section" style="margin-top:var(--space-8);">
        <h2>Bot Commands</h2>
        <div style="overflow-x:auto;">
        <table class="table" style="font-size:var(--text-sm);">
          <thead>
            <tr><th>Command</th><th>Description</th><th>Permission</th></tr>
          </thead>
          <tbody>
            <tr><td><code style="background:var(--surface-elevated);padding:2px 6px;border-radius:4px;font-size:0.85em;">/create</code></td><td>Create a new node war event</td><td>Officer</td></tr>
            <tr><td><code style="background:var(--surface-elevated);padding:2px 6px;border-radius:4px;font-size:0.85em;">/edit</code></td><td>Edit an existing event</td><td>Officer</td></tr>
            <tr><td><code style="background:var(--surface-elevated);padding:2px 6px;border-radius:4px;font-size:0.85em;">/setup</code></td><td>Configure announcement channel</td><td>Admin</td></tr>
            <tr><td><code style="background:var(--surface-elevated);padding:2px 6px;border-radius:4px;font-size:0.85em;">/roster</code></td><td>View current event roster</td><td>Anyone</td></tr>
            <tr><td><code style="background:var(--surface-elevated);padding:2px 6px;border-radius:4px;font-size:0.85em;">/upload</code></td><td>Upload a scoreboard screenshot</td><td>Officer</td></tr>
          </tbody>
        </table>
        </div>
      </article>

      <!-- FAQ -->
      <article id="faq" class="docs-section" style="margin-top:var(--space-8);margin-bottom:var(--space-10);">
        <h2>FAQ</h2>

        <details style="margin-top:var(--space-3);padding:var(--space-3) var(--space-4);border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--surface);">
          <summary style="cursor:pointer;font-weight:600;font-size:var(--text-sm);">How do I link my Discord to my BDO character?</summary>
          <p style="margin-top:var(--space-2);font-size:var(--text-sm);color:var(--text-muted);">Currently, attendance uses your Discord display name. Score reports use BDO family names from OCR. A name mapping feature is planned to link Discord accounts to BDO characters.</p>
        </details>

        <details style="margin-top:var(--space-3);padding:var(--space-3) var(--space-4);border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--surface);">
          <summary style="cursor:pointer;font-weight:600;font-size:var(--text-sm);">What regions are supported for Guild Activity?</summary>
          <p style="margin-top:var(--space-2);font-size:var(--text-sm);color:var(--text-muted);">EU, NA, SA, KR via the BDO Community API, and ASIA (TH/SEA) via direct scraping of the Pearl Abyss website.</p>
        </details>

        <details style="margin-top:var(--space-3);padding:var(--space-3) var(--space-4);border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--surface);">
          <summary style="cursor:pointer;font-weight:600;font-size:var(--text-sm);">How accurate is the scoreboard OCR?</summary>
          <p style="margin-top:var(--space-2);font-size:var(--text-sm);color:var(--text-muted);">Accuracy depends on screenshot quality. Clear, full-screen screenshots work best. You can review and edit the extracted data before saving.</p>
        </details>

        <details style="margin-top:var(--space-3);padding:var(--space-3) var(--space-4);border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--surface);">
          <summary style="cursor:pointer;font-weight:600;font-size:var(--text-sm);">Can I use this for siege wars?</summary>
          <p style="margin-top:var(--space-2);font-size:var(--text-sm);color:var(--text-muted);">Yes. Create an event with kind "siege" and the workflow is the same as node wars.</p>
        </details>

        <details style="margin-top:var(--space-3);padding:var(--space-3) var(--space-4);border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--surface);">
          <summary style="cursor:pointer;font-weight:600;font-size:var(--text-sm);">Where is the data stored?</summary>
          <p style="margin-top:var(--space-2);font-size:var(--text-sm);color:var(--text-muted);">Events and settings are stored locally in a JSON file. Score reports and images are stored in Supabase (PostgreSQL + S3).</p>
        </details>
      </article>
    </section>
  `;

  return renderApp('Documentation — Project Athena', content, { session, summaries, activeNav: 'dashboard' });
}
