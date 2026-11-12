import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  PartyHistoryEntry,
  PartyDetailsRow,
  PartyListQuery,
  PartyListRow,
  PartyReader,
  PartySummaryRow,
  TagSummary,
} from '../application/ports/party-reader.port';
import type { DeliveryStatus, RsvpStatus } from '../domain/party';

/** O histórico do Painel devolve as 50 linhas mais recentes (Prazo RN05; R3-5). */
const HISTORY_LIMIT = 50;

/** Ordem do grupo (RN17): com nome por joinedPartyAt e id; vagas no fim. */
const GROUP_ORDER = [
  { isPlusOne: 'asc' },
  { joinedPartyAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.GuestOrderByWithRelationInput[];

const ACTIVE_TAG = { tag: { deletedAt: null } } as const;
const TAG_SELECT = { tag: { select: { id: true, name: true, color: true } } } as const;

/** Escapa %, _ e \ para o LIKE do "contém". */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Leituras na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaPartyReader implements PartyReader {
  constructor(private readonly tenant: TenantTransaction) {}

  async findActive({
    weddingId,
    partyId,
  }: {
    weddingId: string;
    partyId: string;
  }): Promise<PartyDetailsRow | null> {
    const party = await this.tenant.client().party.findFirst({
      where: { id: partyId, weddingId, deletedAt: null },
      select: {
        id: true,
        name: true,
        version: true,
        firstViewedAt: true,
        contactGuestId: true,
        plusOneSlots: true,
        internalNote: true,
        linkToken: true,
        linkRegeneratedAt: true,
        deliveryStatus: true,
        wedding: { select: { slug: true } },
        tags: { where: ACTIVE_TAG, select: TAG_SELECT, orderBy: { createdAt: 'asc' } },
        guests: {
          where: { deletedAt: null },
          orderBy: GROUP_ORDER,
          select: {
            id: true,
            name: true,
            ageGroup: true,
            dietaryRestriction: true,
            phone: true,
            email: true,
            isPlusOne: true,
            rsvpStatus: true,
            tags: { where: ACTIVE_TAG, select: TAG_SELECT, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    if (!party) return null;
    const { wedding, tags, guests, firstViewedAt, ...rest } = party;
    return {
      ...rest,
      history: await this.history({ partyId, firstViewedAt }),
      weddingSlug: wedding.slug,
      tags: tags.map(({ tag }) => tag),
      guests: guests.map(({ tags: guestTags, ...guest }) => ({
        ...guest,
        tags: guestTags.map(({ tag }) => tag),
      })),
    };
  }

  /** As 50 linhas mais recentes do histórico (Prazo RN05; R3-5). */
  private async history({
    partyId,
    firstViewedAt,
  }: {
    partyId: string;
    firstViewedAt: Date | null;
  }): Promise<PartyHistoryEntry[]> {
    const tx = this.tenant.client();
    const [deliveries, submissions] = await Promise.all([
      tx.partyDelivery.findMany({
        where: { partyId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_LIMIT,
        select: { kind: true, channel: true, createdAt: true },
      }),
      tx.$queryRaw<
        {
          created_at: Date;
          actor: 'party' | 'couple';
          signed_by: string | null;
          actor_name: string | null;
          confirmed_count: number;
          declined_count: number;
          guest_name: string | null;
          guest_status: RsvpStatus | null;
        }[]
      >`
        SELECT s.created_at, s.actor, sg.name AS signed_by, u.name AS actor_name,
               s.confirmed_count, s.declined_count,
               cg.name AS guest_name, gr.status AS guest_status
        FROM rsvp_submissions s
        LEFT JOIN guests sg ON sg.id = s.signed_by_guest_id
        LEFT JOIN users u ON u.id = s.actor_user_id
        LEFT JOIN LATERAL (
          SELECT r.guest_id, r.status FROM guest_responses r
          WHERE r.submission_id = s.id AND s.actor = 'couple'
          ORDER BY r.created_at LIMIT 1
        ) gr ON true
        LEFT JOIN guests cg ON cg.id = gr.guest_id
        WHERE s.party_id = ${partyId}::uuid
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT ${HISTORY_LIMIT}`,
    ]);
    const entries: PartyHistoryEntry[] = [
      ...deliveries.map(({ kind, channel, createdAt }) => ({
        kind: kind === 'invite' ? ('sent' as const) : kind,
        at: createdAt,
        channel,
      })),
      ...(firstViewedAt ? [{ kind: 'viewed' as const, at: firstViewedAt }] : []),
      ...submissions.map((row) => ({
        kind: 'response' as const,
        at: row.created_at,
        actor: row.actor,
        signedBy: row.signed_by,
        actorName: row.actor === 'couple' ? row.actor_name : null,
        confirmed: row.confirmed_count,
        declined: row.declined_count,
        guest:
          row.actor === 'couple' && row.guest_status
            ? { name: row.guest_name, status: row.guest_status }
            : null,
      })),
    ];
    return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, HISTORY_LIMIT);
  }

  async weddingSlug({ weddingId }: { weddingId: string }): Promise<string | null> {
    const wedding = await this.tenant.client().wedding.findFirst({
      where: { id: weddingId },
      select: { slug: true },
    });
    return wedding?.slug ?? null;
  }

  async isActiveTag({ weddingId, tagId }: { weddingId: string; tagId: string }): Promise<boolean> {
    const tag = await this.tenant.client().tag.findFirst({
      where: { id: tagId, weddingId, deletedAt: null },
      select: { id: true },
    });
    return tag !== null;
  }

  async list({
    query,
  }: {
    query: PartyListQuery;
  }): Promise<{ rows: PartyListRow[]; total: number }> {
    const tx = this.tenant.client();
    const filters: Prisma.Sql[] = [
      Prisma.sql`p.wedding_id = ${query.weddingId}::uuid`,
      Prisma.sql`p.deleted_at IS NULL`,
    ];
    if (query.q) {
      // Busca e ordem sem acento (RN13; decisão 186, item 2): no nome do grupo
      // ou de qualquer convidado ativo dele.
      const pattern = Prisma.sql`lower(f_unaccent(${likePattern(query.q)}))`;
      filters.push(Prisma.sql`(
        lower(f_unaccent(p.name)) LIKE ${pattern} ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM guests g WHERE g.party_id = p.id AND g.deleted_at IS NULL
                   AND lower(f_unaccent(g.name)) LIKE ${pattern} ESCAPE '\\'))`);
    }
    if (query.rsvp)
      filters.push(Prisma.sql`EXISTS (SELECT 1 FROM guests g WHERE g.party_id = p.id
        AND g.deleted_at IS NULL AND g.rsvp_status = ${query.rsvp}::rsvp_status)`);
    if (query.sent)
      filters.push(Prisma.sql`p.delivery_status = ${query.sent}::party_delivery_status`);
    if (query.remind)
      filters.push(Prisma.sql`p.delivery_status <> 'not_sent' AND EXISTS (
        SELECT 1 FROM guests g WHERE g.party_id = p.id AND g.deleted_at IS NULL
          AND g.name IS NOT NULL AND g.rsvp_status = 'pending')`);
    if (query.tagId)
      // O grupo ou algum convidado ativo dele tem a tag (RN13; Tags RN09).
      filters.push(Prisma.sql`(
        EXISTS (SELECT 1 FROM party_tags pt WHERE pt.party_id = p.id AND pt.tag_id = ${query.tagId}::uuid)
        OR EXISTS (SELECT 1 FROM guest_tags gt JOIN guests g ON g.id = gt.guest_id
                   WHERE g.party_id = p.id AND g.deleted_at IS NULL
                     AND gt.tag_id = ${query.tagId}::uuid))`);
    const where = Prisma.join(filters, ' AND ');
    const after = query.after
      ? Prisma.sql`AND (lower(f_unaccent(p.name)), p.id) > (${query.after.name}, ${query.after.id}::uuid)`
      : Prisma.empty;

    const [{ total }] = await tx.$queryRaw<[{ total: number }]>`
      SELECT count(*)::int AS total FROM parties p WHERE ${where}`;
    const page = await tx.$queryRaw<
      {
        id: string;
        name: string;
        sort_name: string;
        contact_guest_id: string | null;
        delivery_status: DeliveryStatus;
        responded_at: Date | null;
        last_response_actor: 'party' | 'couple' | null;
        signed_by_name: string | null;
        actor_name: string | null;
      }[]
    >`
      SELECT p.id, p.name, lower(f_unaccent(p.name)) AS sort_name, p.contact_guest_id,
             p.delivery_status, p.responded_at, p.last_response_actor,
             (SELECT sg.name FROM guests sg WHERE sg.id = p.last_signed_by_guest_id) AS signed_by_name,
             (SELECT u.name FROM users u WHERE u.id = p.last_response_user_id) AS actor_name
      FROM parties p
      WHERE ${where} ${after}
      ORDER BY lower(f_unaccent(p.name)), p.id
      LIMIT ${query.limit}`;
    if (page.length === 0) return { rows: [], total };

    const partyIds = page.map((party) => party.id);
    const [guests, partyTags] = await Promise.all([
      tx.guest.findMany({
        where: { partyId: { in: partyIds }, deletedAt: null },
        orderBy: GROUP_ORDER,
        select: {
          id: true,
          partyId: true,
          name: true,
          phone: true,
          isPlusOne: true,
          rsvpStatus: true,
        },
      }),
      tx.partyTag.findMany({
        where: { partyId: { in: partyIds }, ...ACTIVE_TAG },
        orderBy: { createdAt: 'asc' },
        select: { partyId: true, ...TAG_SELECT },
      }),
    ]);

    return {
      total,
      rows: page.map((party) => {
        const members = guests.filter((guest) => guest.partyId === party.id);
        const contact = members.find((guest) => guest.id === party.contact_guest_id);
        const count = (status: string) => members.filter((g) => g.rsvpStatus === status).length;
        const tags: TagSummary[] = partyTags
          .filter((link) => link.partyId === party.id)
          .map(({ tag }) => tag);
        return {
          id: party.id,
          name: party.name,
          sortName: party.sort_name,
          contact: contact
            ? { guestId: contact.id, name: contact.name, phone: contact.phone }
            : null,
          firstGuestName: members.find((guest) => guest.name !== null)?.name ?? null,
          people: members.length,
          counts: {
            confirmed: count('confirmed'),
            declined: count('declined'),
            pending: count('pending'),
            // Vaga vazia ainda sem resposta: o "1 vaga pendente" (RN07 e RN13).
            pendingPlusOnes: members.filter(
              (g) => g.isPlusOne && g.name === null && g.rsvpStatus === 'pending',
            ).length,
          },
          deliveryStatus: party.delivery_status,
          respondedAt: party.responded_at,
          lastResponse:
            party.responded_at && party.last_response_actor
              ? {
                  actor: party.last_response_actor,
                  signedByName: party.signed_by_name,
                  actorName: party.actor_name,
                }
              : null,
          tags,
        };
      }),
    };
  }

  async summary({ weddingId }: { weddingId: string }): Promise<PartySummaryRow> {
    // Calculado na hora do Guest, como o dashboard do casal (Modelo de Dados,
    // WeddingStats: só para listas de muitos casamentos).
    const [row] = await this.tenant.client().$queryRaw<[PartySummaryRow]>`
      SELECT
        (SELECT count(*)::int FROM guests g WHERE g.wedding_id = ${weddingId}::uuid AND g.deleted_at IS NULL) AS guests,
        (SELECT count(*)::int FROM guests g WHERE g.wedding_id = ${weddingId}::uuid AND g.deleted_at IS NULL
           AND g.name IS NOT NULL) AS "namedGuests",
        (SELECT count(*)::int FROM parties p WHERE p.wedding_id = ${weddingId}::uuid AND p.deleted_at IS NULL) AS parties,
        (SELECT count(*)::int FROM guests g WHERE g.wedding_id = ${weddingId}::uuid AND g.deleted_at IS NULL
           AND g.rsvp_status = 'confirmed') AS confirmed,
        (SELECT count(*)::int FROM guests g WHERE g.wedding_id = ${weddingId}::uuid AND g.deleted_at IS NULL
           AND g.rsvp_status = 'declined') AS declined,
        (SELECT count(*)::int FROM guests g WHERE g.wedding_id = ${weddingId}::uuid AND g.deleted_at IS NULL
           AND g.rsvp_status = 'pending') AS pending`;
    return row;
  }
}
