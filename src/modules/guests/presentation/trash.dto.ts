import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsUUID } from 'class-validator';
import type { RestoreResult } from '../application/trash.use-cases';
import type { TrashListRow } from '../application/ports/trash-store.port';

/** Seleção múltipla: até 200 grupos por pedido (contrato). */
const TRASH_MAX = 200;
export const TRASH_ITEM_TYPES = ['party', 'guest', 'tag'] as const;
type TrashItemType = (typeof TRASH_ITEM_TYPES)[number];

const date = { type: String, format: 'date-time' } as const;
/** O dia, no fuso do casamento, até quando o item restaura (RN10). */
const purgeDay = { type: String, format: 'date', example: '2026-12-06' } as const;

export class TrashedPartyResponse {
  id: string;
  name: string;
  /** Os convidados com nome que foram com o grupo. */
  guests: number;
  @ApiProperty(date) deletedAt: string;
  @ApiProperty(purgeDay) purgeAt: string;
}

export class TrashedGuestResponse {
  id: string;
  name: string;
  partyId: string;
  @ApiProperty(date) deletedAt: string;
  @ApiProperty(purgeDay) purgeAt: string;
}

export class TrashedTagResponse {
  id: string;
  name: string;
  /** Pelos vínculos guardados, com a regra da Tags RN05. */
  guests: number;
  @ApiProperty(date) deletedAt: string;
  @ApiProperty(purgeDay) purgeAt: string;
}

export class TrashPartiesBody {
  @ApiProperty({ type: [String], minItems: 1, maxItems: TRASH_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TRASH_MAX)
  @IsUUID('all', { each: true })
  partyIds: string[];
}

export class SkippedPartyResponse {
  id: string;
  name: string;
  @ApiProperty({ enum: ['ALREADY_RESPONDED'] }) reason: 'ALREADY_RESPONDED';
}

export class TrashPartiesResponse {
  trashed: number;
  /** Para cerimonialista e vendedor: os grupos que já responderam ficam (RN07). */
  @ApiProperty({ type: [SkippedPartyResponse] }) skipped: SkippedPartyResponse[];
}

export class TrashPartyItem {
  @ApiProperty({ enum: ['party'] }) type: 'party';
  id: string;
  name: string;
  guests: number;
  @ApiProperty(date) deletedAt: string;
  @ApiProperty(purgeDay) purgeAt: string;
}

export class TrashGuestItem {
  @ApiProperty({ enum: ['guest'] }) type: 'guest';
  id: string;
  name: string;
  partyName: string;
  @ApiProperty(date) deletedAt: string;
  @ApiProperty(purgeDay) purgeAt: string;
}

export class TrashTagItem {
  @ApiProperty({ enum: ['tag'] }) type: 'tag';
  id: string;
  name: string;
  guests: number;
  @ApiProperty(date) deletedAt: string;
  @ApiProperty(purgeDay) purgeAt: string;
}

@ApiExtraModels(TrashPartyItem, TrashGuestItem, TrashTagItem)
export class TrashListResponse {
  /** Do mais novo para o mais antigo (RN08). */
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(TrashPartyItem) },
        { $ref: getSchemaPath(TrashGuestItem) },
        { $ref: getSchemaPath(TrashTagItem) },
      ],
      discriminator: { propertyName: 'type' },
    },
  })
  data: (TrashPartyItem | TrashGuestItem | TrashTagItem)[];

  static from({ rows }: { rows: (TrashListRow & { purgeAt: string })[] }): TrashListResponse {
    return { data: rows.map((row) => ({ ...row, deletedAt: row.deletedAt.toISOString() })) };
  }
}

export class RestoreTrashItemBody {
  @ApiProperty({ enum: TRASH_ITEM_TYPES }) @IsIn(TRASH_ITEM_TYPES) type: TrashItemType;
  @IsUUID() id: string;
}

export class RestoredPartyRef {
  id: string;
  name: string;
}

export class RestoreTrashItemResponse {
  @ApiProperty({ enum: TRASH_ITEM_TYPES }) type: TrashItemType;
  id: string;
  name: string;
  /** Só quando o grupo voltou junto com o convidado. */
  @ApiProperty({ type: RestoredPartyRef, required: false }) restoredParty?: RestoredPartyRef;

  static from({ result }: { result: RestoreResult }): RestoreTrashItemResponse {
    return result;
  }
}
