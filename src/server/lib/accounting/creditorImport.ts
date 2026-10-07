import { parseCsv } from '../sheetImport';
import { Supplier } from '../../models/Supplier';
import { raiseSupplierCounter } from '../numbering';

export interface CreditorRow {
  kreditorNumber: number;
  name: string;
}

/** Sheet export `creditorName,creditorId` (any column order) → rows + German errors. */
export function parseCreditorsCsv(csv: string): { rows: CreditorRow[]; errors: string[] } {
  const [header, ...data] = parseCsv(csv);
  const nameCol = header?.findIndex((h) => h.trim() === 'creditorName') ?? -1;
  const idCol = header?.findIndex((h) => h.trim() === 'creditorId') ?? -1;
  if (nameCol < 0 || idCol < 0) return { rows: [], errors: ['Kopfzeile braucht creditorName und creditorId'] };

  const rows: CreditorRow[] = [];
  const errors: string[] = [];
  const seen = new Set<number>();
  data.forEach((r, i) => {
    const line = i + 2;
    const name = (r[nameCol] ?? '').trim();
    const raw = (r[idCol] ?? '').trim();
    const kreditorNumber = Number(raw);
    if (!Number.isInteger(kreditorNumber) || kreditorNumber < 70000 || kreditorNumber > 99999) {
      errors.push(`Zeile ${line}: Kreditornummer ${raw} außerhalb 70000–99999`);
      return;
    }
    if (!name) {
      errors.push(`Zeile ${line}: Name fehlt`);
      return;
    }
    if (seen.has(kreditorNumber)) {
      errors.push(`Zeile ${line}: Kreditornummer ${kreditorNumber} doppelt`);
      return;
    }
    seen.add(kreditorNumber);
    rows.push({ kreditorNumber, name });
  });
  return { rows, errors };
}

/** Create missing suppliers by Kreditor number; existing ones are left untouched (renames survive). */
export async function applyCreditorImport(
  rows: CreditorRow[],
  dryRun: boolean,
): Promise<{ created: number; existing: number }> {
  const existingNumbers = new Set(
    (await Supplier.find({ kreditorNumber: { $in: rows.map((r) => r.kreditorNumber) } }).select('kreditorNumber')).map(
      (s) => s.kreditorNumber,
    ),
  );
  const missing = rows.filter((r) => !existingNumbers.has(r.kreditorNumber));
  if (!dryRun) {
    for (const r of missing) await Supplier.create({ kreditorNumber: r.kreditorNumber, name: r.name });
    if (rows.length > 0) await raiseSupplierCounter(Math.max(...rows.map((r) => r.kreditorNumber)));
  }
  return { created: missing.length, existing: rows.length - missing.length };
}
