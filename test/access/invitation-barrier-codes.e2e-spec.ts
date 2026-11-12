import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  INVITATION_ACCEPTANCE_STORE,
  type InvitationAcceptanceStore,
} from '../../src/modules/access/application/ports/invitation-acceptance-store.port';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { TenantTransaction } from '../../src/shared/database/tenant-transaction';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { createTestApp } from '../support/create-test-app';
import { seedInvitation } from '../support/invitations';
import { seedReferrer } from '../support/referrers';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

/**
 * As barreiras de accept_access_invitation chegam à API pelo SQLSTATE próprio
 * (KA001 a KA005), sem depender do texto da mensagem: o adapter, na transação
 * da requisição, devolve a recusa certa mesmo quando o domínio não a pegou antes.
 */
describe('Barreiras do aceite pelo SQLSTATE (banco real, adapter do aceite)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let tenant: TenantTransaction;
  let store: InvitationAcceptanceStore;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    tenant = app.get(TenantTransaction);
    store = app.get(INVITATION_ACCEPTANCE_STORE, { strict: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  const user = async () =>
    (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;

  /** Aceita como a pessoa, numa transação da requisição (desfeita se a rota der erro). */
  const acceptAs = ({
    userId,
    token,
    slot,
  }: {
    userId: string;
    token: string;
    slot: 1 | 2 | null;
  }) =>
    tenant.run({
      userId,
      work: () =>
        store.accept({
          tokenHash: createHash('sha256').update(token).digest('base64url'),
          membershipId: uuidV7(),
          partnerSlot: slot,
          partnerTitle: slot ? 'groom' : null,
          acceptedForEmail: null,
        }),
    });

  async function anaWedding() {
    const ana = await user();
    const { weddingId } = await seedWedding({ db, ownerId: ana });
    return { ana, weddingId };
  }

  it('KA001 - convite já usado: not_pending', async () => {
    const { ana, weddingId } = await anaWedding();
    const { token, invitationId } = await seedInvitation({
      db,
      weddingId,
      kind: 'partner',
      email: `${randomUUID()}@kore.local`,
      invitedByUserId: ana,
    });
    await db.accessInvitation.update({
      where: { id: invitationId },
      data: { acceptedAt: new Date() },
    });

    expect(await acceptAs({ userId: await user(), token, slot: 2 })).toBe('not_pending');
  });

  it('KA002 - casamento com 2 donos: owners_full', async () => {
    const { ana, weddingId } = await anaWedding();
    await db.membership.create({ data: { weddingId, userId: await user(), role: 'owner' } });
    const { token } = await seedInvitation({
      db,
      weddingId,
      kind: 'partner',
      email: `${randomUUID()}@kore.local`,
      invitedByUserId: ana,
    });

    expect(await acceptAs({ userId: await user(), token, slot: 2 })).toBe('owners_full');
  });

  it('KA003 - noivo escolhido já tem login: partner_taken', async () => {
    const { ana, weddingId } = await anaWedding();
    const { token } = await seedInvitation({
      db,
      weddingId,
      kind: 'partner',
      email: `${randomUUID()}@kore.local`,
      invitedByUserId: ana,
    });

    expect(await acceptAs({ userId: await user(), token, slot: 1 })).toBe('partner_taken');
  });

  it('KA004 - casamento com cerimonialista: planner_already', async () => {
    const { ana, weddingId } = await anaWedding();
    await db.membership.create({ data: { weddingId, userId: await user(), role: 'collaborator' } });
    const { token } = await seedInvitation({
      db,
      weddingId,
      kind: 'planner',
      email: `${randomUUID()}@kore.local`,
      invitedByUserId: ana,
    });

    expect(await acceptAs({ userId: await user(), token, slot: null })).toBe('planner_already');
  });

  it('KA005 (decisão 224) - o indicador do casamento aceitando o link do casal: self_referral', async () => {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const { weddingId } = await seedReferrerWedding({ db, referrerUserId: userId });
    // Sem o vínculo, como se tivesse saído por outro caminho: a barreira é do banco.
    await db.membership.updateMany({ where: { weddingId }, data: { removedAt: new Date() } });
    const { token } = await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: null,
      invitedByUserId: userId,
    });

    expect(await acceptAs({ userId, token, slot: 1 })).toBe('self_referral');
    expect(await db.membership.count({ where: { weddingId, role: 'owner' } })).toBe(0);
  });

  it('KA005 (Novo casamento RN05) - quem criou o casamento, sem ser o indicador: self_referral', async () => {
    const { ana, weddingId } = await anaWedding();
    // Sem vínculo e sem indicador: a barreira é só por ter criado o casamento.
    await db.membership.updateMany({ where: { weddingId }, data: { removedAt: new Date() } });
    await db.partner.updateMany({ where: { weddingId }, data: { userId: null } });
    const { token } = await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: null,
      invitedByUserId: ana,
    });

    expect(await acceptAs({ userId: ana, token, slot: 1 })).toBe('self_referral');
  });
});
