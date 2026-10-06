import type { Request, Response } from 'express';
import { Invoice } from '../models/Invoice';
import { Client } from '../models/Client';

/** Render a JS value as a CSV cell, quoting when it contains separators. */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatGermanDate(value: Date | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/**
 * Sheet-shaped CSV export for the tax advisor. Admin-authenticated via
 * `requireAuth` + `requireAdmin` before this handler runs.
 */
export async function exportInvoicesCsv(_req: Request, res: Response): Promise<void> {
  try {
    const [invoices, clients] = await Promise.all([
      Invoice.find({}).sort({ createdAt: -1 }),
      Client.find({}).select('name'),
    ]);
    const nameById = new Map(clients.map((c) => [String(c._id), c.name]));

    const header = [
      'invoiceNumber',
      'legacy',
      'kind',
      'customerNumber',
      'clientName',
      'invoiceDate',
      'servicePeriod',
      'paymentTermDays',
      'dueDate',
      'currency',
      'status',
      'netCents',
      'vatCents',
      'grossCents',
      'title',
    ];

    const rows = invoices.map((inv) =>
      [
        inv.invoiceNumber,
        inv.legacy,
        inv.kind,
        inv.customerNumber,
        nameById.get(String(inv.clientId)) ?? '',
        formatGermanDate(inv.invoiceDate),
        inv.servicePeriod,
        inv.paymentTermDays,
        formatGermanDate(inv.dueDate),
        inv.currency,
        inv.status,
        inv.totals?.netCents ?? 0,
        inv.totals?.vatCents ?? 0,
        inv.totals?.grossCents ?? 0,
        inv.title,
      ]
        .map(csvCell)
        .join(','),
    );

    const csv = [header.join(','), ...rows].join('\r\n') + '\r\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
    res.send('\uFEFF' + csv);
  } catch {
    res.status(500).json({ error: 'export failed' });
  }
}
