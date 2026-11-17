import { formatGermanEUR } from '../money';

/** One bill the intake filed from the mail being answered. */
export interface IntakeReplyBill {
  /** The attachment name as it arrived: that is what the reader recognises in the mailbox. */
  fileName: string;
  vendorName: string;
  invoiceNumber: string;
  /** `null` when the PDF had no readable total — never rendered as 0,00 €. */
  grossCents: number | null;
  /** Filed, but without a text layer (a scan) — worth a look by hand. */
  scan: boolean;
  /** Needed for the year folder the PDF was filed into. */
  receivedAt: Date;
}

export interface IntakeReplyInput {
  /** Subject of the mail being answered; a reply prefix is added, not doubled. */
  subject: string;
  /** Bills this run recorded from that mail (parsed or scanned) — never empty. */
  bills: IntakeReplyBill[];
  /** Attachments of that same mail whose filing or reading failed in this run. */
  failed: string[];
  /** Origin of the deployment, e.g. `https://queen.bumbleflies.de`. */
  appUrl: string;
  /** When this run processed the mail. */
  processedAt: Date;
}

export interface IntakeReply {
  subject: string;
  text: string;
}

/**
 * The German wall clock of a date. The container runs with TZ=Europe/Berlin,
 * but the time zone is passed explicitly so a test or a developer machine
 * produces the same text.
 */
const BERLIN_CLOCK = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `dd.mm.yyyy hh:mm`, built from parts so no locale separator sneaks in. */
function germanDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const parts = BERLIN_CLOCK.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')}.${part('month')}.${part('year')} ${part('hour')}:${part('minute')}`;
}

/** `Re:`, `AW:` and `Antw:` are the same answer prefix in the two languages we get mail in. */
const REPLY_PREFIX = /^\s*(?:re|aw|antw)\s*:\s*/i;

function replySubject(subject: string): string {
  let base = subject.trim();
  while (REPLY_PREFIX.test(base)) base = base.replace(REPLY_PREFIX, '');
  // An untitled mail still gets an answer a reader can place.
  return `Re: ${base || 'Beleg eingegangen'}`;
}

function billLines(bill: IntakeReplyBill): string[] {
  const vendor = bill.vendorName.trim() || 'Unbekannter Absender';
  const number = bill.invoiceNumber.trim() ? `Rechnung ${bill.invoiceNumber.trim()}` : 'ohne Rechnungsnummer';
  // A scan has no read total, and an unreadable one is omitted — never a guessed 0,00 €.
  const amount = bill.scan || bill.grossCents === null ? '' : ` · ${formatGermanEUR(bill.grossCents)}`;
  return [
    `  • ${vendor} · ${number}${amount}`,
    bill.scan
      ? '    Scan ohne lesbaren Text — bitte bei Bedarf manuell ansehen'
      : `    abgelegt als ${bill.fileName}`,
  ];
}

/**
 * The answer to one incoming bill mail, posted into that mail's own Gmail
 * thread. Deliberately plain text and in German: it is a notification to
 * ourselves, not a customer-facing document.
 *
 * Returns `null` when this mail produced no bill, so a mail whose attachments
 * all failed (or a re-run over known bills) stays silent.
 */
export function intakeReply(input: IntakeReplyInput): IntakeReply | null {
  if (input.bills.length === 0) return null;

  const years = [...new Set(input.bills.map((bill) => bill.receivedAt.getFullYear()))].join(', ');

  const lines = [
    'Diese Rechnung ist bei queen eingegangen und abgelegt — die Mail kann ignoriert werden.',
    '',
    'Belege:',
  ];
  for (const bill of input.bills) lines.push(...billLines(bill));

  lines.push('', `Ordner: ${years} · Verarbeitet: ${germanDateTime(input.processedAt)}`);

  if (input.failed.length > 0) {
    lines.push('', 'Nicht verarbeitet (wird beim nächsten Lauf erneut versucht):');
    for (const fileName of input.failed) lines.push(`  • ${fileName}`);
  }

  lines.push('', 'In Queen ansehen:', `${input.appUrl.replace(/\/+$/, '')}/finance?tab=bills`);

  return { subject: replySubject(input.subject), text: lines.join('\n') };
}
