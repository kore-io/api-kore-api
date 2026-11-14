import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StartSession } from '../../src/modules/access/application/start-session.use-case';
import { SESSION_COOKIE } from '../../src/modules/access/presentation/session-cookie';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { PrismaService } from '../../src/shared/database/prisma.service';

/** Cria um usuário com uma sessão aberta e devolve o cabeçalho Cookie dela. */
export async function signedInUser({
  app,
  name = 'Ana Beatriz Moreira',
}: {
  app: INestApplication;
  name?: string;
}): Promise<{ userId: string; email: string; cookie: string }> {
  const email = `ana.${randomUUID()}@kore.local`;
  const user = await app.get(PrismaService).user.create({ data: { email, name } });
  const cookie = await openSession({ app, userId: user.id });
  return { userId: user.id, email, cookie };
}

/** Abre mais uma sessão (outro aparelho) para o usuário. */
export async function openSession({
  app,
  userId,
}: {
  app: INestApplication;
  userId: string;
}): Promise<string> {
  const { token } = await app
    .get(StartSession)
    .execute({ userId, now: new Date(), authMethod: 'email' });
  return `${SESSION_COOKIE}=${token}`;
}

/**
 * Alguém da equipe do Kore (Backoffice - acesso RN01): a sessão pelo Google
 * com o `hd` verificado e o papel no banco. `domain` e `authMethod` trocados
 * servem aos casos de recusa.
 */
export async function staffUser({
  app,
  role,
  domain = 'kore.com.br',
  authMethod = 'google',
  name = 'Renata Lima',
}: {
  app: INestApplication;
  role: 'admin' | 'support' | 'none';
  domain?: string | null;
  authMethod?: 'google' | 'email';
  name?: string;
}): Promise<{ userId: string; email: string; cookie: string }> {
  const email = `staff.${randomUUID()}@kore.com.br`;
  const user = await app
    .get(BackofficePrismaService)
    .user.create({ data: { email, name, platformRole: role } });
  const { token } = await app
    .get(StartSession)
    .execute({ userId: user.id, now: new Date(), authMethod, staffDomain: domain });
  return { userId: user.id, email, cookie: `${SESSION_COOKIE}=${token}` };
}
