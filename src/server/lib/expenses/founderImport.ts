import type { HydratedDocument } from 'mongoose';
import { z } from 'zod';
import { Founder, type FounderDoc } from '../../models/Founder';
import { Account } from '../../models/Account';
import { normalizeIban } from '../accounting/normalize';

const email = z.string().trim().toLowerCase().email();

/**
 * One founder as imported. Every field is optional so a row can patch an
 * existing founder; at least one identifying field must be present, and a row
 * that creates a new founder needs name, shortName, emails, loginEmail and iban.
 */
export const founderRowSchema = z
  .object({
    name: z.string().trim().min(1, 'Name fehlt').optional(),
    shortName: z.string().trim().min(1).max(12).optional(),
    emails: z
      .array(email)
      .min(1)
      .transform((list) => [...new Set(list)])
      .optional(),
    loginEmail: email
      .refine((e) => e.endsWith('@bumbleflies.de'), 'Login-Adresse muss @bumbleflies.de sein')
      .optional(),
    iban: z.string().trim().min(15).max(34).transform(normalizeIban).optional(),
    bic: z.string().trim().max(11).optional(),
    liabilityAccount: z.string().trim().regex(/^\d{4}$/, 'Konto muss 4 Ziffern haben').optional(),
    legacyCreditorNumber: z.number().int().min(70000).max(99999).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (r) => !!r.name || !!r.shortName || !!r.emails?.length || !!r.loginEmail || !!r.iban,
    'Mindestens ein Zuordnungsfeld fehlt',
  );

export type FounderRow = z.infer<typeof founderRowSchema>;

export interface FounderImportResult {
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  items: { name: string; loginEmail: string; action: 'create' | 'update' | 'unchanged' }[];
  errors: string[];
}

const key = (name: string) => name.trim().toLowerCase();

/** JSON text → validated rows + German errors (`Eintrag N: …`, 1-based). */
export function parseFounderJson(json: string): { rows: FounderRow[]; entries: number[]; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return { rows: [], entries: [], errors: [`Kein gültiges JSON: ${(err as Error).message}`] };
  }
  if (!Array.isArray(data)) return { rows: [], entries: [], errors: ['JSON muss eine Liste von Gesellschaftern sein'] };

  const rows: FounderRow[] = [];
  const entries: number[] = [];
  const errors: string[] = [];
  const names = new Set<string>();
  const logins = new Set<string>();
  const emails = new Map<string, number>();

  data.forEach((item, i) => {
    const res = founderRowSchema.safeParse(item);
    if (!res.success) {
      errors.push(`Eintrag ${i + 1}: ${res.error.issues.map((e) => `${e.path.join('.') || 'Eintrag'}: ${e.message}`).join('; ')}`);
      return;
    }
    const row = res.data;
    const at = `Eintrag ${i + 1}`;
    if (row.name && names.has(key(row.name))) errors.push(`${at}: Name „${row.name}“ doppelt`);
    if (row.loginEmail && logins.has(row.loginEmail)) errors.push(`${at}: Login-Adresse „${row.loginEmail}“ doppelt`);
    for (const address of row.emails ?? []) {
      const first = emails.get(address);
      if (first !== undefined) errors.push(`${at}: E-Mail „${address}“ bereits in Eintrag ${first} verwendet`);
      else emails.set(address, i + 1);
    }
    if (row.name) names.add(key(row.name));
    if (row.loginEmail) logins.add(row.loginEmail);
    rows.push(row);
    entries.push(i + 1);
  });
  return { rows, entries, errors };
}

type FounderEntity = HydratedDocument<FounderDoc>;

interface FounderFields {
  name: string;
  shortName: string;
  emails: string[];
  loginEmail: string;
  iban: string;
  bic: string;
  liabilityAccount: string;
  legacyCreditorNumber: number | null;
  active: boolean;
}

function snapshot(f: FounderEntity | FounderFields): FounderFields {
  return {
    name: f.name ?? '',
    shortName: f.shortName ?? '',
    emails: [...(f.emails ?? [])],
    loginEmail: f.loginEmail ?? '',
    iban: f.iban ?? '',
    bic: f.bic ?? '',
    liabilityAccount: f.liabilityAccount ?? '3500',
    legacyCreditorNumber: f.legacyCreditorNumber ?? null,
    active: f.active ?? true,
  };
}

function patchOf(row: FounderRow, existing?: FounderEntity): FounderFields {
  const base = existing ? snapshot(existing) : snapshot({
    name: '', shortName: '', emails: [], loginEmail: '', iban: '', bic: '',
    liabilityAccount: '3500', legacyCreditorNumber: null, active: true,
  });
  return {
    name: row.name ?? base.name,
    shortName: row.shortName ?? base.shortName,
    emails: row.emails ?? base.emails,
    loginEmail: row.loginEmail ?? base.loginEmail,
    iban: row.iban ?? base.iban,
    bic: row.bic ?? base.bic,
    liabilityAccount: row.liabilityAccount ?? base.liabilityAccount,
    legacyCreditorNumber: row.legacyCreditorNumber ?? base.legacyCreditorNumber,
    active: row.active ?? base.active,
  };
}

