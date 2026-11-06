import { Prisma } from '../../generated/prisma/client';
import { postgresErrorCode } from './postgres-error';

const prismaError = (meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('raw query failed', {
    code: 'P2010',
    clientVersion: 'test',
    meta,
  });

describe('postgresErrorCode', () => {
  it('lê o SQLSTATE do erro do driver que veio pelo Prisma', () => {
    const error = prismaError({
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: { code: 'KA002', message: 'owners full' },
      },
    });

    expect(postgresErrorCode({ error })).toBe('KA002');
  });

  it('sem erro do driver, ou erro que não é do Prisma, não há código', () => {
    expect(postgresErrorCode({ error: prismaError({}) })).toBeUndefined();
    expect(postgresErrorCode({ error: new Error('x') })).toBeUndefined();
  });
});
