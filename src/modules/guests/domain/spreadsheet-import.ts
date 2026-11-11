import { isEmail } from 'class-validator';
import { comparableName } from './paste-list';
import {
  canBeContact,
  GUEST_NAME_MAX,
  PARTY_NAME_MAX,
  TAG_NAME_MAX,
  TAGS_PER_WEDDING_MAX,
  type AgeGroup,
} from './party';
import { parsePhone } from './phone';

/** Os 7 títulos do modelo, nesta ordem (Importação RN02 e RN03; decisão 184, item 1). */
export const TEMPLATE_HEADERS = [
  'Grupo',
  'Nome',
  'Telefone',
  'E-mail',
  'Faixa etária',
  'Restrição alimentar',
  'Tags',
] as const;
/** Até 1.000 linhas de convidado (RN03). */
export const SPREADSHEET_ROWS_MAX = 1_000;
/** Restrição alimentar até 200 caracteres (decisão 189, item 9). */
export const DIETARY_RESTRICTION_MAX = 200;

export type CellValue = string | number | null;

export type RowField =
  'party' | 'name' | 'phone' | 'email' | 'ageGroup' | 'dietaryRestriction' | 'tags';

export type SkippedRow =
  | {
      row: number;
      name: string | null;
      kind: 'error';
      code: string;
      field: RowField;
      params: Record<string, unknown>;
    }
  | {
      row: number;
      name: string;
      kind: 'duplicate';
      code: 'DUPLICATE';
      duplicateOf: { row: number; party: string };
      params: Record<string, never>;
    };

export type ImportWarning =
  { code: 'PARTY_NAME_EXISTS'; party: string } | { code: 'TAG_LIMIT'; tag: string; rows: number[] };

export interface ImportedGuest {
  row: number;
  name: string;
  phone: string | null;
  email: string | null;
  ageGroup: AgeGroup | null;
  dietaryRestriction: string | null;
  /** Os nomes das tags da linha, já sem as que passaram do limite de 10. */
  tags: string[];
}

export interface ImportedParty {
  /** O texto da primeira linha do grupo (RN04). */
  name: string;
  /** Na ordem das linhas. */
  guests: ImportedGuest[];
  /** O índice em guests do contato: o primeiro com telefone ou e-mail (Grupos RN06). */
  contactIndex: number | null;
}

export interface SpreadsheetCheck {
  parties: ImportedParty[];
  skipped: SkippedRow[];
  warnings: ImportWarning[];
  counts: { valid: number; errors: number; duplicates: number };
  /** As tags novas que a importação cria, na ordem de primeira aparição. */
  tagsToCreate: string[];
}

/** Por que o arquivo inteiro é recusado (422). */
export type SpreadsheetRefusal = 'TEMPLATE_MISMATCH' | 'TOO_MANY_ROWS';

