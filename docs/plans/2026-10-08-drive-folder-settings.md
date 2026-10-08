# Drive Folder Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hardcoded `GOOGLE_DRIVE_INVOICES_FOLDER_ID` and `QUEEN_RECEIPTS_FOLDER_ID` env vars with DB-backed settings that admins pick through a Drive folder-picker UI.

**Architecture:** A single `Setting` MongoDB document (`key: 'drive'`) stores both folder IDs and their names. A small service resolves folders as *setting → env fallback → null* so existing environments (servyy-test, Ansible-managed) keep working until an admin picks folders in the UI. Consumers (`receipts` router, `admin.importSheet/linkDriveFiles`, invoice filing job) read through that resolver. A tRPC `settings` router exposes read (any user), browse (any user, per-user Drive auth), and write (admin only). The client gets a `FolderPicker` modal (existing `.backdrop`/`.dialog` CSS) on the SettingsPage.

**Tech Stack:** Mongoose 9, tRPC 11, React 19, vitest (+mongodb-memory-server), googleapis Drive v3 (existing `driveForUser`).

---

## Task 1: Setting model + folder resolution service

**Files:**
- Create: `src/server/models/Setting.ts`
- Create: `src/server/services/appSettings.ts`
- Test: `src/server/services/__tests__/appSettings.test.ts`

**Step 1: Write the failing test**

```ts
// src/server/services/__tests__/appSettings.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import type { TaskContext } from 'vitest';
import { Setting } from '../../models/Setting';
import { getInvoicesFolder, getReceiptsFolder, setDriveFolders } from '../appSettings';

function skipIfNoDb(ctx: TaskContext): void {
  if (mongoose.connection.readyState !== 1) ctx.skip();
}

describe('appSettings drive folders', () => {
  beforeEach(skipIfNoDb);
  beforeEach(async () => {
    await Setting.deleteMany({});
    delete process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID;
    delete process.env.QUEEN_RECEIPTS_FOLDER_ID;
  });
  afterEach(() => {
    delete process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID;
    delete process.env.QUEEN_RECEIPTS_FOLDER_ID;
  });

  it('returns null without setting and without env', async () => {
    await expect(getInvoicesFolder()).resolves.toBeNull();
    await expect(getReceiptsFolder()).resolves.toBeNull();
  });

  it('falls back to env vars when no setting is present', async () => {
    process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID = 'env-inv';
    process.env.QUEEN_RECEIPTS_FOLDER_ID = 'env-rec';
    await expect(getInvoicesFolder()).resolves.toEqual({ id: 'env-inv', name: null });
    await expect(getReceiptsFolder()).resolves.toEqual({ id: 'env-rec', name: null });
  });

  it('setting wins over env', async () => {
    process.env.QUEEN_RECEIPTS_FOLDER_ID = 'env-rec';
    await setDriveFolders({ receipts: { id: 'ui-rec', name: 'Belege' } }, 'admin-id-1');
    await expect(getReceiptsFolder()).resolves.toEqual({ id: 'ui-rec', name: 'Belege' });
  });

  it('persists both folders and updatedBy, clearing works per-slot', async () => {
    await setDriveFolders(
      {
        invoices: { id: 'ui-inv', name: 'Rechnungen' },
        receipts: { id: 'ui-rec', name: 'Belege' },
      },
      'admin-id-1',
    );
    const doc = await Setting.findOne({ key: 'drive' });
    expect(doc?.value).toMatchObject({
      invoicesFolderId: 'ui-inv',
      invoicesFolderName: 'Rechnungen',
      receiptsFolderId: 'ui-rec',
      receiptsFolderName: 'Belege',
    });
    await setDriveFolders({ invoices: null }, 'admin-id-1');
    const doc2 = await Setting.findOne({ key: 'drive' });
    expect(doc2?.value).toMatchObject({ invoicesFolderId: null, receiptsFolderId: 'ui-rec' });
    await expect(getInvoicesFolder()).resolves.toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```
