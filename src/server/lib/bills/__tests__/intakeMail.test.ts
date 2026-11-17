import { describe, expect, it } from 'vitest';
import { buildRawMail } from '../../../services/GmailService';
import { formatGermanEUR } from '../../money';
import { intakeReply, type IntakeReplyBill, type IntakeReplyInput } from '../intakeMail';

const APP = 'https://queen.example';
/** 16.11.2026 07:31 in Berlin (CET is one hour ahead of UTC in November). */
const PROCESSED = new Date(Date.UTC(2026, 10, 16, 6, 31));

function bill(over: Partial<IntakeReplyBill> = {}): IntakeReplyBill {
  return {
    fileName: 'Hetzner_2026-11-16_087001370124.pdf',
    vendorName: 'Hetzner Online GmbH',
    invoiceNumber: '087001370124',
    grossCents: 202600,
    scan: false,
    receivedAt: new Date(2026, 10, 16),
    ...over,
  };
}

function input(over: Partial<IntakeReplyInput> = {}): IntakeReplyInput {
  return {
    subject: 'Ihre Rechnung 087001370124',
    bills: [bill()],
    failed: [],
    appUrl: APP,
    processedAt: PROCESSED,
    ...over,
  };
}

describe('intakeReply', () => {
  it('answers the mail it belongs to, with the exact text of one filed bill', () => {
    expect(intakeReply(input())).toEqual({
      subject: 'Re: Ihre Rechnung 087001370124',
      text: [
        'Diese Rechnung ist bei queen eingegangen und abgelegt — die Mail kann ignoriert werden.',
        '',
        'Belege:',
        `  • Hetzner Online GmbH · Rechnung 087001370124 · ${formatGermanEUR(202600)}`,
        '    abgelegt als Hetzner_2026-11-16_087001370124.pdf',
        '',
        'Ordner: 2026 · Verarbeitet: 16.11.2026 07:31',
        '',
        'In Queen ansehen:',
        `${APP}/finance?tab=bills`,
      ].join('\n'),
    });
  });

  it('writes nothing for a mail that produced no bill', () => {
    // A mail whose attachments all failed, or a re-run over known bills.
    expect(intakeReply(input({ bills: [] }))).toBeNull();
  });

  it('lists every bill of the mail and the attachments of that mail that failed', () => {
    const mail = intakeReply(
      input({
        bills: [
          bill({ fileName: 'hetzner.pdf', vendorName: 'Hetzner Online GmbH', invoiceNumber: '087001370124', grossCents: 202600 }),
          bill({ fileName: 'gcloud.pdf', vendorName: 'Google Cloud EMEA Limited', invoiceNumber: '5502-8855-92', grossCents: 8400 }),
        ],
        failed: ['26-B001-103855369-98848178.PDF'],
      }),
    );

    expect(mail?.text).toContain(
      [
        'Belege:',
        `  • Hetzner Online GmbH · Rechnung 087001370124 · ${formatGermanEUR(202600)}`,
        '    abgelegt als hetzner.pdf',
        `  • Google Cloud EMEA Limited · Rechnung 5502-8855-92 · ${formatGermanEUR(8400)}`,
        '    abgelegt als gcloud.pdf',
      ].join('\n'),
    );
    expect(mail?.text).toContain(
      ['Nicht verarbeitet (wird beim nächsten Lauf erneut versucht):', '  • 26-B001-103855369-98848178.PDF'].join('\n'),
    );
    // One year folder for this mail.
    expect(mail?.text).toContain('Ordner: 2026 ·');
  });

  it('names scans and leaves their amount out instead of guessing 0,00 €', () => {
    const mail = intakeReply(
      input({ bills: [bill({ fileName: 'scan.pdf', invoiceNumber: '', grossCents: null, scan: true })] }),
    );

    expect(mail?.text).toContain(
      ['  • Hetzner Online GmbH · ohne Rechnungsnummer', '    Scan ohne lesbaren Text — bitte bei Bedarf manuell ansehen'].join('\n'),
    );
    expect(mail?.text).not.toContain(formatGermanEUR(0));
    expect(mail?.text).not.toContain('abgelegt als');
  });

  it('falls back to a readable vendor and invoice number instead of leaving gaps', () => {
    const mail = intakeReply(input({ bills: [bill({ vendorName: '   ', invoiceNumber: '' })] }));

    expect(mail?.text).toContain(`  • Unbekannter Absender · ohne Rechnungsnummer · ${formatGermanEUR(202600)}`);
  });

  it('omits the amount of a parsed bill whose total could not be read', () => {
    const mail = intakeReply(input({ bills: [bill({ grossCents: null })] }));
    expect(mail?.text).toContain('  • Hetzner Online GmbH · Rechnung 087001370124\n');
    expect(mail?.text).not.toContain('Betrag unbekannt');
  });

  it('mentions the failures block only when something of this mail failed', () => {
    expect(intakeReply(input())?.text).not.toContain('Nicht verarbeitet');
    expect(intakeReply(input({ failed: ['kaputt.pdf'] }))?.text).toContain('  • kaputt.pdf');
  });

  it('does not double an answer prefix, in either language', () => {
    expect(intakeReply(input({ subject: 'Rechnung Mai' }))?.subject).toBe('Re: Rechnung Mai');
    expect(intakeReply(input({ subject: 'Re: Rechnung Mai' }))?.subject).toBe('Re: Rechnung Mai');
    expect(intakeReply(input({ subject: 'RE: Rechnung Mai' }))?.subject).toBe('Re: Rechnung Mai');
    expect(intakeReply(input({ subject: 'AW: Rechnung Mai' }))?.subject).toBe('Re: Rechnung Mai');
    expect(intakeReply(input({ subject: 'Re: AW: Rechnung Mai' }))?.subject).toBe('Re: Rechnung Mai');
  });

  it('keeps the umlaut subject intact for the mail builder to RFC-2047 encode', () => {
    const mail = intakeReply(input({ subject: 'Rechnung für März' }));
    expect(mail?.subject).toBe('Re: Rechnung für März');
    // `buildRawMail` is the one place that encodes; doing it here would double-encode.
    const raw = buildRawMail({ to: 'bills@bumbleflies.de', subject: mail!.subject, text: mail!.text });
    const subject = raw.split('\r\n\r\n')[0].split('\r\n').find((h) => h.startsWith('Subject: '))!;
    expect(subject).toContain('=?UTF-8?B?');
    expect(Buffer.from(subject.replace('Subject: =?UTF-8?B?', '').replace('?=', ''), 'base64').toString('utf8')).toBe(
      'Re: Rechnung für März',
    );
  });

  it('reports the year folder the bills were filed into', () => {
    const mail = intakeReply(
      input({
        bills: [
          bill({ receivedAt: new Date(2025, 11, 30) }),
          bill({ receivedAt: new Date(2026, 0, 2) }),
        ],
      }),
    );
    expect(mail?.text).toContain('Ordner: 2025, 2026 ·');
  });

  it('links the bills tab of the deployment it runs in', () => {
    expect(intakeReply(input({ appUrl: 'https://queen.example/' }))?.text).toContain(
      'In Queen ansehen:\nhttps://queen.example/finance?tab=bills',
    );
  });
});
