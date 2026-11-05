import { Inject, Injectable } from '@nestjs/common';
import { WeddingActionForbiddenError, WeddingNotFoundError } from '../domain/access.errors';
import {
  roleAllows,
  type MembershipRole,
  type WeddingAction,
} from '../domain/wedding-authorization';
import { MEMBERSHIP_READER, type MembershipReader } from './ports/membership-reader.port';

/**
 * Autorização central: can({ userId, weddingId, action }) (Parecer, CTO r3 item
 * 3; decisão 153). Os casos de uso chamam esta porta; a RLS é a segunda barreira.
 */
@Injectable()
export class WeddingAuthorization {
  constructor(@Inject(MEMBERSHIP_READER) private readonly memberships: MembershipReader) {}

  async can({
    userId,
    weddingId,
    action,
  }: {
    userId: string;
    weddingId: string;
    action: WeddingAction;
  }): Promise<boolean> {
    const role = await this.memberships.activeRole({ userId, weddingId });
    return role !== null && roleAllows({ role, action });
  }

  /**
   * Exige a ação: sem vínculo, WeddingNotFoundError (404, RN01); com vínculo e
   * sem permissão, WeddingActionForbiddenError (403). Devolve o papel.
   */
  async require({
    userId,
    weddingId,
    action,
  }: {
    userId: string;
    weddingId: string;
    action: WeddingAction;
  }): Promise<MembershipRole> {
    const role = await this.memberships.activeRole({ userId, weddingId });
    if (role === null) throw new WeddingNotFoundError();
    if (!roleAllows({ role, action })) throw new WeddingActionForbiddenError();
    return role;
  }
}
