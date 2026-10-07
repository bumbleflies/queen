export interface ParsedReference {
  customerNumber: number | null;
  invoiceNumber: string;
}

/**
 * Tolerant Verwendungszweck parser (mirrors the server's reconcile regex):
 * labeled `RNR <invoice> KD <customer>` (either order), `<customer>-<YYYYMMDD>-<NN>`
 * and a bare `<YYYYMMDD>-<NN>`. Banks insert spaces/line breaks; EREF-style
 * digit blocks must not shadow a labeled reference, so labels are tried first.
 */
export function parseReference(text: string | null | undefined): ParsedReference | null {
  const src = text ?? '';
  const rnr = /RNR\s*(\d{8})\s*[-/ ]?\s*(\d{2})/i.exec(src);
  if (rnr) {
    const kd = /(?:\bKD\b|\bKunde\b|\bKundennr\.?)\s*(\d{5})/i.exec(src);
    return {
      customerNumber: kd ? Number(kd[1]) : null,
      invoiceNumber: `${rnr[1]}-${rnr[2]}`,
    };
  }
  const stripped = src.replace(/\s+/g, '');
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
