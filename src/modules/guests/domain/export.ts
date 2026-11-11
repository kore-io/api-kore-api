import type { AgeGroup, RsvpStatus } from './party';
import { localDate } from './trash';

/** Os formatos (Exportação RN01). O PDF entra com o desenho do Penpot (186(17)). */
export const EXPORT_FORMATS = ['xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number] | 'pdf';

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
