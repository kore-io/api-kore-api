import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { WeddingLifecycleView } from '../application/ports/wedding-deletion.store.port';

/** Excluir o casamento (Retenção e expurgo RN05): o nome do casal digitado. */
export class WeddingDeletionBody {
  /** "Ana & Marcos", como o app mostra (decisão 163). */
  @ApiProperty({ example: 'Ana & Marcos', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  confirmName: string;
}

export class WeddingDeletionScheduledResponse {
  /** O dia do expurgo, AAAA-MM-DD (hoje + 7, no fuso do casamento). */
  @ApiProperty({ example: '2026-11-21' }) deletionScheduledFor: string;
}

/** O bloco `lifecycle` do vínculo, como no GET /v1/me (Casamento bloqueado RN07). */
export class WeddingLifecycleResponse {
  @ApiProperty({
    enum: ['awaiting_couple', 'draft', 'published', 'post_event', 'grace', 'expired'],
  })
  status: string;
  blocked: boolean;
  @ApiProperty({ type: String, nullable: true, example: '2027-02-14' }) endDate: string | null;
  @ApiProperty({ type: String, nullable: true, example: '2027-02-21' }) graceUntil: string | null;
  @ApiProperty({ type: String, nullable: true, example: '2027-02-22' }) expiredAt: string | null;
  @ApiProperty({ type: String, nullable: true }) deletionScheduledFor: string | null;

  static from({ view }: { view: WeddingLifecycleView }): WeddingLifecycleResponse {
    return { ...view };
  }
}

/** Cancelar a exclusão: `200` com o ciclo de vida do casamento. */
export class WeddingDeletionCanceledResponse {
  @ApiProperty({ type: WeddingLifecycleResponse }) lifecycle: WeddingLifecycleResponse;
}
