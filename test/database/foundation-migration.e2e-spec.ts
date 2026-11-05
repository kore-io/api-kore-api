import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { createTestApp } from '../support/create-test-app';

describe('Migration de fundação (banco real)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('dada a API conectada, quando consulta o próprio usuário, então não é superusuário nem ignora a RLS', async () => {
    const [role] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('dado o usuário da API, quando consulta os papéis, então é membro de kore_app e não de kore_backoffice', async () => {
    const [membership] = await prisma.$queryRaw<{ app: boolean; backoffice: boolean }[]>`
      SELECT pg_has_role(current_user, 'kore_app', 'member') AS app,
             pg_has_role(current_user, 'kore_backoffice', 'member') AS backoffice`;

    expect(membership).toEqual({ app: true, backoffice: false });
  });

  it('dados os papéis de grupo, quando consulta, então só kore_backoffice ignora a RLS e nenhum faz login', async () => {
    const roles = await prisma.$queryRaw<
      { rolname: string; rolbypassrls: boolean; rolcanlogin: boolean }[]
    >`SELECT rolname, rolbypassrls, rolcanlogin FROM pg_roles
      WHERE rolname IN ('kore_app', 'kore_backoffice') ORDER BY rolname`;

    expect(roles).toEqual([
      { rolname: 'kore_app', rolbypassrls: false, rolcanlogin: false },
      { rolname: 'kore_backoffice', rolbypassrls: true, rolcanlogin: false },
    ]);
  });

  it('dada a extensão citext, quando compara textos, então ignora maiúsculas', async () => {
    const [row] = await prisma.$queryRaw<{ equal: boolean }[]>`
      SELECT 'Ana@Kore.com.br'::citext = 'ana@kore.com.br'::citext AS equal`;

    expect(row.equal).toBe(true);
  });

  it('dada uma transação sem SET LOCAL, quando lê o casamento corrente, então é nulo (nega em vez de vazar)', async () => {
    const [row] = await prisma.$queryRaw<{ weddingId: string | null }[]>`
      SELECT current_wedding_id() AS "weddingId"`;

    expect(row.weddingId).toBeNull();
  });

  it('dado um SET LOCAL na transação, quando lê o casamento corrente, então devolve o id e ele não vaza para a próxima transação', async () => {
    const weddingId = randomUUID();

    const inside = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.wedding_id', ${weddingId}, true)`;
      const [row] = await tx.$queryRaw<{ weddingId: string }[]>`
        SELECT current_wedding_id() AS "weddingId"`;
      return row.weddingId;
    });
    const [after] = await prisma.$queryRaw<{ weddingId: string | null }[]>`
      SELECT current_wedding_id() AS "weddingId"`;

    expect(inside).toBe(weddingId);
    expect(after.weddingId).toBeNull();
  });
});
