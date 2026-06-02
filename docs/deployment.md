# Deployment

## Build And Start

```bash
npm install
npm run typecheck
npm run build
npm start
```

The production entry point is `dist/index.js`. One process serves both Discord bot interactions and the Express dashboard.

## Discord Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Add a bot invite with `bot` and `applications.commands` scopes.
3. Grant the message, embed, channel visibility, history, slash-command, external-emoji, and role-mention permissions required by your deployment.
4. Configure `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID`.
5. For dashboard login, configure `DISCORD_CLIENT_SECRET`, `PUBLIC_BASE_URL`, and `DISCORD_REDIRECT_URI`.
6. Add the exact redirect URI in the Discord Developer Portal.
7. Run `npm run register:commands`.
8. Set a per-server announcement channel by running `/set-nwchannel` in Discord.

Use guild-scoped registration during development. Set `REGISTER_COMMANDS_GLOBAL=true` for production when commands should be available in every server where the bot is installed.

## Persistent Storage

JSON mode is adequate for one local process. Production deployments should use Supabase:

1. Create the tables from [configuration.md](configuration.md).
2. Set `SUPABASE_URL`.
3. Set server-only `SUPABASE_SERVICE_ROLE_KEY`.
4. Keep the service-role key out of browser code and repository files.

Supabase event storage survives restarts. Supabase web-session storage also keeps dashboard logins active across restarts.

## Railway

For Railway or a similar host:

- Add environment variables in the provider dashboard.
- Do not upload or commit a populated environment file.
- Use `npm run build` as the build command.
- Use `npm start` as the start command.
- Set `PUBLIC_BASE_URL` to the generated HTTPS origin.
- Set `DISCORD_REDIRECT_URI` to `${PUBLIC_BASE_URL}/auth/discord/callback`.
- Keep a single replica when using JSON mode.

## Local Development

```bash
npm run dev
```

This rebuilds CSS and starts `tsx watch src/index.ts`. The dashboard is available at `http://localhost:3000` by default.

To exercise the compiled dashboard and lifecycle smoke suite:

```bash
npm run qa:web
```

## Operational Notes

- The Discord token is optional only when intentionally running the web server without bot functionality.
- Scheduler recovery happens when the Discord client becomes ready.
- The scheduler polls every 60 seconds and posts overdue unannounced events after restart.
- Dashboard OAuth and wizard state are in memory. OAuth state always resets on restart; persistent dashboard sessions require Supabase service-role configuration.
- JSON storage supports one application process. Use Supabase before scaling to multiple replicas.
- Rotate any token that appears in logs, chat, screenshots, or local files shared outside the deployment environment.