/** Texto da célula, sem espaços nas pontas; vazio vira null. */
function text(value: CellValue): string | null {
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/** Faixa etária sem diferenciar maiúsculas, acentos e gênero (decisão 186, item 16). */
const AGE_GROUPS: Record<string, AgeGroup> = {
  adulto: 'adult',
  adulta: 'adult',
  crianca: 'child',
  bebe: 'baby',
};

/** Nome da tag comparável: sem diferenciar maiúsculas e espaços (RN08). */
function tagKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A primeira linha tem os 7 títulos do modelo, nessa ordem (RN03)? Colunas a mais são ignoradas. */
export function matchesTemplate({ header }: { header: readonly CellValue[] }): boolean {
  return TEMPLATE_HEADERS.every(
    (title, index) => comparableName(text(header[index] ?? null) ?? '') === comparableName(title),
  );
}

/**
 * Valida a planilha (Importação RN03 a RN08), sem tocar no banco: rows são as
 * linhas depois da dos títulos, cada uma com as 7 células; firstRow é o número
 * da primeira (2). Linhas em branco não contam nem geram erro. Cada linha com
 * erro aparece uma vez por falha (186(16)); as duplicadas (mesmo nome no mesmo
 * grupo do arquivo) ficam de fora; o grupo leva o texto da primeira linha; as
 * tags novas são criadas até completar 10, na ordem da primeira aparição.
 */
export function checkSpreadsheet({
  rows,
  firstRow,
  activePartyNames,
  activeTagNames,
}: {
  rows: readonly (readonly CellValue[])[];
  firstRow: number;
  activePartyNames: readonly string[];
  activeTagNames: readonly string[];
}): SpreadsheetCheck | SpreadsheetRefusal {
  const filled = rows
    .map((cells, index) => ({ row: firstRow + index, cells }))
    .filter(({ cells }) =>
      cells.slice(0, TEMPLATE_HEADERS.length).some((cell) => text(cell) !== null),
    );
  if (filled.length > SPREADSHEET_ROWS_MAX) return 'TOO_MANY_ROWS';

  const skipped: SkippedRow[] = [];
  const valid: (ImportedGuest & { party: string })[] = [];
  let errorRows = 0;

  for (const { row, cells } of filled) {
    const [partyCell, nameCell, phoneCell, emailCell, ageCell, dietCell, tagsCell] = cells;
    const party = text(partyCell);
    const name = text(nameCell);
    const failures: Omit<Extract<SkippedRow, { kind: 'error' }>, 'row' | 'name' | 'kind'>[] = [];

    if (!name) failures.push({ code: 'NAME_MISSING', field: 'name', params: {} });
    else if (name.length > GUEST_NAME_MAX)
      failures.push({ code: 'TOO_LONG', field: 'name', params: { max: GUEST_NAME_MAX } });
    if (!party) failures.push({ code: 'PARTY_MISSING', field: 'party', params: {} });
    else if (party.length > PARTY_NAME_MAX)
      failures.push({ code: 'TOO_LONG', field: 'party', params: { max: PARTY_NAME_MAX } });

    let phone: string | null = null;
    if (text(phoneCell) !== null) {
      const parsed = parsePhone({ raw: phoneCell as string | number });
      if (parsed.ok) phone = parsed.e164;
      else failures.push({ code: parsed.code, field: 'phone', params: parsed.params });
    }

    const email = text(emailCell)?.toLowerCase() ?? null;
    if (email && !isEmail(email))
      failures.push({ code: 'EMAIL_INVALID', field: 'email', params: {} });

    const ageText = text(ageCell);
    const ageGroup = ageText ? (AGE_GROUPS[comparableName(ageText)] ?? null) : null;
    if (ageText && !ageGroup)
      failures.push({ code: 'AGE_GROUP_INVALID', field: 'ageGroup', params: {} });

    const dietaryRestriction = text(dietCell);
    if (dietaryRestriction && dietaryRestriction.length > DIETARY_RESTRICTION_MAX)
      failures.push({
        code: 'TOO_LONG',
        field: 'dietaryRestriction',
        params: { max: DIETARY_RESTRICTION_MAX },
      });

    // Tags separadas por vírgula; a repetida na mesma célula vale uma vez (187(C)).
    const tags: string[] = [];
    for (const raw of (text(tagsCell) ?? '').split(',')) {
      const tag = raw.replace(/\s+/g, ' ').trim();
      if (!tag || tags.some((existing) => tagKey(existing) === tagKey(tag))) continue;
      if (tag.length > TAG_NAME_MAX)
        failures.push({ code: 'TOO_LONG', field: 'tags', params: { max: TAG_NAME_MAX, tag } });
      else tags.push(tag);
    }

    if (failures.length > 0) {
      errorRows += 1;
      for (const failure of failures) skipped.push({ row, name, kind: 'error', ...failure });
      continue;
    }
    valid.push({
      row,
      party: party as string,
      name: name as string,
      phone,
      email,
      ageGroup,
      dietaryRestriction,
      tags,
    });
  }

  // Grupos pelo nome comparável, com o texto da primeira linha (RN04); a segunda
  // linha com o mesmo nome no mesmo grupo fica de fora (RN06).
  const groups = new Map<
    string,
    { name: string; guests: ImportedGuest[]; seen: Map<string, number> }
  >();
  let duplicates = 0;
  for (const { party, ...guest } of valid) {
    const key = comparableName(party);
    const group = groups.get(key) ?? { name: party, guests: [], seen: new Map<string, number>() };
    groups.set(key, group);
    const nameKey = comparableName(guest.name);
    const firstRowOfName = group.seen.get(nameKey);
    if (firstRowOfName !== undefined) {
      duplicates += 1;
      skipped.push({
        row: guest.row,
        name: guest.name,
        kind: 'duplicate',
        code: 'DUPLICATE',
        duplicateOf: { row: firstRowOfName, party: group.name },
        params: {},
      });
      continue;
    }
    group.seen.set(nameKey, guest.row);
    group.guests.push(guest);
  }

  // Tags novas até completar 10, na ordem de primeira aparição (RN08; 186).
  const active = new Set(activeTagNames.map(tagKey));
  const tagsToCreate: string[] = [];
  const overLimit = new Map<string, { tag: string; rows: number[] }>();
  const ordered = [...groups.values()]
    .flatMap((group) => group.guests)
    .sort((a, b) => a.row - b.row);
  for (const guest of ordered) {
    guest.tags = guest.tags.filter((tag) => {
      const key = tagKey(tag);
      if (active.has(key) || tagsToCreate.some((created) => tagKey(created) === key)) return true;
      if (active.size + tagsToCreate.length < TAGS_PER_WEDDING_MAX) {
        tagsToCreate.push(tag);
        return true;
      }
      const warning = overLimit.get(key) ?? { tag, rows: [] };
      warning.rows.push(guest.row);
      overLimit.set(key, warning);
      return false;
    });
  }

  const existing = new Set(activePartyNames.map(comparableName));
  const parties: ImportedParty[] = [...groups.values()]
    .filter((group) => group.guests.length > 0)
    .map((group) => {
      const contact = group.guests.findIndex((guest) => canBeContact(guest));
      return {
        name: group.name,
        guests: group.guests,
        contactIndex: contact === -1 ? null : contact,
      };
    });

  return {
    parties,
    skipped: skipped.sort((a, b) => a.row - b.row),
    warnings: [
      ...parties
        .filter((party) => existing.has(comparableName(party.name)))
        .map((party) => ({ code: 'PARTY_NAME_EXISTS' as const, party: party.name })),
      ...[...overLimit.values()].map((warning) => ({ code: 'TAG_LIMIT' as const, ...warning })),
    ],
    counts: {
      valid: parties.reduce((total, party) => total + party.guests.length, 0),
      errors: errorRows,
      duplicates,
    },
    tagsToCreate,
  };
}
