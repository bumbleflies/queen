import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { formatDate, formatDateTime, formatEUR } from '../lib/format';
import { parseReference } from '../lib/reference';

interface BankTx {
  _id: unknown;
  fireflyJournalId: string;
  date: string | Date;
  amountCents: number;
  currency: string;
  description: string;
  counterpartyName?: string;
  counterpartyIban?: string;
  matchedInvoiceId?: unknown;
  matchMethod?: string;
  ignored?: boolean;
}

interface OpenItem {
  id: string;
  invoiceNumber: string;
  customerNumber: number;
  clientName: string;
  openCents: number;
  dueDate?: string | Date | null;
}

interface InvoiceSummary {
  _id: unknown;
  invoiceNumber: string;
  status: string;
}

interface ReconcileRunRow {
  finishedAt?: string | Date | null;
  fetched?: number;
  matched?: number;
  partial?: number;
  unmatched?: number;
  error?: string | null;
}

interface Suggestion {
  id: string;
  invoiceNumber: string;
  clientName: string;
  openCents: number;
  why: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

function suggestionsFor(tx: BankTx, openItems: OpenItem[]): { reason: string; suggestions: Suggestion[] } {
  const parsed = parseReference(tx.description);
  const out: Suggestion[] = [];
  let reason = 'Kein Verwendungszweck im Format Kundennr-Rechnungsnr erkannt.';

  if (parsed) {
    const candidate = openItems.find((i) => i.invoiceNumber === parsed.invoiceNumber);
    if (candidate && parsed.customerNumber !== null && parsed.customerNumber !== candidate.customerNumber) {
      reason = `Kundennummer ${parsed.customerNumber} passt nicht zu Rechnung ${parsed.invoiceNumber} (Kunde ${candidate.customerNumber}).`;
    } else if (candidate) {
      reason = 'Verwendungszweck erkannt, Betrag/Nummer prüfen.';
    }
  }

  for (const item of openItems) {
    const whys: string[] = [];
    if (parsed && parsed.invoiceNumber === item.invoiceNumber) whys.push('Rechnungsnr. passt');
    if (item.openCents === tx.amountCents) whys.push('Betrag exakt');
    if (
      tx.counterpartyName &&
      normalize(item.clientName).length > 0 &&
      normalize(tx.counterpartyName).includes(normalize(item.clientName))
    ) {
      whys.push('Auftraggeber ≈ Kunde');
    }
    if (whys.length > 0) {
      out.push({
        id: item.id,
        invoiceNumber: item.invoiceNumber,
        clientName: item.clientName,
        openCents: item.openCents,
        why: whys.join(' · '),
      });
    }
  }

  out.sort((a, b) => (b.why.includes('Betrag exakt') ? 1 : 0) - (a.why.includes('Betrag exakt') ? 1 : 0));
  return { reason, suggestions: out };
}

export function BankPage() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const bank = trpc.bank.list.useQuery();
  const openItemsQuery = trpc.reports.openItems.useQuery();
  const invoices = trpc.invoices.list.useQuery();
  const reconcile = trpc.reconcile.status.useQuery();
  const assign = trpc.bank.assign.useMutation();
  const unassign = trpc.bank.unassign.useMutation();
  const ignore = trpc.bank.ignore.useMutation();
  const unignore = trpc.bank.unignore.useMutation();
  const syncNow = trpc.bank.syncNow.useMutation();
  const runNow = trpc.reconcile.runNow.useMutation();

  const [tab, setTab] = useState<'open' | 'done' | 'ignored'>('open');

  const txs = (bank.data ?? []) as unknown as BankTx[];
  const openItems = (openItemsQuery.data?.items ?? []) as unknown as OpenItem[];
  const invoiceById = useMemo(() => {
    const map = new Map<string, InvoiceSummary>();
    for (const inv of (invoices.data ?? []) as unknown as InvoiceSummary[]) {
      map.set(String(inv._id), inv);
    }
    return map;
  }, [invoices.data]);

  const openTxs = txs.filter((t) => !t.matchedInvoiceId && !t.ignored);
  const doneTxs = txs.filter((t) => !!t.matchedInvoiceId && !t.ignored);
  const ignoredTxs = txs.filter((t) => t.ignored);

  const run = (reconcile.data ?? null) as unknown as ReconcileRunRow | null;
  const runLabel = run?.finishedAt
    ? `Letzter Abgleich ${formatDateTime(run.finishedAt)}`
    : 'Noch kein Abgleich gelaufen.';

