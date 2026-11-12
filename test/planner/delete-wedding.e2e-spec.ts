import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { siteImageKeys } from '../../src/modules/site/domain/site-image';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../src/shared/storage/application/object-storage.port';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/**
 * Excluir este casamento (Meus casamentos RN11; revisão C2-5), com o banco
 * real: a cerimonialista que criou exclui o rascunho ou o aguardando o casal
 * sem dono; os dados saem como no expurgo, a lápide fica com o endereço livre,
 * o link para de funcionar e as imagens saem do armazenamento. A trava contra o
 * aceite ao mesmo tempo é testada com duas conexões.
 */
describe('Excluir este casamento (banco real; RN11)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let storage: ObjectStorage;
  let owner: Client;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    owner = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await owner.connect();
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const remove = (cookie: string, weddingId: string) =>
    http().delete(`/v1/weddings/${weddingId}`).set('Cookie', cookie).set('Origin', APP_ORIGIN);

  async function plannerWedding(status: 'draft' | 'awaiting_couple' = 'awaiting_couple') {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const cookie = await openSession({ app, userId });
    const { weddingId } = await seedReferrerWedding({ db, referrerUserId: userId, status });
    return { userId, cookie, weddingId };
  }

  async function generateLink(cookie: string, weddingId: string): Promise<string> {
    const response = await http()
      .post(`/v1/weddings/${weddingId}/access-invitations`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ kind: 'couple' })
      .expect(201);
    return String(response.body.invitations[0].url).split('/').pop() ?? '';
  }

  it('RN11 - a cerimonialista que criou exclui: os dados saem como no expurgo, a lápide fica, o link para e o log registra', async () => {
    const planner = await plannerWedding();
    const { slug } = await db.wedding.findUniqueOrThrow({ where: { id: planner.weddingId } });
    const token = await generateLink(planner.cookie, planner.weddingId);
    const party = await db.party.create({
      data: {
        weddingId: planner.weddingId,
        name: 'Família Moreira',
        linkToken: randomBytes(16).toString('base64url'),
      },
    });
    await db.guest.create({
      data: { weddingId: planner.weddingId, partyId: party.id, name: 'Luiz Moreira' },
    });
    const imageId = uuidV7();
    const keyToken = randomBytes(16).toString('hex');
    const keys = siteImageKeys({ keyToken });
    await db.siteImage.create({
      data: {
        id: imageId,
        keyToken,
        weddingId: planner.weddingId,
        status: 'ready',
        storageKey: keys.display,
        thumbKey: keys.thumb,
        ogKey: keys.og,
        sizeBytes: 3,
        width: 2560,
        height: 1707,
        readyAt: new Date(),
      },
    });
    const body = Buffer.from('jpg');
    await storage.put({ bucket: 'private', key: keys.original, body, contentType: 'image/jpeg' });
    for (const key of [keys.display, keys.thumb, keys.og])
      await storage.put({ bucket: 'public', key, body, contentType: 'image/jpeg' });

    await remove(planner.cookie, planner.weddingId).expect(204);

    expect(await db.wedding.findUniqueOrThrow({ where: { id: planner.weddingId } })).toMatchObject({
      status: 'purged',
      slug: null,
      createdByUserId: null,
      purgedAt: expect.any(Date),
    });
    const where = { weddingId: planner.weddingId };
    expect(await db.membership.count({ where })).toBe(0);
    expect(await db.accessInvitation.count({ where })).toBe(0);
    expect(await db.partner.count({ where })).toBe(0);
    expect(await db.guest.count({ where })).toBe(0);
    expect(await db.party.count({ where })).toBe(0);
    expect(await db.section.count({ where })).toBe(0);
    expect(await db.siteImage.count({ where })).toBe(0);
    expect(await storage.head({ bucket: 'private', key: keys.original })).toBeNull();
    expect(await storage.head({ bucket: 'public', key: keys.display })).toBeNull();
    const log = await db.applicationLog.findFirstOrThrow({
      where: { action: 'wedding.deleted_by_creator', weddingId: planner.weddingId },
    });
    expect(log).toMatchObject({ actorKind: 'user', actorUserId: planner.userId });
    expect(log.data).toEqual({ status: 'awaiting_couple' });
    // O link que ela mandou ao casal deixa de funcionar, e o endereço fica livre.
    expect((await http().get(`/v1/access-invitations/${token}`).expect(410)).body.error).toBe(
      'INVITATION_INVALID',
    );
    expect(await db.wedding.count({ where: { slug } })).toBe(0);
  });

  it('RN11 - o rascunho sem convite também sai', async () => {
    const planner = await plannerWedding('draft');

    await remove(planner.cookie, planner.weddingId).expect(204);

    expect((await db.wedding.findUniqueOrThrow({ where: { id: planner.weddingId } })).status).toBe(
      'purged',
    );
  });

  it('RN11 - com dono ativo: 409 WEDDING_HAS_OWNER, e nada muda', async () => {
    const planner = await plannerWedding();
    const fernanda = await signedInUser({ app, name: 'Fernanda Alves' });
    await db.membership.create({
      data: { weddingId: planner.weddingId, userId: fernanda.userId, role: 'owner' },
    });

    expect((await remove(planner.cookie, planner.weddingId).expect(409)).body.error).toBe(
      'WEDDING_HAS_OWNER',
    );
    expect((await db.wedding.findUniqueOrThrow({ where: { id: planner.weddingId } })).status).toBe(
      'awaiting_couple',
    );
  });

  it('RN11 - quem não criou: 403 ACTION_NOT_ALLOWED (colaboradora no casamento do casal, o próprio dono); sem vínculo: 404', async () => {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const cookie = await openSession({ app, userId });
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const couple = await seedWedding({ db, ownerId: ana.userId, collaboratorIds: [userId] });
    await db.membership.updateMany({
      where: { weddingId: couple.weddingId, role: 'owner' },
      data: { removedAt: new Date() },
    });

    expect((await remove(cookie, couple.weddingId).expect(403)).body.error).toBe(
      'ACTION_NOT_ALLOWED',
    );
    const other = await plannerWedding();
    expect((await remove(cookie, other.weddingId).expect(404)).body.error).toBe(
      'WEDDING_NOT_FOUND',
    );
    expect((await remove(cookie, 'nao-e-uuid').expect(404)).body.error).toBe('WEDDING_NOT_FOUND');
  });

  it('RN11 e decisão 223 (risco 4) - aceite e exclusão ao mesmo tempo, com duas conexões: o aceite que trava antes vence, e a exclusão recebe 409', async () => {
    const planner = await plannerWedding();
    const fernanda = await signedInUser({ app, name: 'Fernanda Alves' });

    // A outra conexão faz o que a accept_access_invitation faz: trava o
    // casamento e grava o dono; a exclusão espera o lock.
    await owner.query('BEGIN');
    await owner.query('SELECT id FROM weddings WHERE id = $1 FOR UPDATE', [planner.weddingId]);
    await owner.query(
      `INSERT INTO memberships (id, wedding_id, user_id, role) VALUES ($1, $2, $3, 'owner')`,
      [uuidV7(), planner.weddingId, fernanda.userId],
    );
    const deletion = remove(planner.cookie, planner.weddingId).then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await owner.query('COMMIT');

    const response = await deletion;
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('WEDDING_HAS_OWNER');
    expect((await db.wedding.findUniqueOrThrow({ where: { id: planner.weddingId } })).status).toBe(
      'awaiting_couple',
    );
  });

  it('RN11 - a exclusão que chega antes: o aceite depois cai no Convite inválido', async () => {
    const planner = await plannerWedding();
    const token = await generateLink(planner.cookie, planner.weddingId);
    const fernanda = await signedInUser({ app, name: 'Fernanda Alves' });

    await remove(planner.cookie, planner.weddingId).expect(204);

    const accept = await http()
      .post(`/v1/access-invitations/${token}/accept`)
      .set('Cookie', fernanda.cookie)
      .set('Origin', APP_ORIGIN)
      .send({ partnerIndex: 1, myTitle: 'bride' })
      .expect(410);
    expect(accept.body.error).toBe('INVITATION_INVALID');
  });
});
