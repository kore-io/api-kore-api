import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/**
 * A cerimonialista dentro do casamento (F6, C4), pela API: as regras que a
 * spec junta e que atravessam as telas. O gate é o perfil que a conta tem e o
 * vínculo a cada pedido, nunca o perfil ativo da sessão; duas abas abrem dois
 * casamentos; e quem perde o acesso recebe o mesmo 404 em qualquer rota. As
 * restrições de cada tela já têm os seus e2e (lixeira, publicação, prazo,
 * colaboradores e Dados básicos).
 */
describe('A cerimonialista dentro do casamento (banco real; decisões 223 e 224)', () => {
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
  const createParty = (cookie: string, weddingId: string, name: string) =>
    http()
      .post(`/v1/weddings/${weddingId}/parties`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ name, guests: [{ name }] });
  const chooseProfile = (cookie: string, profile: string) =>
    http()
      .post('/v1/me/active-profile')
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ profile });
  const dashboard = (cookie: string, weddingId: string) =>
    http().get(`/v1/weddings/${weddingId}/dashboard`).set('Cookie', cookie);

  /** Juliana: dona de Juliana e Pedro e colaboradora de Ana e Marcos e de Fernanda e João. */
  async function juliana() {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const own = await seedWedding({ db, ownerId: userId });
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const anaWedding = await seedWedding({ db, ownerId: ana.userId, collaboratorIds: [userId] });
    const created = await seedReferrerWedding({ db, referrerUserId: userId });
    return { userId, own, ana, anaWedding, created };
  }

  it('RN01 e RN03 - dona e colaboradora em duas abas: trocar o perfil numa aba não quebra a outra, e o gate é ter o perfil', async () => {
    const planner = await juliana();
    const coupleTab = await openSession({ app, userId: planner.userId });
    const plannerTab = await openSession({ app, userId: planner.userId });
    await chooseProfile(plannerTab, 'planner').expect(200);

    // Na aba do casal, ela troca o perfil ativo para casal.
    await chooseProfile(coupleTab, 'couple').expect(200);

    // A outra aba segue: as rotas /v1/me da cerimonialista e o casamento em que colabora.
    await http().get('/v1/me/weddings').set('Cookie', plannerTab).expect(200);
    await http().get('/v1/me/weddings').set('Cookie', coupleTab).expect(200);
    const party = await createParty(
      plannerTab,
      planner.anaWedding.weddingId,
      'Família Moreira',
    ).expect(201);
    expect(
      (await db.party.findUniqueOrThrow({ where: { id: party.body.id as string } })).weddingId,
    ).toBe(planner.anaWedding.weddingId);
    await createParty(coupleTab, planner.own.weddingId, 'Família Prado').expect(201);
  });

  it('RN01 - dois casamentos em duas abas: cada grupo entra no casamento da sua rota', async () => {
    const planner = await juliana();
    const [first, second] = [
      await openSession({ app, userId: planner.userId }),
      await openSession({ app, userId: planner.userId }),
    ];

    const a = await createParty(first, planner.anaWedding.weddingId, 'Família Moreira').expect(201);
    const b = await createParty(second, planner.created.weddingId, 'Família Alves').expect(201);

    const weddingOf = async (id: unknown) =>
      (await db.party.findUniqueOrThrow({ where: { id: id as string } })).weddingId;
    expect(await weddingOf(a.body.id)).toBe(planner.anaWedding.weddingId);
    expect(await weddingOf(b.body.id)).toBe(planner.created.weddingId);
  });

  it('RN01 - a URL sozinha não dá acesso: o casamento de outra assessoria responde 404', async () => {
    const planner = await juliana();
    const cookie = await openSession({ app, userId: planner.userId });
    const other = await seedReferrer({ db, kind: 'planner', name: 'Clara Dias' });
    const { weddingId } = await seedReferrerWedding({ db, referrerUserId: other.userId });

    expect((await dashboard(cookie, weddingId).expect(404)).body.error).toBe('WEDDING_NOT_FOUND');
    expect((await createParty(cookie, weddingId, 'Família').expect(404)).body.error).toBe(
      'WEDDING_NOT_FOUND',
    );
  });

  it('RN01 - sem o perfil de cerimonialista, as rotas /v1/me dela respondem 403; o casamento próprio segue aberto', async () => {
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });

    expect(
      (await http().get('/v1/me/weddings').set('Cookie', ana.cookie).expect(403)).body.error,
    ).toBe('PROFILE_NOT_OWNED');
    await dashboard(ana.cookie, weddingId).expect(200);
  });

  it('RN07 - removida pelo casal: a próxima gravação recebe 404 e não salva; o casamento sai de Meus casamentos', async () => {
    const planner = await juliana();
    const cookie = await openSession({ app, userId: planner.userId });
    await dashboard(cookie, planner.anaWedding.weddingId).expect(200);
    const membership = await db.membership.findFirstOrThrow({
      where: { weddingId: planner.anaWedding.weddingId, userId: planner.userId },
    });

    await http()
      .delete(`/v1/weddings/${planner.anaWedding.weddingId}/memberships/${membership.id}`)
      .set('Cookie', planner.ana.cookie)
      .set('Origin', APP_ORIGIN)
      .expect(204);

    expect(
      (await createParty(cookie, planner.anaWedding.weddingId, 'Família Moreira').expect(404)).body
        .error,
    ).toBe('WEDDING_NOT_FOUND');
    expect(await db.party.count({ where: { weddingId: planner.anaWedding.weddingId } })).toBe(0);
    const mine = await http().get('/v1/me/weddings').set('Cookie', cookie).expect(200);
    expect(
      (mine.body.weddings as { weddingId: string }[]).map(({ weddingId }) => weddingId),
    ).not.toContain(planner.anaWedding.weddingId);
  });

  it('RN07 - casamento excluído aberto pela URL: o mesmo 404', async () => {
    const planner = await juliana();
    const cookie = await openSession({ app, userId: planner.userId });

    await http()
      .delete(`/v1/weddings/${planner.created.weddingId}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .expect(204);

    expect((await dashboard(cookie, planner.created.weddingId).expect(404)).body.error).toBe(
      'WEDDING_NOT_FOUND',
    );
  });

  it('RN05 - sair de casamento sem dono: 409 WEDDING_HAS_NO_OWNER, e ela continua no casamento', async () => {
    const planner = await juliana();
    const cookie = await openSession({ app, userId: planner.userId });
    const membership = await db.membership.findFirstOrThrow({
      where: { weddingId: planner.created.weddingId, userId: planner.userId },
    });

    const response = await http()
      .delete(`/v1/weddings/${planner.created.weddingId}/memberships/${membership.id}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .expect(409);

    expect(response.body.error).toBe('WEDDING_HAS_NO_OWNER');
    await dashboard(cookie, planner.created.weddingId).expect(200);
  });
});