  async function doAssign(bankTxId: string, invoiceId: string) {
    try {
      await assign.mutateAsync({ bankTxId, invoiceId });
      await utils.invalidate();
      toast.show('Zahlung zugeordnet.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function doIgnore(bankTxId: string) {
    try {
      await ignore.mutateAsync({ bankTxId });
      await utils.invalidate();
      toast.show('Buchung ignoriert.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function doUnassign(bankTxId: string) {
    try {
      await unassign.mutateAsync({ bankTxId });
      await utils.invalidate();
      toast.show('Zuordnung aufgehoben.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function doUnignore(bankTxId: string) {
    try {
      await unignore.mutateAsync({ bankTxId });
      await utils.invalidate();
      toast.show('Ignorieren aufgehoben.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleSync() {
    try {
      const result = await syncNow.mutateAsync();
      await utils.invalidate();
      if (result.ok) toast.show(`Synchronisiert: ${result.fetched} Buchungen.`);
      else toast.error(result.error ?? 'Synchronisierung fehlgeschlagen.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleRun() {
    try {
      await runNow.mutateAsync();
      await utils.invalidate();
      toast.show('Abgleich gestartet.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Bankabgleich</h1>
          <p className="page-sub">GLS Geschäftskonto via Firefly · Import 06:00 · Abgleich 07:30</p>
        </div>
        <div className="row acts">
          <button type="button" className="btn ghost" onClick={handleSync}>
            Jetzt synchronisieren
          </button>
          <button type="button" className="btn" onClick={handleRun}>
            Abgleich starten
          </button>
        </div>
      </header>

      <section className="card row" style={{ padding: '14px 20px' }}>
        <span className={`badge ${run?.error ? 'b-cancel' : 'b-paid'}`}>{run?.error ? 'Fehler' : 'OK'}</span>
        <span>{runLabel}</span>
        {run ? (
          <span className="muted" style={{ fontSize: 14 }}>
            {run.fetched ?? 0} Eingänge · {run.matched ?? 0} automatisch zugeordnet ·{' '}
            {run.partial ?? 0} teilweise · {run.unmatched ?? 0} offen
          </span>
        ) : null}
      </section>

      <div role="tablist" aria-label="Buchungen" className="tabs">
        <button
          type="button"
          role="tab"
          className={`tab${tab === 'open' ? ' on' : ''}`}
          onClick={() => setTab('open')}
        >
          Offen ({openTxs.length})
        </button>
        <button
          type="button"
          role="tab"
          className={`tab${tab === 'done' ? ' on' : ''}`}
          onClick={() => setTab('done')}
        >
          Zugeordnet ({doneTxs.length})
        </button>
        <button
          type="button"
          role="tab"
          className={`tab${tab === 'ignored' ? ' on' : ''}`}
          onClick={() => setTab('ignored')}
        >
          Ignoriert ({ignoredTxs.length})
        </button>
      </div>

      {tab === 'open' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {openTxs.map((tx) => {
            const { reason, suggestions } = suggestionsFor(tx, openItems);
            return (
              <article className="card" key={String(tx._id)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{tx.counterpartyName || 'Unbekannter Auftraggeber'}</div>
                    <div className="num muted" style={{ fontSize: 13, marginTop: 2 }}>
                      {tx.counterpartyIban} · {formatDate(tx.date)}
                    </div>
                  </div>
                  <div className="num" style={{ fontSize: 22, fontWeight: 500, color: '#1E5B32' }}>
                    {formatEUR(tx.amountCents)}
                  </div>
                </div>
                <div className="ref-box">
                  <span className="muted">Verwendungszweck:</span> <span className="num">{tx.description}</span>
                  <div className="reason">{reason}</div>
                </div>
                {suggestions.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="lbl">Vorschläge</div>
                    {suggestions.map((s) => (
                      <div className="sug" key={s.id}>
                        <div style={{ minWidth: 0 }}>
                          <span className="num">{s.invoiceNumber}</span> · {s.clientName}
                          <div className="muted" style={{ fontSize: 13 }}>{s.why}</div>
                        </div>
                        <div className="row">
                          <span className="num">{formatEUR(s.openCents)}</span>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => doAssign(String(tx._id), s.id)}
                          >
                            Zuordnen
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="row acts">
                  <Link className="btn ghost" to="/invoices">
                    Andere Rechnung wählen …
                  </Link>
                  <button type="button" className="btn ghost" onClick={() => doIgnore(String(tx._id))}>
                    Keine Rechnungszahlung
                  </button>
                </div>
              </article>
            );
          })}
          {openTxs.length === 0 ? (
            <section className="card empty">Alles zugeordnet. Nächster Abgleich täglich 07:30.</section>
          ) : null}
        </div>
      ) : null}

      {tab === 'done' ? (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Auftraggeber</th>
                  <th>Rechnung</th>
                  <th>Methode</th>
                  <th className="right">Betrag</th>
                  <th>Ergebnis</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {doneTxs.map((tx) => {
                  const inv = invoiceById.get(String(tx.matchedInvoiceId));
                  return (
                    <tr key={String(tx._id)}>
                      <td data-l="Datum" className="num">{formatDate(tx.date)}</td>
                      <td data-l="Auftraggeber">{tx.counterpartyName}</td>
                      <td data-l="Rechnung" className="num">
                        {inv ? <Link to={`/invoices/${String(inv._id)}`}>{inv.invoiceNumber}</Link> : '—'}
                      </td>
                      <td data-l="Methode">{tx.matchMethod === 'reference' ? 'Referenz' : 'manuell'}</td>
                      <td data-l="Betrag" className="num right">{formatEUR(tx.amountCents)}</td>
                      <td data-l="Ergebnis">
                        <span className={`badge ${inv?.status === 'paid' ? 'b-paid' : 'b-sent'}`}>
                          {inv?.status === 'paid' ? 'bezahlt' : 'teilbezahlt'}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => doUnassign(String(tx._id))}
                        >
                          Aufheben
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {doneTxs.length === 0 ? <p className="empty">Noch keine zugeordneten Buchungen.</p> : null}
        </section>
      ) : null}

      {tab === 'ignored' ? (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Auftraggeber</th>
                  <th>Verwendungszweck</th>
                  <th className="right">Betrag</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ignoredTxs.map((tx) => (
                  <tr key={String(tx._id)}>
                    <td data-l="Datum" className="num">{formatDate(tx.date)}</td>
                    <td data-l="Auftraggeber">{tx.counterpartyName}</td>
                    <td data-l="Verwendungszweck" className="num w">{tx.description}</td>
                    <td data-l="Betrag" className="num right">{formatEUR(tx.amountCents)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => doUnignore(String(tx._id))}
                      >
                        Wiederherstellen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ignoredTxs.length === 0 ? <p className="empty">Keine ignorierten Buchungen.</p> : null}
        </section>
      ) : null}
    </>
  );
}
