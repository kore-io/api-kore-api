import { randomUUID } from 'node:crypto';
import type { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';

/**
 * Cria um casamento com vínculos pela conexão do backoffice (ignora a RLS):
 * os testes montam o cenário sem depender das rotas de cadastro e convite.
 */
export async function seedWedding({
  db,
  ownerId,
  collaboratorIds = [],
}: {
  db: BackofficePrismaService;
  ownerId: string;
  collaboratorIds?: string[];
}): Promise<{ weddingId: string }> {
  const wedding = await db.wedding.create({
    data: {
      slug: `casamento-${randomUUID()}`,
      status: 'draft',
      timezone: 'America/Sao_Paulo',
      city: 'Campinas',
      state: 'SP',
      createdByUserId: ownerId,
      signupSource: 'direct',
      partners: {
        create: [
          { slot: 1, displayName: 'Ana', title: 'bride', userId: ownerId },
          { slot: 2, displayName: 'Marcos', title: 'groom' },
        ],
      },
      memberships: {
        create: [
          { userId: ownerId, role: 'owner' },
          ...collaboratorIds.map((userId) => ({ userId, role: 'collaborator' as const })),
        ],
      },
    },
    select: { id: true },
  });
  return { weddingId: wedding.id };
}
