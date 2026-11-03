import { describe, expect, it } from 'vitest';
import { formatGermanEUR } from '../../money';
import { intakeMail, type IntakeMailInput } from '../intakeMail';

const APP = 'https://queen.example';

function input(over: Partial<IntakeMailInput> = {}): IntakeMailInput {
  return {
    appUrl: APP,
    created: [{ fileName: 'rechnung-1000.pdf', vendorName: 'Hetzner Online GmbH', grossCents: 11900, receivedAt: new Date(2026, 10, 3, 8, 5) }],
    noText: 0,
    failed: 0,
    ...over,
  };
}

describe('intakeMail', () => {
  it('writes nothing when no bill arrived, so an idle hourly run stays silent', () => {
    expect(intakeMail(input({ created: [] }))).toBeNull();
  });

  it('names the count in the subject, singular and plural', () => {
    expect(intakeMail(input())?.subject).toBe('Neuer Beleg im Postfach: 1 Beleg abgelegt');
    const two = intakeMail(
      input({
        created: [
          { fileName: 'a.pdf', vendorName: 'Hetzner Online GmbH', grossCents: 11900, receivedAt: new Date(2026, 10, 3) },
          { fileName: 'b.pdf', vendorName: 'Google Ireland Ltd', grossCents: 4999, receivedAt: new Date(2026, 10, 3) },
        ],
      }),
    );
    expect(two?.subject).toBe('Neue Belege im Postfach: 2 Belege abgelegt');
  });

  it('lists each bill with date, vendor, file name and amount, and links the bills tab', () => {
    const mail = intakeMail(
      input({
        created: [
          { fileName: 'rechnung-1000.pdf', vendorName: 'Hetzner Online GmbH', grossCents: 11900, receivedAt: new Date(2026, 10, 3, 8, 5) },
          // An unread amount stays blank rather than becoming a guessed 0,00 €.
          { fileName: 'scan.pdf', vendorName: '', grossCents: null, receivedAt: new Date(2026, 9, 30) },
        ],
      }),
    );

    expect(mail?.text).toContain('03.11.2026');
    expect(mail?.text).toContain('Hetzner Online GmbH');
    expect(mail?.text).toContain('rechnung-1000.pdf');
    expect(mail?.text).toContain(formatGermanEUR(11900));
    expect(mail?.text).toContain('30.10.2026');
    expect(mail?.text).toContain('scan.pdf');
    expect(mail?.text).toContain(`${APP}/finance?tab=bills`);
    expect(mail?.text).not.toContain(formatGermanEUR(0));
  });

  it('mention scans and failed reads only when there are some', () => {
    expect(intakeMail(input())?.text).not.toContain('ohne lesbaren Text');
    expect(intakeMail(input())?.text).not.toContain('nicht gelesen');

    const mail = intakeMail(input({ noText: 2, failed: 1 }));
    expect(mail?.text).toContain('2 Belege ohne lesbaren Text');
    expect(mail?.text).toContain('1 Beleg konnte nicht gelesen werden');
  });
});
