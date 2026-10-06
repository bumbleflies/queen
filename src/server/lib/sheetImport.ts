/**
 * Pure Sheet → queen import planning (plan Task 10). Takes the CSV export of
 * the ledger Sheet tabs `clientData`, `invoiceData` and `invoicePositions` and
 * produces the documents to write, plus a report of everything that needs a
 * human look. No DB access here — see applySheetImport.ts.
 */
import { invoiceTotals, parseGermanAmount, type InvoiceTotals } from './money';
import { normaliseServicePeriod } from './servicePeriod';

export interface SheetImportInput {
  clientsCsv: string;
  invoicesCsv: string;
  positionsCsv: string;
}

export interface PlannedClient {
  customerNumber: number;
  name: string;
  invoiceAddress: string;
  domain?: string;
  defaultPaymentTermDays: number;
}

export interface PlannedLine {
  position: string;
  description: string;
  quantity: number;
  unitNetCents: number;
  vatRate: number;
}

export type PlannedStatus = 'draft' | 'sent' | 'paid' | 'canceled';

export interface PlannedInvoice {
  invoiceNumber: string;
  legacy: boolean;
  customerNumber: number;
  invoiceAddress: string;
  title: string;
  invoiceDate?: Date;
  servicePeriod: string;
  paymentTermDays: number;
  dueDate?: Date;
  status: PlannedStatus;
  importedPaid: boolean;
  driveFileName?: string;
  lines: PlannedLine[];
  totals: InvoiceTotals;
  sheetTotals: InvoiceTotals;
}

export interface TotalsMismatch {
  invoiceNumber: string;
  sheet: InvoiceTotals;
  computed: InvoiceTotals;
}

export interface ImportPlan {
  clients: PlannedClient[];
  invoices: PlannedInvoice[];
  mismatches: TotalsMismatch[];
  warnings: string[];
  errors: string[];
}

const NEW_NUMBER_RE = /^\d{8}-\d{2}$/;
const VAT_RATES = new Set([0, 0.07, 0.16, 0.19]);

