import { type Queue } from 'bull';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { BankTransaction } from '../models/BankTransaction';
import { Supplier } from '../models/Supplier';
import EmailBillModel from '../models/EmailBill';
import { fetchBillEmails, type GmailMessage } from '../services/GmailService';
import { uploadInvoicePdf, createOAuth2Client } from '../services/DriveService';
import type { DriveFilesLike } from '../services/receiptsDrive';
import { receiptText } from '../services/receiptText';
import { loadHistory } from '../lib/accounting/history';
import { allocateSupplierNumber } from '../lib/numbering';
import { getReceiptsFolder } from '../services/appSettings';
import { driveForCron } from '../services/driveForUser';

const QUEUE_NAME = 'email-intake';

export let enqueueEmailIntake: () => Promise<void> = async (): Promise<void> => {
  // no-op until initEmailIntakeQueue wires Bull/valkey
};

export function setEnqueueEmailIntake(fn: () => Promise<void>): void {
  enqueueEmailIntake = fn;
}

function createBullQueue(): Queue {
  const url = process.env.REDIS_URL ?? process.env.VALKEY_URL;
  if (!url) throw new Error('REDIS_URL or VALKEY_URL must be set to start the email-intake queue');
  return new (require('bull'))(QUEUE_NAME, { redis: url });
}

export function initEmailIntakeQueue(): Queue {
  const queue = createBullQueue();
  queue.process(async () => {
    await runEmailIntake();
  });
  setEnqueueEmailIntake(async () => {
    await queue.add({});
  });
  return queue;
}

interface ExtractedBill {
  vendor: string;
  vendorName: string;
  invoiceNumber: string;
  amountCents: number;
  vatCents: number;
  iban: string;
  dueDate: string;
  description: string;
  pdfBuffer: Buffer;
  fileName: string;
}

async function runEmailIntake(): Promise<void> {
  await connectMongo();
  try {
    const gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (!gmailRefreshToken) {
      console.log('GMAIL_REFRESH_TOKEN not set; skipping email intake');
      return;
    }

    const messages = await fetchBillEmails('me', gmailRefreshToken, 20);
    if (messages.length === 0) {
      console.log('No new bill emails found');
      return;
    }

    const drive = await driveForCron();
    if (!drive) throw new Error('Drive not available for cron');

    const folderRef = await getReceiptsFolder();
    if (!folderRef) throw new Error('Receipts folder not configured');

    const gmailClient = require('googleapis').google.gmail({
      version: 'v1',
      auth: createOAuth2Client(gmailRefreshToken),
    });

    const suppliers = await Supplier.find({ archived: false }).lean() as any[];
    void loadHistory();

    for (const msg of messages) {
      const fullMsg = await gmailClient.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const pdfFiles = extractPdfAttachments(fullMsg.data);

      for (const { buffer, fileName } of pdfFiles) {
        try {
          const bill = await extractBillFromPdf(buffer, fileName);
          if (!bill) {
            console.log(`Could not parse PDF: ${fileName}`);
            continue;
          }

          const existing = await EmailBillModel.findOne({ messageId: msg.id, fileName });
          if (existing) {
            console.log(`Bill already processed: ${fileName}`);
            continue;
          }

          const uploadResult = await uploadInvoicePdf({
            auth: createOAuth2Client(gmailRefreshToken),
            buffer,
            fileName,
            folderId: folderRef.id,
          });

          const supplier = await findOrCreateSupplier(bill, suppliers);
          createDraftBankTransaction(bill, supplier, uploadResult.fileId, uploadResult.link, 'bills@bumbleflies.de', msg.id, fullMsg.data);
          await EmailBillModel.create({
            emailSource: 'bills@bumbleflies.de',
            messageId: msg.id,
            subject: getHeader(fullMsg.data, 'Subject') ?? '',
            date: new Date(fullMsg.data.internalDate ? Date.parse(fullMsg.data.internalDate) : Date.now()),
            vendor: bill.vendor,
            vendorName: bill.vendorName,
            invoiceNumber: bill.invoiceNumber,
            amountCents: bill.amountCents,
            vatCents: bill.vatCents,
            iban: bill.iban,
            dueDate: bill.dueDate,
            description: bill.description,
            fileId: uploadResult.fileId,
            status: 'draft',
            createdBy: 'email-intake-job',
          });

          console.log(`Created draft bill: ${bill.vendorName} - ${bill.invoiceNumber} (${bill.amountCents / 100} EUR)`);
        } catch (err) {
          console.error(`Failed to process attachment ${fileName}:`, (err as Error).message);
        }
      }
    }
  } finally {
    await disconnectMongo();
  }
}

