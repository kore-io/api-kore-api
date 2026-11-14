import { Inject, Injectable } from '@nestjs/common';
import { BlockWedding } from '../../billing/application/block-wedding.use-case';
import { IpHasher } from '../../logs/infrastructure/ip-hasher';
import type { ApplicationLogWriter } from '../../logs/application/ports/application-log-writer.port';
import {
  AlreadyBlockedError,
  NotBlockedError,
  AdminWeddingNotFoundError,
} from '../domain/backoffice.errors';
import { withoutMoney, type StaffMember } from '../domain/staff';
import {
  ADMIN_WEDDINGS_READER,
  type AdminWeddingGeneral,
  type AdminWeddingGuest,
  type AdminWeddingListQuery,
  type AdminWeddingLogEntry,
  type AdminWeddingNumbers,
  type AdminWeddingRow,
  type AdminWeddingsReader,
  type AdminWeddingTombstone,
  type Page,
} from './ports/admin-weddings.reader.port';

/** O log do staff pela conexão do backoffice (as rotas /v1/admin não têm casamento na transação). */
export const ADMIN_LOG_WRITER = Symbol('AdminLogWriter');

export type AdminWeddingTab = 'general' | 'numbers' | 'guests' | 'log';
export const ADMIN_WEDDING_TABS: readonly AdminWeddingTab[] = [
  'general',
  'numbers',
  'guests',
  'log',
];

export type AdminWeddingDetail =
  | { tab: 'general'; general: AdminWeddingGeneral | AdminWeddingTombstone }
  | { tab: 'numbers'; numbers: AdminWeddingNumbers }
  | { tab: 'guests'; guests: Page<AdminWeddingGuest> }
  | { tab: 'log'; log: Page<AdminWeddingLogEntry> };

/** Casamentos do Backoffice (Backoffice - acesso RN05 e RN06). */
@Injectable()
export class AdminWeddings {
  constructor(
    @Inject(ADMIN_WEDDINGS_READER) private readonly reader: AdminWeddingsReader,
    @Inject(ADMIN_LOG_WRITER) private readonly log: ApplicationLogWriter,
    private readonly blocks: BlockWedding,
    private readonly ipHasher: IpHasher,
  ) {}

  list({ query }: { query: AdminWeddingListQuery }): Promise<Page<AdminWeddingRow>> {
    return this.reader.list(query);
  }

  /**
   * O detalhe por aba. As leituras do staff vão ao log (B9-4), uma linha por
   * requisição: a Convidados grava `admin.guests_listed`; as outras abas,
   * `admin.wedding_viewed` com a aba. A Cobrança fica no Backoffice de cobrança (PR 12).
   */
  async detail({
    staff,
    weddingId,
    tab,
    page,
    ip,
  }: {
    staff: StaffMember;
    weddingId: string;
    tab: AdminWeddingTab;
    page: number;
    ip: string | null;
  }): Promise<AdminWeddingDetail> {
    switch (tab) {
      case 'general': {
        const general = await this.reader.general({ weddingId, role: staff.role });
        if (!general) throw new AdminWeddingNotFoundError();
        await this.record({ staff, weddingId, action: 'admin.wedding_viewed', ip, data: { tab } });
        return { tab, general };
      }
      case 'numbers': {
        const numbers = await this.reader.numbers({ weddingId });
        if (!numbers) throw new AdminWeddingNotFoundError();
        await this.record({ staff, weddingId, action: 'admin.wedding_viewed', ip, data: { tab } });
        return { tab, numbers };
      }
      case 'guests': {
        const guests = await this.reader.guests({ weddingId, page });
        if (!guests) throw new AdminWeddingNotFoundError();
        await this.record({ staff, weddingId, action: 'admin.guests_listed', ip, data: { page } });
        return { tab, guests };
      }
      case 'log': {
        const log = await this.reader.log({ weddingId, page });
        if (!log) throw new AdminWeddingNotFoundError();
        await this.record({
          staff,
          weddingId,
          action: 'admin.wedding_viewed',
          ip,
          data: { tab, page },
        });
        if (staff.role === 'support')
          log.items = log.items.map((item) => ({
            ...item,
            data: withoutMoney({ data: item.data, role: staff.role }),
          }));
        return { tab, log };
      }
    }
  }

  /** Bloquear (RN05; Casamento bloqueado RN01): Admin e suporte, com o motivo no log. */
  async block({
    staff,
    weddingId,
    reason,
    ip,
    now,
  }: {
    staff: StaffMember;
    weddingId: string;
    reason: string;
    ip: string | null;
    now: Date;
  }): Promise<void> {
    const result = await this.blocks.block({
      weddingId,
      byUserId: staff.userId,
      reason,
      ipHash: ip ? this.ipHasher.hash({ ip }) : null,
      now,
    });
    if (result === 'not_found') throw new AdminWeddingNotFoundError();
    if (result === 'already_blocked') throw new AlreadyBlockedError();
  }

  async unblock({
    staff,
    weddingId,
    reason,
    ip,
    now,
  }: {
    staff: StaffMember;
    weddingId: string;
    reason: string;
    ip: string | null;
    now: Date;
  }): Promise<void> {
    const result = await this.blocks.unblock({
      weddingId,
      byUserId: staff.userId,
      reason,
      ipHash: ip ? this.ipHasher.hash({ ip }) : null,
      now,
    });
    if (result === 'not_found') throw new AdminWeddingNotFoundError();
    if (result === 'not_blocked') throw new NotBlockedError();
  }

  private record({
    staff,
    weddingId,
    action,
    ip,
    data,
  }: {
    staff: StaffMember;
    weddingId: string;
    action: string;
    ip: string | null;
    data?: Record<string, unknown>;
  }): Promise<void> {
    return this.log.record({
      entry: {
        action,
        actorKind: 'admin',
        actorUserId: staff.userId,
        weddingId,
        entityType: 'wedding',
        entityId: weddingId,
        data: { role: staff.role, ...data },
        ...(ip ? { ip } : {}),
      },
    });
  }
}
