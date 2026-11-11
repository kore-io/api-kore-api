import type { Prisma } from '../../../../generated/prisma/client';

/**
 * Recalcula os números do casamento a partir do Guest (Grupos RN16): contam
 * os convidados ativos, vagas incluídas; partiesPending são os grupos ativos
 * com pelo menos um convidado ou vaga pendente. Pela conexão do backoffice
 * (sem RLS): o seed e a rotina noturna de recálculo. Devolve quantas linhas
 * mudaram.
 */
export async function recomputeWeddingStats({
  db,
  weddingId,
}: {
  db: Pick<Prisma.TransactionClient, '$executeRaw'>;
  weddingId?: string;
}): Promise<number> {
  return db.$executeRaw`
    WITH counted AS (
      SELECT w.id AS wedding_id,
        count(g.id) AS guests_total,
        count(g.id) FILTER (WHERE g.rsvp_status = 'confirmed') AS confirmed,
        count(g.id) FILTER (WHERE g.rsvp_status = 'declined') AS declined,
        count(g.id) FILTER (WHERE g.rsvp_status = 'pending') AS pending,
        count(g.id) FILTER (WHERE g.rsvp_status = 'confirmed' AND g.age_group = 'adult') AS adults_confirmed,
        count(g.id) FILTER (WHERE g.rsvp_status = 'confirmed' AND g.age_group = 'child') AS children_confirmed,
        count(g.id) FILTER (WHERE g.rsvp_status = 'confirmed' AND g.age_group = 'baby') AS babies_confirmed,
        count(DISTINCT g.party_id) FILTER (WHERE g.rsvp_status = 'pending') AS parties_pending
      FROM weddings w
      LEFT JOIN guests g ON g.wedding_id = w.id AND g.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM parties p WHERE p.id = g.party_id AND p.deleted_at IS NULL)
      WHERE ${weddingId ?? null}::uuid IS NULL OR w.id = ${weddingId ?? null}::uuid
      GROUP BY w.id
    )
    UPDATE wedding_stats s SET
      guests_total = c.guests_total, confirmed = c.confirmed, declined = c.declined,
      pending = c.pending, adults_confirmed = c.adults_confirmed,
      children_confirmed = c.children_confirmed, babies_confirmed = c.babies_confirmed,
      parties_pending = c.parties_pending, updated_at = now()
    FROM counted c
    WHERE s.wedding_id = c.wedding_id
      AND (s.guests_total, s.confirmed, s.declined, s.pending, s.adults_confirmed,
           s.children_confirmed, s.babies_confirmed, s.parties_pending)
          IS DISTINCT FROM
          (c.guests_total::int, c.confirmed::int, c.declined::int, c.pending::int,
           c.adults_confirmed::int, c.children_confirmed::int, c.babies_confirmed::int,
           c.parties_pending::int)`;
}
