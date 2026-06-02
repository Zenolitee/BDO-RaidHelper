# Dead Code Report

Production-readiness dead-code analysis completed on 2026-06-02.

## Files Removed

| File removed | Why it was removed | References checked |
| --- | --- | --- |
| `src/date-input.ts` | The date phrase parser and its helpers were not imported or called anywhere in the application, scripts, or documentation workflows. Current Discord and dashboard scheduling use their own timezone-aware Node War date selection paths. | Repository-wide reference search, TypeScript imports, `src/bot.ts`, `src/web.ts`, `scripts/qa-web-smoke.mjs`, and `docs/architecture.md`. |

## Symbols Removed

| Symbol | Previous location | Why it was removed | References checked |
| --- | --- | --- | --- |
| `GROUPS` | `src/types.ts` | Unused constant. Dynamic custom roster group keys mean it was not an authoritative validator. | Repository-wide symbol search and strict TypeScript unused scan. |
| `renderSignupMenu` | `src/render.ts` | Unused compatibility alias for `renderEventComponents`. | Repository-wide symbol search and bot renderer imports. |
| `getDefaultGroups` | `src/nodewar-presets.ts` | Unused compatibility wrapper for `getT1DefaultGroups`. | Repository-wide symbol search and preset imports. |
| `timeMatches` | `src/bot.ts` | Unused scheduler helper. Scheduler due checks use `announcementIsDue`. | Repository-wide symbol search and strict TypeScript unused scan. |
| `client` parameter on `handleWizardButton` | `src/bot.ts` | Unused interaction-router argument. | Strict TypeScript unused scan and wizard-button flow review. |
| `updateEventMessage` | `src/store.ts` | Unused store mutation superseded by announcement and detail update paths. | Repository-wide method-call search and Discord posting flow review. |
| `allocateGroups` | `src/store.ts` | Unused store mutation. Active dashboard allocation uses `updateEventDetails`; Discord slot editing uses `setBalancedGroups`. | Repository-wide method-call search, dashboard handlers, and Discord handlers. |
| `setGroupCapacity` | `src/store.ts` | Unused single-role mutation. | Repository-wide method-call search and management flows. |
| `upsertGroup` | `src/store.ts` | Unused incremental custom-role mutation. Dashboard persists validated complete allocations. | Repository-wide method-call search and dashboard allocation parser. |
| `setEnabledRoles` | `src/store.ts` | Unused incremental enabled-role mutation. | Repository-wide method-call search and dashboard allocation parser. |
| `setEventTime` | `src/store.ts` | Unused mutation. Current editing uses `updateEventDetails`. | Repository-wide method-call search and edit handlers. |

## Assets And Routes

- No tracked image files exist. Local `images/`, `references/`, and `debug/` files are ignored development artifacts and were left untouched.
- All Express routes registered in `src/web.ts` are documented or intentionally retained.
- `src/public/styles.css` is generated from `src/styles/input.css` and served at `/assets/styles.css`; it is not dead code.
- CSS source is scanned by Tailwind from `src/web.ts`. No manual CSS removal was attempted because dynamic HTML templates make selector-level deletion unsafe without visual regression coverage.

