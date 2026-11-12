import type { AgeGroup, RsvpStatus } from './party';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { localDate } from './trash';

/** Os formatos (Exportação RN01). */
export const EXPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Quem entra (RN02). */
export const EXPORT_WHO = ['all', 'confirmed', 'tag'] as const;
export type ExportWho = (typeof EXPORT_WHO)[number];

/** As colunas, na ordem da tela e do arquivo (RN04). */
export const EXPORT_COLUMNS = [
  'name',
  'party',
  'ageGroup',
  'dietaryRestriction',
  'rsvp',
  'phone',
  'tags',
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

/** Os títulos no arquivo (Pena, decisão 186): a coluna do telefone é só "Telefone". */
export const COLUMN_TITLES: Record<ExportColumn, string> = {
  name: 'Nome',
  party: 'Grupo',
  ageGroup: 'Faixa etária',
  dietaryRestriction: 'Restrição alimentar',
  rsvp: 'Resposta',
  phone: 'Telefone',
  tags: 'Tags',
};

const AGE_LABELS: Record<AgeGroup, string> = { adult: 'Adulto', child: 'Criança', baby: 'Bebê' };
const RSVP_LABELS: Record<RsvpStatus, string> = {
  confirmed: 'Confirmado',
  declined: 'Recusado',
  pending: 'Pendente',
};

/** Um convidado com nome, como sai no arquivo (RN03). */
export interface ExportGuest {
  name: string;
  /** O grupo: o nome não é único (decisão 184(12)), então o PDF agrupa pelo id. */
  partyId: string;
  party: string;
  ageGroup: AgeGroup | null;
  dietaryRestriction: string | null;
  rsvpStatus: RsvpStatus;
  /** O telefone do próprio convidado, inteiro (RN05; decisão 185(5)). */
  phone: string | null;
  /** As do grupo e as do convidado, sem repetir (RN04). */
  tags: string[];
}

/** As colunas pedidas, na ordem do arquivo, sem repetir. */
export function orderedColumns({ columns }: { columns: readonly ExportColumn[] }): ExportColumn[] {
  return EXPORT_COLUMNS.filter((column) => columns.includes(column));
}

/** O texto de cada célula (RN04): toda célula é texto; vazio quando não há. */
export function cellText({ guest, column }: { guest: ExportGuest; column: ExportColumn }): string {
  switch (column) {
    case 'name':
      return guest.name;
    case 'party':
      return guest.party;
    case 'ageGroup':
      return guest.ageGroup ? AGE_LABELS[guest.ageGroup] : '';
    case 'dietaryRestriction':
      return guest.dietaryRestriction ?? '';
    case 'rsvp':
      return RSVP_LABELS[guest.rsvpStatus];
    case 'phone':
      return guest.phone ?? '';
    case 'tags':
      return guest.tags.join(', ');
  }
}

/**
 * convidados-{slug}-{AAAA-MM-DD}.{formato} (RN09): a data de hoje no fuso do
 * casamento (às 23 h em São Paulo vale o dia de São Paulo).
 */
export function exportFileName({
  slug,
  timezone,
  now,
  format,
}: {
  slug: string;
  timezone: string | null;
  now: Date;
  format: ExportFormat;
}): string {
  return `convidados-${slug}-${localDate({ at: now, timezone })}.${format}`;
}

/** O telefone no PDF, inteiro e formatado ("(19) 99876-3310"; "+351 912 345 678"). */
export function formatPhone({ e164 }: { e164: string }): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.countryCallingCode === '55'
    ? parsed.formatNational()
    : parsed.formatInternational();
}

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' });
const DAY = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * O subtítulo do topo do PDF (RN01): "Sábado, 14/11/2026 · Campinas (SP)". Sem
 * data ou sem cidade, a parte que falta some, sem o " · " sobrando (189(10)).
 * A data do casamento é um dia, sem hora (guardado como meia-noite UTC).
 */
export function eventLine({
  eventDate,
  city,
  state,
}: {
  eventDate: Date | null;
  city: string | null;
  state: string | null;
}): string {
  const weekday = eventDate ? WEEKDAY.format(eventDate) : '';
  const date = eventDate
    ? `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${DAY.format(eventDate)}`
    : null;
  const place = city ? (state ? `${city} (${state})` : city) : null;
  return [date, place].filter(Boolean).join(' · ');
}

/** O filtro no topo (RN01): "Confirmados", "Tag: Padrinhos" ou "Todos os convidados". */
export function filterLabel({ who, tagName }: { who: ExportWho; tagName?: string }): string {
  if (who === 'confirmed') return 'Confirmados';
  if (who === 'tag') return `Tag: ${tagName ?? ''}`;
  return 'Todos os convidados';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * O resumo do PDF (RN01): "96 convidados · 78 adultos · 12 crianças · 4 bebês
 * · 2 sem faixa etária", com singular e sem a faixa que tem zero.
 */
export function summaryLine({ guests }: { guests: readonly ExportGuest[] }): string {
  const count = (age: AgeGroup | null) => guests.filter((guest) => guest.ageGroup === age).length;
  const parts = [plural(guests.length, 'convidado', 'convidados')];
  const adults = count('adult');
  const children = count('child');
  const babies = count('baby');
  const none = count(null);
  if (adults) parts.push(plural(adults, 'adulto', 'adultos'));
  if (children) parts.push(plural(children, 'criança', 'crianças'));
  if (babies) parts.push(plural(babies, 'bebê', 'bebês'));
  if (none) parts.push(`${none} sem faixa etária`);
  return parts.join(' · ');
}

/** O rodapé (RN01, RN09): a data de hoje no fuso do casamento. */
export function generatedLine({ now, timezone }: { now: Date; timezone: string | null }): string {
  const [year, month, day] = localDate({ at: now, timezone }).split('-');
  return `Gerado pelo Kore em ${day}/${month}/${year}`;
}