function getHeader(msg: GmailMessage, name: string): string | null {
  return msg.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function extractPdfAttachments(msg: GmailMessage): Array<{ buffer: Buffer; fileName: string }> {
  const result: Array<{ buffer: Buffer; fileName: string }> = [];
  const parts = msg.payload.parts ?? [];
  for (const part of parts) {
    if (part.mimeType === 'application/pdf' && part.filename && part.body?.data) {
      const data = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
      result.push({ buffer: Buffer.from(data, 'base64'), fileName: part.filename });
    }
  }
  return result;
}

async function extractBillFromPdf(buffer: Buffer, fileName: string): Promise<ExtractedBill | null> {
  try {
    const text = await receiptText(
      { files: { list: async () => ({ data: { files: [] } }), get: async () => ({ data: buffer }) } },
      'temp',
    );
    if (!text || text.length < 20) return null;
    return parseBillText(text, fileName);
  } catch (e) {
    console.error(`PDF text extraction failed for ${fileName}:`, (e as Error).message);
    return null;
  }
}

function parseBillText(text: string, fileName: string): ExtractedBill | null {
  const vendorPatterns = [
    { vendor: 'hetzner', vendorName: 'Hetzner Online GmbH', pattern: /Hetzner/i },
    { vendor: 'opencode', vendorName: 'OpenCode', pattern: /OpenCode/i },
    { vendor: 'google', vendorName: 'Google Ireland Ltd', pattern: /Google (Workspace|Cloud|Ireland)/i },
  ];

  let vendor = 'unknown';
  let vendorName = 'Unknown Vendor';
  for (const v of vendorPatterns) {
    if (v.pattern.test(text)) {
      vendor = v.vendor;
      vendorName = v.vendorName;
      break;
    }
  }

  const amountMatch = text.match(/(?:Summe|Total|Amount)[^\d]*([\d.,]+)\s*EUR/i);
  const amountStr = amountMatch ? amountMatch[1].replace(/\./g, '').replace(',', '.') : '0';
  const amountCents = Math.round(parseFloat(amountStr) * 100);

  const ibanMatch = text.match(/IBAN\s+([A-Z]{2}[A-Z0-9]{10,20})/i);
  const iban = ibanMatch ? ibanMatch[1] : '';

  const invoiceMatch = text.match(/(?:Rechnungsnummer|Invoice\s+No|Invoice\s+Number)[^\w]*([A-Z0-9-]+)/i);
  const invoiceNumber = invoiceMatch ? invoiceMatch[1] : `email-${Date.now()}`;

  const dueMatch = text.match(/(?:Fälligkeitsdatum|Due\s+date)[^\d]*(\d{2}[.\-/]\d{2}[.\-/]\d{4})/i);
  const dueDate = dueMatch ? dueMatch[1] : '';

  const vatCents = Math.round(amountCents * 0.19 / 1.19);

  const description = text.slice(0, 300).replace(/\n/g, ' ').trim();

  return { vendor, vendorName, invoiceNumber, amountCents, vatCents, iban, dueDate, description, pdfBuffer: Buffer.alloc(0), fileName };
}

async function findOrCreateSupplier(bill: ExtractedBill, existingSuppliers: any[]) {
  let supplier = existingSuppliers.find((s) =>
    s.ibans?.some?.((i: string) => i.toUpperCase() === bill.iban.toUpperCase()),
  );

  if (!supplier && bill.vendorName !== 'Unknown Vendor') {
    supplier = existingSuppliers.find((s) =>
      s.namePatterns?.some?.((p: string) => bill.vendorName.toLowerCase().includes(p.toLowerCase())),
    );
  }

  if (supplier) {
    if (bill.iban && !supplier.ibans?.includes(bill.iban)) {
      await Supplier.findByIdAndUpdate(supplier._id, { ibans: [...(supplier.ibans ?? []), bill.iban] });
    }
    return supplier;
  }

  const kreditorNumber = await allocateSupplierNumber();
  const newSupplier = await Supplier.create({
    kreditorNumber,
    name: bill.vendorName,
    ibans: bill.iban ? [bill.iban] : [],
    namePatterns: [bill.vendorName.toLowerCase()],
    purposePatterns: [],
    defaultAccount: '4400',
    defaultVatRate: 0.19,
    defaultMode: 'normal',
    archived: false,
    origin: 'learned',
    learnedAt: new Date(),
  });

  return newSupplier;
}

async function createDraftBankTransaction(
  bill: ExtractedBill,
  supplier: any,
  fileId: string,
  fileLink: string,
  emailSource: string,
  messageId: string,
  msg: GmailMessage,
): Promise<void> {
  await BankTransaction.create({
    fireflyJournalId: `email-intake-${messageId}-${Date.now()}`,
    date: new Date(msg.internalDate ? Date.parse(msg.internalDate) : Date.now()),
    amountCents: bill.amountCents,
    currency: 'EUR',
    description: `${supplier.name} - ${bill.invoiceNumber}`,
    counterpartyName: supplier.name,
    counterpartyIban: bill.iban,
    direction: 'out',
    supplierId: supplier._id,
    receipt: {
      driveFileId: fileId,
      fileName: bill.fileName,
      link: fileLink,
    },
    receiptMissingReason: '',
    receiptReadings: [],
    receiptMatch: null,
    matchedInvoiceId: null,
    matchMethod: 'reference',
    ignored: false,
    importedAt: new Date(),
  });
}