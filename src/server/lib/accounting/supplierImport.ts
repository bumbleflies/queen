import { z } from 'zod';
import { Supplier } from '../../models/Supplier';
import { Account } from '../../models/Account';
import { allocateSupplierNumber, raiseSupplierCounter } from '../numbering';
import { normalizeIban } from './suggest';
import { BANK_VAT_RATES, type BankBookingMode } from './postingRules';

/** One rule as exported/imported. Missing fields leave an existing supplier's value alone. */
export const supplierRuleSchema = z
  .object({
    kreditorNumber: z.number().int().min(70000).max(99999).optional(),
    name: z.string().trim().min(1, 'Name fehlt'),
    ibans: z.array(z.string()).optional(),
    namePatterns: z.array(z.string()).optional(),
    purposePatterns: z.array(z.string()).optional(),
    defaultAccount: z.string().regex(/^\d{4,5}$/, 'Konto muss 4–5 Ziffern haben').nullable().optional(),
    defaultVatRate: z
      .number()
      .refine((r) => (BANK_VAT_RATES as readonly number[]).includes(r), 'USt-Satz nicht erlaubt')
      .nullable()
      .optional(),
    defaultMode: z.enum(['normal', 'vatOnly', 'reverseCharge']).optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export type SupplierRule = z.infer<typeof supplierRuleSchema>;

export interface SupplierExport {
  kreditorNumber: number;
  name: string;
  ibans: string[];
  namePatterns: string[];
  purposePatterns: string[];
  defaultAccount: string | null;
  defaultVatRate: number | null;
  defaultMode: BankBookingMode;
  archived: boolean;
}

type ImportAction = 'create' | 'update' | 'unchanged';

export interface SupplierImportResult {
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  items: { name: string; kreditorNumber: number | null; action: ImportAction }[];
  errors: string[];
}

function cleanList(list: string[], fn: (s: string) => string = (s) => s.trim()): string[] {
  return list.map(fn).filter((s) => s !== '');
}

const key = (name: string) => name.trim().toLowerCase();

export function toExport(s: {
  kreditorNumber: number;
  name: string;
  ibans: string[];
  namePatterns: string[];
  purposePatterns: string[];
  defaultAccount?: string | null;
  defaultVatRate?: number | null;
  defaultMode?: string | null;
  archived?: boolean | null;
}): SupplierExport {
  return {
    kreditorNumber: s.kreditorNumber,
    name: s.name,
    ibans: [...s.ibans],
    namePatterns: [...s.namePatterns],
    purposePatterns: [...s.purposePatterns],
    defaultAccount: s.defaultAccount ?? null,
    defaultVatRate: s.defaultVatRate ?? null,
    defaultMode: s.defaultMode === 'vatOnly' || s.defaultMode === 'reverseCharge' ? s.defaultMode : 'normal',
    archived: !!s.archived,
  };
}

/** JSON text → validated rules + German errors ("Eintrag N: …", 1-based). */
export function parseSupplierJson(json: string): { rows: SupplierRule[]; entries: number[]; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return { rows: [], entries: [], errors: [`Kein gültiges JSON: ${(err as Error).message}`] };
  }
  if (!Array.isArray(data)) return { rows: [], entries: [], errors: ['JSON muss eine Liste von Regeln sein'] };
  const rows: SupplierRule[] = [];
  const entries: number[] = [];
  const errors: string[] = [];
  const names = new Set<string>();
  const numbers = new Set<number>();
  data.forEach((item, i) => {
    const res = supplierRuleSchema.safeParse(item);
    if (!res.success) {
      errors.push(`Eintrag ${i + 1}: ${res.error.issues.map((e) => `${e.path.join('.') || 'Eintrag'}: ${e.message}`).join('; ')}`);
      return;
    }
    const rule = res.data;
    if (names.has(key(rule.name))) {
      errors.push(`Eintrag ${i + 1}: Name „${rule.name}“ doppelt`);
      return;
    }
    if (rule.kreditorNumber !== undefined && numbers.has(rule.kreditorNumber)) {
      errors.push(`Eintrag ${i + 1}: Kreditornummer ${rule.kreditorNumber} doppelt`);
      return;
    }
    names.add(key(rule.name));
    if (rule.kreditorNumber !== undefined) numbers.add(rule.kreditorNumber);
    rows.push(rule);
    entries.push(i + 1);
  });
  return { rows, entries, errors };
}

/** The supplier fields a rule sets, normalised; undefined = keep. */
function patchOf(rule: SupplierRule) {
  return {
    name: rule.name,
    ibans: rule.ibans && cleanList(rule.ibans, normalizeIban),
    namePatterns: rule.namePatterns && cleanList(rule.namePatterns),
    purposePatterns: rule.purposePatterns && cleanList(rule.purposePatterns),
    defaultAccount: rule.defaultAccount,
    defaultVatRate: rule.defaultVatRate,
    defaultMode: rule.defaultMode,
    archived: rule.archived,
  };
}

/**
 * Upsert rules: match by Kreditor number, else by name (case-insensitive).
 * Validates every row (accounts, number clashes) before writing anything.
 */
export async function applySupplierImport(json: string, dryRun: boolean): Promise<SupplierImportResult> {
  const parsed = parseSupplierJson(json);
  const empty = { created: 0, updated: 0, unchanged: 0, items: [] };
  const rowCount = parsed.rows.length + parsed.errors.length;

  const all = await Supplier.find({});
  const byNumber = new Map(all.map((s) => [s.kreditorNumber, s]));
  const byName = new Map(all.map((s) => [key(s.name), s]));
  const accounts = new Set(
    (await Account.find({ archived: false }).select('number').lean()).map((a) => (a as { number: string }).number),
  );

  const errors = [...parsed.errors];
  const plan = parsed.rows.map((rule, i) => {
    const existing = (rule.kreditorNumber !== undefined ? byNumber.get(rule.kreditorNumber) : undefined) ?? byName.get(key(rule.name));
    const at = `Eintrag ${parsed.entries[i]}`;
    if (rule.defaultAccount && !accounts.has(rule.defaultAccount)) {
      errors.push(`${at}: Unbekanntes oder archiviertes Konto ${rule.defaultAccount}`);
    }
    const sameName = byName.get(key(rule.name));
    if (existing && sameName && sameName !== existing) {
      errors.push(`${at}: Name „${rule.name}“ gehört schon Kreditor ${sameName.kreditorNumber}`);
    } else if (existing && rule.kreditorNumber !== undefined && existing.kreditorNumber !== rule.kreditorNumber) {
      errors.push(`${at}: „${rule.name}“ hat Kreditornummer ${existing.kreditorNumber}, nicht ${rule.kreditorNumber}`);
    }
    return { rule, existing };
  });
  if (errors.length > 0) {
    // parse errors carry the original index; keep them in input order
    errors.sort((a, b) => Number(a.match(/^Eintrag (\d+)/)?.[1] ?? 0) - Number(b.match(/^Eintrag (\d+)/)?.[1] ?? 0));
    return { rows: rowCount, ...empty, errors };
  }

  const items: SupplierImportResult['items'] = [];
  for (const { rule, existing } of plan) {
    const patch = patchOf(rule);
    if (!existing) {
      items.push({ name: rule.name, kreditorNumber: rule.kreditorNumber ?? null, action: 'create' });
      if (dryRun) continue;
      if (rule.kreditorNumber !== undefined) await raiseSupplierCounter(rule.kreditorNumber);
      const created = await Supplier.create({
        name: patch.name,
        ibans: patch.ibans ?? [],
        namePatterns: patch.namePatterns ?? [],
        purposePatterns: patch.purposePatterns ?? [],
        defaultAccount: patch.defaultAccount ?? undefined,
        defaultVatRate: patch.defaultVatRate ?? undefined,
        defaultMode: patch.defaultMode ?? 'normal',
        archived: patch.archived ?? false,
        kreditorNumber: rule.kreditorNumber ?? (await allocateSupplierNumber()),
      });
      items[items.length - 1].kreditorNumber = created.kreditorNumber;
      continue;
    }
    const before = JSON.stringify(toExport(existing));
    const next = toExport(existing);
    for (const [field, value] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
      if (value !== undefined) (next as unknown as Record<string, unknown>)[field] = value;
    }
    const action: ImportAction = JSON.stringify(next) === before ? 'unchanged' : 'update';
    items.push({ name: next.name, kreditorNumber: existing.kreditorNumber, action });
    if (dryRun || action === 'unchanged') continue;
    existing.set({
      name: next.name,
      ibans: next.ibans,
      namePatterns: next.namePatterns,
      purposePatterns: next.purposePatterns,
      defaultAccount: next.defaultAccount ?? undefined,
      defaultVatRate: next.defaultVatRate ?? undefined,
      defaultMode: next.defaultMode,
      archived: next.archived,
    });
    await existing.save();
  }
  const count = (a: ImportAction) => items.filter((i) => i.action === a).length;
  return { rows: rowCount, created: count('create'), updated: count('update'), unchanged: count('unchanged'), items, errors };
}
