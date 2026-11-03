import { describe, expect, it } from 'vitest';
import { intakeAppUrl, sendIntakeConfirmation } from '../billIntake';
import type { GmailClientLike } from '../../services/GmailService';

// No Mongo here on purpose: these two are pure composition plus one send call,
// so they run even where mongodb-memory-server cannot start.
describe('intakeAppUrl', () => {
  it('defaults to the production origin and honours the override', () => {
    expect(intakeAppUrl({})).toBe('https://queen.bumbleflies.de');
    expect(intakeAppUrl({ QUEEN_APP_URL: ' https://queen.example/ ' })).toBe('https://queen.example');
  });
});

describe('sendIntakeConfirmation', () => {
  function sending() {
    const sent: { to: string; subject: string; text: string }[] = [];
    const client: GmailClientLike = {
      users: {
        messages: {
          list: async () => ({ data: {} }),
          get: async () => ({ data: {} }),
          attachments: { get: async () => ({ data: {} }) },
          send: async ({ requestBody }) => {
            const raw = Buffer.from(requestBody.raw, 'base64url').toString('utf8');
            const [head, ...body] = raw.split('\r\n\r\n');
            sent.push({
              to: head.split('\r\n').find((h) => h.startsWith('To: '))!.slice(4),
              subject: head.split('\r\n').find((h) => h.startsWith('Subject: '))!.slice(9),
              text: Buffer.from(body.join('\r\n\r\n').replace(/\r\n/g, ''), 'base64').toString('utf8'),
            });
            return { data: { id: 'msg-1' } };
          },
        },
      },
    };
    return { client, sent };
  }

  it('mails one summary to the bills mailbox after a run that filed a bill', async () => {
    const { client, sent } = sending();
    const result = {
      messages: 1, attachments: 1, created: 1, skipped: 0, noText: 0, failed: 0, errors: [],
      createdBills: [
        { fileName: 'rechnung.pdf', vendorName: 'Hetzner Online GmbH', grossCents: 11900, receivedAt: new Date(2026, 10, 3) },
      ],
    };

    const id = await sendIntakeConfirmation(result, { gmail: client, to: 'bills@bumbleflies.de', appUrl: 'https://queen.example' });

    expect(id).toBe('msg-1');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('bills@bumbleflies.de');
    expect(sent[0].text).toContain('https://queen.example/finance?tab=bills');
    expect(sent[0].text).toContain('rechnung.pdf');
  });

  it('sends nothing when the run filed no bill', async () => {
    const { client, sent } = sending();
    const id = await sendIntakeConfirmation(
      { messages: 3, attachments: 2, created: 0, skipped: 2, noText: 0, failed: 0, errors: [], createdBills: [] },
      { gmail: client, to: 'bills@bumbleflies.de', appUrl: 'https://queen.example' },
    );

    expect(id).toBeNull();
    expect(sent).toEqual([]);
  });

  it('passes the missing-scope error up, so the cron can warn instead of failing', async () => {
    const noSend: GmailClientLike = {
      users: { messages: { list: async () => ({ data: {} }), get: async () => ({ data: {} }), attachments: { get: async () => ({ data: {} }) } } },
    };
    await expect(
      sendIntakeConfirmation(
        { messages: 1, attachments: 1, created: 1, skipped: 0, noText: 0, failed: 0, errors: [], createdBills: [
          { fileName: 'a.pdf', vendorName: 'X', grossCents: null, receivedAt: new Date(2026, 10, 3) },
        ] },
        { gmail: noSend, to: 'bills@bumbleflies.de', appUrl: 'https://queen.example' },
      ),
    ).rejects.toThrow(/gmail\.send/);
  });
});

