import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { useLanguage } from '../i18n/LanguageContext';
import { formatDate, formatEUR } from '../lib/format';

interface BillParse {
  vendorName?: string;
  invoiceNumber?: string;
  grossCents?: number | null;
  vatCents?: number | null;
  vatRate?: number | null;
  iban?: string;
  dueDate?: string | Date | null;
  reverseCharge?: boolean;
}

interface BillRow {
  id: string;
  receivedAt: string | Date;
  from: string;
  subject: string;
  fileName: string;
  driveLink: string;
  status: 'parsed' | 'noText' | 'failed';
  ignored: boolean;
  error?: string | null;
  parse?: BillParse | null;
  transaction?: {
    id: string;
    date: string | Date;
    amountCents: number;
    counterpartyName: string | null;
    description: string;
  } | null;
}

/** `"Hetzner Online GmbH" <billing@hetzner.com>` → `Hetzner Online GmbH`. */
function senderName(from: string): string {
  const name = from.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  return name || from;
}

export function BillsPage() {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const me = trpc.me.useQuery();
  const isAdmin = me.data?.user?.role === 'admin';

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const bills = trpc.bills.list.useQuery({ year });
  const intake = trpc.bills.intakeNow.useMutation();
  const setIgnored = trpc.bills.setIgnored.useMutation();

  const rows = (bills.data ?? []) as unknown as BillRow[];
  const years = [currentYear, currentYear - 1, currentYear - 2];

  async function fetchNow() {
    try {
      const result = await intake.mutateAsync();
      await utils.bills.list.invalidate();
      toast.show(
        t('bills.fetched')
          .replace('{new}', String(result.created))
          .replace('{known}', String(result.skipped))
          .replace('{failed}', String(result.failed)),
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function toggleIgnored(row: BillRow) {
    try {
      await setIgnored.mutateAsync({ id: row.id, ignored: !row.ignored });
      await utils.bills.list.invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('bills.title')}</h1>
          <p className="page-sub">{t('bills.sub')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="field"
            style={{ width: 'auto' }}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label={t('common.year')}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {isAdmin ? (
            <button type="button" className="btn" onClick={fetchNow} disabled={intake.isPending}>
              {intake.isPending ? t('bills.fetching') : t('bills.fetch')}
            </button>
          ) : null}
        </div>
      </header>

      <section className="card flush">
        {bills.isLoading ? (
          <p className="empty">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="empty">{t('bills.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>{t('bills.col.received')}</th>
                  <th>{t('bills.col.sender')}</th>
                  <th>{t('bills.col.invoice')}</th>
                  <th>{t('bills.col.due')}</th>
                  <th className="right">{t('bills.col.amount')}</th>
                  <th>{t('bills.col.receipt')}</th>
                  <th>{t('bills.col.payment')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const parsed = row.parse ?? {};
                  const badge = row.status === 'parsed' ? 'b-sent' : row.status === 'noText' ? 'b-draft' : 'b-over';
                  return (
                    <tr key={row.id} style={row.ignored ? { opacity: 0.55 } : undefined}>
                      <td data-l={t('bills.col.received')} className="num">{formatDate(row.receivedAt)}</td>
                      <td data-l={t('bills.col.sender')} className="w">
                        <div>
                          <strong>{parsed.vendorName || senderName(row.from)}</strong>
                          {row.ignored ? <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{t('bills.ignored')}</span> : null}
                        </div>
                        <div className="rc" style={{ fontSize: 12 }} title={row.subject}>{row.subject}</div>
                      </td>
                      <td data-l={t('bills.col.invoice')} className="num">
                        {parsed.invoiceNumber || '—'}
                        <div>
                          <span className={`badge ${badge}`}>
                            {row.status === 'parsed' ? t('bills.status.parsed') : row.status === 'noText' ? t('bills.status.noText') : t('bills.status.failed')}
                          </span>
                        </div>
                        {row.error ? <div className="rc" style={{ fontSize: 12 }}>{row.error}</div> : null}
                      </td>
                      <td data-l={t('bills.col.due')} className="num">{parsed.dueDate ? formatDate(parsed.dueDate) : '—'}</td>
                      <td data-l={t('bills.col.amount')} className="num right" style={{ whiteSpace: 'nowrap' }}>
                        {typeof parsed.grossCents === 'number' ? formatEUR(parsed.grossCents) : '—'}
                        {parsed.reverseCharge ? <div className="rc" style={{ fontSize: 12 }}>{t('bills.reverseCharge')}</div> : null}
                      </td>
                      <td data-l={t('bills.col.receipt')}>
                        {row.driveLink ? (
                          <a href={row.driveLink} target="_blank" rel="noreferrer">{row.fileName}</a>
                        ) : (
                          <span className="muted">{row.fileName}</span>
                        )}
                      </td>
                      <td data-l={t('bills.col.payment')}>
                        {row.transaction ? (
                          <span className="num">
                            {formatDate(row.transaction.date)} · {formatEUR(row.transaction.amountCents)}
                          </span>
                        ) : (
                          <span className="muted">{t('bills.unpaid')}</span>
                        )}
                      </td>
                      <td>
                        {isAdmin ? (
                          <button type="button" className="btn ghost sm" onClick={() => toggleIgnored(row)} disabled={setIgnored.isPending}>
                            {row.ignored ? t('bills.unignore') : t('bills.ignore')}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>{t('bills.hint')}</p>
    </>
  );
}
