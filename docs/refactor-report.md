# Production Readiness Refactor Report

Cleanup completed on 2026-06-02.

## 1. Files Removed

- Removed `src/date-input.ts`, an unreferenced legacy parser. See [dead-code-report.md](dead-code-report.md).

## 2. Files Modified

- Updated `src/bot.ts`, `src/store.ts`, `src/render.ts`, `src/web.ts`, `src/types.ts`, and `src/nodewar-presets.ts`.
- Added `src/time-format.ts`.
- Updated `package.json` and `package-lock.json`.
- Updated `docs/architecture.md` and `docs/commands.md`.
- Added this report, `docs/dead-code-report.md`, and `docs/documentation-audit.md`.

## 3. Duplicate Logic Consolidated

- Centralized 12-hour time display formatting in `src/time-format.ts` for Discord embeds and dashboard pages.
- Centralized the seven-day weekday tuple in `src/types.ts`; both Discord wizard scheduling and dashboard scheduling now derive from the same typed constant.
- Removed obsolete compatibility wrappers and unused store mutation variants rather than preserving parallel implementations.

## 4. Security Issues Fixed

- No source-level security fix was required during this pass.
- No tracked secrets, tokens, service-role keys, or hardcoded Discord IDs were found.
- No unsafe local file access or path traversal paths were found in request handling.
- Dashboard HTML values are escaped before insertion. The remaining `innerHTML` assignment builds a static client-side role-editor row and interpolates only numeric capacity.
- Local `.env`, Railway variable files, logs, data, debug screenshots, and reference images remain excluded by `.gitignore`.
- No security TODOs were found.

## 5. Dependency Cleanup

- Removed unused `@supabase/ssr`. Supabase support continues through `@supabase/supabase-js`.
- `npm audit` reports zero vulnerabilities.
- No duplicate or deprecated direct dependencies were identified.

## 6. Performance Improvements

- Removed unreachable code and unused storage mutation paths, reducing maintenance and compile surface.
- Kept scheduler read sequencing unchanged. The scheduler intentionally reloads storage between lifecycle phases, which preserves behavior after writes and is important for Supabase-backed runs.
- Deferred broader scheduler batching until adapter-level tests can prove equivalent behavior.

## 7. Remaining Technical Debt

| File | Lines after cleanup | Recommendation |
| --- | ---: | --- |
| `src/bot.ts` | About 1,950 | Split interaction routing, creation wizard, edit wizard, scheduler, Discord posting, and permission helpers into focused modules. |
| `src/web.ts` | About 1,280 | Split routes, Discord REST client, authentication/session middleware, HTML rendering, and request parsing. |
| `src/styles/input.css` | About 1,580 | Organize by dashboard area and add browser screenshot coverage before removing selectors. |

Additional debt:

- `src/store.ts` is below 500 lines after cleanup but still combines JSON persistence, validation, and roster mutation policy. Split only alongside adapter and behavior tests.
- Discord command interaction behavior is validated by type checking and code review, but automated Discord interaction tests are still missing.
- Supabase support is compiled and reviewed, but this pass did not run against a live Supabase project.

## 8. Recommended Next Refactor Targets

1. Add unit tests for store mutations, Discord custom-ID routing, weekly rollover, and due-announcement recovery.
2. Extract scheduler code from `src/bot.ts` behind a small storage and posting interface.
3. Extract dashboard request validation and HTML rendering from `src/web.ts`.
4. Add browser-based dashboard regression coverage before CSS cleanup.

## Validation

- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`
- `npm run typecheck`
- `npm run build`
- `npm run qa:web`
- `npm audit`
- `git diff --check`
