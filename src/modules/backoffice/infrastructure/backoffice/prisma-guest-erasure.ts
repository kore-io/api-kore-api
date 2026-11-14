import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import { comparableName } from '../../../guests/domain/paste-list';
import { recomputeWeddingStats } from '../../../guests/infrastructure/backoffice/wedding-stats-recompute';
import type { GuestErasure, RequestChannel } from '../../application/ports/guest-erasure.port';

/** O nome que fica no grupo de uma pessoa só (decisão 253(3)). */
export const REMOVED_PARTY_NAME = 'Grupo removido';

/** Pela conexão do backoffice (decisão 180(5)); vale também com o casamento bloqueado. */
@Injectable()
export class PrismaGuestErasure implements GuestErasure {
  constructor(private readonly db: BackofficePrismaService) {}

  erase({
    weddingId,
    guestId,
    byUserId,
    requestChannel,
    ipHash,
    now,
  }: {
    weddingId: string;
    guestId: string;
    byUserId: string;
    requestChannel: RequestChannel;
    ipHash: string | null;
    now: Date;
  }): Promise<'erased' | 'not_found'> {
    return this.db.$transaction(async (tx) => {
      // A ordem das escritas da lista: os números do casamento, depois o grupo.
      await tx.$queryRaw`SELECT 1 FROM wedding_stats WHERE wedding_id = ${weddingId}::uuid FOR UPDATE`;
      const guest = await tx.guest.findFirst({
        where: { id: guestId, weddingId },
        select: { id: true, name: true, partyId: true, isPlusOne: true, deletedAt: true },
      });
      if (!guest) return 'not_found';
      const [party] = await tx.$queryRaw<{ name: string; deletedAt: Date | null }[]>`
        SELECT name, deleted_at AS "deletedAt" FROM parties
        WHERE id = ${guest.partyId}::uuid FOR UPDATE`;
      // Outra PESSOA do grupo (decisão 253(3)): a vaga de acompanhante sem nome não conta.
      const others = await tx.guest.count({
        where: { partyId: guest.partyId, id: { not: guestId }, name: { not: null } },
      });

      // O contato do grupo passa a nenhum; a vaga (acompanhante) sai da conta do grupo.
      await tx.party.updateMany({
        where: { id: guest.partyId, contactGuestId: guestId },
        data: { contactGuestId: null },
      });
      if (guest.isPlusOne && guest.deletedAt === null && party && party.deletedAt === null)
        await tx.$executeRaw`
          UPDATE parties SET plus_one_slots = greatest(plus_one_slots - 1, 0)
          WHERE id = ${guest.partyId}::uuid`;
      await tx.guestTag.deleteMany({ where: { weddingId, guestId } });
      // As respostas do convidado saem pelo cascade; o histórico do grupo fica,
      // sem quem assinou (SET NULL).
      await tx.guest.delete({ where: { id: guestId } });

      // O grupo de uma pessoa só com o nome dela: o nome é dado do titular.
      const singlePersonParty =
        others === 0 &&
        party !== undefined &&
        guest.name !== null &&
        comparableName(party.name) === comparableName(guest.name);
      if (singlePersonParty) {
        await tx.party.update({
          where: { id: guest.partyId },
          data: { name: REMOVED_PARTY_NAME },
        });
        // O nome sai dos avisos de RSVP desse grupo; as contagens ficam (retrato do momento).
        await tx.$executeRaw`
          UPDATE notifications n SET payload = (
            SELECT jsonb_agg(CASE WHEN item->>'partyId' = ${guest.partyId}
                                  THEN jsonb_set(item, '{name}', 'null'::jsonb) ELSE item END)
            FROM jsonb_array_elements(n.payload) AS item)
          WHERE n.wedding_id = ${weddingId}::uuid AND n.type = 'rsvp'
            AND jsonb_typeof(n.payload) = 'array'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(n.payload) AS item
                        WHERE item->>'partyId' = ${guest.partyId})`;
      }
      await recomputeWeddingStats({ db: tx, weddingId });
      // O log sem o nome (RN10): o que já saiu do Kore não dá para tirar.
      await tx.applicationLog.create({
        data: {
          createdAt: now,
          action: 'guest.erased_on_request',
          actorKind: 'admin',
          actorUserId: byUserId,
          weddingId,
          entityType: 'guest',
          entityId: guestId,
          data: {
            requestChannel,
            partyId: guest.partyId,
            partyRenamed: singlePersonParty,
            note: 'E-mails e pushes entregues, exportações baixadas e backups até o prazo deles não são alcançados.',
          },
          ipHash,
        },
      });
      return 'erased';
    });
  }
}
