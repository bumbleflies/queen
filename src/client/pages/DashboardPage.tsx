import { useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatDate, formatDateTime, formatEUR, toDate } from '../lib/format';
import {
  agingBuckets,
  daysUntil,
  dueWithin,
  expectedByMonth,
  groupByDue,
  overdueByClient,
  relativeDays,
  type DueGroup,
  type OpenItem,
} from '../lib/dashboard';

function formatToday(): string {
  return new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

interface DashboardInvoice {
  _id?: unknown;
  status: string;
  paidAt?: string | Date | null;
  createdAt?: string | Date | null;
  totals?: { grossCents: number } | null;
  reconcileState?: string | null;
}

interface ReconcileRunRow {
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
  fetched?: number;
  matched?: number;
  partial?: number;
  unmatched?: number;
  error?: string | null;
}

interface Task {
  key: string;
  tone: 'over' | 'warn' | 'neutral';
  title: string;
  sub: string;
  to: string;
  cta: string;
}

type Filter = 'all' | 'over' | 'due';

export function DashboardPage() {
  const invoices = trpc.invoices.list.useQuery();
  const reports = trpc.reports.openItems.useQuery();
  const reconcile = trpc.reconcile.status.useQuery();
  const openBank = trpc.bank.list.useQuery({ unmatchedOnly: true });
  const [filter, setFilter] = useState<Filter>('all');

  const list = (invoices.data ?? []) as unknown as DashboardInvoice[];
  const openItems = reports.data;
  const run = (reconcile.data ?? null) as unknown as ReconcileRunRow | null;
  const openBankCount = openBank.data?.length ?? 0;

  const items = ((openItems?.items ?? []) as unknown as OpenItem[]).filter(
    (i) => i.kind !== 'credit_note',
  );
  const overdueItems = items.filter((i) => i.overdue);
  const notDueItems = items.filter((i) => !i.overdue);

  const currentYear = new Date().getFullYear();
  const paidYtdCents = list
    .filter((inv) => inv.status === 'paid' && toDate(inv.paidAt)?.getFullYear() === currentYear)
    .reduce((sum, inv) => sum + (inv.totals?.grossCents ?? 0), 0);
  const drafts = list.filter((inv) => inv.status === 'draft');
  const overpaid = list.filter((inv) => inv.reconcileState === 'overpaid');

  const totalOpen = openItems?.totalOpenCents ?? 0;
  const totalOverdue = openItems?.totalOverdueCents ?? 0;
  const overdueShare = totalOpen > 0 ? Math.min(100, Math.round((totalOverdue / totalOpen) * 100)) : 0;
  const overdueClients = overdueByClient(items);
  const oldestOverdue = overdueItems.reduce((max, i) => Math.max(max, i.daysOverdue), 0);

  const soon = dueWithin(items, 30);
  const soonCents = soon.reduce((s, i) => s + i.openCents, 0);
  const nextDue = soon[0] ? daysUntil(soon[0].dueDate) : null;

  const importOk = !run?.error;
  const importLabel = run?.finishedAt
    ? formatDateTime(run.finishedAt)
    : run?.startedAt
      ? formatDateTime(run.startedAt)
      : 'kein Lauf';

  const tasks: Task[] = [];
  if (run?.error) {
    tasks.push({
      key: 'import',
      tone: 'over',
      title: 'GLS-Import fehlgeschlagen',
      sub: run.error,
      to: '/bank',
      cta: 'Ansehen',
    });
  }
  for (const g of overdueClients) {
    const single = g.items.length === 1;
    tasks.push({
      key: `over-${g.clientId}`,
      tone: 'over',
      title: `${plural(g.items.length, 'überfällige Rechnung', 'überfällige Rechnungen')} an ${g.clientName}`,
      sub: `${formatEUR(g.cents)} · ${g.items.map((i) => `${i.invoiceNumber} seit ${i.daysOverdue} T`).join(', ')}`,
      to: single ? `/invoices/${g.items[0].id}` : `/clients/${g.clientId}`,
      cta: single ? 'Rechnung öffnen' : 'Kunde öffnen',
    });
  }
  if (openBankCount > 0) {
    tasks.push({
      key: 'bank',
      tone: 'warn',
      title: `${plural(openBankCount, 'Bankbuchung', 'Bankbuchungen')} ohne Zuordnung`,
      sub: `GLS-Import ${importLabel} · Vorschlag prüfen`,
      to: '/bank',
      cta: 'Zuordnen',
    });
  }
  if (overpaid.length > 0) {
    tasks.push({
      key: 'overpaid',
      tone: 'warn',
      title: `${plural(overpaid.length, 'Rechnung', 'Rechnungen')} überzahlt`,
      sub: `${formatEUR(overpaid.reduce((s, i) => s + (i.totals?.grossCents ?? 0), 0))} brutto · Rückzahlung oder Verrechnung klären`,
      to: overpaid.length === 1 ? `/invoices/${String(overpaid[0]._id)}` : '/invoices?status=paid',
      cta: 'Prüfen',
    });
  }
  if (drafts.length > 0) {
    const oldest = drafts
      .map((d) => toDate(d.createdAt))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    tasks.push({
      key: 'drafts',
      tone: 'neutral',
      title: `${plural(drafts.length, 'Entwurf', 'Entwürfe')} nicht gesendet`,
      sub: [
        oldest ? `ältester vom ${formatDate(oldest)}` : null,
        `${formatEUR(drafts.reduce((s, d) => s + (d.totals?.grossCents ?? 0), 0))} brutto`,
      ]
        .filter(Boolean)
        .join(' · '),
      to: '/invoices?status=draft',
      cta: drafts.length === 1 ? 'Entwurf öffnen' : 'Entwürfe öffnen',
    });
  }

  const shown = filter === 'over' ? overdueItems : filter === 'due' ? notDueItems : items;
  const groups = groupByDue(shown);
  const aging = agingBuckets(items);
  const agingMax = Math.max(1, ...aging.map((b) => b.cents));
  const expected = expectedByMonth(items);

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'Alle', count: items.length },
    { key: 'over', label: 'Überfällig', count: overdueItems.length },
    { key: 'due', label: 'Noch nicht fällig', count: notDueItems.length },
  ];

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="dash-date">{formatToday()}</p>
          <h1>Dashboard</h1>
        </div>
        <Link className="btn dash-new" to="/invoices/new">
          + Neue Rechnung
        </Link>
      </header>

      <section aria-label="Kennzahlen" className="kpi-strip">
        <Link to="/invoices?status=sent" className="kpi">
          <div className="kpi-label">Offene Posten</div>
          <div className="kpi-value num">{formatEUR(totalOpen)}</div>
          <div className="split" aria-hidden="true">
            <div className="split-over" style={{ width: `${overdueShare}%` }} />
            <div className="split-due" style={{ width: `${totalOpen > 0 ? 100 - overdueShare : 0}%` }} />
          </div>
          <div className="kpi-legend">
            <span>
              <i className="sw sw-over" /> überfällig <span className="num">{formatEUR(totalOverdue)}</span>
            </span>
            <span>
              <i className="sw sw-due" /> nicht fällig{' '}
              <span className="num">{formatEUR(totalOpen - totalOverdue)}</span>
            </span>
          </div>
        </Link>
        <Link to="/invoices?status=over" className={`kpi${totalOverdue > 0 ? ' kpi-over' : ''}`}>
          <div className="kpi-label">Überfällig</div>
          <div className="kpi-value num">{formatEUR(totalOverdue)}</div>
          <div className="kpi-sub">
            {overdueItems.length > 0
              ? `${plural(overdueItems.length, 'Rechnung', 'Rechnungen')} · ${plural(overdueClients.length, 'Kunde', 'Kunden')} · älteste seit ${oldestOverdue} Tagen`
              : 'nichts überfällig'}
          </div>
        </Link>
        <Link to="/invoices?status=sent" className="kpi">
          <div className="kpi-label">Fällig in 30 Tagen</div>
          <div className="kpi-value num">{formatEUR(soonCents)}</div>
          <div className="kpi-sub">
            {soon.length > 0 && nextDue !== null
              ? `${plural(soon.length, 'Rechnung', 'Rechnungen')} · nächste ${formatDate(soon[0].dueDate)} (${relativeDays(nextDue)})`
              : 'keine Fälligkeiten'}
          </div>
        </Link>
        <Link to="/reports" className="kpi">
          <div className="kpi-label">Zahlungseingang {currentYear}</div>
          <div className={`kpi-value num${paidYtdCents === 0 ? ' kpi-zero' : ''}`}>
            {formatEUR(paidYtdCents)}
          </div>
          <div className="kpi-sub">
            brutto ·{' '}
            {overpaid.length > 0
              ? plural(overpaid.length, 'Überzahlung', 'Überzahlungen')
              : 'keine Überzahlungen'}
          </div>
        </Link>
      </section>

      <div className="dash-body">
        <div className="dash-main">
          <section className="card flush" aria-labelledby="todo-h">
            <div className="card-head">
              <h2 id="todo-h">
                Zu erledigen <span className="num count">{tasks.length}</span>
              </h2>
            </div>
            {tasks.length === 0 ? (
              <p className="empty">Nichts zu tun – alles abgeglichen.</p>
            ) : (
              <ul className="tasks">
                {tasks.map((t) => (
                  <li key={t.key}>
                    <Link to={t.to} className="task">
                      <span className={`dot dot-${t.tone}`} aria-hidden="true" />
                      <span className="task-text">
                        <span className="task-title">{t.title}</span>
                        <span className="task-sub">{t.sub}</span>
                      </span>
                      <span className="task-cta">{t.cta}</span>
                      <svg className="task-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card flush" aria-labelledby="open-h">
            <div className="card-head">
              <h2 id="open-h">Offene Rechnungen</h2>
              <Link to="/invoices" className="card-link">
                Alle Rechnungen →
              </Link>
              <div className="filters" role="group" aria-label="Filter">
                {filters.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={`pill${filter === f.key ? ' on' : ''}`}
                    aria-pressed={filter === f.key}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label} <span className="num">{f.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {openItems && shown.length === 0 ? <p className="empty">Keine offenen Rechnungen.</p> : null}

            {shown.length > 0 ? (
              <>
                <div className="table-wrap dash-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Nr.</th>
                        <th>Kunde</th>
                        <th>Leistung</th>
                        <th>Fällig</th>
                        <th className="right">Offen</th>
                        <th className="right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <TableGroup key={g.key} group={g} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mlist">
                  {groups.map((g) => (
                    <MobileGroup key={g.key} group={g} />
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </div>

        <aside className="dash-rail" aria-label="Übersicht">
          <section className="card rail-card">
            <div className="rail-head">
              <h2>Bankabgleich</h2>
              <span className={`badge ${importOk ? 'b-paid' : 'b-cancel'}`}>
                {importOk ? 'Sync OK' : 'Fehler'}
              </span>
            </div>
            <p className="rail-note">GLS via Firefly · zuletzt {importLabel}</p>
            <div className="stat3">
              <div>
                <span className="num">{run?.fetched ?? 0}</span>Buchungen
              </div>
              <div>
                <span className="num">{run?.matched ?? 0}</span>zugeordnet
              </div>
              <div className={openBankCount > 0 ? 'hot' : ''}>
                <span className="num">{openBankCount}</span>zu prüfen
              </div>
            </div>
            <Link to="/bank" className="card-link">
              Zum Bankabgleich →
            </Link>
          </section>

          <section className="card rail-card">
            <h2>Altersstruktur Forderungen</h2>
            <div className="aging">
              {aging.map((b) => (
                <div key={b.key} className={`aging-row${b.cents === 0 ? ' zero' : ''}`}>
                  <span>{b.label}</span>
                  <span className="bar">
                    <span
                      className={`bar-fill t-${b.tone}`}
                      style={{ width: `${Math.round((b.cents / agingMax) * 100)}%` }}
                    />
                  </span>
                  <span className={`num${b.key === 'old' && b.cents > 0 ? ' over' : ''}`}>
                    {formatEUR(b.cents)}
                  </span>
                </div>
              ))}
            </div>
            {aging[4].cents > 0 ? (
              <p className="rail-note rail-foot">
                Forderungen über 1 Jahr: Verjährung und Wertberichtigung prüfen.
              </p>
            ) : null}
          </section>

          <section className="card rail-card">
            <h2>Erwartete Eingänge</h2>
            <ul className="months">
              {expected.map((m) => (
                <li key={m.key} className={m.cents === 0 ? 'zero' : ''}>
                  <span>{m.label}</span>
                  <span className="num">{formatEUR(m.cents)}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <Link className="fab btn honey" to="/invoices/new" aria-label="Neue Rechnung">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>
    </div>
  );
}

function groupLabel(g: DueGroup): string {
  if (g.tone === 'over') return 'Überfällig';
  if (!g.dueDate) return 'Ohne Fälligkeit';
  const n = daysUntil(g.dueDate);
  return `Fällig am ${formatDate(g.dueDate)}${n !== null ? ` (${relativeDays(n)})` : ''}`;
}

function statusText(i: OpenItem): string {
  return i.paidCents > 0 ? 'teilbezahlt' : 'gesendet';
}

function TableGroup({ group }: { group: DueGroup }) {
  return (
    <>
      <tr className={`grp grp-${group.tone}`}>
        <td colSpan={6}>
          {groupLabel(group)} · <span className="num">{formatEUR(group.cents)}</span>
        </td>
      </tr>
      {group.items.map((i) => (
        <tr key={i.id}>
          <td className="num nowrap">
            <Link to={`/invoices/${i.id}`}>{i.invoiceNumber}</Link>
          </td>
          <td className="client">
            <span className="clamp">{i.clientName}</span>{' '}
            <span className="num muted small">{i.customerNumber}</span>
          </td>
          <td className="muted-ink">{i.title}</td>
          <td className="nowrap">
            <div className="num">{formatDate(i.dueDate)}</div>
            {i.overdue ? <div className="over small strong">vor {i.daysOverdue} Tagen</div> : null}
          </td>
          <td className="num right nowrap">{formatEUR(i.openCents)}</td>
          <td className="right muted small">{statusText(i)}</td>
        </tr>
      ))}
    </>
  );
}

function MobileGroup({ group }: { group: DueGroup }) {
  return (
    <section>
      <h3 className={`mgroup grp-${group.tone}`}>
        <span>{groupLabel(group)}</span>
        <span className="num">{formatEUR(group.cents)}</span>
      </h3>
      {group.items.map((i) => {
        const n = daysUntil(i.dueDate);
        return (
          <Link key={i.id} to={`/invoices/${i.id}`} className="mrow">
            <span className="mrow-main">
              <span className="mrow-t">{i.clientName}</span>
              <span className="mrow-s">
                <span className="num">{i.invoiceNumber}</span> · {i.title}
              </span>
            </span>
            <span className="mrow-side">
              <span className="num mrow-amt">{formatEUR(i.openCents)}</span>
              <span className={`mrow-due${i.overdue ? ' over' : ''}`}>
                {i.overdue
                  ? `seit ${i.daysOverdue} T`
                  : n !== null
                    ? relativeDays(n)
                    : statusText(i)}
              </span>
            </span>
          </Link>
        );
      })}
    </section>
  );
}
