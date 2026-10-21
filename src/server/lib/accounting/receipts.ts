export interface ReceiptFile {
  id: string;
  name: string;
  link: string;
}

export function amountTokens(cents: number): string[] {
  const euros = Math.floor(Math.abs(cents) / 100);
  const rest = String(Math.abs(cents) % 100).padStart(2, '0');
  const tokens = [`${euros},${rest}`, `${euros}.${rest}`];
  if (euros >= 1000) tokens.push(`${euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${rest}`);
  return tokens;
}

const DAY = 24 * 60 * 60 * 1000;

function dateScore(name: string, date: Date): number {
  const full = name.match(/(20\d{2})-?(\d{2})-?(\d{2})/);
  if (full) {
    const d = new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
    return Math.abs(d.getTime() - date.getTime()) <= 10 * DAY ? 2 : 0;
  }
  const month = name.match(/(20\d{2})-?(\d{2})(?!\d)/);
  if (month) {
    return Number(month[1]) === date.getFullYear() && Number(month[2]) === date.getMonth() + 1 ? 1 : 0;
  }
  return 0;
}

function nameScore(fileName: string, who: string | null | undefined): number {
  const tokens = (who ?? '').toLowerCase().split(/[^a-z0-9äöüß]+/).filter((t) => t.length >= 3);
  const lower = fileName.toLowerCase();
  return Math.min(2, tokens.filter((t) => lower.includes(t)).length);
}

function squash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * What the Verwendungszweck says about a file: its Drive id (+10), its name
 * without extension (+5) or a shared number of ≥ 6 digits (+5, whole runs only).
 */
function purposeScore(file: ReceiptFile, description: string | null | undefined): number {
  const purpose = description ?? '';
  if (!purpose) return 0;
  let score = purpose.includes(file.id) ? 10 : 0;
  const stem = squash(file.name.replace(/\.pdf$/i, ''));
  if (stem.length >= 8 && squash(purpose).includes(stem)) score += 5;
  const fileNumbers = new Set(file.name.match(/\d{6,}/g) ?? []);
  if ((purpose.match(/\d{6,}/g) ?? []).some((n) => fileNumbers.has(n))) score += 5;
  return score;
}

/**
 * Best receipt candidates first: Verwendungszweck (≤ +20), amount in name (+3),
 * date ±10 days (+2) / same month (+1), name tokens (≤ +2).
 */
export function rankReceipts(
  files: ReceiptFile[],
  tx: { date: Date; amountCents: number; counterpartyName?: string | null; description?: string | null },
  supplierName?: string,
): (ReceiptFile & { score: number })[] {
  const amounts = amountTokens(tx.amountCents);
  return files
    .map((f) => ({
      ...f,
      score:
        purposeScore(f, tx.description) +
        (amounts.some((a) => f.name.includes(a)) ? 3 : 0) +
        dateScore(f.name, tx.date) +
        nameScore(f.name, supplierName ?? tx.counterpartyName),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** The top candidate when it is clearly the one: score ≥ 5 and ahead of the runner-up. */
export function strongReceipt<T extends { score: number }>(ranked: T[]): T | null {
  const [top, next] = ranked;
  if (!top || top.score < 5) return null;
  return next && next.score >= top.score ? null : top;
}
