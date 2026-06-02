# Documentation Audit

Documentation was compared against the current implementation on 2026-06-02.

## Reviewed Documents

- `docs/architecture.md`
- `docs/commands.md`
- `docs/configuration.md`
- `docs/deployment.md`
- `docs/security.md`
- `README.md`

## Corrections Applied

| Document | Correction |
| --- | --- |
| `docs/architecture.md` | Removed the obsolete `src/date-input.ts` entry and documented shared clock formatting in `src/time-format.ts`. |
| `docs/commands.md` | Corrected `/event set-slots` and `/event delete`: IDs are matched case-insensitively, but ID prefixes are not accepted by the implementation. |

## Confirmed Matches

- Registered Discord commands match `src/commands.ts`: `/event create`, `create-today`, `create-test`, `edit`, `recurring`, `set-slots`, `repost`, `delete`, `list`, `show`, and `/set-nwchannel`.
- Scheduler documentation matches `src/bot.ts`: immediate startup recovery, 60-second polling, overdue posting, weekly rollover, one-hour closure, and duplicate avoidance through `createEventIfMissing`.
- Supabase documentation matches `src/supabase-store.ts` and `src/web-session-store.ts`: event storage uses `nodewar_store`; persistent web sessions use hashed tokens in `web_sessions` only when a service-role key is configured.
- Dashboard route documentation matches `src/web.ts`, including authenticated management routes, CSRF checks, public event detail pages, and the intentionally denied unscoped `GET /api/events`.
- Security documentation matches the implementation: runtime Discord permission checks, escaped HTML values, OAuth state expiry, `HttpOnly` cookies, secure-cookie selection for HTTPS, CSP headers, and SHA-256 session-token hashes in Supabase.

## Remaining Documentation Work

- Add a contributor-focused module map after `src/bot.ts` and `src/web.ts` are split. The existing architecture document accurately describes current ownership, but those modules contain several responsibilities each.
- Add an operational checklist for rotating Discord and Supabase credentials during a public incident response.