NODE_ENV=development npx vitest run src/server/services/__tests__/appSettings.test.ts
```
Expected: FAIL — cannot find module Setting / appSettings.

**Step 3: Implement the model**

```ts
// src/server/models/Setting.ts
import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedBy: { type: String },
  updatedAt: { type: Date, default: () => new Date() },
}, { timestamps: true });

export const Setting = mongoose.model('Setting', settingSchema);
export type SettingDoc = typeof Setting.prototype;
```

**Step 4: Implement the service**

```ts
// src/server/services/appSettings.ts
import { Setting } from '../models/Setting';

export interface FolderRef {
  id: string;
  name: string | null;
}

export interface DriveFoldersValue {
  invoicesFolderId?: string | null;
  invoicesFolderName?: string | null;
  receiptsFolderId?: string | null;
  receiptsFolderName?: string | null;
}

const DRIVE_KEY = 'drive';

async function readDriveValue(): Promise<DriveFoldersValue | null> {
  const doc = await Setting.findOne({ key: DRIVE_KEY });
  return (doc?.value as DriveFoldersValue | undefined) ?? null;
}

/** Setting wins over env; env (`GOOGLE_DRIVE_INVOICES_FOLDER_ID`) is the fallback. */
export async function getInvoicesFolder(): Promise<FolderRef | null> {
  const value = await readDriveValue();
  if (value?.invoicesFolderId) {
    return { id: value.invoicesFolderId, name: value.invoicesFolderName ?? null };
  }
  const env = process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID;
  return env ? { id: env, name: null } : null;
}

/** Setting wins over env; env (`QUEEN_RECEIPTS_FOLDER_ID`) is the fallback. */
export async function getReceiptsFolder(): Promise<FolderRef | null> {
  const value = await readDriveValue();
  if (value?.receiptsFolderId) {
    return { id: value.receiptsFolderId, name: value.receiptsFolderName ?? null };
  }
  const env = process.env.QUEEN_RECEIPTS_FOLDER_ID;
  return env ? { id: env, name: null } : null;
}

/**
 * Upsert the 'drive' setting. Slots not passed are left untouched; passing
 * `null` for a slot clears it (falls back to env again).
 */
export async function setDriveFolders(
  input: { invoices?: FolderRef | null; receipts?: FolderRef | null },
  updatedBy: string,
): Promise<void> {
  const value = (await readDriveValue()) ?? {};
  if (input.invoices !== undefined) {
    value.invoicesFolderId = input.invoices?.id ?? null;
    value.invoicesFolderName = input.invoices?.name ?? null;
  }
  if (input.receipts !== undefined) {
    value.receiptsFolderId = input.receipts?.id ?? null;
    value.receiptsFolderName = input.receipts?.name ?? null;
  }
  await Setting.updateOne(
    { key: DRIVE_KEY },
    { key: DRIVE_KEY, value, updatedBy, updatedAt: new Date() },
    { upsert: true },
  );
}
```

**Step 5: Run tests to verify they pass** — same command as Step 2, expect 4 PASS.

**Step 6: Commit**

```bash
git add src/server/models/Setting.ts src/server/services/appSettings.ts src/server/services/__tests__/appSettings.test.ts
git commit -m "feat(settings): Setting model + drive folder resolution with env fallback"
```

---

## Task 2: Settings tRPC router (read / browse / write)

**Files:**
- Create: `src/server/routers/settings.ts`
- Modify: `src/server/trpc.ts` (import + mount `settings: settingsRouter`)
- Test: `src/server/routers/__tests__/settings.test.ts`

**Step 1: Write the failing test**

```ts
// src/server/routers/__tests__/settings.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import type { TaskContext } from 'vitest';
import { Setting } from '../../models/Setting';
import { appRouter } from '../../trpc';
import { adminCaller } from './helpers/ledgerFixtures';

function skipIfNoDb(ctx: TaskContext): void {
  if (mongoose.connection.readyState !== 1) ctx.skip();
}

function userCaller() {
  return appRouter.createCaller({
    user: { sub: 'user-id-1', email: 'user@example.de', role: 'user' },
    serviceAuth: false,
  });
}

