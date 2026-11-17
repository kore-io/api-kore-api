import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  changePlatformRole,
  PlatformRoleUsageError,
  PLATFORM_ROLE_CHANGED_ACTION,
} from '@/cli/platform-role/change-platform-role';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/harness/create-test-app';
import { staffUser } from '../support/harness/sessions';

/**
 * pnpm staff:role (Backoffice - acesso RN01; decisão 275): o platformRole só
 * muda pelo script de operação, com a linha no log da aplicação, e o guard
 * relê o papel na próxima requisição.
 */
describe('Backoffice: o script do platformRole (Backoffice - acesso RN01; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const overview = (cookie: string) =>
    request(app.getHttpServer()).get('/v1/admin/overview').set('Cookie', cookie);
  const run = (input: { email: string; role: string; reason?: string }) =>
    changePlatformRole({
      db,
      input: { by: 'ops@kore.com.br', reason: 'Entrada na equipe', ...input },
      now: new Date(),
    });
  const logsOf = (userId: string) =>
    db.applicationLog.findMany({
      where: { action: PLATFORM_ROLE_CHANGED_ACTION, entityId: userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  it('RN01 - dá e tira o papel com o log (de, para, quem rodou e motivo); o guard relê o papel na próxima requisição', async () => {
    const person = await staffUser({ app, role: 'none' });
    await overview(person.cookie).expect(403);

    expect(await run({ email: person.email.toUpperCase(), role: 'support' })).toEqual({
      outcome: 'changed',
      userId: person.userId,
      from: 'none',
      to: 'support',
    });
    await overview(person.cookie).expect(200);

    await run({ email: person.email, role: 'none', reason: 'Saiu da equipe' });
    expect((await overview(person.cookie).expect(403)).body.error).toBe('STAFF_ONLY');

    expect((await logsOf(person.userId)).map((row) => [row.actorKind, row.data])).toEqual([
      [
        'system',
        { from: 'none', to: 'support', by: 'ops@kore.com.br', reason: 'Entrada na equipe' },
      ],
      ['system', { from: 'support', to: 'none', by: 'ops@kore.com.br', reason: 'Saiu da equipe' }],
    ]);
  });

  it('RN01 - o mesmo papel não muda nada nem grava log; papel inválido, conta inexistente ou sem motivo: recusa', async () => {
    const person = await staffUser({ app, role: 'admin' });
    expect(await run({ email: person.email, role: 'admin' })).toEqual({
      outcome: 'unchanged',
      userId: person.userId,
      role: 'admin',
    });
    expect(await logsOf(person.userId)).toEqual([]);

    await expect(run({ email: person.email, role: 'owner' })).rejects.toThrow(
      PlatformRoleUsageError,
    );
    await expect(run({ email: 'ninguem@kore.com.br', role: 'admin' })).rejects.toThrow(
      PlatformRoleUsageError,
    );
    await expect(run({ email: person.email, role: 'none', reason: ' ' })).rejects.toThrow(
      PlatformRoleUsageError,
    );
    expect(await db.user.findUniqueOrThrow({ where: { id: person.userId } })).toMatchObject({
      platformRole: 'admin',
    });
  });
});
