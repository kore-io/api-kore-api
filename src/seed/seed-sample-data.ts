import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { invitationExpiresAt } from '../modules/access/domain/access-invitation';
import { timezoneForState } from '../modules/access/domain/wedding-signup';
import { OpaqueSessionTokens } from '../modules/access/infrastructure/opaque-session-tokens';
import { recomputeWeddingStats } from '../modules/guests/infrastructure/backoffice/wedding-stats-recompute';
import { uuidV7 } from '../shared/ids/uuid-v7';
import { INVITATION_PATH } from '../modules/access/infrastructure/outbox-invitation-mailer';
import {
  ownAccountEmail,
  SAMPLE_ACCOUNTS,
  SAMPLE_EMAIL_DOMAIN,
  SAMPLE_INVITATIONS,
  SAMPLE_PLANNER,
  SAMPLE_SELLER,
  SAMPLE_WEDDINGS,
  type SampleWedding,
} from './sample-data';
import { SAMPLE_GUESTS_WEDDING, SAMPLE_PARTIES, SAMPLE_TAGS } from './sample-guests';

/** O seed roda em local, test e homologação; nunca em produção (decisão 181). */
export const SEED_ALLOWED_ENVS = ['local', 'test', 'homolog'] as const;
/** Tokens fixos (públicos no código) só onde nada é de verdade. */
const FIXED_TOKEN_ENVS = ['local', 'test'];

export function assertSeedAllowed({ appEnv }: { appEnv: string }): void {
  if (!(SEED_ALLOWED_ENVS as readonly string[]).includes(appEnv)) {
    throw new Error(`db:seed não roda com APP_ENV "${appEnv}" (só local, test e homolog).`);
  }
}

export interface SeededInvitation {
  key: string;
  url: string;
}

type Tx = Prisma.TransactionClient;
const tokens = new OpaqueSessionTokens();

/**
 * Grava os Dados de exemplo do Kore da Fase 0 (decisão 181), idempotente por
 * chaves naturais (e-mail, endereço, código de indicação): rodar de novo deixa
 * o mesmo estado. Uma transação só. Devolve os links dos convites; em
 * homologação os tokens são novos a cada execução (o anterior é substituído).
 */
export async function seedSampleData({
  db,
  appEnv,
  appUrl,
  now,
}: {
  db: PrismaClient;
  appEnv: string;
  appUrl: string;
  now: Date;
}): Promise<SeededInvitation[]> {
  assertSeedAllowed({ appEnv });
  return db.$transaction(
    async (tx) => {
      const users = await upsertAccounts({ tx });
      const referrers = await upsertReferrers({ tx, users, appEnv });
      const weddings = new Map<string, string>();
      for (const wedding of SAMPLE_WEDDINGS) {
        weddings.set(
          wedding.slug,
          await upsertWedding({ tx, wedding, users, plannerReferrerId: referrers.planner, now }),
        );
      }
      const weddingId = weddings.get(SAMPLE_GUESTS_WEDDING);
      if (!weddingId)
        throw new Error(`Casamento de exemplo desconhecido: ${SAMPLE_GUESTS_WEDDING}`);
      await upsertGuests({ tx, weddingId, now });
      return upsertInvitations({ tx, users, weddings, appEnv, appUrl, now });
    },
    { timeout: 60_000 },
  );
}

async function upsertUser({
  tx,
  email,
  name,
  platformRole = 'none',
}: {
  tx: Tx;
  email: string;
  name: string;
  platformRole?: 'none' | 'admin';
}): Promise<string> {
  const user = await tx.user.upsert({
    where: { email },
    create: { email, name, platformRole },
    update: { name, platformRole, status: 'active' },
    select: { id: true },
  });
  return user.id;
}

/** As contas da nota e as contas 'own' dos noivos que já aceitaram. */
async function upsertAccounts({ tx }: { tx: Tx }): Promise<Map<string, string>> {
  const users = new Map<string, string>();
  for (const account of SAMPLE_ACCOUNTS) {
    users.set(account.key, await upsertUser({ tx, ...account }));
  }
  for (const wedding of SAMPLE_WEDDINGS) {
    for (const partner of wedding.partners) {
      if (partner.account !== 'own') continue;
      const email = ownAccountEmail({ name: partner.name, slug: wedding.slug });
      users.set(email, await upsertUser({ tx, email, name: partner.name }));
    }
  }
  return users;
}

