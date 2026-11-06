import { createHash, randomBytes } from 'node:crypto';
import type { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';

/**
 * Cria um convite de acesso pela conexão do backoffice e devolve o token do
 * link (o banco guarda só o hash), sem depender da rota de envio nem do Mailpit.
 */
export async function seedInvitation({
  db,
  weddingId,
  kind,
  email,
  invitedByUserId,
  expiresAt = new Date(Date.now() + 30 * 86_400_000),
}: {
  db: BackofficePrismaService;
  weddingId: string;
  kind: 'partner' | 'couple' | 'planner';
  email: string | null;
  invitedByUserId: string;
  expiresAt?: Date;
}): Promise<{ token: string; invitationId: string }> {
  const token = randomBytes(32).toString('base64url');
  const invitation = await db.accessInvitation.create({
    data: {
      weddingId,
      kind,
      email,
      role: kind === 'planner' ? 'collaborator' : 'owner',
      tokenHash: createHash('sha256').update(token).digest('base64url'),
      invitedByUserId,
      expiresAt,
    },
    select: { id: true },
  });
  return { token, invitationId: invitation.id };
}
