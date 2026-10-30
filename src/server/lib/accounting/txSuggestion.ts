import { suggestWithHistory, type BookingHistory } from './history';
import { cachedReading, readingToSuggestion, suggestionConflict, type ReadableTx } from './receiptReading';
import type { SuggestSupplier, Suggestion } from './suggest';

/**
 * Suggestion order: rule → history → matched receipts (else a legacy single
 * reading). A receipt that contradicts the winning suggestion does not replace
 * it: it is attached as `conflict` so the row needs a decision.
 *
 * Lives here, not in `receiptReading.ts`: history reads the database, and the
 * reading helpers are also bundled into the client (browser), which must stay
 * free of models and node-only packages.
 */
export function suggestForTx(tx: ReadableTx, suppliers: SuggestSupplier[], history: BookingHistory): Suggestion | null {
  const fromRules = suggestWithHistory(tx, suppliers, history);
  const reading = cachedReading(tx.receiptMatch) ?? cachedReading(tx.receiptReading);
  const files = tx.receiptMatch?.driveFileIds?.length ?? 1;
  const fromReceipt = reading ? readingToSuggestion(reading, tx, files) : null;
  if (!fromRules) return fromReceipt;
  if (!fromReceipt) return fromRules;
  const conflict = suggestionConflict(fromRules, fromReceipt);
  return conflict ? { ...fromRules, conflict, reading: fromReceipt.reading } : fromRules;
}
