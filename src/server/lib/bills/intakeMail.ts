import { formatGermanEUR } from '../money';

/** One bill that the intake filed in this run. */
export interface IntakeMailBill {
  fileName: string;
  vendorName: string;
  /** `null` when the PDF had no readable total — never rendered as 0,00 €. */
  grossCents: number | null;
  receivedAt: Date;
}

export interface IntakeMailInput {
  created: IntakeMailBill[];
  /** Bills filed but without a text layer (a scan) — worth a look by hand. */
  noText: number;
  /** Bills that could not be read at all; the next run retries them. */
  failed: number;
  /** Origin of the deployment, e.g. `https://queen.bumbleflies.de`. */
  appUrl: string;
}

export interface IntakeMail {
  subject: string;
  text: string;
}

/** dd.mm.yyyy without depending on the runtime's locale data (same reason as `formatGermanEUR`). */
function germanDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function euro(cents: number | null): string {
  return cents === null ? 'Betrag unbekannt' : formatGermanEUR(cents);
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The confirmation mail sent to the bills mailbox after a run that actually
 * filed something. Deliberately plain text: it is a notification to ourselves,
 * not a customer-facing document.
 *
 * Returns `null` when nothing new arrived, so an hourly schedule stays quiet.
 */
export function intakeMail(input: IntakeMailInput): IntakeMail | null {
  if (input.created.length === 0) return null;

  const n = input.created.length;
  const subject =
    n === 1
      ? 'Neuer Beleg im Postfach: 1 Beleg abgelegt'
      : `Neue Belege im Postfach: ${n} Belege abgelegt`;

  const lines = [
    'Hallo,',
    '',
    `die Beleg-Erkennung hat ${n === 1 ? 'einen neuen Beleg' : `${n} neue Belege`} aus dem Postfach geholt, ` +
      'im Belege-Ordner abgelegt und ausgelesen:',
    '',
  ];

  for (const bill of input.created) {
    const vendor = bill.vendorName.trim() || 'Absender unbekannt';
    lines.push(`  ${germanDate(bill.receivedAt)}  ${vendor}  ${bill.fileName}  ${euro(bill.grossCents)}`);
  }

  if (input.noText > 0) {
    lines.push(
      '',
      `${count(input.noText, 'Beleg', 'Belege')} ohne lesbaren Text (Scan) — bitte einmal von Hand ansehen.`,
    );
  }
  if (input.failed > 0) {
    lines.push(
      '',
      `${count(input.failed, 'Beleg konnte', 'Belege konnten')} nicht gelesen werden; der nächste Lauf versucht es erneut.`,
    );
  }

  lines.push(
    '',
    'In Queen ansehen:',
    `${input.appUrl.replace(/\/+$/, '')}/finance?tab=bills`,
    '',
    'Diese Mail schreibt Queen automatisch, sobald neue Belege eingegangen sind.',
  );

  return { subject, text: lines.join('\n') };
}