describe('settings router', () => {
  beforeEach(skipIfNoDb);

  it('getDriveFolders reports env fallback and explicit settings', async () => {
    process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID = 'env-inv';
    try {
      const before = await adminCaller().settings.getDriveFolders();
      expect(before.invoices).toEqual({ id: 'env-inv', name: null });
      expect(before.receipts).toBeNull();
    } finally {
      delete process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID;
    }
    await adminCaller().settings.setDriveFolders({
      receipts: { id: 'ui-rec', name: 'Belege' },
    });
    const after = await adminCaller().settings.getDriveFolders();
    expect(after.invoices).toBeNull();
    expect(after.receipts).toEqual({ id: 'ui-rec', name: 'Belege' });
  });

  it('setDriveFolders requires admin', async () => {
    await expect(
      userCaller().settings.setDriveFolders({ receipts: { id: 'x', name: 'x' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('browseDriveFolders forbidden without drive auth', async () => {
    await expect(
      adminCaller().settings.browseDriveFolders({ parentId: 'root' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});
```

(For the last check, `driveForUser` fails without a stored refresh token — any tRPC error code is acceptable; assert it rejects. Adjust the expected code after seeing the real error, typically INTERNAL_SERVER_ERROR.)

**Step 2: Run test to verify it fails** — module not found.

**Step 3: Implement the router**

```ts
// src/server/routers/settings.ts
import { z } from 'zod';
import { router, authedProcedure, adminProcedure } from '../trpcInit';
import { TRPCError } from '@trpc/server';
import {
  getInvoicesFolder,
  getReceiptsFolder,
  setDriveFolders,
  type FolderRef,
} from '../services/appSettings';
import { driveForUser } from '../services/driveForUser';

const folderSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().max(512).nullable().optional(),
});

export const settingsRouter = router({
  getDriveFolders: authedProcedure.query(async () => {
    const [invoices, receipts] = await Promise.all([getInvoicesFolder(), getReceiptsFolder()]);
    return { invoices, receipts };
  }),

  /** Live subfolder listing for the picker. Uses the current user's Drive auth. */
  browseDriveFolders: authedProcedure
    .input(z.object({ parentId: z.string().min(1).max(512).default('root') }))
    .query(async ({ input, ctx }) => {
      const drive = await driveForUser(ctx.user.sub);
      try {
        const res = await drive.files.list({
          q:
            `'${input.parentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents` +
            ` and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)',
          spaces: 'drive',
          pageSize: 1000,
        });
        return (res.data.files ?? [])
          .filter((f): f is { id: string; name: string } => !!f.id && !!f.name)
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch (err) {
        throw new TRPCError({ code: 'BAD_GATEWAY', message: `Drive nicht erreichbar: ${(err as Error).message}` });
      }
    }),

  setDriveFolders: adminProcedure
    .input(z.object({
      invoices: folderSchema.nullable().optional(),
      receipts: folderSchema.nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const pick = (f: FolderRef | null | undefined): FolderRef | null | undefined =>
        f === undefined ? undefined : f ? { id: f.id, name: f.name ?? null } : null;
      await setDriveFolders(
        { receipts: pick(input.receipts), invoices: pick(input.invoices) },
        ctx.user.sub,
      );
      const [invoices, receipts] = await Promise.all([getInvoicesFolder(), getReceiptsFolder()]);
      return { invoices, receipts };
    }),
});
```

**Step 4: Mount it** — in `src/server/trpc.ts`: add `import { settingsRouter } from './routers/settings';` and `settings: settingsRouter,` to the `appRouter` object.

**Step 5: Run tests to verify they pass**

```
NODE_ENV=development npx vitest run src/server/routers/__tests__/settings.test.ts
```
Expected: PASS (adjust the browse error-code assertion to the actual behavior).

**Step 6: Commit**

```bash
git add src/server/routers/settings.ts src/server/routers/__tests__/settings.test.ts src/server/trpc.ts
git commit -m "feat(settings): settings router with drive browse + folder mutation"
```

---

## Task 3: Switch consumers to the resolver

**Files:**
- Modify: `src/server/routers/receipts.ts:14-17` — replace env read with `getReceiptsFolder()`.
- Modify: `src/server/routers/admin.ts:68-79` — replace env read with `getInvoicesFolder()`.
- Modify: `src/server/jobs/FileInvoiceJob.ts:84-88,120` — `getInvoicesFolderId()` becomes an async resolver through the service (keep `deps.folderId` override for tests).
- Test: keep/extend existing tests (`receipts`, `fileInvoiceJob.test.ts`).

**Step 1: receipts.ts** — replace lines 14–23:

```ts
const folder = await getReceiptsFolder();
if (!folder) {
  throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Kein Belege-Ordner gewählt (Einstellungen)' });
}
let files;
try {
  files = await listReceiptFiles(await driveForUser(ctx.user.sub), folder.id, input.year);
} catch (err) {
  throw new TRPCError({ code: 'BAD_GATEWAY', message: `Drive nicht erreichbar: ${(err as Error).message}` });
}
```

**Step 2: admin.ts** — replace the `folderId` resolution (lines 68–78) with:

```ts
const invoicesFolder = await getInvoicesFolder();
const folderId = invoicesFolder?.id;
...
if (folderId) {
  resolveDriveFile = await driveResolver(ctx.user.sub, folderId);
} else {
  warnings.push('Drive lookup skipped: no invoices folder selected (settings)');
}
```

Where `applySheetImport.folderId` is consumed downstream, pass `invoicesFolder?.id ?? undefined` as before.

**Step 3: FileInvoiceJob.ts** — delete `getInvoicesFolderId()` and in `processFileInvoice` replace line 120 with:

```ts
const folderRef = deps.folderId != null ? { id: deps.folderId, name: null } : await getInvoicesFolder();
if (!folderRef) {
  throw new Error('Drive invoices folder is not selected (settings)');
}
const folderId = folderRef.id;
```

Import `getInvoicesFolder` from `../services/appSettings`.

**Step 4: Run existing suites**

```
NODE_ENV=development npx vitest run src/server/routers src/server/jobs
```
Expected: all pass; env-var fallback paths keep working because tests set envs or use no setting.
`fileInvoiceJob.test.ts` passes `deps.folderId` already in every case, so no test changes needed.

**Step 5: Commit**

```bash
git add src/server/routers/receipts.ts src/server/routers/admin.ts src/server/jobs/FileInvoiceJob.ts
git commit -m "feat(settings): read drive folders from settings with env fallback"
```

---

## Task 4: FolderPicker component + SettingsPage section

**Files:**
- Create: `src/client/components/FolderPicker.tsx`
- Modify: `src/client/pages/SettingsPage.tsx`
- Modify: `src/client/i18n/de.ts` and `en.ts` (add all `settings.drive.*` keys to BOTH — en must mirror de keys exactly; add to `DictKey`-deriving de first)
- Test: `src/client/__tests__/folderPicker.test.tsx`

**Step 1: Write the failing component test**

Follow the `financePage.test.tsx` mock harness (`vi.mock('../lib/trpc', …)` with a static `trpc` object). Scenario:

```tsx
// src/client/__tests__/folderPicker.test.tsx
// Mock trpc:
//   settings.getDriveFolders: q({ invoices: null, receipts: null })
//   settings.browseDriveFolders: q([{ id: 'f1', name: 'Abrechnungen' }])
//   settings.setDriveFolders: mut('set', async () => ({}))
//   me: q({ user: { role: 'admin' } })

it('browses root folders and saves the selection', async () => {
  render(<MemoryRouter><LanguageProvider><SettingsPage /></LanguageProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /Belege-Ordner|Receipts folder/ }));
  // picker dialog is open, shows root content
  expect(await screen.findByRole('button', { name: 'Abrechnungen' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Abrechnungen' })); // descend
  fireEvent.click(screen.getByRole('button', { name: /Ordner auswählen|Select folder/ }));
  fireEvent.click(screen.getByRole('button', { name: /Übernehmen|Apply/ }));
  await waitFor(() => expect(calls.set).toEqual([{ receipts: { id: 'f1', name: 'Abrechnungen' }, invoices: undefined }]));
});
```

(Exact string assertions adapt to the final i18n keys; keep to German strings since tests set `queen-lang: de`.)

**Step 2: Run test to verify it fails**

```
NODE_ENV=development npx vitest run src/client/__tests__/folderPicker.test.tsx
```

**Step 3: Implement FolderPicker**

Props: `{ scope: 'invoices' | 'receipts', current: { id: string; name: string | null } | null, onClose: () => void }`.

Behavior:
- Uses `trpc.settings.getDriveFolders` for the current value and `trpc.settings.browseDriveFolders` for browsing; maintains a stack `[{ id: 'root', name: 'Meine Ablage' }, …]`; root listing query uses `parentId: 'root'`.
- Renders inside `<div className="backdrop" role="dialog" aria-modal="true">` + `<div className="dialog">` (same modal pattern as `BookingDialog`, Escape + backdrop click close).
- Node rows are buttons with the folder name; clicking a row descends and pushes its `{id, name}` onto the stack. Breadcrumb row lets you pop back up; root first.
- Footer: "Ordner auswählen" commits the *currently open* folder via `settings.setDriveFolders.mutateAsync({ [scope]: { id, name } })`, calls `utils.settings.invalidate()` and `onClose()`. Second button "Ordner entfernen" (only when current is set) commits `null` for `scope`. "Abbrechen" closes.

**Step 4: Implement the SettingsPage section**

New card after the language card (only for `me.data?.user.role === 'admin'`, since non-admins cannot write):

- `trpc.settings.getDriveFolders` query; two rows: invoices folder and receipts folder, each showing `folder?.name ?? folder?.id ?? 'Kein Ordner gewählt'` (env fallback means name can be null while id is set — then show the id) and a "Ändern" button opening `<FolderPicker scope=…>` as modal state `picker: 'invoices' | 'receipts' | null`.

**Step 5: i18n keys** (add to de.ts and en.ts; de is source of truth for `DictKey`):

```
settings.drive / settings.driveInvoices / settings.driveReceipts
settings.drive.none / settings.drive.change / settings.drive.pick
settings.drive.remove / settings.drive.root ('Meine Ablage' / 'My Drive')
settings.drive.breadcrumbAria
```

**Step 6: Run tests to verify they pass** — picker test + `npx vitest run src/client` (SettingsPage has no dedicated test yet; the picker test covers the card).

**Step 7: Commit**

```bash
git add src/client/components/FolderPicker.tsx src/client/pages/SettingsPage.tsx src/client/i18n/de.ts src/client/i18n/en.ts src/client/__tests__/folderPicker.test.tsx
git commit -m "feat(settings): drive folder picker on the settings page"
```

---

## Task 5: Receipt-picker error hint + .env.example note

**Files:**
- Modify: `src/client/components/BookingDialog.tsx:142-144` — when `receipts.isError`, also render `t('bookings.receipt.unavailableHint')` (new key: "Ordner in den Einstellungen wählen") as muted text, so the remedy is discoverable.
- Modify: `.env.example` — annotate both vars as "fallback only; picked folders are stored in the app settings".

**Step 1:** Implement, run lint/typecheck. **Step 2:** Commit.

```bash
git add src/client/components/BookingDialog.tsx .env.example src/client/i18n
git commit -m "feat(settings): hint for receipt folder setup + env example note"
```

---

## Task 6: Full verification + history log

**Step 1: Full check suite**

```
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```
Expected: all green.

**Step 2: History log** — add `history/2026-10-08_drive-folder-settings.md` (follow the format of `history/2026-10-07_buchen-page.md`; note the env-fallback behavior and the go-live step: pick both folders once in Settings → then remove the env vars from the Ansible template if desired).

**Step 3: Commit + push**

```bash
git add history . && git commit -m "docs: history for drive folder settings"
```
