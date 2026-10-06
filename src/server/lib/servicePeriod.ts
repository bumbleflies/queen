/**
 * Normalise a service period like '5.2025' → '05.2025'.
 * Validates /^\d{2}\.\d{4}$/ after normalisation with month 01–12; throws otherwise.
 */
export function normaliseServicePeriod(s: string): string {
  const t = (s ?? '').trim();
  const m = /^(\d{1,2})\.(\d{4})$/.exec(t);
  if (!m) throw new Error(`Invalid service period: ${JSON.stringify(s)}`);
  const month = Number(m[1]);
  if (month < 1 || month > 12) throw new Error(`Invalid service period: ${JSON.stringify(s)}`);
  return `${m[1].padStart(2, '0')}.${m[2]}`;
}