/**
 * Upsert founders from JSON. Match by login address, intake addresses or name;
 * an IBAN may confirm but never override those. Validate the whole file before
 * writing anything: a single conflicting row leaves the registry untouched.
 */
export async function applyFounderImport(json: string, dryRun: boolean, actor: string): Promise<FounderImportResult> {
  const parsed = parseFounderJson(json);
  const empty = { created: 0, updated: 0, unchanged: 0, items: [] as FounderImportResult['items'] };
  const rowCount = parsed.rows.length + parsed.errors.length;

  const all = await Founder.find({});
  const byLogin = new Map(all.map((f) => [f.loginEmail.toLowerCase(), f]));
  const byEmail = new Map<string, FounderEntity>();
  const byName = new Map<string, FounderEntity>();
  const byIban = new Map(all.map((f) => [f.iban, f]));
  for (const f of all) {
    for (const address of f.emails) byEmail.set(address.toLowerCase(), f);
    byName.set(key(f.name), f);
  }
  const accounts = new Set(
    (await Account.find({ archived: { $ne: true } }, { number: 1 }).lean()).map((a) => a.number),
  );

  const errors = [...parsed.errors];
  const plan = parsed.rows.map((row, i) => {
    const at = `Eintrag ${parsed.entries[i]}`;
    const matches = new Set<FounderEntity>();
    if (row.loginEmail) {
      const hit = byLogin.get(row.loginEmail);
      if (hit) matches.add(hit);
    }
    if (row.name) {
      const hit = byName.get(key(row.name));
      if (hit) matches.add(hit);
    }
    for (const address of row.emails ?? []) {
      const hit = byEmail.get(address);
      if (hit) matches.add(hit);
    }
    const ibanHit = row.iban ? byIban.get(row.iban) : undefined;
    if (ibanHit) matches.add(ibanHit);

    if (matches.size > 1) errors.push(`${at}: Zuordnung widersprüchlich — mehrere Gesellschafter treffen zu`);
    const existing = matches.size === 1 ? [...matches][0] : undefined;

    if (existing) {
      const nameHit = row.name ? byName.get(key(row.name)) : undefined;
      if (nameHit && nameHit !== existing) errors.push(`${at}: Name „${row.name}“ gehört schon einem anderen Gesellschafter`);
      const loginHit = row.loginEmail ? byLogin.get(row.loginEmail) : undefined;
      if (loginHit && loginHit !== existing) errors.push(`${at}: Login-Adresse „${row.loginEmail}“ gehört schon einem anderen Gesellschafter`);
      for (const address of row.emails ?? []) {
        const hit = byEmail.get(address);
        if (hit && hit !== existing) errors.push(`${at}: E-Mail „${address}“ gehört schon einem anderen Gesellschafter`);
      }
    }
    if (ibanHit && existing && ibanHit !== existing) {
      errors.push(`${at}: IBAN gehört schon einem anderen Gesellschafter`);
    }
    if (!existing) {
      const missing = [
        !row.name && 'Name',
        !row.shortName && 'Kurzname',
        !row.emails?.length && 'E-Mail-Adressen',
        !row.loginEmail && 'Login-Adresse',
        !row.iban && 'IBAN',
      ].filter(Boolean);
      if (missing.length > 0) errors.push(`${at}: Neuer Gesellschafter braucht ${missing.join(', ')}`);
    }
    if (row.liabilityAccount && !accounts.has(row.liabilityAccount)) {
      errors.push(`${at}: Unbekanntes oder archiviertes Konto ${row.liabilityAccount}`);
    }
    return { row, existing };
  });
  if (errors.length > 0) {
    errors.sort((a, b) => Number(a.match(/^Eintrag (\d+)/)?.[1] ?? 0) - Number(b.match(/^Eintrag (\d+)/)?.[1] ?? 0));
    return { rows: rowCount, ...empty, errors };
  }

  const items: FounderImportResult['items'] = [];
  for (const { row, existing } of plan) {
    const next = patchOf(row, existing);
    if (!existing) {
      items.push({ name: next.name, loginEmail: next.loginEmail, action: 'create' });
      if (dryRun) continue;
      await Founder.create({ ...next, emails: next.emails ?? [], createdBy: actor });
      continue;
    }
    const action = JSON.stringify(snapshot(existing)) === JSON.stringify(next) ? 'unchanged' : 'update';
    items.push({ name: next.name, loginEmail: next.loginEmail, action });
    if (dryRun || action === 'unchanged') continue;
    existing.set(next);
    await existing.save();
  }
  const count = (a: FounderImportResult['items'][number]['action']) => items.filter((i) => i.action === a).length;
  return { rows: rowCount, created: count('create'), updated: count('update'), unchanged: count('unchanged'), items, errors };
}
