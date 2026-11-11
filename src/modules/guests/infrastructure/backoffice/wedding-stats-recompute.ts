import type { Prisma } from '../../../../generated/prisma/client';

/**
 * Recalcula os números de um casamento a partir do Guest (Grupos RN16): contam
 * os convidados ativos, vagas incluídas; partiesPending são os grupos ativos
 * com pelo menos um convidado ou vaga pendente. Pela conexão do backoffice
 * (sem RLS): o seed e a rotina noturna. Rode dentro de uma transação: a linha
 * do wedding_stats fica travada antes da contagem, e toda escrita na lista
 * trava a mesma linha antes de mexer nos convidados (PartyStore.lockStats),
 * então um incremento nunca se perde entre a contagem e a gravação. Devolve 1
 * se a linha mudou.
 */
export async function recomputeWeddingStats({
  db,
  weddingId,
}: {
  db: Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;
  weddingId: string;
}): Promise<number> {
  await db.$queryRaw`SELECT 1 FROM wedding_stats WHERE wedding_id = ${weddingId}::uuid FOR UPDATE`;
  return db.$executeRaw`
    WITH counted AS (
      SELECT
        count(g.id) AS guests_total,
        count(g.id) FILTER (WHERE g.rsvp_status = 'confirmed') AS confirmed,
        count(g.id) FILTER (WHERE g.rsvp_status = 'declined') AS declined,
        count(g.id) FILTER (WHERE g.rsvp_status = 'pending') AS pending,
        count(g.id) FILTER (WHERE g.rsvp_status = 'confirmed' AND g.age_group = 'adult') AS adults_confirmed,
        count(g.id) FILTER (WHERE g.rsvp_status = 'confirmed' AND g.age_group = 'child') AS children_confirmed,
        count(g.id) FILTER (WHERE g.rsvp_status = 'confirmed' AND g.age_group = 'baby') AS babies_confirmed,
        count(DISTINCT g.party_id) FILTER (WHERE g.rsvp_status = 'pending') AS parties_pending
      FROM guests g
      WHERE g.wedding_id = ${weddingId}::uuid AND g.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM parties p WHERE p.id = g.party_id AND p.deleted_at IS NULL)
    )
    UPDATE wedding_stats s SET
      guests_total = c.guests_total, confirmed = c.confirmed, declined = c.declined,
      pending = c.pending, adults_confirmed = c.adults_confirmed,
      children_confirmed = c.children_confirmed, babies_confirmed = c.babies_confirmed,
      parties_pending = c.parties_pending, updated_at = now()
    FROM counted c
    WHERE s.wedding_id = ${weddingId}::uuid
      AND (s.guests_total, s.confirmed, s.declined, s.pending, s.adults_confirmed,
           s.children_confirmed, s.babies_confirmed, s.parties_pending)
          IS DISTINCT FROM
          (c.guests_total::int, c.confirmed::int, c.declined::int, c.pending::int,
           c.adults_confirmed::int, c.children_confirmed::int, c.babies_confirmed::int,
           c.parties_pending::int)`;
}
