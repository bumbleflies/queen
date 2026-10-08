import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import type { TaskContext } from 'vitest';
import { Setting } from '../../models/Setting';
import {
  resolveFolder,
  getInvoicesFolder,
  getReceiptsFolder,
  setDriveFolders,
} from '../appSettings';

describe('resolveFolder (pure)', () => {
  it('returns null without setting and without env', () => {
    expect(resolveFolder(null, 'invoicesFolderId', 'invoicesFolderName', undefined)).toBeNull();
  });

  it('falls back to env when no setting is present', () => {
    expect(resolveFolder(null, 'invoicesFolderId', 'invoicesFolderName', 'env-inv')).toEqual({ id: 'env-inv', name: null });
  });

  it('setting wins over env', () => {
    expect(resolveFolder(
      { invoicesFolderId: 'ui-inv', invoicesFolderName: 'Rechnungen' },
      'invoicesFolderId',
      'invoicesFolderName',
      'env-inv',
    )).toEqual({ id: 'ui-inv', name: 'Rechnungen' });
  });

  it('setting id present but name missing → null name', () => {
    expect(resolveFolder(
      { receiptsFolderId: 'ui-rec' },
      'receiptsFolderId',
      'receiptsFolderName',
      undefined,
    )).toEqual({ id: 'ui-rec', name: null });
  });
});

describe('appSettings drive folders (db)', () => {
  beforeEach((ctx: TaskContext) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
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
