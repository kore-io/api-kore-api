import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SAMPLE_EMAIL_DOMAIN } from '../../src/seed/sample-data';
import { seedSampleData } from '../../src/seed/seed-sample-data';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { openSession } from '../support/sessions';

const SAMPLE_SLUGS = ['ana-e-marcos', 'juliana-e-tiago', 'bianca-e-henrique', 'fernanda-e-joao'];

/** pnpm db:seed (decisão 181), no banco de teste: idempotente e pronto para o E2E do app. */
describe('Dados de exemplo do Kore (seed da Fase 0; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  const appUrl = 'http://localhost:5173';

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const run = () =>
    seedSampleData({ db, termsVersion: '2026-09', appEnv: 'test', appUrl, now: new Date() });
  const sampleWeddings = { createdBy: { email: { endsWith: `@${SAMPLE_EMAIL_DOMAIN}` } } };

  it('decisão 181 - rodar duas vezes deixa o mesmo estado (idempotente), com os mesmos links em local e test', async () => {
    const first = await run();
    const counts = async () => ({
      users: await db.user.count({ where: { email: { endsWith: `@${SAMPLE_EMAIL_DOMAIN}` } } }),
      weddings: await db.wedding.count({ where: sampleWeddings }),
      memberships: await db.membership.count({
        where: { removedAt: null, wedding: sampleWeddings },
      }),
      parties: await db.party.count({ where: { wedding: sampleWeddings } }),
      guests: await db.guest.count({ where: { wedding: sampleWeddings } }),
      tags: await db.tag.count({ where: { wedding: sampleWeddings } }),
      pendingInvitations: await db.accessInvitation.count({
        where: {
          wedding: sampleWeddings,
          acceptedAt: null,
          declinedAt: null,
          revokedAt: null,
          supersededAt: null,
        },
      }),
    });
    const before = await counts();

    const second = await run();

    expect(await counts()).toEqual(before);
    expect(second).toEqual(first);
    expect(before.weddings).toBe(14);
    expect(before.pendingInvitations).toBe(5);
    expect(first.every(({ url }) => url.startsWith(`${appUrl}/convite/seed-`))).toBe(true);
  });

  it('Grupos (F1) - Ana vê os grupos de exemplo pela API, com o contato mascarado, e os números do casamento batem', async () => {
    await run();
    const ana = await db.user.findUniqueOrThrow({
      where: { email: `ana.moreira@${SAMPLE_EMAIL_DOMAIN}` },
    });
    const wedding = await db.wedding.findUniqueOrThrow({ where: { slug: 'ana-e-marcos' } });
    const cookie = await openSession({ app, userId: ana.id });

    const response = await request(app.getHttpServer())
      .get(`/v1/weddings/${wedding.id}/parties`)
      .query({ q: 'moreira' })
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Família Moreira',
          contact: expect.objectContaining({
            name: 'Célia Moreira',
            phoneMasked: '(19) 9****-3310',
          }),
          counts: { confirmed: 3, declined: 0, pending: 0, pendingPlusOnes: 0 },
          deliveryStatus: 'responded',
          tags: [expect.objectContaining({ name: 'Família da Ana' })],
        }),
        expect.objectContaining({ name: 'Vó Helena', contact: null }),
      ]),
    );
    const summary = response.body.summary as { guests: number; pending: number };
    expect(
      await db.weddingStats.findUniqueOrThrow({ where: { weddingId: wedding.id } }),
    ).toMatchObject({
      guestsTotal: summary.guests,
      pending: summary.pending,
      confirmed: 6,
      declined: 1,
      adultsConfirmed: 5,
      childrenConfirmed: 1,
    });
  });

  it('Lixeira (F1) - Ana vê a lixeira de exemplo: o grupo com 4 convidados, o convidado sozinho e a tag, dentro do prazo', async () => {
    await run();
    const ana = await db.user.findUniqueOrThrow({
      where: { email: `ana.moreira@${SAMPLE_EMAIL_DOMAIN}` },
    });
    const wedding = await db.wedding.findUniqueOrThrow({ where: { slug: 'ana-e-marcos' } });
    const cookie = await openSession({ app, userId: ana.id });

    const response = await request(app.getHttpServer())
      .get(`/v1/weddings/${wedding.id}/trash`)
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body.data).toMatchObject([
      { type: 'party', name: 'Amigos do vôlei', guests: 4 },
      { type: 'guest', name: 'Bruno Lima', partyName: 'Família Rocha' },
      { type: 'tag', name: 'Vizinhos', guests: 2 },
    ]);
  });

  it('decisão 181 - nenhum e-mail do seed sai do domínio de exemplo', async () => {
    await run();

    const emails = [
      ...(await db.user.findMany({
        where: { memberships: { some: { wedding: { slug: { in: SAMPLE_SLUGS } } } } },
        select: { email: true },
      })),
      ...(await db.accessInvitation.findMany({
        where: { wedding: sampleWeddings, email: { not: null } },
        select: { email: true },
      })),
    ].map(({ email }) => email ?? '');

    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((email) => email.endsWith(`@${SAMPLE_EMAIL_DOMAIN}`))).toBe(true);
  });

  it('RN14 e decisão 174 - Juliana tem dois perfis (casal e cerimonialista) e 12 casamentos como colaboradora', async () => {
    await run();
    const juliana = await db.user.findUniqueOrThrow({
      where: { email: `juliana.prado@${SAMPLE_EMAIL_DOMAIN}` },
    });
    const cookie = await openSession({ app, userId: juliana.id });

    const me = await request(app.getHttpServer()).get('/v1/me').set('Cookie', cookie).expect(200);

    expect(me.body).toMatchObject({
      profiles: ['couple', 'planner'],
      planner: { organization: 'Prado Assessoria', weddingsCount: 12 },
      referrer: { kind: 'planner', referralCode: 'juliana-prado' },
    });
  });

  it('os convites do E2E abrem pela API: do casal pela cerimonialista, o link sem e-mail e o de cerimonialista pelo casal', async () => {
    const invitations = await run();
    const read = (url: string) =>
      request(app.getHttpServer()).get(
        `/v1/access-invitations/${new URL(url).pathname.split('/').pop() ?? ''}`,
      );
    const urlOf = (text: string) => invitations.find(({ key }) => key.includes(text))?.url ?? '';

    expect((await read(urlOf('Fernanda e João')).expect(200)).body).toMatchObject({
      kind: 'couple',
      invitedBy: { name: 'Prado Assessoria', role: 'planner' },
      wedding: { names: 'Fernanda & João' },
    });
    expect((await read(urlOf('link do casal')).expect(200)).body).toMatchObject({
      kind: 'couple',
      email: null,
    });
    expect((await read(urlOf('cerimonialista')).expect(200)).body).toMatchObject({
      kind: 'planner',
      invitedBy: { name: 'Bianca', role: 'owner' },
    });
  });

  it('um endereço de exemplo que é de um casamento de verdade não é sobrescrito', async () => {
    await run();
    const anaEMarcos = await db.wedding.findUniqueOrThrow({ where: { slug: 'ana-e-marcos' } });
    const stranger = await db.user.create({ data: { email: `alguem.${Date.now()}@kore.local` } });
    await db.wedding.update({
      where: { id: anaEMarcos.id },
      data: { createdByUserId: stranger.id },
    });

    try {
      await expect(run()).rejects.toThrow(/ana-e-marcos/);
    } finally {
      await db.wedding.update({
        where: { id: anaEMarcos.id },
        data: { createdByUserId: anaEMarcos.createdByUserId },
      });
    }
  });

  it('decisão 181 - em homologação, tokens aleatórios a cada execução, e o anterior deixa de valer', async () => {
    const homolog = () =>
      seedSampleData({ db, termsVersion: '2026-09', appEnv: 'homolog', appUrl, now: new Date() });
    const tokenOf = (url: string) => new URL(url).pathname.split('/').pop() ?? '';

    const first = await homolog();
    const second = await homolog();

    const [firstToken, secondToken] = [first, second].map((runs) => tokenOf(runs[0]?.url ?? ''));
    expect(firstToken).not.toMatch(/^seed-/);
    expect(secondToken).not.toBe(firstToken);
    await request(app.getHttpServer()).get(`/v1/access-invitations/${firstToken}`).expect(410);
    await request(app.getHttpServer()).get(`/v1/access-invitations/${secondToken}`).expect(200);
    await run(); // volta aos tokens fixos para os outros casos
  });

  describe('decisão 181(6) - código de indicação do seed nas mãos de outra conta', () => {
    /** Tira o lucas-andrade do vendedor de exemplo e o dá a uma conta de verdade. */
    async function strangerHoldsSellerCode() {
      await run();
      const lucas = await db.user.findUniqueOrThrow({
        where: { email: `lucas.andrade@${SAMPLE_EMAIL_DOMAIN}` },
      });
      await db.referrer.update({
        where: { userId: lucas.id },
        data: { referralCode: `lucas-provisorio-${Date.now()}` },
      });
      const stranger = await db.user.create({
        data: { email: `vendedor.${Date.now()}@kore.local`, name: 'Lucas Andrade' },
      });
      await db.referrer.create({
        data: {
          userId: stranger.id,
          kind: 'seller',
          referralCode: 'lucas-andrade',
          ratePercent: 20,
        },
      });
      return { lucasId: lucas.id, strangerId: stranger.id };
    }
    const codeOf = async (userId: string) =>
      (await db.referrer.findUniqueOrThrow({ where: { userId } })).referralCode;

    it('em local e test, o seed toma o código e a outra conta passa ao próximo sufixo', async () => {
      const { lucasId, strangerId } = await strangerHoldsSellerCode();

      await run();

      expect(await codeOf(lucasId)).toBe('lucas-andrade');
      expect(await codeOf(strangerId)).toMatch(/^lucas-andrade-\d+$/);
    });

    it('em homologação, recusa e não muda nada', async () => {
      const { lucasId, strangerId } = await strangerHoldsSellerCode();

      try {
        await expect(
          seedSampleData({
            db,
            termsVersion: '2026-09',
            appEnv: 'homolog',
            appUrl,
            now: new Date(),
          }),
        ).rejects.toThrow(/lucas-andrade.*não é de exemplo/);
        expect(await codeOf(strangerId)).toBe('lucas-andrade');
        expect(await codeOf(lucasId)).not.toBe('lucas-andrade');
      } finally {
        await db.referrer.delete({ where: { userId: strangerId } });
        await run();
      }
    });
  });

  it('decisão 181 - recusa produção', async () => {
    await expect(
      seedSampleData({
        db,
        termsVersion: '2026-09',
        appEnv: 'production',
        appUrl,
        now: new Date(),
      }),
    ).rejects.toThrow(/production/);
  });
});
