import { INestApplication } from '@nestjs/common';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';

describe('Conexão do backoffice e das rotinas (banco real)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('dada a conexão do backoffice, quando consulta o papel, então é kore_backoffice e ignora a RLS', async () => {
    const [role] = await app.get(BackofficePrismaService).$queryRaw<
      { role: string; bypass: boolean }[]
    >`SELECT current_user AS role, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;

    expect(role).toEqual({ role: 'kore_backoffice', bypass: true });
  });
});
