import { Inject, Injectable } from '@nestjs/common';
import { SupportContext } from '../../../shared/database/support-context';
import { WeddingActionForbiddenError, WeddingNotFoundError } from '../domain/access.errors';
import {
  canManageSiteIdentity,
  roleAllows,
  type MembershipRole,
  type WeddingAction,
} from '../domain/wedding-authorization';
import { MEMBERSHIP_READER, type MembershipReader } from './ports/membership-reader.port';
import { PLANNER_PROFILES, type PlannerProfiles } from './ports/planner-profiles.port';

/**
 * Autorização central: can({ userId, weddingId, action }) (Parecer, CTO r3 item
 * 3; decisão 153). Os casos de uso chamam esta porta; a RLS é a segunda barreira.
 */
@Injectable()
export class WeddingAuthorization {
  constructor(
    @Inject(MEMBERSHIP_READER) private readonly memberships: MembershipReader,
    @Inject(PLANNER_PROFILES) private readonly plannerProfiles: PlannerProfiles,
    private readonly support: SupportContext,
  ) {}

  /**
   * O papel na requisição: no Ver como o casal, o staff vê o casamento da
   * sessão como a colaboradora (Backoffice - acesso RN08: a Cobrança sem
   * valores; a escrita já parou no guard).
   */
  private async roleOf({ userId, weddingId }: { userId: string; weddingId: string }) {
    if (this.support.forWedding(weddingId)) return 'collaborator' as const;
    return this.memberships.activeRole({ userId, weddingId });
  }

  /**
   * A ação `manage_site_identity` (Dados básicos RN04): depende do papel, do
   * perfil de indicador e de o casamento ter dono ativo. Sem vínculo, false.
   */
  async canManageSiteIdentity({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<boolean> {
    if (this.support.forWedding(weddingId)) return false;
    const role = await this.roleOf({ userId, weddingId });
    if (role === null) return false;
    if (role === 'owner') return true;
    const origin = await this.memberships.weddingOrigin({ weddingId });
    return canManageSiteIdentity({
      role,
      referrerKind: await this.plannerProfiles.referrerKind({ userId }),
      hasActiveOwner: await this.memberships.hasActiveOwner({ weddingId }),
      createdByMe: origin?.createdByUserId === userId,
      referralSource: origin?.referralSource ?? null,
    });
  }

  async can({
    userId,
    weddingId,
    action,
  }: {
    userId: string;
    weddingId: string;
    action: WeddingAction;
  }): Promise<boolean> {
    const role = await this.roleOf({ userId, weddingId });
    return role !== null && roleAllows({ role, action });
  }

  /**
   * Exige a ação: sem vínculo, WeddingNotFoundError (404, RN01); com vínculo e
   * sem permissão, WeddingActionForbiddenError (403). Devolve o papel.
   */
  /** O papel da pessoa quando ela pode a ação; senão, nulo (sem lançar). */
  async allowedRole({
    userId,
    weddingId,
    action,
  }: {
    userId: string;
    weddingId: string;
    action: WeddingAction;
  }): Promise<MembershipRole | null> {
    const role = await this.roleOf({ userId, weddingId });
    return role !== null && roleAllows({ role, action }) ? role : null;
  }

  async require({
    userId,
    weddingId,
    action,
  }: {
    userId: string;
    weddingId: string;
    action: WeddingAction;
  }): Promise<MembershipRole> {
    const role = await this.roleOf({ userId, weddingId });
    if (role === null) throw new WeddingNotFoundError();
    if (!roleAllows({ role, action })) throw new WeddingActionForbiddenError();
    return role;
  }
}
