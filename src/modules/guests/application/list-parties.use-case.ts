import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { GuestFieldsInvalidError, type FieldIssue } from '../domain/guests.errors';
import type { DeliveryStatus, RsvpStatus } from '../domain/party';
import { decodePartyCursor, encodePartyCursor } from '../domain/party-cursor';
import { maskPhone } from '../domain/phone';
import {
  PARTY_READER,
  type PartyListRow,
  type PartyReader,
  type PartySummaryRow,
} from './ports/party-reader.port';

export interface PartyListItem extends Omit<PartyListRow, 'sortName' | 'contact'> {
  /** Sem o número inteiro (RN13; decisão 186, item 11). */
  contact: { guestId: string; name: string | null; phoneMasked: string | null } | null;
  /** Quem assinou a resposta: Fase 4. */
  respondedBy: null;
}

export interface PartyList {
  summary: PartySummaryRow;
  total: number;
  data: PartyListItem[];
  nextCursor: string | null;
}

/**
 * Grupos e convidados, a lista (Grupos RN13): o resumo do casamento inteiro,
 * os filtros, a ordem alfabética sem acento e a página por cursor.
 */
@Injectable()
export class ListParties {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(PARTY_READER) private readonly reader: PartyReader,
  ) {}

  async execute({
    userId,
    weddingId,
    q,
    rsvp,
    sent,
    tagId,
    cursor,
    limit = 25,
  }: {
    userId: string;
    weddingId: string;
    q?: string;
    rsvp?: RsvpStatus;
    sent?: DeliveryStatus;
    tagId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<PartyList> {
    await this.authorization.require({ userId, weddingId, action: 'view' });

    const issues: FieldIssue[] = [];
    const after = cursor === undefined ? undefined : decodePartyCursor({ cursor });
    if (after === null) issues.push({ path: 'cursor', code: 'INVALID_CURSOR', params: {} });
    if (tagId !== undefined && !(await this.reader.isActiveTag({ weddingId, tagId })))
      issues.push({ path: 'tag', code: 'TAG_NOT_FOUND', params: {} });
    if (issues.length > 0) throw new GuestFieldsInvalidError({ issues });

    const { rows, total } = await this.reader.list({
      query: {
        weddingId,
        q: q || undefined,
        rsvp,
        sent,
        tagId,
        after: after ?? undefined,
        limit: limit + 1,
      },
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      summary: await this.reader.summary({ weddingId }),
      total,
      data: page.map(({ contact, ...row }) => ({
        id: row.id,
        name: row.name,
        firstGuestName: row.firstGuestName,
        people: row.people,
        counts: row.counts,
        deliveryStatus: row.deliveryStatus,
        respondedAt: row.respondedAt,
        tags: row.tags,
        contact: contact && {
          guestId: contact.guestId,
          name: contact.name,
          phoneMasked: contact.phone ? maskPhone({ e164: contact.phone }) : null,
        },
        respondedBy: null,
      })),
      nextCursor:
        rows.length > limit && last
          ? encodePartyCursor({ name: last.sortName, id: last.id })
          : null,
    };
  }
}