/**
 * Os códigos de indicação do seed (juliana-prado, lucas-andrade) nas mãos de
 * OUTRA conta (decisão 181(6)): em local e test, o seed toma o código e a outra
 * conta passa ao próximo sufixo livre, com aviso na saída (no banco de teste, o
 * aceite de um convite de cerimonialista de "Juliana Prado" gera juliana-prado);
 * em homologação, recusa, como a trava do endereço: o link que a pessoa
 * compartilhou não para de funcionar sem aviso.
 */
async function reserveReferralCode({
  tx,
  referralCode,
  userId,
  appEnv,
}: {
  tx: Tx;
  referralCode: string;
  userId: string;
  appEnv: string;
}): Promise<void> {
  const holder = await tx.referrer.findUnique({
    where: { referralCode },
    select: { id: true, userId: true },
  });
  if (!holder || holder.userId === userId) return;
  if (!FIXED_TOKEN_ENVS.includes(appEnv)) {
    throw new Error(
      `O código de indicação ${referralCode} é de uma conta que não é de exemplo; o seed não o toma em ${appEnv}.`,
    );
  }
  for (let n = 2; ; n++) {
    const candidate = `${referralCode}-${n}`;
    if (await tx.referrer.findUnique({ where: { referralCode: candidate }, select: { id: true } }))
      continue;
    await tx.referrer.update({ where: { id: holder.id }, data: { referralCode: candidate } });
    console.warn(`O código ${referralCode} era de outra conta; ela passou a ${candidate}.`);
    return;
  }
}

const accountOf = (users: Map<string, string>, key: string): string => {
  const id = users.get(key);
  if (!id) throw new Error(`Conta de exemplo desconhecida: ${key}`);
  return id;
};

/** Juliana (cerimonialista, Prado Assessoria) e Lucas (vendedor). */
async function upsertReferrers({
  tx,
  users,
  appEnv,
}: {
  tx: Tx;
  users: Map<string, string>;
  appEnv: string;
}): Promise<{ planner: string }> {
  const { defaultRatePercent } = await tx.referralSettings.findFirstOrThrow({
    select: { defaultRatePercent: true },
  });
  const julianaId = accountOf(users, SAMPLE_PLANNER.account);
  await reserveReferralCode({
    tx,
    referralCode: SAMPLE_PLANNER.referralCode,
    userId: julianaId,
    appEnv,
  });
  const planner = await tx.referrer.upsert({
    where: { userId: julianaId },
    create: {
      userId: julianaId,
      kind: 'planner',
      referralCode: SAMPLE_PLANNER.referralCode,
      ratePercent: defaultRatePercent,
    },
    update: { kind: 'planner', referralCode: SAMPLE_PLANNER.referralCode, status: 'active' },
    select: { id: true },
  });
  await tx.planner.upsert({
    where: { referrerId: planner.id },
    create: { referrerId: planner.id, creditName: SAMPLE_PLANNER.creditName },
    update: { creditName: SAMPLE_PLANNER.creditName },
  });
  const organization =
    (await tx.organization.findFirst({
      where: { createdByUserId: julianaId, name: SAMPLE_PLANNER.creditName },
      select: { id: true },
    })) ??
    (await tx.organization.create({
      data: { name: SAMPLE_PLANNER.creditName, createdByUserId: julianaId },
      select: { id: true },
    }));
  const member = await tx.organizationMember.findFirst({
    where: { organizationId: organization.id, userId: julianaId, removedAt: null },
  });
  if (!member) {
    await tx.organizationMember.create({
      data: { organizationId: organization.id, userId: julianaId, role: 'owner' },
    });
  }

  const lucasId = accountOf(users, SAMPLE_SELLER.account);
  await reserveReferralCode({
    tx,
    referralCode: SAMPLE_SELLER.referralCode,
    userId: lucasId,
    appEnv,
  });
  await tx.referrer.upsert({
    where: { userId: lucasId },
    create: {
      userId: lucasId,
      kind: 'seller',
      referralCode: SAMPLE_SELLER.referralCode,
      ratePercent: defaultRatePercent,
      createdByAdminUserId: accountOf(users, SAMPLE_SELLER.createdByAdmin),
    },
    update: { kind: 'seller', referralCode: SAMPLE_SELLER.referralCode, status: 'active' },
  });
  return { planner: planner.id };
}

