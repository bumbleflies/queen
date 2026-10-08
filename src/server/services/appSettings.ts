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

/** Pure resolution logic: setting wins, env fallback. */
export function resolveFolder(
  value: DriveFoldersValue | null,
  settingsKey: 'invoicesFolderId' | 'receiptsFolderId',
  settingsName: 'invoicesFolderName' | 'receiptsFolderName',
  envFolderId: string | undefined,
): FolderRef | null {
  const id = value?.[settingsKey];
  if (id) return { id, name: value?.[settingsName] ?? null };
  return envFolderId ? { id: envFolderId, name: null } : null;
}

async function readDriveValue(): Promise<DriveFoldersValue | null> {
  const doc = await Setting.findOne({ key: DRIVE_KEY });
  return (doc?.value as DriveFoldersValue | undefined) ?? null;
}

/** Setting wins over env; env (`GOOGLE_DRIVE_INVOICES_FOLDER_ID`) is the fallback. */
export async function getInvoicesFolder(): Promise<FolderRef | null> {
  return resolveFolder(await readDriveValue(), 'invoicesFolderId', 'invoicesFolderName', process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID);
}

/** Setting wins over env; env (`QUEEN_RECEIPTS_FOLDER_ID`) is the fallback. */
export async function getReceiptsFolder(): Promise<FolderRef | null> {
  return resolveFolder(await readDriveValue(), 'receiptsFolderId', 'receiptsFolderName', process.env.QUEEN_RECEIPTS_FOLDER_ID);
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
