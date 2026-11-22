import type { Client } from 'pg';

/**
 * Espera até outro backend estar parado num lock que a conexão `holder` segura
 * (pg_stat_activity com wait_event_type = 'Lock' e pg_blocking_pids). Usado nos
 * testes de duas conexões: o COMMIT só sai depois que o pedido da API já está
 * esperando, sem depender de uma espera fixa (sugestão do Crivo no DoD da F6).
 */
export async function waitUntilBlockedBy({
  holder,
  timeoutMs = 5_000,
}: {
  holder: Client;
  timeoutMs?: number;
}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await holder.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND pg_backend_pid() = ANY (pg_blocking_pids(pid))`,
    );
    if ((rows[0]?.waiting ?? 0) > 0) return;
    if (Date.now() > deadline)
      throw new Error(`Nenhum backend esperou o lock da conexão do teste em ${timeoutMs} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
