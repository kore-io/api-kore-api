import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { seedInvitation } from '../support/invitations';
import { inbox, waitForInbox } from '../support/mailpit';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';

/**
 * Os e-mails fora das preferências (Notificações da cerimonialista RN09; D19 e
 * D20): a cerimonialista saiu, às pessoas donas; o casal aceitou, à indicadora
 * que criou. Pela fila comum, o worker envia (Mailpit).
 */
describe('E-mails da RN09 de Notificações da cerimonialista (banco real e Mailpit)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const textOf = async (id: string) =>
    ((await (await fetch(`${MAILPIT_API_URL}/api/v1/message/${id}`)).json()) as { Text: string })
      .Text;
  const removeMembership = (cookie: string, weddingId: string, membershipId: string) =>
    http()
      .delete(`/v1/weddings/${weddingId}/memberships/${membershipId}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN);

  /** Ana e Marcos, os dois donos, com Juliana Prado (Prado Assessoria) colaborando. */
  async function anaAndMarcos({ creditName = 'Prado Assessoria' } = {}) {
    const ana = await signedInUser({ app, name: 'Ana Beatriz Moreira' });
    const marcos = await signedInUser({ app, name: 'Marcos Rocha' });
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    await db.planner.updateMany({
      where: { referrer: { userId: juliana.userId } },
      data: { creditName },
    });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    await db.membership.create({ data: { weddingId, userId: marcos.userId, role: 'owner' } });
    await db.partner.updateMany({
      where: { weddingId, slot: 1 },
      data: { userId: ana.userId, displayName: 'Ana Beatriz Moreira' },
    });
    await db.partner.updateMany({
      where: { weddingId, slot: 2 },
      data: { userId: marcos.userId, displayName: 'Marcos Rocha' },
    });
    const emailOf = async (userId: string) =>
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).email;
    const membership = await db.membership.findFirstOrThrow({
      where: { weddingId, userId: juliana.userId },
    });
    return {
      ana: { ...ana, email: await emailOf(ana.userId) },
      marcos: { ...marcos, email: await emailOf(marcos.userId) },
      juliana: {
        ...juliana,
        cookie: await openSession({ app, userId: juliana.userId }),
        membershipId: membership.id,
      },
      weddingId,
    };
  }

  it('RN09 - Juliana sai: Ana e Marcos recebem "Prado Assessoria saiu do casamento de vocês"', async () => {
    const { ana, marcos, juliana, weddingId } = await anaAndMarcos();

    await removeMembership(juliana.cookie, weddingId, juliana.membershipId).expect(204);

    for (const owner of [ana, marcos]) {
      const [message] = await waitForInbox({ to: owner.email });
      expect(message.Subject).toBe('Prado Assessoria saiu do casamento de vocês');
      const text = await textOf(message.ID);
      expect(text).toContain(
        'Juliana Prado (Prado Assessoria) saiu do casamento de Ana e Marcos no Kore.',
      );
      expect(text).toContain('Abrir Colaboradores: http://localhost:5173/app');
    }
    expect(await textOf((await inbox({ to: ana.email }))[0].ID)).toContain('Olá, Ana.');
    expect(await textOf((await inbox({ to: marcos.email }))[0].ID)).toContain('Olá, Marcos.');
    // Sem notificação na central do casal.
    expect(
      await db.notification.count({
        where: { weddingId, userId: { in: [ana.userId, marcos.userId] } },
      }),
    ).toBe(0);
  });

  it('RN09 - com o nome da assessoria igual ao dela, os parênteses saem', async () => {
    const { ana, juliana, weddingId } = await anaAndMarcos({ creditName: 'Juliana Prado' });

    await removeMembership(juliana.cookie, weddingId, juliana.membershipId).expect(204);

    const [message] = await waitForInbox({ to: ana.email });
    expect(message.Subject).toBe('Juliana Prado saiu do casamento de vocês');
    expect(await textOf(message.ID)).toContain(
      'Juliana Prado saiu do casamento de Ana e Marcos no Kore.',
    );
  });

  it('Papéis RN06 - quando a dona remove a cerimonialista, o e-mail de saída não sai', async () => {
    const { ana, marcos, juliana, weddingId } = await anaAndMarcos();

    await removeMembership(ana.cookie, weddingId, juliana.membershipId).expect(204);
    // Um e-mail de controle depois: quando ele chega, a fila já passou pelo da remoção.
    const decoy = await anaAndMarcos();
    await removeMembership(
      decoy.juliana.cookie,
      decoy.weddingId,
      decoy.juliana.membershipId,
    ).expect(204);
    await waitForInbox({ to: decoy.ana.email });

    expect(await inbox({ to: ana.email })).toEqual([]);
    expect(await inbox({ to: marcos.email })).toEqual([]);
  });

  it('RN09 - Fernanda aceita o convite do casal criado por Juliana: Juliana recebe "Fernanda e João aceitaram o convite"', async () => {
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const julianaEmail = (await db.user.findUniqueOrThrow({ where: { id: juliana.userId } })).email;
    const { weddingId } = await seedReferrerWedding({
      db,
      referrerUserId: juliana.userId,
      status: 'awaiting_couple',
    });
    const { token } = await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: null,
      invitedByUserId: juliana.userId,
    });
    const fernanda = await signedInUser({ app, name: `Fernanda ${randomUUID().slice(0, 4)}` });

    await http()
      .post(`/v1/access-invitations/${token}/accept`)
      .set('Cookie', fernanda.cookie)
      .set('Origin', APP_ORIGIN)
      .send({ partnerIndex: 1, myTitle: 'bride' })
      .expect(200);

    const [message] = await waitForInbox({ to: julianaEmail });
    expect(message.Subject).toBe('Fernanda e João aceitaram o convite');
    const text = await textOf(message.ID);
    expect(text).toContain('Olá, Juliana.');
    expect(text).toContain(
      `Abrir o casamento: http://localhost:5173/cerimonialista/casamentos/${weddingId}`,
    );
    expect(text).toContain('Você recebeu este e-mail porque criou este casamento no Kore.');
  });

  it('RN09 - no casamento criado pelo vendedor, o aceite não manda o e-mail', async () => {
    const lucas = await seedReferrer({ db, kind: 'seller', name: 'Lucas Andrade' });
    const lucasEmail = (await db.user.findUniqueOrThrow({ where: { id: lucas.userId } })).email;
    const { weddingId } = await seedReferrerWedding({
      db,
      referrerUserId: lucas.userId,
      referrerKind: 'seller',
      status: 'awaiting_couple',
    });
    const { token } = await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: null,
      invitedByUserId: lucas.userId,
    });
    const fernanda = await signedInUser({ app, name: 'Fernanda' });

    await http()
      .post(`/v1/access-invitations/${token}/accept`)
      .set('Cookie', fernanda.cookie)
      .set('Origin', APP_ORIGIN)
      .send({ partnerIndex: 1, myTitle: 'bride' })
      .expect(200);
    // Controle: o aviso de outra cerimonialista chega depois, pela mesma fila.
    const decoy = await anaAndMarcos();
    await removeMembership(
      decoy.juliana.cookie,
      decoy.weddingId,
      decoy.juliana.membershipId,
    ).expect(204);
    await waitForInbox({ to: decoy.ana.email });

    expect(await inbox({ to: lucasEmail })).toEqual([]);
  });
});
