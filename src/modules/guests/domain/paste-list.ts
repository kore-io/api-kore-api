import { GUEST_NAME_MAX, PARTY_NAME_MAX } from './party';

/** "+ N" de 1 a 20 por linha (Importação RN10; decisão 186, item 16). */
export const PLUS_MIN = 1;
export const PLUS_MAX = 20;
/** Até 1.000 convidados por importação, contando as pessoas sem nome (RN10). */
export const IMPORT_GUESTS_MAX = 1_000;

export type PasteWarning =
  'PARTY_NAME_EXISTS' | 'DUPLICATE_REMOVED' | 'TOO_LONG' | 'PLUS_OUT_OF_RANGE';

export interface PastedGroup {
  /** Número da linha no texto (1 = a primeira). */
  line: number;
  source: string;
  /** Nulo na linha só com "+ N": o app preenche com a 1ª pessoa (189(7)). */
  name: string | null;
  /** Nulo é a pessoa sem nome ("Nome da 2ª pessoa"). */
  guests: { name: string | null }[];
  warnings: PasteWarning[];
  /**
   * Quantos nomes repetidos saíram do grupo ("Jorge, jorge, JORGE" dá 2): o app
   * os soma ao removedInPreview (RN14; decisão 210(4)).
   */
  duplicatesRemoved: number;
}

export interface PastedList {
  groups: PastedGroup[];
  /** Linhas que viraram grupo sem nenhuma pessoa e saíram da prévia (189(7)). */
  droppedLines: number[];
}

/**
 * Nome comparável: sem diferenciar maiúsculas, acentos e espaços (Importação
 * RN04, RN06 e RN07).
 */
export function comparableName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "+ 2 filhos", "+1", "+ 3": o "+", o número e o que vier depois, até o fim da linha. */
const PLUS = /\+\s*(\d+)\b.*$/;
/** Vírgula, " e " (sem diferenciar maiúsculas), "&" ou "/" separam as pessoas. */
const SEPARATORS = /\s*,\s*|\s+e\s+|\s*&\s*|\s*\/\s*/i;

/**
 * Lê a lista colada (Importação RN10; decisão 184, item 2): uma linha por
 * grupo; o texto antes do primeiro ":" é o nome do grupo; sem ":", o grupo é a
 * linha sem o "+ N…". Cada "+ N" de 1 a 20 cria N pessoas sem nome; fora disso,
 * o aviso PLUS_OUT_OF_RANGE e nenhuma pessoa sem nome. O nome repetido no mesmo
 * grupo sai (DUPLICATE_REMOVED); nome de pessoa ou de grupo acima de 80 fica,
 * com o aviso TOO_LONG. Grupo sem nenhuma pessoa sai (droppedLines). O aviso
 * PARTY_NAME_EXISTS depende do banco e entra depois.
 */
export function parsePastedList({ text }: { text: string }): PastedList {
  const groups: PastedGroup[] = [];
  const droppedLines: number[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const source = raw.trim();
    if (!source) return;
    const line = index + 1;
    const warnings = new Set<PasteWarning>();

    const colon = source.indexOf(':');
    const groupPart = colon === -1 ? null : source.slice(0, colon).trim();
    let peoplePart = colon === -1 ? source : source.slice(colon + 1);

    let unnamed = 0;
    const plus = PLUS.exec(peoplePart);
    if (plus) {
      peoplePart = peoplePart.slice(0, plus.index);
      const n = Number(plus[1]);
      if (n >= PLUS_MIN && n <= PLUS_MAX) unnamed = n;
      else warnings.add('PLUS_OUT_OF_RANGE');
    }
    peoplePart = peoplePart.trim();

    const named: string[] = [];
    const seen = new Set<string>();
    let duplicatesRemoved = 0;
    for (const person of peoplePart ? peoplePart.split(SEPARATORS) : []) {
      const name = person.replace(/\s+/g, ' ').trim();
      if (!name) continue;
      const key = comparableName(name);
      if (seen.has(key)) {
        warnings.add('DUPLICATE_REMOVED');
        duplicatesRemoved += 1;
        continue;
      }
      seen.add(key);
      named.push(name);
    }

    // Sem ":", o grupo é a linha sem o "+ N…" (a pessoa sozinha ou o casal).
    const name = (groupPart ?? peoplePart).replace(/\s+/g, ' ').trim() || null;
    if (named.length + unnamed === 0) {
      droppedLines.push(line);
      return;
    }
    if ((name && name.length > PARTY_NAME_MAX) || named.some((n) => n.length > GUEST_NAME_MAX))
      warnings.add('TOO_LONG');

    groups.push({
      line,
      source,
      name,
      guests: [
        ...named.map((guestName) => ({ name: guestName })),
        ...Array.from({ length: unnamed }, () => ({ name: null })),
      ],
      warnings: [...warnings],
      duplicatesRemoved,
    });
  });

  return { groups, droppedLines };
}

/** Quantos convidados a lista cria, com as pessoas sem nome (o limite de 1.000). */
export function pastedGuestCount({ groups }: { groups: readonly PastedGroup[] }): number {
  return groups.reduce((total, group) => total + group.guests.length, 0);
}

/**
 * Na confirmação: o primeiro par de nomes repetidos no mesmo grupo (Importação
 * RN11: o app reenviou um nome que a prévia tirou), ou null.
 */
export function findDuplicateGuest({
  groups,
}: {
  groups: readonly { guests: readonly string[] }[];
}): { group: number; guest: number } | null {
  for (const [group, { guests }] of groups.entries()) {
    const seen = new Set<string>();
    for (const [guest, name] of guests.entries()) {
      const key = comparableName(name);
      if (seen.has(key)) return { group, guest };
      seen.add(key);
    }
  }
  return null;
}
