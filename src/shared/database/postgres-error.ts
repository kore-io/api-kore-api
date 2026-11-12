import { Prisma } from '../../generated/prisma/client';

/**
 * O SQLSTATE de um erro do Postgres que veio pelo Prisma (adapter-pg), quando
 * houver: ex. as barreiras das funções do banco, com classe própria (KA001…).
 */
export function postgresErrorCode({ error }: { error: unknown }): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const cause = (error.meta?.driverAdapterError as { cause?: { code?: unknown } } | undefined)
    ?.cause;
  return typeof cause?.code === 'string' ? cause.code : undefined;
}
