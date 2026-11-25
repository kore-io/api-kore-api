import type { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import type {
  AdminLogActorRole,
  AdminLogRow,
} from '@/modules/backoffice/application/ports/admin-insights.reader.port';

const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/**
 * Os nomes e papéis de quem agiu e os casais da página do Log, em 4 leituras
 * (sem uma consulta por linha; decisão 316(11)(c)).
 */
export async function loadLogActors({
  db,
  rows,
}: {
  db: BackofficePrismaService;
  rows: { actorKind: string; actorUserId: string | null; weddingId: string | null }[];
}) {
  const userIds = [...new Set(rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])))];
  const weddingIds = [...new Set(rows.flatMap((row) => (row.weddingId ? [row.weddingId] : [])))];
  const [users, memberships, referrers, partners] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, platformRole: true },
    }),
    db.membership.findMany({
      where: { userId: { in: userIds }, weddingId: { in: weddingIds } },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, weddingId: true, role: true },
    }),
    db.referrer.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, kind: true },
    }),
    db.partner.findMany({
      where: { weddingId: { in: weddingIds } },
      orderBy: { slot: 'asc' },
      select: { weddingId: true, displayName: true },
    }),
  ]);
  const userOf = new Map(users.map((user) => [user.id, user] as const));
  // O vínculo mais recente da pessoa no casamento, mesmo se removido depois.
  const membershipRole = new Map<string, 'owner' | 'collaborator'>();
  for (const membership of memberships) {
    const key = `${membership.userId}:${membership.weddingId}`;
    if (!membershipRole.has(key)) membershipRole.set(key, membership.role);
  }
  const referrerKind = new Map(referrers.map((referrer) => [referrer.userId, referrer.kind]));
  const couple = new Map<string, string[]>();
  for (const partner of partners)
    couple.set(partner.weddingId, [
      ...(couple.get(partner.weddingId) ?? []),
      firstName(partner.displayName),
    ]);
  return {
    actorOf: (row: {
      actorKind: string;
      actorUserId: string | null;
      weddingId: string | null;
    }): AdminLogRow['actor'] => {
      if (!row.actorUserId) return null;
      const user = userOf.get(row.actorUserId);
      const staffRole =
        row.actorKind === 'admin' && user && user.platformRole !== 'none'
          ? user.platformRole
          : null;
      const role: AdminLogActorRole | null =
        staffRole ??
        (row.weddingId ? membershipRole.get(`${row.actorUserId}:${row.weddingId}`) : null) ??
        referrerKind.get(row.actorUserId) ??
        null;
      return { name: user?.name ?? null, role };
    },
    coupleOf: (weddingId: string) => couple.get(weddingId)?.join(' & ') ?? null,
  };
}
