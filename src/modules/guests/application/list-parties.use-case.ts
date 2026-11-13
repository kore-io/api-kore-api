import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { GuestFieldsInvalidError, type FieldIssue } from '../domain/guests.errors';
import type { DeliveryStatus, RsvpStatus } from '../domain/party';
import {
  decodePartyCursor,
  decodeRespondedCursor,
  encodePartyCursor,
  encodeRespondedCursor,
} from '../domain/party-cursor';
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
  /** Mantido por compatibilidade: o nome de lastResponse (quem assinou ou quem alterou). */
  respondedBy: string | null;
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
    remind,
    saveTheDate,
    order = 'name',
    cursor,
    limit = 25,
  }: {
    userId: string;
    weddingId: string;
    q?: string;
    rsvp?: RsvpStatus;
    sent?: DeliveryStatus;
    tagId?: string;
    remind?: boolean;
    saveTheDate?: 'sent' | 'not_sent';
    /** Alfabética (o padrão) ou por "Respondido em" (Central RN05; decisão 246). */
    order?: 'name' | 'respondedAt';
    cursor?: string;
    limit?: number;
  }): Promise<PartyList> {
    await this.authorization.require({ userId, weddingId, action: 'view' });

    const issues: FieldIssue[] = [];
    const byResponse = order === 'respondedAt';
    const after = cursor === undefined || byResponse ? undefined : decodePartyCursor({ cursor });
    const afterResponded =
      cursor === undefined || !byResponse ? undefined : decodeRespondedCursor({ cursor });
    if (after === null || afterResponded === null)
      issues.push({ path: 'cursor', code: 'INVALID_CURSOR', params: {} });
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
        remind,
        saveTheDate,
        order,
        after: after ?? undefined,
        afterResponded: afterResponded ?? undefined,
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
        lastResponse: row.lastResponse,
        tags: row.tags,
        contact: contact && {
          guestId: contact.guestId,
          name: contact.name,
          phoneMasked: contact.phone ? maskPhone({ e164: contact.phone }) : null,
        },
        respondedBy: row.lastResponse?.signedByName ?? row.lastResponse?.actorName ?? null,
      })),
      nextCursor:
        rows.length > limit && last
          ? byResponse
            ? encodeRespondedCursor({ respondedAt: last.respondedAt, id: last.id })
            : encodePartyCursor({ name: last.sortName, id: last.id })
          : null,
    };
  }
}
