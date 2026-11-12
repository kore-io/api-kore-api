import type { Prisma, PrismaClient } from '../../../../generated/prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Quem recebe as respostas de um casamento, conferido na hora de mandar
 * (Notificações da cerimonialista RN07; D18): o dono, ou a cerimonialista com
 * vínculo collaborator ativo e Planner (o vendedor não recebe). Nulo sem
 * vínculo: o que estava na fila é descartado. Pela conexão do backoffice, então
 * a conferência é explícita (a RLS não vale aqui).
 */
export async function recipientRole({
  db,
  userId,
  weddingId,
}: {
  db: Db;
  userId: string;
  weddingId: string;
}): Promise<'owner' | 'planner' | null> {
  const membership = await db.membership.findFirst({
    where: { userId, weddingId, removedAt: null },
    select: { role: true },
  });
  if (!membership) return null;
  if (membership.role === 'owner') return 'owner';
  const planner = await db.planner.findFirst({
    where: { referrer: { userId, kind: 'planner', status: 'active' } },
    select: { id: true },
  });
  return planner ? 'planner' : null;
}

/**
 * A preferência que vale (Notificações da cerimonialista RN06): para o dono, a
 * do casamento; para a cerimonialista, a geral (sem casamento).
 */
export function preferenceWhere({
  role,
  userId,
  weddingId,
  type,
}: {
  role: 'owner' | 'planner';
  userId: string;
  weddingId: string;
  type: 'rsvp' | 'wedding_published' | 'membership_removed';
}): Prisma.NotificationPreferenceWhereInput {
  return { userId, type, weddingId: role === 'owner' ? weddingId : null };
}

/** Os primeiros nomes do casal, na ordem dos noivos. */
export async function partnerNamesOf({
  db,
  weddingId,
}: {
  db: Db;
  weddingId: string;
}): Promise<[string, string]> {
  const partners = await db.partner.findMany({
    where: { weddingId },
    select: { slot: true, displayName: true },
  });
  const name = (slot: number) =>
    (partners.find((partner) => partner.slot === slot)?.displayName ?? '').trim().split(/\s+/)[0] ??
    '';
  return [name(1), name(2)];
}
