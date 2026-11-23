import { describe, it, expect, vi } from 'vitest';
import type { OutgoingMail } from '../../../services/GmailService';
import { payoutReleaseMail, sendPayoutReleaseMail, type PayoutMailInput } from '../payoutMail';

const input: PayoutMailInput = {
  payout: {
    number: 'SP-2026-0001',
    amountCents: 4120,
    purpose: 'Spesen ChrisD 2026-01 SP-2026-0001',
  },
  founder: { name: 'Chris Daehn', loginEmail: 'chris.daehn@bumbleflies.de' },
  newestClaim: { messageId: 'gmail-newest', subject: 'Spesen' },
};

describe('payoutReleaseMail', () => {
  it('is a German mail with amount, reference and the authenticated deep link', () => {
    const mail = payoutReleaseMail(input, 'https://queen.example');
    expect(mail.subject).toBe('Spesen-Auszahlung SP-2026-0001');
    expect(mail.text).toMatch(/41,20/);
    expect(mail.text).toContain('Referenz: SP-2026-0001');
    expect(mail.text).toContain('https://queen.example/expenses/payouts/SP-2026-0001');
    expect(mail.text).toContain('melde dich an');
    expect(mail.text).toContain('In der GLS-App scannen und dort mit TAN bestätigen.');
    expect(mail.text).toContain('die Bankzeile gleicht automatisch aus');
  });

  it('uses QUEEN_APP_URL with trailing slashes removed', () => {
    const previous = process.env.QUEEN_APP_URL;
    process.env.QUEEN_APP_URL = 'https://queen.example/';
    try {
      expect(payoutReleaseMail(input).text).toContain(
        'https://queen.example/expenses/payouts/SP-2026-0001',
      );
    } finally {
      if (previous === undefined) delete process.env.QUEEN_APP_URL;
      else process.env.QUEEN_APP_URL = previous;
    }
  });
});

describe('sendPayoutReleaseMail', () => {
  it('sends to loginEmail as a reply in the newest claim thread', async () => {
    const send = vi.fn(async () => 'sent-id');
    const lookup = vi.fn(async () => ({ threadId: 'thread-9', messageIdHeader: '<orig@example>' }));
    await sendPayoutReleaseMail({ input, send, lookup, origin: 'https://queen.example' });
    expect(lookup).toHaveBeenCalledWith('gmail-newest');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining<Partial<OutgoingMail>>({
        to: 'chris.daehn@bumbleflies.de',
        threadId: 'thread-9',
        inReplyTo: '<orig@example>',
        references: '<orig@example>',
      }),
    );
  });

  it('still sends when the thread cannot be looked up', async () => {
    const send = vi.fn(async () => 'sent-id');
    const lookup = vi.fn(async () => {
      throw new Error('message nicht gefunden');
    });
    await expect(
      sendPayoutReleaseMail({ input, send, lookup, origin: 'https://queen.example' }),
    ).resolves.toBe('sent-id');
    const mail = send.mock.calls[0][0] as OutgoingMail;
    expect(mail.to).toBe('chris.daehn@bumbleflies.de');
    expect(mail.threadId).toBeUndefined();
  });

  it('propagates a send failure so release can only warn', async () => {
    const send = vi.fn(async () => {
      throw new Error('gmail.send fehlt');
    });
    await expect(
      sendPayoutReleaseMail({ input, send, origin: 'https://queen.example' }),
    ).rejects.toThrow('gmail.send fehlt');
  });
});
