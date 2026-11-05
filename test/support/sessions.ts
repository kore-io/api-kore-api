import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StartSession } from '../../src/modules/access/application/start-session.use-case';
import { SESSION_COOKIE } from '../../src/modules/access/presentation/session-cookie';
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
  const { token } = await app.get(StartSession).execute({ userId, now: new Date() });
  return `${SESSION_COOKIE}=${token}`;
}
