import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { PurgeOwnerlessWeddings } from '../../src/modules/access/application/purge-ownerless-weddings.use-case';
import { EmailDeliveryFailures } from '../../src/shared/email/application/email-delivery-failures';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { seedInvitation } from '../support/invitations';
import { waitForInbox } from '../support/mailpit';
import { seedReferrer } from '../support/referrers';
import { openSession } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

const day = 24 * 60 * 60 * 1000;
const APP_ORIGIN = 'http://localhost:5173';

describe('Expurgo do casamento sem dono (RN13 de Convites; decisões 136 e 180; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let purge: PurgeOwnerlessWeddings;

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
    purge = worker.get(PurgeOwnerlessWeddings);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  // Cada caso numa data própria e distante, para não pegar casamentos dos outros testes.
  async function ownerlessWedding({
    lastActivityAt,
    status = 'awaiting_couple',
  }: {
    lastActivityAt: Date;
    status?: 'draft' | 'awaiting_couple';
  }) {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const { weddingId } = await seedReferrerWedding({ db, referrerUserId: userId, status });
    await db.wedding.update({ where: { id: weddingId }, data: { lastActivityAt } });
    const creator = await db.user.findUniqueOrThrow({ where: { id: userId } });
    return { weddingId, referrerUserId: userId, creator };
  }

  it('decisão 180 - 30 dias antes da data do expurgo, avisa o indicador (e-mail 6) e registra no log', async () => {
    const lastActivityAt = new Date('2021-01-10T12:00:00Z');
    const { weddingId, creator } = await ownerlessWedding({ lastActivityAt });
    const now = new Date(new Date('2021-07-10T12:00:00Z').getTime() - 30 * day);

    await purge.execute({ now });

    const wedding = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    expect(wedding.purgeNoticeSentAt).toEqual(now);
    expect(wedding.status).toBe('awaiting_couple');
    const [message] = await waitForInbox({ to: creator.email });
    expect(message?.Subject).toBe('O casamento de Fernanda e João será excluído em 30 dias');
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'wedding.purge_notice_sent', weddingId },
    });
  });

  it('decisão 180 - com o aviso no prazo, na data vira lápide: filhas apagadas, endereço livre, indicador mantido', async () => {
    const lastActivityAt = new Date('2020-01-10T12:00:00Z');
    const purgeDate = new Date('2020-07-10T12:00:00Z');
    const { weddingId, referrerUserId } = await ownerlessWedding({ lastActivityAt });
    await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: null,
      invitedByUserId: referrerUserId,
    });
    await db.wedding.update({
      where: { id: weddingId },
      data: { purgeNoticeSentAt: new Date(purgeDate.getTime() - 30 * day) },
    });
    const before = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });

    await purge.execute({ now: new Date(purgeDate.getTime() - 1000) });
    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe(
      'awaiting_couple',
    );
    await purge.execute({ now: purgeDate });

    const tombstone = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    expect(tombstone).toMatchObject({
      id: weddingId,
      status: 'purged',
      purgedAt: purgeDate,
      slug: null,
      city: null,
      state: null,
      timezone: null,
      eventDate: null,
      createdByUserId: null,
      signupSource: null,
      referrerId: before.referrerId,
      referralSource: 'created_by_planner',
      createdAt: before.createdAt,
    });
    expect(await db.partner.count({ where: { weddingId } })).toBe(0);
    expect(await db.membership.count({ where: { weddingId } })).toBe(0);
    expect(await db.accessInvitation.count({ where: { weddingId } })).toBe(0);
    const log = await db.applicationLog.findFirstOrThrow({
      where: { action: 'wedding.purged', weddingId },
    });
    expect(log.data).toEqual({ reason: 'ownerless_inactive', status: 'awaiting_couple' });
    expect(await db.wedding.count({ where: { slug: before.slug } })).toBe(0);
  });

  it('decisão 180 - com o aviso atrasado, espera os 30 dias prometidos no e-mail', async () => {
    const lastActivityAt = new Date('2019-01-10T12:00:00Z');
    const purgeDate = new Date('2019-07-10T12:00:00Z');
    const { weddingId } = await ownerlessWedding({ lastActivityAt });
    const noticeSentAt = new Date(purgeDate.getTime() + 5 * day);
    await db.wedding.update({
      where: { id: weddingId },
      data: { purgeNoticeSentAt: noticeSentAt },
    });

    await purge.execute({ now: new Date(purgeDate.getTime() + 20 * day) });
    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe(
      'awaiting_couple',
    );
    await purge.execute({ now: new Date(noticeSentAt.getTime() + 30 * day) });
    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe(
      'purged',
    );
  });

  it('decisão 180(8) - se o worker desistir do e-mail 6, a marca do aviso é desfeita e registrada', async () => {
    const lastActivityAt = new Date('2016-01-10T12:00:00Z');
    const { weddingId } = await ownerlessWedding({ lastActivityAt });
    const now = new Date(new Date('2016-07-10T12:00:00Z').getTime() - 30 * day);
    await purge.execute({ now });
    expect(
      (await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).purgeNoticeSentAt,
    ).toEqual(now);

    // O processador da fila avisa assim depois da última tentativa (testado no unitário dele).
    await worker.get(EmailDeliveryFailures).gaveUp({
      tag: { kind: 'purge_notice', data: { weddingId, noticeSentAt: now.toISOString() } },
    });

    expect(
      (await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).purgeNoticeSentAt,
    ).toBeNull();
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'wedding.purge_notice_failed', weddingId },
    });
  });

  it('RN13 (decisão 102) - rascunho sem dono também expira: aviso aos 30 dias e exclusão aos 6 meses', async () => {
    const lastActivityAt = new Date('2015-01-10T12:00:00Z');
    const purgeDate = new Date('2015-07-10T12:00:00Z');
    const { weddingId, creator } = await ownerlessWedding({ lastActivityAt, status: 'draft' });
    const noticeAt = new Date(purgeDate.getTime() - 30 * day);

    await purge.execute({ now: noticeAt });

    const noticed = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    expect(noticed).toMatchObject({ status: 'draft', purgeNoticeSentAt: noticeAt });
    const [message] = await waitForInbox({ to: creator.email });
    expect(message?.Subject).toBe('O casamento de Fernanda e João será excluído em 30 dias');

    await purge.execute({ now: new Date(purgeDate.getTime() - 1000) });
    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe('draft');
    await purge.execute({ now: purgeDate });

    expect(await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).toMatchObject({
      status: 'purged',
      purgedAt: purgeDate,
    });
    const log = await db.applicationLog.findFirstOrThrow({
      where: { action: 'wedding.purged', weddingId },
    });
    expect(log.data).toEqual({ reason: 'ownerless_inactive', status: 'draft' });
  });

  it('decisão 207(17) - o expurgo apaga também grupos, convidados, tags, vínculos e números, e só deste casamento', async () => {
    async function seedGuestList(weddingId: string) {
      const party = await db.party.create({
        data: {
          weddingId,
          name: 'Família Moreira',
          linkToken: randomBytes(16).toString('base64url'),
        },
      });
      const luiz = await db.guest.create({
        data: { weddingId, partyId: party.id, name: 'Luiz Moreira' },
      });
      await db.guest.create({
        data: { weddingId, partyId: party.id, name: 'Célia Moreira', deletedAt: new Date() },
      });
      await db.party.update({ where: { id: party.id }, data: { contactGuestId: luiz.id } });
      const tag = await db.tag.create({ data: { weddingId, name: 'Igreja' } });
      await db.partyTag.create({ data: { weddingId, partyId: party.id, tagId: tag.id } });
      await db.guestTag.create({ data: { weddingId, guestId: luiz.id, tagId: tag.id } });
    }
    async function counts(weddingId: string) {
      const where = { weddingId };
      return {
        parties: await db.party.count({ where }),
        guests: await db.guest.count({ where }),
        tags: await db.tag.count({ where }),
        partyTags: await db.partyTag.count({ where }),
        guestTags: await db.guestTag.count({ where }),
        stats: await db.weddingStats.count({ where }),
      };
    }
    const lastActivityAt = new Date('2014-01-10T12:00:00Z');
    const purgeDate = new Date('2014-07-10T12:00:00Z');
    const { weddingId } = await ownerlessWedding({ lastActivityAt, status: 'draft' });
    await seedGuestList(weddingId);
    await db.wedding.update({
      where: { id: weddingId },
      data: { purgeNoticeSentAt: new Date(purgeDate.getTime() - 30 * day) },
    });
    const ana = (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;
    const other = await seedWedding({ db, ownerId: ana });
    await seedGuestList(other.weddingId);
    const kept = { parties: 1, guests: 2, tags: 1, partyTags: 1, guestTags: 1, stats: 1 };
    expect(await counts(weddingId)).toEqual(kept);

    await purge.execute({ now: purgeDate });

    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe(
      'purged',
    );
    expect(await counts(weddingId)).toEqual({
      parties: 0,
      guests: 0,
      tags: 0,
      partyTags: 0,
      guestTags: 0,
      stats: 0,
    });
    expect(await counts(other.weddingId)).toEqual(kept);
  });

  it('RN13 - casamento com dono nunca entra, mesmo parado', async () => {
    const ana = (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;
    const { weddingId } = await seedWedding({ db, ownerId: ana });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        lastActivityAt: new Date('2018-01-10T12:00:00Z'),
        purgeNoticeSentAt: new Date('2018-06-10T12:00:00Z'),
      },
    });

    await purge.execute({ now: new Date('2019-01-01T00:00:00Z') });

    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe('draft');
  });

  it('decisões 136 e 180 - o indicador abrir o casamento conta como atividade e zera o aviso', async () => {
    const { weddingId, referrerUserId } = await ownerlessWedding({
      lastActivityAt: new Date('2017-01-10T12:00:00Z'),
    });
    await db.wedding.update({
      where: { id: weddingId },
      data: { purgeNoticeSentAt: new Date('2017-06-10T12:00:00Z') },
    });
    const cookie = await openSession({ app, userId: referrerUserId });

    await request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/memberships`)
      .set('Cookie', cookie)
      .expect(200);

    const wedding = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    expect(wedding.purgeNoticeSentAt).toBeNull();
    expect(wedding.lastActivityAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('decisão 180 - gerar o link do casal também zera o aviso', async () => {
    const { weddingId, referrerUserId } = await ownerlessWedding({
      lastActivityAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    await db.wedding.update({ where: { id: weddingId }, data: { purgeNoticeSentAt: new Date() } });
    const cookie = await openSession({ app, userId: referrerUserId });

    await request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/access-invitations`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ kind: 'couple' })
      .expect(201);

    expect(
      (await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).purgeNoticeSentAt,
    ).toBeNull();
  });
});
