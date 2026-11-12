import { Prisma } from '../../../../generated/prisma/client';

type Db = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;

/**
 * Os números de cada casamento contados a partir do Guest (Grupos RN16):
 * convidados ativos de grupos ativos, vagas incluídas; partiesPending são os
 * grupos com pelo menos um convidado ou vaga pendente. Casamento sem convidado
 * conta zero.
 */
function countedStats({ weddingId }: { weddingId?: string }): Prisma.Sql {
  const filter = weddingId ? Prisma.sql`AND s.wedding_id = ${weddingId}::uuid` : Prisma.empty;
  return Prisma.sql`
    SELECT s.wedding_id,
      coalesce(c.guests_total, 0)::int AS guests_total,
      coalesce(c.confirmed, 0)::int AS confirmed,
      coalesce(c.declined, 0)::int AS declined,
      coalesce(c.pending, 0)::int AS pending,
      coalesce(c.adults_confirmed, 0)::int AS adults_confirmed,
      coalesce(c.children_confirmed, 0)::int AS children_confirmed,
      coalesce(c.babies_confirmed, 0)::int AS babies_confirmed,
      coalesce(c.parties_pending, 0)::int AS parties_pending
    FROM wedding_stats s
    LEFT JOIN (
      SELECT g.wedding_id,
        count(*) AS guests_total,
        count(*) FILTER (WHERE g.rsvp_status = 'confirmed') AS confirmed,
        count(*) FILTER (WHERE g.rsvp_status = 'declined') AS declined,
        count(*) FILTER (WHERE g.rsvp_status = 'pending') AS pending,
        count(*) FILTER (WHERE g.rsvp_status = 'confirmed' AND g.age_group = 'adult') AS adults_confirmed,
        count(*) FILTER (WHERE g.rsvp_status = 'confirmed' AND g.age_group = 'child') AS children_confirmed,
        count(*) FILTER (WHERE g.rsvp_status = 'confirmed' AND g.age_group = 'baby') AS babies_confirmed,
        count(DISTINCT g.party_id) FILTER (WHERE g.rsvp_status = 'pending') AS parties_pending
      FROM guests g
      JOIN parties p ON p.id = g.party_id AND p.deleted_at IS NULL
      WHERE g.deleted_at IS NULL ${weddingId ? Prisma.sql`AND g.wedding_id = ${weddingId}::uuid` : Prisma.empty}
      GROUP BY g.wedding_id
    ) c ON c.wedding_id = s.wedding_id
    WHERE TRUE ${filter}`;
}

const DIVERGES = Prisma.sql`
  (s.guests_total, s.confirmed, s.declined, s.pending, s.adults_confirmed,
   s.children_confirmed, s.babies_confirmed, s.parties_pending)
  IS DISTINCT FROM
  (c.guests_total, c.confirmed, c.declined, c.pending, c.adults_confirmed,
   c.children_confirmed, c.babies_confirmed, c.parties_pending)`;

/**
 * Os casamentos cujos números divergem do Guest, numa leitura só e sem lock:
 * a rotina noturna só abre transação para esses (RN16).
 */
export async function findDivergentWeddingIds({ db }: { db: Db }): Promise<string[]> {
  const rows = await db.$queryRaw<{ wedding_id: string }[]>`
    SELECT s.wedding_id FROM wedding_stats s
    JOIN (${countedStats({})}) c ON c.wedding_id = s.wedding_id
    WHERE ${DIVERGES}`;
  return rows.map((row) => row.wedding_id);
}

/**
 * Recalcula os números de um casamento a partir do Guest (RN16). Pela conexão
 * do backoffice (sem RLS): o seed e a rotina noturna. Rode dentro de uma
 * transação: a linha do wedding_stats fica travada antes da contagem, e toda
 * escrita na lista trava a mesma linha antes de mexer nos convidados
 * (PartyStore.lockStats), então um incremento nunca se perde entre a contagem
 * e a gravação. Devolve 1 se a linha mudou.
 */
export async function recomputeWeddingStats({
  db,
  weddingId,
}: {
  db: Db;
  weddingId: string;
}): Promise<number> {
  await db.$queryRaw`SELECT 1 FROM wedding_stats WHERE wedding_id = ${weddingId}::uuid FOR UPDATE`;
  return db.$executeRaw`
    UPDATE wedding_stats s SET
      guests_total = c.guests_total, confirmed = c.confirmed, declined = c.declined,
      pending = c.pending, adults_confirmed = c.adults_confirmed,
      children_confirmed = c.children_confirmed, babies_confirmed = c.babies_confirmed,
      parties_pending = c.parties_pending, updated_at = now()
    FROM (${countedStats({ weddingId })}) c
    WHERE s.wedding_id = c.wedding_id AND ${DIVERGES}`;
}
