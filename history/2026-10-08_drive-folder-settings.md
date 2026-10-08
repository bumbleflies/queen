# 2026-10-08 — Drive folder settings + booking dialog as modal

Spec: [`docs/plans/2026-10-08-drive-folder-settings.md`](../docs/plans/2026-10-08-drive-folder-settings.md).

## Problem

The Drive folders used by queen were hardcoded env vars: `GOOGLE_DRIVE_INVOICES_FOLDER_ID` (invoice PDF filing) and `QUEEN_RECEIPTS_FOLDER_ID` (receipt picker root). Changing them required an Ansible env change and a container redeploy, and an environment without them just showed an unresolved error ("QUEEN_RECEIPTS_FOLDER_ID ist nicht gesetzt"). Separately, the booking form rendered as an inline card that pushed the transaction table down the page.

## Solution

- **Setting model** (`src/server/models/Setting.ts`): generic key/value collection; single `key: 'drive'` document holds both folder IDs plus their human-readable names (so the UI shows "Eingangsrechnungen", not an opaque ID).
- **Resolution** (`src/server/services/appSettings.ts`): setting wins → env var fallback → null. Pure part (`resolveFolder`) unit-tested without DB; DB layer covered by CI tests.
- **Consumers switched**: receipts router, `admin.importSheet` Drive lookup, invoice filing job (`FileInvoiceJob` reads the setting at execution time — a folder change applies to the next Bull job without restart).
- **Settings router**: `getDriveFolders` (any user), `browseDriveFolders` (per-user Drive auth, live subfolder listing), `setDriveFolders` (admin only).
- **SettingsPage**: new "Google Drive" card (admin view) with invoices/receipts rows and a `FolderPicker` modal (existing backdrop/dialog CSS; breadcrumb browsing from "Meine Ablage", escape/backdrop close, remove-folder action).
- **Booking dialog** renders as a centered modal overlay instead of an inline card (same modal pattern in `FolderPicker`).
- Receipts error in the booking dialog now points to the remedy ("Ordner in den Einstellungen wählen").
- `.env.example` documents both vars as fallbacks.

## Main files

- `src/server/models/Setting.ts`, `src/server/services/appSettings.ts`, `src/server/routers/settings.ts`
- `src/server/routers/receipts.ts`, `src/server/routers/admin.ts`, `src/server/jobs/FileInvoiceJob.ts`
- `src/client/components/FolderPicker.tsx`, `src/client/pages/SettingsPage.tsx`, `src/client/components/BookingDialog.tsx`
- `src/client/i18n/{de,en}.ts` (`settings.drive*`, `bookings.receipt.unavailableHint`)
- Tests: `appSettings.test.ts`, `settings.test.ts` (CI/db), `folderPicker.test.tsx`; updated `i18n-rollout.test.tsx`

## Deployment results

- Local: lint + both typechecks + 266 tests pass (DB-backed tests skip in this Alpine container; they run in CI).
- Not yet deployed (feature branch `feat/drive-folder-settings`).

## Verification commands

```
npm run lint && npm run typecheck && npm run typecheck:server && npm test
NODE_ENV=development npx vitest run src/client/__tests__/folderPicker.test.tsx
NODE_ENV=development npx vitest run src/server/services/__tests__/appSettings.test.ts
```

## Success criteria

- Admin can pick both folders in the UI; pick persists (Setting doc) and wins over env.
- Environments that keep the env vars unchanged keep working (fallback).
- Receipts work as soon as the receipts folder is picked — no env or redeploy needed.
- Filing job picks up folder changes on the next run.

## Known issues / future enhancements

- Folder picker lists only subfolders of the browsed folder; a Shared Drive must be reached by navigating from the root list.
- No migration of env-entry `name` (env fallback shows the ID as label until picked in the UI).
- Go-live on a new environment: pick both folders once in Settings → then remove the env vars from the Ansible template `templates/finance/queen.env.j2` if desired.
