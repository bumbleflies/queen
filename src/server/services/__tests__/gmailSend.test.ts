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

  it('threads a reply with In-Reply-To and References, and leaves both out otherwise', () => {
    const reply = buildRawMail({
      to: 'bills@bumbleflies.de',
      subject: 'Re: Ihre Rechnung',
      text: 'Danke',
      inReplyTo: '<CAF-123@mail.gmail.com>',
      references: '<CAF-123@mail.gmail.com>',
    });
    const headers = headersOf(reply);
    expect(headers).toContain('In-Reply-To: <CAF-123@mail.gmail.com>');
    expect(headers).toContain('References: <CAF-123@mail.gmail.com>');
    // Still no From: Gmail fills in the credential's own account.
    expect(headers.some((h) => h.startsWith('From: '))).toBe(false);

    const plain = headersOf(buildRawMail({ to: 'bills@bumbleflies.de', subject: 'x', text: 'y' }));
    expect(plain.some((h) => h.startsWith('In-Reply-To: '))).toBe(false);
    expect(plain.some((h) => h.startsWith('References: '))).toBe(false);
  });
});

describe('sendMail', () => {
  function capturing() {
    const sent: { userId?: string; raw: string; threadId?: string }[] = [];
    const client = {
      users: {
        messages: {
          list: async () => ({ data: {} }),
          get: async () => ({ data: {} }),
          attachments: { get: async () => ({ data: {} }) },
          send: async (params: { userId: string; requestBody: { raw: string; threadId?: string } }) => {
            sent.push({
              userId: params.userId,
              raw: Buffer.from(params.requestBody.raw, 'base64url').toString('utf8'),
              threadId: params.requestBody.threadId,
            });
            return { data: { id: 'msg-1' } };
          },
        },
      },
    };
    return { client, sent };
  }

  it('hands the encoded message to Gmail and reports the id', async () => {
    const { client, sent } = capturing();

    const id = await sendMail(client, { to: 'bills@bumbleflies.de', subject: 'Test', text: 'Hallo' });

    expect(id).toBe('msg-1');
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe('me');
    expect(sent[0].raw).toContain('To: bills@bumbleflies.de');
    // No thread for a new mail.
    expect(sent[0].threadId).toBeUndefined();
  });

  it('posts into the given thread and keeps the raw message base64url', async () => {
    const { client, sent } = capturing();

    await sendMail(client, {
      to: 'bills@bumbleflies.de',
      subject: 'Re: Ihre Rechnung',
      text: 'Abgelegt.',
      threadId: 'thread-1',
      inReplyTo: '<m1@mail.gmail.com>',
      references: '<m1@mail.gmail.com>',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].threadId).toBe('thread-1');
    expect(sent[0].raw).toContain('In-Reply-To: <m1@mail.gmail.com>');
    expect(sent[0].raw).toContain('References: <m1@mail.gmail.com>');
  });

  it('base64url-encodes the raw message so the JSON body stays plain ASCII', async () => {
    const bodies: string[] = [];
    const client = {
      users: {
        messages: {
          list: async () => ({ data: {} }),
          get: async () => ({ data: {} }),
          attachments: { get: async () => ({ data: {} }) },
          send: async (params: { userId: string; requestBody: { raw: string } }) => {
            bodies.push(params.requestBody.raw);
            return { data: { id: 'msg-1' } };
          },
        },
      },
    };

    await sendMail(client, { to: 'bills@bumbleflies.de', subject: 'Rechnung für März', text: 'Grüße' });

    expect(bodies[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(bodies[0], 'base64url').toString('utf8')).toContain('Subject: =?UTF-8?B?');
  });

  it('fails loudly when the client cannot send (no `gmail.send` scope)', async () => {
    const client = {
      users: { messages: { list: async () => ({ data: {} }), get: async () => ({ data: {} }), attachments: { get: async () => ({ data: {} }) } } },
    };
    await expect(sendMail(client, { to: 'bills@bumbleflies.de', subject: 'x', text: 'y' })).rejects.toThrow(/gmail\.send/);
  });
});
