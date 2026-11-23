/**
 * File name of a founder's receipt inside `<receipts>/Spesen/<year>/`.
 * Pure: the intake builds the name from what the PDF said, and the name is the
 * only hint the receipt ranking has when the payment arrives.
 */
export function claimFileName(input: {
  shortName: string;
  period: string;
  vendorName: string;
  invoiceNumber?: string;
}): string {
  const slug = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      // A slash or ampersand is a separator, not a hole: "419/259" → "419-259".
      .replace(/[^\w\s-]+/g, '-')
      .trim()
      .replace(/[\s-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '');

  const parts = ['Spesen', slug(input.shortName), input.period.replace('-', '')];
  if (input.vendorName.trim()) parts.push(slug(input.vendorName));
  if (input.invoiceNumber?.trim()) parts.push(slug(input.invoiceNumber));
  return `${parts.filter(Boolean).join('-').slice(0, 116)}.pdf`;
}