/** RFC 4180 CSV parser (quoted fields may contain commas, quotes and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** Parse a Sheet date `DD.MM.YYYY` as local midnight. */
export function parseGermanDate(s: string): Date {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid date (expected DD.MM.YYYY): ${JSON.stringify(s)}`);
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    throw new Error(`Invalid date: ${JSON.stringify(s)}`);
  }
  return d;
}

function parseVatRate(s: string): number {
  const m = /^(\d+(?:,\d+)?)\s*%$/.exec(s.trim());
  if (!m) throw new Error(`Invalid VAT rate: ${JSON.stringify(s)}`);
  const rate = Number(m[1].replace(',', '.')) / 100;
  if (!VAT_RATES.has(rate)) throw new Error(`Unsupported VAT rate: ${JSON.stringify(s)}`);
  return rate;
}

function parseQuantity(s: string): number {
  const q = Number(s.trim().replace(/\./g, '').replace(',', '.'));
  if (!s.trim() || !Number.isFinite(q)) throw new Error(`Invalid quantity: ${JSON.stringify(s)}`);
  return q;
}

/** Turn a CSV tab into header-keyed records; throws if a required column is missing. */
function records(csv: string, tab: string, required: string[]): Record<string, string>[] {
  const [header, ...rows] = parseCsv(csv);
  const cols = (header ?? []).map((h) => h.trim());
  const missing = required.filter((r) => !cols.includes(r));
  if (missing.length > 0) {
    throw new Error(`${tab}: missing column(s) ${missing.join(', ')}`);
  }
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? ''])));
}

function sameTotals(a: InvoiceTotals, b: InvoiceTotals): boolean {
  return a.netCents === b.netCents && a.vatCents === b.vatCents && a.grossCents === b.grossCents;
}

export function buildImportPlan(input: SheetImportInput): ImportPlan {
  const warnings: string[] = [];
  const errors: string[] = [];

  const clientRows = records(input.clientsCsv, 'clientData', [
    'clientId',
    'clientName',
    'standardInvoiceAddress',
    'clientDomain',
  ]).filter((r) => r.clientId.trim() !== '');
  const invoiceRows = records(input.invoicesCsv, 'invoiceData', [
    'invoiceId',
    'clientId',
    'invoiceAddress',
    'invoiceName',
    'invoiceDate',
    'jobPeriod',
    'paymentTerm',
    'state',
    'finalInvoiceUrl',
    'netSum',
    'grossSum',
    'vatSum',
  ]).filter((r) => r.invoiceId.trim() !== '');
  const positionRows = records(input.positionsCsv, 'invoicePositions', [
    'invoiceId',
    'position',
    'description',
    'quantity',
    'net',
    'vat',
  ]).filter((r) => r.invoiceId.trim() !== '');

  // --- Lines, grouped by invoice in sheet order ---
  const linesByInvoice = new Map<string, PlannedLine[]>();
  const autoNumbered = new Set<string>();
  for (const r of positionRows) {
    const id = r.invoiceId.trim();
    try {
      const lines = linesByInvoice.get(id) ?? [];
      let position = r.position.trim();
      if (!position) {
        position = String(lines.length + 1);
        autoNumbered.add(id);
      }
      lines.push({
        position,
        description: r.description.trim(),
        quantity: parseQuantity(r.quantity),
        unitNetCents: parseGermanAmount(r.net),
        vatRate: parseVatRate(r.vat),
      });
      linesByInvoice.set(id, lines);
    } catch (err) {
      errors.push(`invoicePositions ${id}: ${(err as Error).message}`);
    }
  }
  for (const id of autoNumbered) {
    warnings.push(`${id}: empty position(s) numbered sequentially in sheet order`);
  }

  // --- Invoices ---
  const invoiceIds = new Set(invoiceRows.map((r) => r.invoiceId.trim()));
  for (const id of linesByInvoice.keys()) {
    if (!invoiceIds.has(id)) errors.push(`invoicePositions: lines for unknown invoice ${id}`);
  }

  const knownClients = new Set(clientRows.map((r) => Number(r.clientId.trim())));
  const invoices: PlannedInvoice[] = [];
  const mismatches: TotalsMismatch[] = [];
  for (const r of invoiceRows) {
    const invoiceNumber = r.invoiceId.trim();
    try {
      const customerNumber = Number(r.clientId.trim());
      if (!knownClients.has(customerNumber)) {
        throw new Error(`unknown client ${r.clientId.trim()}`);
      }
      const state = r.state.trim();
      let status: PlannedStatus;
      if (state === 'open' || state === 'overdue') status = 'sent';
      else if (state === 'paid' || state === 'draft' || state === 'canceled') status = state;
      else throw new Error(`unknown state ${JSON.stringify(state)}`);

      const paymentTermDays = Number(r.paymentTerm.trim());
      if (!Number.isInteger(paymentTermDays)) {
        throw new Error(`invalid paymentTerm ${JSON.stringify(r.paymentTerm)}`);
      }
      const invoiceDate = r.invoiceDate.trim() ? parseGermanDate(r.invoiceDate) : undefined;
      if (!invoiceDate && status !== 'draft') throw new Error('issued invoice without invoiceDate');
      let dueDate: Date | undefined;
      if (invoiceDate) {
        dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + paymentTermDays);
      }

      const lines = linesByInvoice.get(invoiceNumber) ?? [];
      if (lines.length === 0 && status !== 'draft') throw new Error('issued invoice without lines');
      const totals = invoiceTotals(lines);
      const sheetTotals = {
        netCents: parseGermanAmount(r.netSum),
        vatCents: parseGermanAmount(r.vatSum),
        grossCents: parseGermanAmount(r.grossSum),
      };
      if (!sameTotals(totals, sheetTotals)) {
        mismatches.push({ invoiceNumber, sheet: sheetTotals, computed: totals });
      }

      const fileName = r.finalInvoiceUrl.trim().replace(/^Gebucht - /, '');
      if (status === 'canceled') {
        warnings.push(
          `${invoiceNumber}: canceled in the Sheet without a credit note — imported as canceled, no Stornorechnung created`,
        );
      }

      invoices.push({
        invoiceNumber,
        legacy: !NEW_NUMBER_RE.test(invoiceNumber),
        customerNumber,
        invoiceAddress: r.invoiceAddress.trim(),
        title: r.invoiceName.trim(),
        invoiceDate,
        servicePeriod: normaliseServicePeriod(r.jobPeriod),
        paymentTermDays,
        dueDate,
        status,
        importedPaid: status === 'paid',
        driveFileName: fileName || undefined,
        lines,
        totals,
        sheetTotals,
      });
    } catch (err) {
      errors.push(`invoiceData ${invoiceNumber}: ${(err as Error).message}`);
    }
  }

  // --- Clients (default term = term of the most recent invoice) ---
  const lastTerm = new Map<number, { date: number; term: number }>();
  for (const inv of invoices) {
    const date = inv.invoiceDate?.getTime() ?? 0;
    const prev = lastTerm.get(inv.customerNumber);
    if (!prev || date >= prev.date) {
      lastTerm.set(inv.customerNumber, { date, term: inv.paymentTermDays });
    }
  }
  const clients: PlannedClient[] = [];
  for (const r of clientRows) {
    const customerNumber = Number(r.clientId.trim());
    if (!Number.isInteger(customerNumber) || customerNumber <= 0) {
      errors.push(`clientData: invalid clientId ${JSON.stringify(r.clientId)}`);
      continue;
    }
    const domain = r.clientDomain.trim();
    clients.push({
      customerNumber,
      name: r.clientName.trim(),
      invoiceAddress: r.standardInvoiceAddress.trim(),
      domain: domain || undefined,
      defaultPaymentTermDays: lastTerm.get(customerNumber)?.term ?? 30,
    });
  }

  return { clients, invoices, mismatches, warnings, errors };
}
