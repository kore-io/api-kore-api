import { Inject, Injectable } from '@nestjs/common';
import {
  WEDDING_MEMBERS_STORE,
  type PendingAccessInvitation,
  type WeddingMember,
  type WeddingMembersStore,
} from './ports/wedding-members-store.port';
import { WeddingAuthorization } from './wedding-authorization.service';

/** Quem tem acesso e os convites pendentes, para Colaboradores (RN02, RN05 de Papéis). */
@Injectable()
export class ListWeddingMembers {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(WEDDING_MEMBERS_STORE) private readonly store: WeddingMembersStore,
  ) {}

  async execute({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<{ members: WeddingMember[]; pendingInvitations: PendingAccessInvitation[] }> {
    // O colaborador vê a lista em leitura (RN03): basta o vínculo.
    await this.authorization.require({ userId, weddingId, action: 'view' });
    const [members, pendingInvitations] = await Promise.all([
      this.store.listActive({ weddingId }),
      this.store.listPendingInvitations({ weddingId }),
    ]);
    return { members, pendingInvitations };
  }
}
