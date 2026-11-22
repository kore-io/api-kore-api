import { Client } from 'pg';
import { waitUntilBlockedBy } from '../support/harness/lock-wait';

/** O helper dos testes de duas conexões (waitUntilBlockedBy), com o banco real. */
describe('waitUntilBlockedBy (helper dos testes de duas conexões)', () => {
  const connect = async () => {
    const client = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await client.connect();
    return client;
  };
  const key = () => Math.floor(Math.random() * 2 ** 31);

  it('volta quando outro backend espera o lock que a conexão segura', async () => {
    const [holder, waiter] = [await connect(), await connect()];
    const lock = key();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1)', [lock]);
      const waiting = waiter.query('SELECT pg_advisory_lock($1)', [lock]);

      await waitUntilBlockedBy({ holder });

      await holder.query('COMMIT');
      await waiting;
      await waiter.query('SELECT pg_advisory_unlock($1)', [lock]);
    } finally {
      await holder.end();
      await waiter.end();
    }
  });

  it('sem ninguém esperando, cai no prazo', async () => {
    const holder = await connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1)', [key()]);

      await expect(waitUntilBlockedBy({ holder, timeoutMs: 200 })).rejects.toThrow(
        /Nenhum backend esperou/,
      );
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
    }
  });
});
