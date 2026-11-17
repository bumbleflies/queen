import { describe, expect, it } from 'vitest';
import { intakeAppUrl } from '../billIntake';
import { buildRawMail } from '../../services/GmailService';
import { formatGermanEUR } from '../../lib/money';
import { intakeReply } from '../../lib/bills/intakeMail';

// No Mongo here on purpose: the composer is pure and `buildRawMail` only turns
// it into bytes, so these run even where mongodb-memory-server cannot start.
describe('intakeAppUrl', () => {
  it('defaults to the production origin and honours the override', () => {
    expect(intakeAppUrl({})).toBe('https://queen.bumbleflies.de');
    expect(intakeAppUrl({ QUEEN_APP_URL: ' https://queen.example/ ' })).toBe('https://queen.example');
  });
});

describe('the confirmation reply as Gmail receives it', () => {
  const reply = intakeReply({
    subject: 'Ihre Rechnung',
    bills: [
      { fileName: 'hetzner.pdf', vendorName: 'Hetzner Online GmbH', invoiceNumber: 'R-1', grossCents: 202600, scan: false, receivedAt: new Date(2026, 10, 16) },
      { fileName: 'scan.pdf', vendorName: 'Google Cloud EMEA Limited', invoiceNumber: '', grossCents: null, scan: true, receivedAt: new Date(2026, 10, 16) },
    ],
    failed: ['kaputt.pdf'],
    appUrl: 'https://queen.example',
    processedAt: new Date(Date.UTC(2026, 10, 16, 6, 31)),
  })!;

  const raw = buildRawMail({
    to: 'bills@bumbleflies.de',
    subject: reply.subject,
    text: reply.text,
    threadId: 'thread-1',
    inReplyTo: '<m1@mail.gmail.com>',
    references: '<m1@mail.gmail.com>',
  });
  const headers = raw.split('\r\n\r\n')[0].split('\r\n');
  const body = Buffer.from(
    raw.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n/g, ''),
    'base64',
  ).toString('utf8');

  it('goes to the mailbox itself, into the thread of the mail it answers', () => {
    expect(headers).toContain('To: bills@bumbleflies.de');
    expect(headers).toContain('Subject: Re: Ihre Rechnung');
    expect(headers).toContain('In-Reply-To: <m1@mail.gmail.com>');
    expect(headers).toContain('References: <m1@mail.gmail.com>');
    // Never a From: Gmail fills in the credential's own account.
    expect(headers.some((h) => h.startsWith('From: '))).toBe(false);
  });

  it('lists every bill of that mail and names its failed attachment', () => {
    expect(body).toContain(`  • Hetzner Online GmbH · Rechnung R-1 · ${formatGermanEUR(202600)}`);
    expect(body).toContain('    abgelegt als hetzner.pdf');
    expect(body).toContain('  • Google Cloud EMEA Limited · ohne Rechnungsnummer');
    expect(body).toContain('    Scan ohne lesbaren Text — bitte bei Bedarf manuell ansehen');
    expect(body).toContain('  • kaputt.pdf');
    expect(body).toContain('https://queen.example/finance?tab=bills');
  });
});
