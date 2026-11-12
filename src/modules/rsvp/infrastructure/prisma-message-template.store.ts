import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { MessageKind } from '../domain/message-templates';
import type {
  MessageTemplateStore,
  MessageWedding,
  StoredMessageTemplate,
} from '../application/ports/message-template-store.port';

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaMessageTemplateStore implements MessageTemplateStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async wedding({ weddingId }: { weddingId: string }): Promise<MessageWedding | null> {
    const wedding = await this.tenant.client().wedding.findFirst({
      where: { id: weddingId },
      select: {
        city: true,
        rsvpDeadline: true,
        partners: { orderBy: { slot: 'asc' }, select: { displayName: true } },
      },
    });
    if (!wedding) return null;
    return {
      city: wedding.city ?? '',
      partners: wedding.partners.map((partner) => partner.displayName),
      rsvpDeadline: wedding.rsvpDeadline?.toISOString().slice(0, 10) ?? null,
    };
  }

  list({ weddingId }: { weddingId: string }): Promise<StoredMessageTemplate[]> {
    return this.tenant.client().messageTemplate.findMany({
      where: { weddingId },
      select: { kind: true, subject: true, body: true },
    });
  }

  async save({
    weddingId,
    kind,
    subject,
    body,
    userId,
  }: {
    weddingId: string;
    kind: MessageKind;
    subject: string | null;
    body: string;
    userId: string;
  }): Promise<void> {
    // Sem RETURNING de linha alheia: o upsert do Prisma faz SELECT, INSERT ou UPDATE.
    await this.tenant.client().messageTemplate.upsert({
      where: { weddingId_kind: { weddingId, kind } },
      create: { weddingId, kind, subject, body, updatedByUserId: userId },
      update: { subject, body, updatedByUserId: userId },
      select: { id: true },
    });
  }

  async remove({ weddingId, kind }: { weddingId: string; kind: MessageKind }): Promise<void> {
    await this.tenant.client().messageTemplate.deleteMany({ where: { weddingId, kind } });
  }
}
