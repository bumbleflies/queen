/** SKR04 accounts queen books against. Generic chart data only — never company figures. */
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface AccountSeed {
  number: string;
  name: string;
  type: AccountType;
  vatRate?: number;
}

export const SKR04_ACCOUNTS: AccountSeed[] = [
  { number: '1200', name: 'Forderungen aus Lieferungen und Leistungen', type: 'asset' },
  { number: '1401', name: 'Abziehbare Vorsteuer 7 %', type: 'asset', vatRate: 0.07 },
  { number: '1406', name: 'Abziehbare Vorsteuer 19 %', type: 'asset', vatRate: 0.19 },
  { number: '1800', name: 'Bank', type: 'asset' },
  { number: '2900', name: 'Gezeichnetes Kapital', type: 'equity' },
  { number: '2930', name: 'Gesetzliche Rücklage', type: 'equity' },
  { number: '2970', name: 'Gewinnvortrag vor Verwendung', type: 'equity' },
  { number: '2978', name: 'Verlustvortrag vor Verwendung', type: 'equity' },
  { number: '3020', name: 'Steuerrückstellungen', type: 'liability' },
  { number: '3035', name: 'Gewerbesteuerrückstellung § 4 Abs. 5b EStG', type: 'liability' },
  { number: '3040', name: 'Körperschaftsteuerrückstellung', type: 'liability' },
  { number: '3300', name: 'Verbindlichkeiten aus Lieferungen und Leistungen', type: 'liability' },
  { number: '3500', name: 'Sonstige Verbindlichkeiten', type: 'liability' },
  { number: '3501', name: 'Sonstige Verbindlichkeiten (bis 1 Jahr)', type: 'liability' },
  { number: '3801', name: 'Umsatzsteuer 7 %', type: 'liability', vatRate: 0.07 },
  { number: '3806', name: 'Umsatzsteuer 19 %', type: 'liability', vatRate: 0.19 },
  { number: '3820', name: 'Umsatzsteuer-Vorauszahlungen', type: 'liability' },
  { number: '3840', name: 'Umsatzsteuer laufendes Jahr', type: 'liability' },
  { number: '3841', name: 'Umsatzsteuer Vorjahr', type: 'liability' },
  { number: '4110', name: 'Sonstige steuerfreie Umsätze Inland', type: 'revenue', vatRate: 0 },
  { number: '4300', name: 'Erlöse 7 % USt', type: 'revenue', vatRate: 0.07 },
  { number: '4400', name: 'Erlöse 19 % USt', type: 'revenue', vatRate: 0.19 },
  { number: '4930', name: 'Erträge aus der Auflösung von Rückstellungen', type: 'revenue' },
  { number: '6260', name: 'Sofortabschreibung geringwertiger Wirtschaftsgüter', type: 'expense' },
  { number: '6300', name: 'Sonstige betriebliche Aufwendungen', type: 'expense' },
  { number: '6420', name: 'Beiträge', type: 'expense' },
  { number: '6600', name: 'Werbekosten', type: 'expense' },
  { number: '6640', name: 'Bewirtungskosten', type: 'expense' },
  { number: '6820', name: 'Zeitschriften, Bücher, digitale Medien', type: 'expense' },
  { number: '6821', name: 'Fortbildungskosten', type: 'expense' },
  { number: '6837', name: 'Aufwendungen für Lizenzen, Konzessionen', type: 'expense' },
  { number: '6855', name: 'Nebenkosten des Geldverkehrs', type: 'expense' },
  { number: '6960', name: 'Periodenfremde Aufwendungen', type: 'expense' },
  { number: '7600', name: 'Körperschaftsteuer', type: 'expense' },
  { number: '7608', name: 'Solidaritätszuschlag', type: 'expense' },
  { number: '7610', name: 'Gewerbesteuer', type: 'expense' },
  { number: '7641', name: 'Gewerbesteuer Nachzahlung/Erstattung Vorjahre', type: 'expense' },
  { number: '9000', name: 'Saldenvorträge Sachkonten', type: 'equity' },
];
