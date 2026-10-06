export interface ParsedReference {
  customerNumber: number | null;
  invoiceNumber: string;
}

/**
 * Tolerant Verwendungszweck parser (mirrors the server's reconcile regex):
 * banks insert spaces/line breaks. Accepts `<customer>-<YYYYMMDD>-<NN>` and a
 * bare `<YYYYMMDD>-<NN>` (legacy invoices).
 */
export function parseReference(text: string | null | undefined): ParsedReference | null {
  const stripped = (text ?? '').replace(/\s+/g, '');
  const full = stripped.match(/(\d{5})[-/]?(\d{8})[-/]?(\d{2})/);
  if (full) {
    return { customerNumber: Number(full[1]), invoiceNumber: `${full[2]}-${full[3]}` };
  }
  const bare = stripped.match(/(\d{8})[-/]?(\d{2})/);
  if (bare) {
    return { customerNumber: null, invoiceNumber: `${bare[1]}-${bare[2]}` };
  }
  return null;
}
