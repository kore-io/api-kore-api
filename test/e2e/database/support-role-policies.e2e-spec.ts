import { INestApplication } from '@nestjs/common';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/harness/create-test-app';

/**
 * A auditoria do papel kore_support (Ver como o casal, Backoffice - acesso
 * RN08; decisão 272): em toda tabela que ele lê, a RLS está ligada e nenhuma
 * policy permissiva sem condição (USING true) vale para ele sem uma
 * RESTRICTIVE do suporte junto. Foi assim que a referrers (PR 11f) e a users
 * (decisão 272) deixavam o suporte ler fora do casamento da sessão.
 */
describe('Papel kore_support: RLS e policies das tabelas que ele lê (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('RN08 (decisão 272) - toda tabela que o kore_support lê tem RLS e nenhuma porta aberta sem o recorte do suporte', async () => {
    // As tabelas com SELECT para o kore_support, na tabela inteira ou por coluna.
    const tables = await db.$queryRaw<{ table_name: string; rls: boolean }[]>`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r' AND has_any_column_privilege('kore_support', c.oid, 'SELECT')
      ORDER BY c.relname`;
    expect(tables.length).toBeGreaterThan(10);
    expect(tables.filter((table) => !table.rls).map((table) => table.table_name)).toEqual([]);

    const policies = await db.$queryRaw<
      {
        tablename: string;
        policyname: string;
        roles: string[];
        cmd: string;
        permissive: string;
        qual: string | null;
      }[]
    >`
      SELECT tablename, policyname, roles::text[] AS roles, cmd, permissive, qual
      FROM pg_policies
      WHERE schemaname = 'public' AND cmd IN ('SELECT', 'ALL')`;
    const appliesToSupport = (roles: string[]) =>
      roles.includes('public') || roles.includes('kore_support');
    const open = policies.filter(
      (policy) =>
        tables.some((table) => table.table_name === policy.tablename) &&
        policy.permissive === 'PERMISSIVE' &&
        appliesToSupport(policy.roles) &&
        policy.qual?.trim() === 'true',
    );
    const unguarded = open
      .filter(
        (policy) =>
          !policies.some(
            (guard) =>
              guard.tablename === policy.tablename &&
              guard.permissive === 'RESTRICTIVE' &&
              guard.roles.includes('kore_support'),
          ),
      )
      .map((policy) => `${policy.tablename}.${policy.policyname}`);
    expect(unguarded).toEqual([]);
    // As duas portas conhecidas estão abertas e com o recorte do suporte junto.
    expect(open.map((policy) => policy.tablename).sort()).toEqual(
      expect.arrayContaining(['referrers', 'users']),
    );
  });
});
