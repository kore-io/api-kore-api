import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type {
  CoupleInvitationView,
  MyWeddingDetail,
  MyWeddingItem,
  MyWeddingsView,
} from '@/modules/planner/application/my-weddings.use-cases';
import {
  MY_WEDDING_FILTERS,
  MY_WEDDING_STATUSES,
  type MyWeddingFilter,
  type MyWeddingStatus,
  type WeddingOrigin,
} from '@/modules/planner/domain/my-weddings';

const ORIGINS: WeddingOrigin[] = ['created_by_me', 'referral_link', 'couple_invite'];

/** GET /v1/me/weddings?status=: o filtro da lista (com o Aguardando pagamento; Comissões RN08). */
export class MyWeddingsQuery {
  @ApiProperty({ enum: MY_WEDDING_FILTERS, required: false })
  @IsOptional()
  @IsIn(MY_WEDDING_FILTERS)
  status?: MyWeddingFilter;
}

class MyWeddingsSummaryResponse {
  /** Todos menos pós-evento e expirado (RN03). */
  active: number;
  awaitingCouple: number;
  /** Aguardando pagamento: rascunho com o Pix pendente (Comissões do indicador RN08). */
  awaitingPayment: number;
  /** Comissão disponível, em centavos (Comissões do indicador RN08; decisão 36). */
  @ApiProperty({ example: 6742 }) commissionAvailableCents: number;
}

class PendingResponsesAlertResponse {
  weddingId: string;
  /** Os primeiros nomes; o app junta (revisão, transversal "Nomes do casal"). */
  @ApiProperty({ type: [String], example: ['Ana', 'Marcos'] }) partnerNames: [string, string];
  @ApiProperty({ example: '2026-11-16' }) rsvpDeadline: string;
}

class InvitationsNotSentAlertResponse {
  weddingId: string;
  @ApiProperty({ type: [String], example: ['Ana', 'Marcos'] }) partnerNames: [string, string];
  @ApiProperty({ example: '2027-01-30' }) eventDate: string;
}

class MyWeddingsAlertsResponse {
  @ApiProperty({ type: [PendingResponsesAlertResponse] })
  pendingResponses: PendingResponsesAlertResponse[];
  @ApiProperty({ type: [InvitationsNotSentAlertResponse] })
  invitationsNotSent: InvitationsNotSentAlertResponse[];
}

class MyWeddingItemResponse {
  weddingId: string;
  @ApiProperty({ type: [String], example: ['Ana', 'Marcos'] }) partnerNames: [string, string];
  @ApiProperty({ type: String, nullable: true, example: '2027-01-30' }) eventDate: string | null;
  city: string;
  state: string;
  @ApiProperty({ enum: MY_WEDDING_STATUSES }) status: MyWeddingStatus;
  /** WeddingStats.rsvpPercent; com 0 convidados, o app mostra "—" (RN02). */
  @ApiProperty({ example: 62 }) rsvpPercent: number;
  guestsTotal: number;
  @ApiProperty({ enum: ORIGINS }) origin: WeddingOrigin;
  createdByMe: boolean;
  /** "Aguardando pagamento" (filtro e status derivado; Comissões RN08): só o booleano. */
  awaitingPayment: boolean;
}

/** GET /v1/me/weddings (Meus casamentos RN01 a RN07). */
export class MyWeddingsResponse {
  @ApiProperty({ type: MyWeddingsSummaryResponse }) summary: MyWeddingsSummaryResponse;
  @ApiProperty({ type: MyWeddingsAlertsResponse }) alerts: MyWeddingsAlertsResponse;
  /** A lista inteira, sem paginação, já na ordem da RN02. */
  @ApiProperty({ type: [MyWeddingItemResponse] }) weddings: MyWeddingItemResponse[];

  static from({ view }: { view: MyWeddingsView }): MyWeddingsResponse {
    return view;
  }
}

class MyWeddingStatsResponse {
  guestsTotal: number;
  confirmed: number;
  declined: number;
  pending: number;
}

class CoupleInvitationResponse {
  @ApiProperty({ enum: ['email', 'link'] }) type: 'email' | 'link';
  id: string;
  /** Só no convite por e-mail. */
  @ApiProperty({ required: false }) email?: string;
  @ApiProperty({ required: false }) sentAt?: string;
  expiresAt: string;
  /** Só no link: vigente ou vencido. */
  @ApiProperty({ enum: ['active', 'expired'], required: false }) state?: 'active' | 'expired';
  /** Só no link, só para quem o gerou e enquanto vale (RN09, N1(b)). */
  @ApiProperty({ type: String, nullable: true, required: false }) url?: string | null;
}

/** GET /v1/me/weddings/{id} (Meus casamentos RN08 e RN09). Cache-Control: no-store. */
export class MyWeddingDetailResponse extends MyWeddingItemResponse {
  @ApiProperty({ type: String, nullable: true }) slug: string | null;
  @ApiProperty({ type: MyWeddingStatsResponse }) stats: MyWeddingStatsResponse;
  hasOwner: boolean;
  /**
   * Bloqueado pelo suporte (Casamento bloqueado RN04; decisão 344): Reenviar,
   * Convidar outro e-mail, Cancelar convite e Excluir casamento ficam
   * desabilitados; o Sair deste casamento continua (RN03).
   */
  blocked: boolean;
  /** O vínculo ativo de quem lê (decisão 261(1)). */
  @ApiProperty({ format: 'uuid' }) myMembershipId: string;
  /** O fuso IANA do casamento, para o "Enviado em" (decisão 263). */
  @ApiProperty({ example: 'America/Sao_Paulo' }) timezone: string;
  /** A data, a UF e o endereço (Novo casamento RN08). */
  canEditIdentity: boolean;
  /** Só quando ela criou o casamento. */
  @ApiProperty({ type: [CoupleInvitationResponse] }) coupleInvitations: CoupleInvitationResponse[];

  static from({ detail }: { detail: MyWeddingDetail }): MyWeddingDetailResponse {
    const invitation = (view: CoupleInvitationView): CoupleInvitationResponse =>
      view.type === 'email'
        ? {
            type: 'email',
            id: view.id,
            email: view.email,
            sentAt: view.sentAt.toISOString(),
            expiresAt: view.expiresAt.toISOString(),
          }
        : {
            type: 'link',
            id: view.id,
            expiresAt: view.expiresAt.toISOString(),
            state: view.state,
            url: view.url,
          };
    const item: MyWeddingItem = detail;
    return {
      ...item,
      slug: detail.slug,
      stats: detail.stats,
      hasOwner: detail.hasOwner,
      blocked: detail.blocked,
      myMembershipId: detail.myMembershipId,
      timezone: detail.timezone,
      canEditIdentity: detail.canEditIdentity,
      coupleInvitations: detail.coupleInvitations.map(invitation),
    };
  }
}
