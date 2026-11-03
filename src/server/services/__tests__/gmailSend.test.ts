import { describe, expect, it } from 'vitest';
import { buildRawMail, sendMail } from '../GmailService';

function headersOf(raw: string): string[] {
  return raw.split('\r\n\r\n')[0].split('\r\n');
}

function bodyOf(raw: string): string {
  const [, ...rest] = raw.split('\r\n\r\n');
  return rest.join('\r\n\r\n');
}

describe('buildRawMail', () => {
  it('builds an RFC 5322 message with CRLF line endings and the fields Gmail needs', () => {
    const raw = buildRawMail({ to: 'bills@bumbleflies.de', subject: 'Test', text: 'Hallo' });
    const headers = headersOf(raw);

    expect(raw).toContain('\r\n');
    expect(headers).toContain('To: bills@bumbleflies.de');
    expect(headers).toContain('Subject: Test');
    expect(headers).toContain('MIME-Version: 1.0');
    expect(headers).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(headers).toContain('Content-Transfer-Encoding: base64');
    expect(headers.some((h) => h.startsWith('Date: '))).toBe(true);
    expect(headers.some((h) => h.startsWith('Message-ID: <'))).toBe(true);
    // Omitted on purpose: Gmail rejects a From that is not the authenticated account or an alias.
    expect(headers.some((h) => h.startsWith('From: '))).toBe(false);
    // Base64 body decodes back to the exact text, umlauts included.
    expect(Buffer.from(bodyOf(raw).replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Hallo');
  });

  it('encodes a German subject and body without breaking the header', () => {
    const raw = buildRawMail({ to: 'bills@bumbleflies.de', subject: 'Neue Belege: 2 Belege abgelegt, 1 Größe', text: 'Grüße\n119,00 €' });
    const subject = headersOf(raw).find((h) => h.startsWith('Subject: '))!;
    expect(subject).toContain('=?UTF-8?B?');

    const decoded = Buffer.from(subject.replace('Subject: =?UTF-8?B?', '').replace('?=', ''), 'base64').toString('utf8');
    expect(decoded).toBe('Neue Belege: 2 Belege abgelegt, 1 Größe');
    expect(Buffer.from(bodyOf(raw).replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Grüße\n119,00 €');
  });

  it('keeps long body lines inside the 76-character base64 limit', () => {
    const raw = buildRawMail({ to: 'bills@bumbleflies.de', subject: 'x', text: 'a'.repeat(5000) });
    for (const line of bodyOf(raw).split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
  });

  it('uses the Reply-To and From when the caller sets them', () => {
    const raw = buildRawMail({ to: 'bills@bumbleflies.de', from: 'billing@hetzner.com', replyTo: 'bills@bumbleflies.de', subject: 'x', text: 'y' });
    const headers = headersOf(raw);
    expect(headers).toContain('From: billing@hetzner.com');
    expect(headers).toContain('Reply-To: bills@bumbleflies.de');
  });
});

describe('sendMail', () => {
  it('hands the encoded message to Gmail and reports the id', async () => {
    const sent: { userId?: string; raw?: string }[] = [];
    const client = {
      users: {
        messages: {
          list: async () => ({ data: {} }),
          get: async () => ({ data: {} }),
          attachments: { get: async () => ({ data: {} }) },
          send: async (params: { userId: string; requestBody: { raw: string } }) => {
            const raw = Buffer.from(params.requestBody.raw, 'base64url').toString('utf8');
            sent.push({ userId: params.userId, raw });
            return { data: { id: 'msg-1' } };
          },
        },
      },
    };

    const id = await sendMail(client, { to: 'bills@bumbleflies.de', subject: 'Test', text: 'Hallo' });

    expect(id).toBe('msg-1');
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe('me');
    expect(sent[0].raw).toContain('To: bills@bumbleflies.de');
  });

  it('fails loudly when the client cannot send (no `gmail.send` scope)', async () => {
    const client = {
      users: { messages: { list: async () => ({ data: {} }), get: async () => ({ data: {} }), attachments: { get: async () => ({ data: {} }) } } },
    };
    await expect(sendMail(client, { to: 'bills@bumbleflies.de', subject: 'x', text: 'y' })).rejects.toThrow(/gmail\.send/);
  });
});
