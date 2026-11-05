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

/**
 * Casamento criado pelo indicador para o casal (Novo casamento, F6): rascunho
 * sem dono, com o indicador como colaborador e atribuído a ele.
 */
export async function seedReferrerWedding({
  db,
  referrerUserId,
  referrerKind = 'planner',
  status = 'draft',
}: {
  db: BackofficePrismaService;
  referrerUserId: string;
  referrerKind?: 'planner' | 'seller';
  status?: 'draft' | 'awaiting_couple';
}): Promise<{ weddingId: string }> {
  const referrer = await db.referrer.findUniqueOrThrow({
    where: { userId: referrerUserId },
    select: { id: true },
  });
  const wedding = await db.wedding.create({
    data: {
      slug: `casamento-${randomUUID()}`,
      status,
      eventDate: new Date('2027-03-20T00:00:00Z'),
      timezone: 'America/Sao_Paulo',
      city: 'Valinhos',
      state: 'SP',
      createdByUserId: referrerUserId,
      referrerId: referrer.id,
      referralSource: referrerKind === 'planner' ? 'created_by_planner' : 'created_by_seller',
      signupSource: referrerKind === 'planner' ? 'planner' : 'direct',
      partners: {
        create: [
          { slot: 1, displayName: 'Fernanda Alves' },
          { slot: 2, displayName: 'João Lima' },
        ],
      },
      memberships: { create: [{ userId: referrerUserId, role: 'collaborator' }] },
    },
    select: { id: true },
  });
  return { weddingId: wedding.id };
}
