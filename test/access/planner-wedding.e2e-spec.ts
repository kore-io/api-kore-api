import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/**
 * Novo casamento pela cerimonialista (F6, C3), com o banco real: o POST
 * /v1/me/weddings, o teto de casamentos sem dono, o convite para o próprio
 * e-mail, a prévia do convite com a autoindicação e a data, a UF e o endereço
 * antes do aceite.
 */
describe('Novo casamento pela cerimonialista (banco real; decisões 223 e 224)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const create = (cookie: string, body: Record<string, unknown>) =>
    http().post('/v1/me/weddings').set('Cookie', cookie).set('Origin', APP_ORIGIN).send(body);
  const invite = (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    http()
      .post(`/v1/weddings/${weddingId}/access-invitations`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const patchSite = (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    http()
      .patch(`/v1/weddings/${weddingId}/site`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);

  const slug = () => `fernanda-e-joao-${randomUUID().slice(0, 8)}`;
  const body = (extra: Record<string, unknown> = {}) => ({
    partner1Name: 'Fernanda Alves',
    partner2Name: 'João Lima',
    eventDate: '2027-03-20',
    city: 'Campinas',
    state: 'SP',
    slug: slug(),
    ...extra,
  });

  async function juliana() {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const cookie = await openSession({ app, userId });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId } });
    return { userId, cookie, referrerId: referrer.id };
  }

  describe('POST /v1/me/weddings (RN01 a RN04)', () => {
    it('RN04 - nasce em rascunho, sem dono, com os noivos sem login, ela colaboradora e atribuído a ela', async () => {
      const planner = await juliana();
      const sent = body();

      const response = await create(planner.cookie, sent).expect(201);

      expect(response.body).toEqual({
        weddingId: expect.any(String),
        slug: sent.slug,
        status: 'draft',
        timezone: 'America/Sao_Paulo',
      });
      const wedding = await db.wedding.findUniqueOrThrow({
        where: { id: response.body.weddingId as string },
        include: {
          memberships: true,
          partners: { orderBy: { slot: 'asc' } },
          sections: true,
          stats: true,
        },
      });
      expect(wedding).toMatchObject({
        status: 'draft',
        createdByUserId: planner.userId,
        referrerId: planner.referrerId,
        referralSource: 'created_by_planner',
        signupSource: 'planner',
        city: 'Campinas',
        state: 'SP',
        fontPairKey: 'romantico',
        appearanceSetAt: null,
      });
      expect(wedding.memberships).toEqual([
        expect.objectContaining({ userId: planner.userId, role: 'collaborator', removedAt: null }),
      ]);
      expect(
        wedding.partners.map(({ displayName, userId, title }) => ({ displayName, userId, title })),
      ).toEqual([
        { displayName: 'Fernanda Alves', userId: null, title: null },
        { displayName: 'João Lima', userId: null, title: null },
      ]);
      expect(wedding.sections).toHaveLength(6);
      expect(wedding.stats).not.toBeNull();
      // Não muda o perfil ativo da sessão.
      const me = await http().get('/v1/me').set('Cookie', planner.cookie).expect(200);
      expect(me.body.activeProfile).toBeNull();
    });

    it('RN03 - a Aparência do passo 2 entra, com o guarda-corpo do contraste', async () => {
      const planner = await juliana();

      const created = await create(
        planner.cookie,
        body({
          appearance: {
            fontPairKey: 'classico',
            starterPaletteKey: null,
            primaryColor: '#3D5A4C',
            accentColor: '#A94F37',
            backgroundMode: 'light',
          },
        }),
      ).expect(201);
      const wedding = await db.wedding.findUniqueOrThrow({
        where: { id: created.body.weddingId as string },
      });
      expect(wedding).toMatchObject({ fontPairKey: 'classico', primaryColor: '#3D5A4C' });
      expect(wedding.appearanceSetAt).not.toBeNull();

      const refused = await create(
        planner.cookie,
        body({
          appearance: {
            fontPairKey: 'classico',
            starterPaletteKey: null,
            primaryColor: '#FFFFFF',
            accentColor: '#FFFFFF',
            backgroundMode: 'light',
          },
        }),
      ).expect(422);
      expect(refused.body.error).toBe('CONTRAST_TOO_LOW');
    });

    it('RN02 - sem a UF e com o nome da segunda pessoa vazio: 400 por campo', async () => {
      const planner = await juliana();

      const response = await create(
        planner.cookie,
        body({ state: undefined, partner2Name: '  ' }),
      ).expect(400);

      const paths = (response.body.errors as { path: string }[]).map(({ path }) => path);
      expect(paths).toEqual(expect.arrayContaining(['partner2Name', 'state']));
    });

    it('RN01 - sem o perfil de cerimonialista (casal, vendedor ou indicador inativo): 403 PROFILE_NOT_OWNED', async () => {
      const marcos = await signedInUser({ app, name: 'Marcos Rocha' });
      const seller = await seedReferrer({ db, kind: 'seller', name: 'Lucas Andrade' });
      const inactive = await seedReferrer({
        db,
        kind: 'planner',
        name: 'Juliana Prado',
        status: 'inactive',
      });

      for (const cookie of [
        marcos.cookie,
        await openSession({ app, userId: seller.userId }),
        await openSession({ app, userId: inactive.userId }),
      ])
        expect((await create(cookie, body()).expect(403)).body.error).toBe('PROFILE_NOT_OWNED');
    });

    it('caso de borda - quem também é dona de um casamento cria sem esbarrar no ALREADY_OWNER', async () => {
      const planner = await juliana();
      await seedWedding({ db, ownerId: planner.userId });

      await create(planner.cookie, body()).expect(201);
    });

    it('RN04 e revisão C3-7 - endereço em uso, também no duplo toque: 409 SLUG_UNAVAILABLE com a sugestão', async () => {
      const planner = await juliana();
      const sent = body();

      const results = await Promise.all([
        create(planner.cookie, sent),
        create(planner.cookie, sent),
      ]);

      expect(results.map(({ status }) => status).sort()).toEqual([201, 409]);
      const refused = results.find(({ status }) => status === 409);
      expect(refused?.body).toMatchObject({
        error: 'SLUG_UNAVAILABLE',
        suggestion: expect.any(String),
      });
      expect(await db.wedding.count({ where: { createdByUserId: planner.userId } })).toBe(1);
    });

    it('RN04 - com 50 casamentos sem dono, o 51º recebe 409 OWNERLESS_WEDDINGS_LIMIT; com dono, deixa de contar', async () => {
      const planner = await juliana();
      const weddingIds: string[] = [];
      for (let i = 0; i < 50; i++)
        weddingIds.push(
          (await seedReferrerWedding({ db, referrerUserId: planner.userId })).weddingId,
        );

      expect((await create(planner.cookie, body()).expect(409)).body.error).toBe(
        'OWNERLESS_WEDDINGS_LIMIT',
      );

      const fernanda = await signedInUser({ app, name: 'Fernanda Alves' });
      await db.membership.create({
        data: { weddingId: weddingIds[0], userId: fernanda.userId, role: 'owner' },
      });
      await create(planner.cookie, body()).expect(201);
    });
  });

  it('RN05 - o convite do casal para o e-mail da própria conta: 422 SELF_INVITATION', async () => {
    const planner = await juliana();
    const { weddingId } = (await create(planner.cookie, body()).expect(201)).body as {
      weddingId: string;
    };
    const { email } = await db.user.findUniqueOrThrow({ where: { id: planner.userId } });

    const response = await invite(planner.cookie, weddingId, {
      kind: 'couple',
      emails: [email.toUpperCase()],
    }).expect(422);

    expect(response.body.error).toBe('SELF_INVITATION');
    expect(await db.accessInvitation.count({ where: { weddingId } })).toBe(0);
    await invite(planner.cookie, weddingId, {
      kind: 'couple',
      emails: [`fernanda.${randomUUID()}@kore.local`],
    }).expect(201);
  });

  it('RN05 - a prévia do convite, com a sessão de quem criou, já acusa a autoindicação; sem sessão, mostra o convite', async () => {
    const planner = await juliana();
    const { weddingId } = (await create(planner.cookie, body()).expect(201)).body as {
      weddingId: string;
    };
    const link = await invite(planner.cookie, weddingId, { kind: 'couple' }).expect(201);
    const token = String(link.body.invitations[0].url).split('/').pop() ?? '';

    const own = await http()
      .get(`/v1/access-invitations/${token}`)
      .set('Cookie', planner.cookie)
      .expect(409);
    expect(own.body.error).toBe('SELF_REFERRAL');
    await http().get(`/v1/access-invitations/${token}`).expect(200);
  });

  describe('RN08 - data, UF e endereço antes do aceite', () => {
    it('a cerimonialista que criou muda o endereço até o aceite, com log; depois do aceite, 403 FIELD_NOT_ALLOWED', async () => {
      const planner = await juliana();
      const { weddingId } = (await create(planner.cookie, body()).expect(201)).body as {
        weddingId: string;
      };
      const newSlug = slug();

      await patchSite(planner.cookie, weddingId, { slug: newSlug, state: 'MG' }).expect(200);

      expect(await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).toMatchObject({
        slug: newSlug,
        state: 'MG',
      });
      const log = await db.applicationLog.findFirstOrThrow({
        where: { action: 'wedding.identity_changed', weddingId },
      });
      expect(log).toMatchObject({ actorUserId: planner.userId, actorKind: 'user' });
      expect(log.data).toEqual({ fields: ['state', 'slug'] });

      const fernanda = await signedInUser({ app, name: 'Fernanda Alves' });
      await db.membership.create({ data: { weddingId, userId: fernanda.userId, role: 'owner' } });
      const refused = await patchSite(planner.cookie, weddingId, { slug: slug() }).expect(403);
      expect(refused.body).toMatchObject({ error: 'FIELD_NOT_ALLOWED', fields: ['slug'] });
    });

    it('a cerimonialista que só colabora (casamento de outra origem) não muda, nem sem dono', async () => {
      const planner = await juliana();
      const { weddingId } = await seedReferrerWedding({ db, referrerUserId: planner.userId });
      await db.wedding.update({
        where: { id: weddingId },
        data: { referralSource: 'invited_before_payment' },
      });

      await patchSite(planner.cookie, weddingId, { slug: slug() }).expect(403);
    });
  });
});
