import { startOfToday, toDate } from './format';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Shape of one `reports.openItems` row the dashboard reads. */
export interface OpenItem {
  id: string;
  invoiceNumber: string;
  kind: string;
  customerNumber: number | string;
  clientId: string;
  clientName: string;
  title: string;
  dueDate: string | Date | null;
  paidCents: number;
  openCents: number;
  overdue: boolean;
  daysOverdue: number;
}

/** Whole days from `today` until `date` (negative = in the past). */
export function daysUntil(date: string | Date | null | undefined, today: Date = startOfToday()): number | null {
  const d = toDate(date);
  if (!d) return null;
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - today.getTime()) / MS_PER_DAY);
}

const sum = (items: OpenItem[]) => items.reduce((s, i) => s + i.openCents, 0);

export interface AgingBucket {
  key: string;
  label: string;
  cents: number;
  tone: 'due' | 'warn' | 'over';
}

/** Open receivables by age: not yet due, then days past due. */
export function agingBuckets(items: OpenItem[]): AgingBucket[] {
  const bucket = (pred: (i: OpenItem) => boolean) => sum(items.filter(pred));
  return [
    { key: 'due', label: 'nicht fällig', cents: bucket((i) => !i.overdue), tone: 'due' },
    { key: '30', label: '1–30 T', cents: bucket((i) => i.overdue && i.daysOverdue <= 30), tone: 'warn' },
    {
      key: '90',
      label: '31–90 T',
      cents: bucket((i) => i.overdue && i.daysOverdue > 30 && i.daysOverdue <= 90),
      tone: 'warn',
    },
    {
      key: '365',
      label: '91–365 T',
      cents: bucket((i) => i.overdue && i.daysOverdue > 90 && i.daysOverdue <= 365),
      tone: 'over',
    },
    { key: 'old', label: '> 1 Jahr', cents: bucket((i) => i.overdue && i.daysOverdue > 365), tone: 'over' },
  ];
}

export interface MonthSum {
  key: string;
  label: string;
  cents: number;
}

/** Not-yet-overdue open amounts by due month, for this and the next `months - 1` months. */
export function expectedByMonth(items: OpenItem[], months = 3, today: Date = startOfToday()): MonthSum[] {
  const out: MonthSum[] = [];
  for (let n = 0; n < months; n++) {
    const start = new Date(today.getFullYear(), today.getMonth() + n, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + n + 1, 1);
    const cents = sum(
      items.filter((i) => {
        const d = toDate(i.dueDate);
        return !i.overdue && d !== null && d >= start && d < end;
      }),
    );
    out.push({
      key: `${start.getFullYear()}-${start.getMonth() + 1}`,
      label: start.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
      cents,
    });
  }
  return out;
}

/** Open items due within the next `days` days (not overdue). */
export function dueWithin(items: OpenItem[], days: number, today: Date = startOfToday()): OpenItem[] {
  return items.filter((i) => {
    if (i.overdue) return false;
    const n = daysUntil(i.dueDate, today);
    return n !== null && n <= days;
  });
}

export interface ClientGroup {
  clientId: string;
  clientName: string;
  items: OpenItem[];
  cents: number;
}

/** Overdue items grouped by client, largest amount first. */
export function overdueByClient(items: OpenItem[]): ClientGroup[] {
  const map = new Map<string, ClientGroup>();
  for (const i of items) {
    if (!i.overdue) continue;
    const g = map.get(i.clientId) ?? { clientId: i.clientId, clientName: i.clientName, items: [], cents: 0 };
    g.items.push(i);
    g.cents += i.openCents;
    map.set(i.clientId, g);
  }
  return [...map.values()].sort((a, b) => b.cents - a.cents);
}

export interface DueGroup {
  key: string;
  tone: 'over' | 'due';
  /** Due date shared by the group; null for the overdue group. */
  dueDate: Date | null;
  items: OpenItem[];
  cents: number;
}

/** Table sections: one "überfällig" group, then one group per due date. Items keep their order. */
export function groupByDue(items: OpenItem[]): DueGroup[] {
  const groups: DueGroup[] = [];
  const overdue = items.filter((i) => i.overdue);
  if (overdue.length > 0) {
    groups.push({ key: 'over', tone: 'over', dueDate: null, items: overdue, cents: sum(overdue) });
  }
  const byDate = new Map<string, DueGroup>();
  for (const i of items) {
    if (i.overdue) continue;
    const d = toDate(i.dueDate);
    const key = d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : 'none';
    let g = byDate.get(key);
    if (!g) {
      g = { key, tone: 'due', dueDate: d, items: [], cents: 0 };
      byDate.set(key, g);
      groups.push(g);
    }
    g.items.push(i);
    g.cents += i.openCents;
  }
  return groups;
}

/** "in 24 Tagen", "morgen", "heute", "vor 3 Tagen". */
export function relativeDays(n: number): string {
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  return n > 0 ? `in ${n} Tagen` : `vor ${-n} Tagen`;
}