async function upsertWedding({
  tx,
  wedding,
  users,
  plannerReferrerId,
  now,
}: {
  tx: Tx;
  wedding: SampleWedding;
  users: Map<string, string>;
  plannerReferrerId: string;
  now: Date;
}): Promise<string> {
  const partnerUser = (index: 0 | 1): string | null => {
    const account = wedding.partners[index].account;
    if (!account) return null;
    return account === 'own'
      ? accountOf(
          users,
          ownAccountEmail({ name: wedding.partners[index].name, slug: wedding.slug }),
        )
      : accountOf(users, account);
  };
  const julianaId = accountOf(users, SAMPLE_PLANNER.account);
  const createdByUserId =
    wedding.createdBy === 'planner' ? julianaId : (partnerUser(0) ?? julianaId);
  const fields = {
    status: wedding.status,
    eventDate: new Date(`${wedding.eventDate}T00:00:00Z`),
    city: wedding.city,
    state: wedding.state,
    timezone: timezoneForState({ state: wedding.state }),
    createdByUserId,
    referrerId: wedding.referral ? plannerReferrerId : null,
    referralSource: wedding.referral,
    signupSource:
      wedding.createdBy === 'planner'
        ? ('planner' as const)
        : wedding.referral === 'referral_link'
          ? ('referral_link' as const)
          : ('direct' as const),
    // Atividade agora: nenhum casamento de exemplo entra no expurgo (decisão 181).
    lastActivityAt: now,
    purgeNoticeSentAt: null,
    purgedAt: null,
  };
  // Um endereço de exemplo nas mãos de um casamento de verdade (ex.: alguém que
  // se cadastrou como "ana-e-marcos" em homologação) não é sobrescrito.
  const existing = await tx.wedding.findUnique({
    where: { slug: wedding.slug },
    select: { createdBy: { select: { email: true } } },
  });
  if (existing && !existing.createdBy?.email.endsWith(`@${SAMPLE_EMAIL_DOMAIN}`)) {
    throw new Error(
      `O endereço ${wedding.slug} é de um casamento que não é de exemplo; o seed não o sobrescreve.`,
    );
  }
  const { id: weddingId } = await tx.wedding.upsert({
    where: { slug: wedding.slug },
    create: { slug: wedding.slug, ...fields },
    update: fields,
    select: { id: true },
  });

  for (const index of [0, 1] as const) {
    const partner = wedding.partners[index];
    const data = { displayName: partner.name, title: partner.title, userId: partnerUser(index) };
    await tx.partner.upsert({
      where: { weddingId_slot: { weddingId, slot: index + 1 } },
      create: { weddingId, slot: index + 1, ...data },
      update: data,
    });
  }

  const members: { userId: string; role: 'owner' | 'collaborator' }[] = [
    ...[partnerUser(0), partnerUser(1)]
      .filter((userId): userId is string => userId !== null)
      .map((userId) => ({ userId, role: 'owner' as const })),
    ...(wedding.plannerCollaborates ? [{ userId: julianaId, role: 'collaborator' as const }] : []),
  ];
  for (const member of members) {
    const active = await tx.membership.findFirst({
      where: { weddingId, userId: member.userId, removedAt: null },
    });
    if (!active) await tx.membership.create({ data: { weddingId, ...member } });
  }
  return weddingId;
}

/**
 * Convites de acesso pendentes para o E2E do app (decisão 181). Em local e
 * test, token fixo: se o pendente já tem esse token, fica; em homologação, um
 * token novo a cada execução, que substitui o pendente anterior.
 */
