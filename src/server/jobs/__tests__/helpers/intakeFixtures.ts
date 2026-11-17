import { Bill } from '../../../models/Bill';
import type { GmailClientLike, GmailMessage } from '../../../services/GmailService';
import type { BillIntakeDeps } from '../../billIntake';

/**
 * Fakes for the bill-intake tests: the Gmail shape Gmail really sends, the
 * Drive folder calls, and the production dependency set. Shared because the
 * router test ("Jetzt abrufen" runs the same job) needs exactly the same ones.
 */

/** A readable vendor invoice; the parser turns this into a parsed bill. */
export const PDF_TEXT = `Hetzner Online GmbH
Rechnungsnummer: R-1000
IBAN: DE44 5009 2100 0000 0595 12
Summe netto 100,00 EUR
19,00 % USt 19,00 EUR
Summe brutto 119,00 EUR`;

/** One incoming mail: its subject/thread and the PDFs it carries. */
export interface FakeMail {
  id: string;
  files: { fileName: string; bytes: Buffer }[];
  internalDate?: string;
  subject?: string;
  from?: string;
  /** The `Message-ID` header the reply threads on. */
  messageId?: string;
  threadId?: string;
}

/**
 * Nested multipart exactly like Gmail sends it: attachment bytes come from
 * attachments.get. The client can send too, so the production reply path (the
 * default `sendReply` → `sendMail`) is what the tests exercise unless a test
 * injects its own `sendReply`.
 */
export function gmailThread(mails: FakeMail[], opts: { inline?: boolean } = {}) {
  const fetched: string[] = [];
  const sent: { raw: string; threadId?: string }[] = [];
  const messages = new Map<string, GmailMessage>();
  const attachmentBytes = new Map<string, Buffer>();

  for (const mail of mails) {
    const parts = mail.files.map((file, index) => {
      const attachmentId = index === 0 ? `att-${mail.id}` : `att-${mail.id}-${index + 1}`;
      attachmentBytes.set(attachmentId, file.bytes);
      return {
        mimeType: 'application/pdf',
        filename: file.fileName,
        body: opts.inline
          ? { data: file.bytes.toString('base64url'), size: file.bytes.length }
          : { attachmentId, size: file.bytes.length },
      };
    });
    messages.set(mail.id, {
      id: mail.id,
      threadId: mail.threadId ?? `thread-${mail.id}`,
      internalDate: mail.internalDate ?? String(Date.UTC(2026, 9, 1, 8)),
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: mail.from ?? '"Hetzner Online GmbH" <billing@hetzner.com>' },
          { name: 'Subject', value: mail.subject ?? 'Ihre Rechnung' },
          { name: 'Message-ID', value: mail.messageId ?? `<${mail.id}@mail.example>` },
        ],
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', body: { data: Buffer.from('siehe Anhang').toString('base64url') } },
              ...parts,
            ],
          },
        ],
      },
    });
  }

  const client: GmailClientLike = {
    users: {
      messages: {
        list: async () => ({ data: { messages: mails.map((m) => ({ id: m.id })) } }),
        get: async ({ id }) => ({ data: messages.get(id)! }),
        attachments: {
          get: async ({ id }) => {
            fetched.push(id);
            const bytes = attachmentBytes.get(id)!;
            return { data: { data: bytes.toString('base64url'), size: bytes.length } };
          },
        },
        send: async ({ requestBody }) => {
          sent.push({ raw: requestBody.raw, threadId: requestBody.threadId });
          return { data: { id: `sent-${sent.length}` } };
        },
      },
    },
  };
  return { client, fetched, sent };
}

/** Every entry is one mail with exactly one PDF — the shape most tests use. */
export function gmailWith(
  files: { id: string; fileName: string; bytes: Buffer; internalDate?: string }[],
  opts: { inline?: boolean } = {},
) {
  return gmailThread(
    files.map((file) => ({
      id: file.id,
      files: [{ fileName: file.fileName, bytes: file.bytes }],
      internalDate: file.internalDate,
    })),
    opts,
  );
}

/** Drive: no folder exists yet, so every year folder is created fresh. */
export function driveStub() {
  const created: { name: string; parent: string }[] = [];
  return {
    created,
    drive: {
      files: {
        list: async () => ({ data: { files: [] } }),
        create: async ({ requestBody }: { requestBody: { name: string; parents?: string[] } }) => {
          created.push({ name: requestBody.name, parent: requestBody.parents?.[0] ?? '' });
          return { data: { id: `folder-${requestBody.name}` } };
        },
      },
    },
  };
}

/** Intake dependencies for a fake client; everything optional stays overridable. */
export function intakeDeps(over: Partial<BillIntakeDeps> & { client: GmailClientLike }): BillIntakeDeps {
  const { drive } = driveStub();
  const uploaded: string[] = [];
  return {
    gmail: over.client,
    drive: (over.drive ?? drive) as BillIntakeDeps['drive'],
    upload: over.upload ?? (async (file) => {
      uploaded.push(file.fileName);
      return { fileId: `file-${uploaded.length}`, link: `https://drive.example/${uploaded.length}` };
    }),
    receiptsFolderId: 'root',
    mailbox: 'bills@bumbleflies.de',
    appUrl: 'https://queen.example',
    extractText: async () => PDF_TEXT,
    now: new Date(2026, 9, 2),
    ...over,
  };
}

/** Bills only exist after a DB-connected test; the suite skips otherwise. */
export async function resetBills(): Promise<void> {
  await Bill.deleteMany({});
}
