import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import type { DeliveryStatus } from '../../guests/domain/party';
import type { DeliveryChannel } from '../domain/deliveries';
import type { MessageKind } from '../domain/message-templates';
import type {
  DeliveryPartyRow,
  DeliveryStore,
  DeliveryWedding,
} from '../application/ports/delivery-store.port';

const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null);

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaDeliveryStore implements DeliveryStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async wedding({ weddingId }: { weddingId: string }): Promise<DeliveryWedding | null> {
    const wedding = await this.tenant.client().wedding.findFirst({
      where: { id: weddingId },
      select: { status: true, timezone: true, eventDate: true, rsvpDeadline: true, slug: true },
    });
    if (!wedding) return null;
    return {
      ...wedding,
      eventDate: day(wedding.eventDate),
      rsvpDeadline: day(wedding.rsvpDeadline),
    };
  }

  async parties({
    weddingId,
    partyIds,
    lock,
  }: {
    weddingId: string;
    partyIds: readonly string[];
    lock: boolean;
  }): Promise<DeliveryPartyRow[]> {
    if (partyIds.length === 0) return [];
    const tx = this.tenant.client();
    const ids = Prisma.join([...new Set(partyIds)].sort().map((id) => Prisma.sql`${id}::uuid`));
    if (lock)
      await tx.$queryRaw`
        SELECT id FROM parties WHERE wedding_id = ${weddingId}::uuid AND id IN (${ids})
        ORDER BY id FOR UPDATE`;
    const rows = await tx.$queryRaw<
      {
        id: string;
        name: string;
        link_token: string;
        delivery_status: DeliveryStatus;
        sent_at: Date | null;
        last_channel: DeliveryChannel | null;
        save_the_date_sent_at: Date | null;
        last_reminder_at: Date | null;
        contact_id: string | null;
        contact_name: string | null;
        contact_phone: string | null;
        contact_email: string | null;
        remindable: boolean;
      }[]
    >`
      SELECT p.id, p.name, p.link_token, p.delivery_status, p.sent_at, p.last_channel,
             p.save_the_date_sent_at, p.last_reminder_at,
             c.id AS contact_id, c.name AS contact_name, c.phone AS contact_phone,
             c.email::text AS contact_email,
             (p.delivery_status <> 'not_sent' AND EXISTS (
               SELECT 1 FROM guests g WHERE g.party_id = p.id AND g.deleted_at IS NULL
                 AND g.name IS NOT NULL AND g.rsvp_status = 'pending')) AS remindable
      FROM parties p
      LEFT JOIN guests c ON c.id = p.contact_guest_id AND c.deleted_at IS NULL
      WHERE p.wedding_id = ${weddingId}::uuid AND p.deleted_at IS NULL AND p.id IN (${ids})
      ORDER BY lower(f_unaccent(p.name)), p.id`;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      linkToken: row.link_token,
      deliveryStatus: row.delivery_status,
      sentAt: row.sent_at,
      lastChannel: row.last_channel,
      saveTheDateSentAt: row.save_the_date_sent_at,
      lastReminderAt: row.last_reminder_at,
      contact: row.contact_id
        ? {
            guestId: row.contact_id,
            name: row.contact_name,
            phone: row.contact_phone,
            email: row.contact_email,
          }
        : null,
      remindable: row.remindable,
    }));
  }

  countActiveParties({ weddingId }: { weddingId: string }): Promise<number> {
    return this.tenant.client().party.count({ where: { weddingId, deletedAt: null } });
  }

  async mark({
    weddingId,
    partyIds,
    kind,
    channel,
    userId,
    now,
  }: {
    weddingId: string;
    partyIds: readonly string[];
    kind: MessageKind;
    channel: DeliveryChannel;
    userId: string;
    now: Date;
  }): Promise<void> {
    const tx = this.tenant.client();
    const ids = Prisma.join(partyIds.map((id) => Prisma.sql`${id}::uuid`));
    if (kind === 'invite')
      // O sentAt guarda o 1º envio e não muda; viewed e responded não voltam a sent.
      await tx.$executeRaw`
        UPDATE parties
        SET sent_at = coalesce(sent_at, ${now}), last_channel = ${channel}::delivery_channel,
            delivery_status = CASE WHEN delivery_status = 'not_sent'
                                   THEN 'sent'::party_delivery_status ELSE delivery_status END,
            updated_at = ${now}
        WHERE wedding_id = ${weddingId}::uuid AND id IN (${ids})`;
    else if (kind === 'save_the_date')
      await tx.$executeRaw`
        UPDATE parties SET save_the_date_sent_at = ${now}, updated_at = ${now}
        WHERE wedding_id = ${weddingId}::uuid AND id IN (${ids})`;
    else
      await tx.$executeRaw`
        UPDATE parties SET last_reminder_at = ${now}, updated_at = ${now}
        WHERE wedding_id = ${weddingId}::uuid AND id IN (${ids})`;
    await tx.partyDelivery.createMany({
      data: partyIds.map((partyId, index) => ({
        id: uuidV7({ now: now.getTime() + index }),
        createdAt: now,
        weddingId,
        partyId,
        kind,
        channel,
        userId,
      })),
    });
  }
}
