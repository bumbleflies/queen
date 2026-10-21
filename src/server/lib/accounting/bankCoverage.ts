import { BankTransaction } from '../../models/BankTransaction';
import { JournalEntry } from '../../models/JournalEntry';

export function yearRange(year: number) {
  return { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) };
}

/** Active coverage per fireflyJournalId: 'payment' | 'bank' (+ entry). */
export async function coverageMap(refIds: string[]) {
  const entries = await JournalEntry.find({
    active: true,
    $or: [
      { 'source.kind': 'bank', 'source.refId': { $in: refIds } },
      { 'source.kind': 'payment', 'source.refId': { $in: refIds.map((r) => `bank:${r}`) } },
    ],
  });
  const entryMap = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    const ref = e.source?.kind === 'payment' ? String(e.source.refId).slice('bank:'.length) : String(e.source?.refId);
    entryMap.set(ref, e);
  }
  return entryMap;
}

/** All bank transactions of a year (oldest first) plus their active ledger coverage. */
export async function loadYear(year: number) {
  const txs = await BankTransaction.find({ date: yearRange(year) }).sort({ date: 1, fireflyJournalId: 1 });
  const coverage = await coverageMap(txs.map((t) => t.fireflyJournalId));
  return { txs, coverage };
}

/** Open = not matched to an invoice, not booked and not ignored: what the inbox still waits on. */
export async function openTransactions(year: number) {
  const { txs, coverage } = await loadYear(year);
  return txs.filter((t) => !t.matchedInvoiceId && !t.ignored && !coverage.has(t.fireflyJournalId));
}
