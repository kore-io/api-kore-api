import { Controller, Get, HttpCode, INestApplication, Param, Post, Req } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { WeddingAuthorization } from '../../src/modules/access/application/wedding-authorization.service';
import type { AuthenticatedRequest } from '../../src/modules/access/presentation/authenticated-request';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { TenantTransaction } from '../../src/shared/database/tenant-transaction';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

// Rotas só do teste: as rotas de produto do casamento chegam nas próximas
// branches; aqui elas exercitam o interceptor, a autorização e a RLS.
@Controller('weddings/:weddingId/test-isolation')
class WeddingScopedTestController {
  constructor(
    private readonly tenant: TenantTransaction,
    private readonly moduleRef: ModuleRef,
  ) {}

  // O controller do teste fica fora do AccessModule: busca a porta pelo container.
  private get authorization(): WeddingAuthorization {
    return this.moduleRef.get(WeddingAuthorization, { strict: false });
  }

  @Get()
  async read(@Param('weddingId') weddingId: string) {
    const wedding = await this.tenant.client().wedding.findUnique({ where: { id: weddingId } });
    const partners = await this.tenant.client().partner.count();
    return { weddingId: wedding?.id ?? null, partners };
  }

  @Post('remove-collaborator')
  @HttpCode(204)
  async removeCollaborator(
    @Param('weddingId') weddingId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.authorization.require({
      userId: request.auth!.userId,
      weddingId,
      action: 'remove_collaborator',
    });
  }
}

@Controller('test-isolation/my-weddings')
class PanelTestController {
  constructor(private readonly tenant: TenantTransaction) {}

  @Get()
  async list() {
    const weddings = await this.tenant.client().wedding.findMany({ select: { id: true } });
    return weddings.map((wedding) => wedding.id).sort();
  }
}

describe('Isolamento entre casamentos: RLS por vínculo e autorização central (Papéis e permissões; decisão 153)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let ana: Awaited<ReturnType<typeof signedInUser>>;
  let juliana: Awaited<ReturnType<typeof signedInUser>>;
  let bia: Awaited<ReturnType<typeof signedInUser>>;
  let anaWedding: string;
  let biaWedding: string;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [WeddingScopedTestController, PanelTestController] });
    db = app.get(BackofficePrismaService);
    ana = await signedInUser({ app, name: 'Ana' });
    juliana = await signedInUser({ app, name: 'Juliana' });
    bia = await signedInUser({ app, name: 'Bia' });
    anaWedding = (await seedWedding({ db, ownerId: ana.userId, collaboratorIds: [juliana.userId] }))
      .weddingId;
    biaWedding = (await seedWedding({ db, ownerId: bia.userId })).weddingId;
  });

  afterAll(async () => {
    await app?.close();
  });

  const read = ({ cookie, weddingId }: { cookie: string; weddingId: string }) =>
    request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/test-isolation`)
      .set('Cookie', cookie);

  describe('RN01 - quem não participa não vê o casamento', () => {
    it('dada a dona, quando abre o casamento dela, então vê o casamento e os 2 noivos', async () => {
      const response = await read({ cookie: ana.cookie, weddingId: anaWedding }).expect(200);

      expect(response.body).toEqual({ weddingId: anaWedding, partners: 2 });
    });

    it('dada uma pessoa de outro casamento, quando abre o casamento, então recebe "não encontrado"', async () => {
      const response = await read({ cookie: bia.cookie, weddingId: anaWedding }).expect(404);

      expect(response.body).toMatchObject({ statusCode: 404, error: 'WEDDING_NOT_FOUND' });
    });

    it.each([randomUUID(), 'nao-e-uuid'])(
      'dado um casamento que não existe (%s), quando abre, então a resposta é a mesma "não encontrado"',
      async (weddingId) => {
        const response = await read({ cookie: ana.cookie, weddingId }).expect(404);

        expect(response.body.error).toBe('WEDDING_NOT_FOUND');
      },
    );

    it('dado o painel sem casamento definido, quando lista, então cada pessoa vê só os casamentos em que tem vínculo', async () => {
      const list = async (cookie: string) =>
        (
          await request(app.getHttpServer())
            .get('/v1/test-isolation/my-weddings')
            .set('Cookie', cookie)
            .expect(200)
        ).body as string[];

      expect(await list(ana.cookie)).toEqual([anaWedding]);
      expect(await list(juliana.cookie)).toEqual([anaWedding]);
      expect(await list(bia.cookie)).toEqual([biaWedding]);
    });
  });

  describe('RN02 e RN03 - o que cada papel pode fazer', () => {
    const removeCollaborator = (cookie: string) =>
      request(app.getHttpServer())
        .post(`/v1/weddings/${anaWedding}/test-isolation/remove-collaborator`)
        .set('Cookie', cookie)
        .set('Origin', APP_ORIGIN);

    it('dada a colaboradora, quando vê o casamento, então pode', async () => {
      await read({ cookie: juliana.cookie, weddingId: anaWedding }).expect(200);
    });

    it('dada a colaboradora, quando tenta remover colaborador, então recebe 403 ACTION_NOT_ALLOWED', async () => {
      const response = await removeCollaborator(juliana.cookie).expect(403);

      expect(response.body.error).toBe('ACTION_NOT_ALLOWED');
    });

    it('dada a dona, quando remove colaborador, então pode', async () => {
      await removeCollaborator(ana.cookie).expect(204);
    });
  });

  it('RN06 - dado um colaborador removido, quando faz a próxima requisição, então já não encontra o casamento', async () => {
    const pedro = await signedInUser({ app, name: 'Pedro' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: (await signedInUser({ app })).userId,
      collaboratorIds: [pedro.userId],
    });
    await read({ cookie: pedro.cookie, weddingId }).expect(200);

    await db.membership.updateMany({
      where: { weddingId, userId: pedro.userId },
      data: { removedAt: new Date() },
    });

    await read({ cookie: pedro.cookie, weddingId }).expect(404);
  });
});
