import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import type {
  LoginChallengeRecord,
  LoginChallengeStore,
  LoginChallengeTransaction,
  NewLoginChallenge,
} from '../application/ports/login-challenge-store.port';

const RECORD_FIELDS = {
  id: true,
  email: true,
  codeHash: true,
  expiresAt: true,
  attempts: true,
  consumedAt: true,
  invalidatedAt: true,
  origin: true,
  originRef: true,
} as const;

@Injectable()
export class PrismaLoginChallengeStore implements LoginChallengeStore {
  constructor(private readonly prisma: PrismaService) {}

  exclusiveForEmail<T>({
    email,
    work,
  }: {
    email: string;
    work: (transaction: LoginChallengeTransaction) => Promise<T>;
  }): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // Trava por e-mail até o fim da transação: dois pedidos ou duas tentativas
      // do mesmo e-mail ao mesmo tempo não se atropelam (RN04, RN05).
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`login:${email.toLowerCase()}`}, 0))`;
      return work(new PrismaLoginChallengeTransaction(tx));
    });
  }

  findByTokenHash({ tokenHash }: { tokenHash: string }): Promise<LoginChallengeRecord | null> {
    return this.prisma.loginChallenge.findUnique({ where: { tokenHash }, select: RECORD_FIELDS });
  }
}

class PrismaLoginChallengeTransaction implements LoginChallengeTransaction {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async listRequestTimesSince({ email, since }: { email: string; since: Date }): Promise<Date[]> {
    const rows = await this.tx.loginChallenge.findMany({
      where: { email, createdAt: { gte: since } },
      select: { createdAt: true },
    });
    return rows.map((row) => row.createdAt);
  }

  async invalidateActive({ email, now }: { email: string; now: Date }): Promise<void> {
    await this.tx.loginChallenge.updateMany({
      where: { email, consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    });
  }

  async create({ challenge }: { challenge: NewLoginChallenge }): Promise<void> {
    await this.tx.loginChallenge.create({ data: challenge, select: { id: true } });
  }

  findLatestOpen({ email }: { email: string }): Promise<LoginChallengeRecord | null> {
    return this.tx.loginChallenge.findFirst({
      where: { email, consumedAt: null, invalidatedAt: null },
      orderBy: { createdAt: 'desc' },
      select: RECORD_FIELDS,
    });
  }

  async registerFailedAttempt({ id }: { id: string }): Promise<number> {
    const { attempts } = await this.tx.loginChallenge.update({
      where: { id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return attempts;
  }

  async invalidate({ id, now }: { id: string; now: Date }): Promise<void> {
    await this.tx.loginChallenge.update({ where: { id }, data: { invalidatedAt: now } });
  }

  async consume({ id, now }: { id: string; now: Date }): Promise<boolean> {
    const { count } = await this.tx.loginChallenge.updateMany({
      where: { id, consumedAt: null, invalidatedAt: null },
      data: { consumedAt: now },
    });
    return count === 1;
  }
}