async function upsertInvitations({
  tx,
  users,
  weddings,
  appEnv,
  appUrl,
  now,
}: {
  tx: Tx;
  users: Map<string, string>;
  weddings: Map<string, string>;
  appEnv: string;
  appUrl: string;
  now: Date;
}): Promise<SeededInvitation[]> {
  const fixed = FIXED_TOKEN_ENVS.includes(appEnv);
  const seeded: SeededInvitation[] = [];
  for (const invitation of SAMPLE_INVITATIONS) {
    const weddingId = weddings.get(invitation.weddingSlug);
    if (!weddingId) throw new Error(`Casamento de exemplo desconhecido: ${invitation.weddingSlug}`);
    const token = fixed ? invitation.fixedToken : tokens.generate().token;
    const tokenHash = tokens.hash({ token });
    const pending = await tx.accessInvitation.findFirst({
      where: {
        weddingId,
        email: invitation.email,
        ...(invitation.email === null && { kind: 'couple' }),
        acceptedAt: null,
        declinedAt: null,
        revokedAt: null,
        supersededAt: null,
      },
      select: { id: true, tokenHash: true },
    });
    if (pending?.tokenHash !== tokenHash) {
      if (pending) {
        await tx.accessInvitation.update({
          where: { id: pending.id },
          data: { supersededAt: now },
        });
      }
      // Um convite antigo com o mesmo token fixo (aceito ou recusado) sai do caminho.
      await tx.accessInvitation.deleteMany({ where: { tokenHash } });
      await tx.accessInvitation.create({
        data: {
          weddingId,
          kind: invitation.kind,
          email: invitation.email,
          role: invitation.kind === 'planner' ? 'collaborator' : 'owner',
          tokenHash,
          invitedByUserId:
            invitation.kind === 'planner'
              ? accountOf(users, 'bianca')
              : accountOf(users, SAMPLE_PLANNER.account),
          expiresAt: invitationExpiresAt({ now }),
        },
      });
    } else {
      // O mesmo convite: renova a validade, para o E2E não pegar um vencido.
      await tx.accessInvitation.update({
        where: { id: pending.id },
        data: { expiresAt: invitationExpiresAt({ now }) },
      });
    }
    seeded.push({
      key: invitation.key,
      url: new URL(`${INVITATION_PATH}/${token}`, appUrl).toString(),
    });
  }
  return seeded;
}

/**
 * Tags, grupos e convidados de Ana e Marcos (Fase 1), idempotente pelo nome:
 * um grupo ou uma tag que já existe fica como está. Os números do casamento
 * são recalculados do Guest no fim (Grupos RN16).
 */
async function upsertGuests({
  tx,
  weddingId,
  now,
}: {
  tx: Tx;
  weddingId: string;
  now: Date;
}): Promise<void> {
  const tagIds = new Map<string, string>();
  for (const name of SAMPLE_TAGS) {
    const existing = await tx.tag.findFirst({
      where: { weddingId, name: { equals: name, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    tagIds.set(
      name,
      existing?.id ?? (await tx.tag.create({ data: { weddingId, name }, select: { id: true } })).id,
    );
  }

  for (const [partyIndex, party] of SAMPLE_PARTIES.entries()) {
    const exists = await tx.party.findFirst({
      where: { weddingId, name: party.name, deletedAt: null },
      select: { id: true },
    });
    if (exists) continue;
    // Um instante por grupo e um milissegundo por pessoa: a ordem do grupo é
    // joinedPartyAt e id (RN17).
    const base = now.getTime() + partyIndex * 1000;
    const partyId = uuidV7({ now: base });
    const guests = [
      ...party.guests.map((guest, index) => ({
        id: uuidV7({ now: base + index }),
        name: guest.name,
        ageGroup: guest.ageGroup ?? null,
        phone: guest.phone ?? null,
        rsvpStatus: guest.rsvpStatus ?? 'pending',
        isPlusOne: false,
        contact: guest.contact ?? false,
      })),
      ...Array.from({ length: party.plusOneSlots ?? 0 }, (_, index) => ({
        id: uuidV7({ now: base + party.guests.length + index }),
        name: null,
        ageGroup: null,
        phone: null,
        rsvpStatus: 'pending' as const,
        isPlusOne: true,
        contact: false,
      })),
    ];
    await tx.party.create({
      data: {
        id: partyId,
        weddingId,
        name: party.name,
        linkToken: randomBytes(16).toString('base64url'),
        contactGuestId: guests.find((guest) => guest.contact)?.id ?? null,
        plusOneSlots: party.plusOneSlots ?? 0,
        deliveryStatus: party.deliveryStatus,
        respondedAt: party.respondedAt ? new Date(party.respondedAt) : null,
      },
    });
    await tx.guest.createMany({
      data: guests.map((guest) => ({
        id: guest.id,
        name: guest.name,
        ageGroup: guest.ageGroup,
        phone: guest.phone,
        rsvpStatus: guest.rsvpStatus,
        isPlusOne: guest.isPlusOne,
        weddingId,
        partyId,
        joinedPartyAt: new Date(base),
        respondedAt:
          guest.rsvpStatus !== 'pending' && party.respondedAt ? new Date(party.respondedAt) : null,
      })),
    });
    if (party.tag)
      await tx.partyTag.create({
        data: { weddingId, partyId, tagId: tagIds.get(party.tag) as string },
      });
  }
  await recomputeWeddingStats({ db: tx, weddingId });
}
