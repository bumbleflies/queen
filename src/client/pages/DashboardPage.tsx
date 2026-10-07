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
  type DueGroup,
  type OpenItem,
} from '../lib/dashboard';
import { useLanguage } from '../i18n/LanguageContext';
import type { Lang } from '../i18n/LanguageContext';

function formatToday(lang: Lang): string {
  return new Date().toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
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
  const openBank = trpc.bookings.stats.useQuery({ year: new Date().getFullYear() });
  const [filter, setFilter] = useState<Filter>('all');
  const { lang, t } = useLanguage();

  function rel(n: number): string {
    if (n === 0) return t('dash.relToday');
    if (n === 1) return t('dash.relTomorrow');
    if (n === -1) return t('dash.relYesterday');
    if (lang === 'de') return `${t(n > 0 ? 'dash.relIn' : 'dash.relAgo')} ${Math.abs(n)} ${t('dash.relDays')}`;
    return n > 0 ? `${t('dash.relIn')} ${n} ${t('dash.relDays')}` : `${-n} ${t('dash.relDays')} ${t('dash.relAgo')}`;
  }

  function monthLabel(key: string): string {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
      month: 'long',
      year: 'numeric',
    });
  }

  function ageLabel(key: string): string {
    switch (key) {
      case 'due':
        return t('dash.ageDue');
      case '30':
        return `1–30 ${t('dash.dayShort')}`;
      case '90':
        return `31–90 ${t('dash.dayShort')}`;
      case '365':
        return `91–365 ${t('dash.dayShort')}`;
      default:
        return t('dash.ageOld');
    }
  }

  function groupLabel(g: DueGroup): string {
    if (g.tone === 'over') return t('dash.groupOver');
    if (!g.dueDate) return t('dash.noDueDate');
    const n = daysUntil(g.dueDate);
    return `${t('dash.dueOn')} ${formatDate(g.dueDate)}${n !== null ? ` (${rel(n)})` : ''}`;
  }

  function statusText(i: OpenItem): string {
    return i.paidCents > 0 ? t('status.partial') : t('status.sent');
  }

  function agoText(days: number): string {
    if (lang === 'de') return `${t('dash.before')} ${days} ${t('dash.daysPl')}`;
    return `${days} ${t('dash.daysPl')} ${t('dash.before')}`;
  }

  function sinceText(days: number): string {
    if (lang === 'de') return `${t('dash.since')} ${days} ${t('dash.dayShort')}`;
    return `${days}${t('dash.dayShort')} ${t('dash.legendOver')}`;
  }

  const list = (invoices.data ?? []) as unknown as DashboardInvoice[];
  const openItems = reports.data;
  const run = (reconcile.data ?? null) as unknown as ReconcileRunRow | null;
  const openBankCount = openBank.data?.open ?? 0;

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
      : t('dash.noRun');

  const tasks: Task[] = [];
  if (run?.error) {
    tasks.push({
      key: 'import',
      tone: 'over',
      title: t('dash.importFail'),
      sub: run.error,
      to: '/finance',
      cta: t('dash.view'),
    });
  }
  for (const g of overdueClients) {
    const single = g.items.length === 1;
    tasks.push({
      key: `over-${g.clientId}`,
      tone: 'over',
      title: `${plural(g.items.length, t('dash.overOne'), t('dash.overMany'))} ${t('dash.at')} ${g.clientName}`,
      sub: `${formatEUR(g.cents)} · ${g.items.map((i) => `${i.invoiceNumber} ${t('dash.since')} ${i.daysOverdue} ${t('dash.dayShort')}`).join(', ')}`,
      to: single ? `/invoices/${g.items[0].id}` : `/clients/${g.clientId}`,
      cta: single ? t('dash.openInvoice') : t('dash.openClient'),
    });
  }
  if (openBankCount > 0) {
    tasks.push({
      key: 'bank',
      tone: 'warn',
      title: `${plural(openBankCount, t('dash.txOne'), t('dash.txMany'))} ${t('dash.unassigned')}`,
      sub: `${t('dash.importWord')} ${importLabel} · ${t('dash.checkProposal')}`,
      to: '/finance',
      cta: t('bank.assign'),
    });
  }
  if (overpaid.length > 0) {
    tasks.push({
      key: 'overpaid',
      tone: 'warn',
      title: `${plural(overpaid.length, t('dash.invoiceOne'), t('dash.invoiceMany'))} ${t('dash.overpaidWord')}`,
      sub: `${formatEUR(overpaid.reduce((s, i) => s + (i.totals?.grossCents ?? 0), 0))} ${t('dash.grossWord')} · ${t('dash.clarify')}`,
      to: overpaid.length === 1 ? `/invoices/${String(overpaid[0]._id)}` : '/invoices?status=paid',
      cta: t('dash.check'),
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
      title: `${plural(drafts.length, t('dash.draftOne'), t('dash.draftMany'))} ${t('dash.notIssued')}`,
      sub: [
        oldest ? `${t('dash.oldestFrom')} ${formatDate(oldest)}` : null,
        `${formatEUR(drafts.reduce((s, d) => s + (d.totals?.grossCents ?? 0), 0))} ${t('dash.grossWord')}`,
      ]
        .filter(Boolean)
        .join(' · '),
      to: '/invoices?status=draft',
      cta: drafts.length === 1 ? t('dash.openDraft') : t('dash.openDrafts'),
    });
  }

  const shown = filter === 'over' ? overdueItems : filter === 'due' ? notDueItems : items;
  const groups = groupByDue(shown);
  const aging = agingBuckets(items).map((b) => ({ ...b, label: ageLabel(b.key) }));
  const agingMax = Math.max(1, ...aging.map((b) => b.cents));
  const expected = expectedByMonth(items).map((m) => ({ ...m, label: monthLabel(m.key) }));

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: t('dash.filterAll'), count: items.length },
    { key: 'over', label: t('dash.filterOver'), count: overdueItems.length },
    { key: 'due', label: t('dash.filterDue'), count: notDueItems.length },
  ];

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="dash-date">{formatToday(lang)}</p>
          <h1>{t('nav.dashboard')}</h1>
        </div>
        <Link className="btn dash-new" to="/invoices/new">
          {t('dash.new')}
        </Link>
      </header>

      <section aria-label={t('dash.kpis')} className="kpi-strip">
        <Link to="/invoices?status=sent" className="kpi">
          <div className="kpi-label">{t('dash.open')}</div>
          <div className="kpi-value num">{formatEUR(totalOpen)}</div>
          <div className="split" aria-hidden="true">
            <div className="split-over" style={{ width: `${overdueShare}%` }} />
            <div className="split-due" style={{ width: `${totalOpen > 0 ? 100 - overdueShare : 0}%` }} />
          </div>
          <div className="kpi-legend">
            <span>
              <i className="sw sw-over" /> {t('dash.legendOver')} <span className="num">{formatEUR(totalOverdue)}</span>
            </span>
            <span>
              <i className="sw sw-due" /> {t('dash.legendDue')}{' '}
              <span className="num">{formatEUR(totalOpen - totalOverdue)}</span>
            </span>
          </div>
        </Link>
        <Link to="/invoices?status=over" className={`kpi${totalOverdue > 0 ? ' kpi-over' : ''}`}>
          <div className="kpi-label">{t('dash.overdue')}</div>
          <div className="kpi-value num">{formatEUR(totalOverdue)}</div>
          <div className="kpi-sub">
            {overdueItems.length > 0
              ? `${plural(overdueItems.length, t('dash.invoiceOne'), t('dash.invoiceMany'))} · ${plural(overdueClients.length, t('dash.clientOne'), t('dash.clientMany'))} · ${t('dash.oldestSince')} ${oldestOverdue} ${t('dash.daysPl')}`
              : t('dash.nothingOver')}
          </div>
        </Link>
        <Link to="/invoices?status=sent" className="kpi">
          <div className="kpi-label">{t('dash.due30')}</div>
          <div className="kpi-value num">{formatEUR(soonCents)}</div>
          <div className="kpi-sub">
            {soon.length > 0 && nextDue !== null
              ? `${plural(soon.length, t('dash.invoiceOne'), t('dash.invoiceMany'))} · ${t('dash.next')} ${formatDate(soon[0].dueDate)} (${rel(nextDue)})`
              : t('dash.noDue')}
          </div>
        </Link>
        <Link to="/reports" className="kpi">
          <div className="kpi-label">{t('dash.paidIn')} {currentYear}</div>
          <div className={`kpi-value num${paidYtdCents === 0 ? ' kpi-zero' : ''}`}>
            {formatEUR(paidYtdCents)}
          </div>
          <div className="kpi-sub">
            {t('dash.grossWord')} ·{' '}
            {overpaid.length > 0
              ? plural(overpaid.length, t('dash.overpayOne'), t('dash.overpayMany'))
              : t('dash.noOverpay')}
          </div>
        </Link>
      </section>

      <div className="dash-body">
        <div className="dash-main">
          <section className="card flush" aria-labelledby="todo-h">
            <div className="card-head">
              <h2 id="todo-h">
                {t('dash.todo')} <span className="num count">{tasks.length}</span>
              </h2>
            </div>
            {tasks.length === 0 ? (
              <p className="empty">{t('dash.todoEmpty')}</p>
            ) : (
              <ul className="tasks">
                {tasks.map((task) => (
                  <li key={task.key}>
                    <Link to={task.to} className="task">
                      <span className={`dot dot-${task.tone}`} aria-hidden="true" />
                      <span className="task-text">
                        <span className="task-title">{task.title}</span>
                        <span className="task-sub">{task.sub}</span>
                      </span>
                      <span className="task-cta">{task.cta}</span>
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
              <h2 id="open-h">{t('dash.openInvoices')}</h2>
              <Link to="/invoices" className="card-link">
                {t('dash.allInvoices')}
              </Link>
              <div className="filters" role="group" aria-label={t('dash.filter')}>
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

            {openItems && shown.length === 0 ? <p className="empty">{t('dash.noOpen')}</p> : null}

            {shown.length > 0 ? (
              <>
                <div className="table-wrap dash-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('tbl.nr')}</th>
                        <th>{t('tbl.customer')}</th>
                        <th>{t('tbl.service')}</th>
                        <th>{t('tbl.due')}</th>
                        <th className="right">{t('tbl.open')}</th>
                        <th className="right">{t('tbl.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <TableGroup key={g.key} group={g} groupLabel={groupLabel(g)} statusText={statusText} agoText={agoText} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mlist">
                  {groups.map((g) => (
                    <MobileGroup key={g.key} group={g} groupLabel={groupLabel(g)} statusText={statusText} rel={rel} sinceText={sinceText} />
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </div>

        <aside className="dash-rail" aria-label={t('dash.overview')}>
          <section className="card rail-card">
            <div className="rail-head">
              <h2>{t('nav.bank')}</h2>
              <span className={`badge ${importOk ? 'b-paid' : 'b-cancel'}`}>
                {importOk ? t('dash.syncOk') : t('dash.syncErr')}
              </span>
            </div>
            <p className="rail-note">{t('dash.syncNote')} {importLabel}</p>
            <div className="stat3">
              <div>
                <span className="num">{run?.fetched ?? 0}</span>{t('dash.bookings')}
              </div>
              <div>
                <span className="num">{run?.matched ?? 0}</span>{t('dash.assigned')}
              </div>
              <div className={openBankCount > 0 ? 'hot' : ''}>
                <span className="num">{openBankCount}</span>{t('dash.toCheck')}
              </div>
            </div>
            <Link to="/finance" className="card-link">
              {t('dash.toBank')}
            </Link>
          </section>

          <section className="card rail-card">
            <h2>{t('dash.aging')}</h2>
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
                {t('dash.agingNote')}
              </p>
            ) : null}
          </section>

          <section className="card rail-card">
            <h2>{t('dash.expected')}</h2>
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

      <Link className="fab btn honey" to="/invoices/new" aria-label={t('invoices.new')}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>
    </div>
  );
}

function TableGroup({ group, groupLabel, statusText, agoText }: {
  group: DueGroup;
  groupLabel: string;
  statusText: (i: OpenItem) => string;
  agoText: (days: number) => string;
}) {
  return (
    <>
      <tr className={`grp grp-${group.tone}`}>
        <td colSpan={6}>
          {groupLabel} · <span className="num">{formatEUR(group.cents)}</span>
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
            {i.overdue ? <div className="over small strong">{agoText(i.daysOverdue)}</div> : null}
          </td>
          <td className="num right nowrap">{formatEUR(i.openCents)}</td>
          <td className="right muted small">{statusText(i)}</td>
        </tr>
      ))}
    </>
  );
}

function MobileGroup({ group, groupLabel, statusText, rel, sinceText }: {
  group: DueGroup;
  groupLabel: string;
  statusText: (i: OpenItem) => string;
  rel: (n: number) => string;
  sinceText: (days: number) => string;
}) {
  return (
    <section>
      <h3 className={`mgroup grp-${group.tone}`}>
        <span>{groupLabel}</span>
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
                  ? sinceText(i.daysOverdue)
                  : n !== null
                    ? rel(n)
                    : statusText(i)}
              </span>
            </span>
          </Link>
        );
      })}
    </section>
  );
}
