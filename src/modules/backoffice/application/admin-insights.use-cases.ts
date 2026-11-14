import { Inject, Injectable } from '@nestjs/common';
import { IpHasher } from '../../logs/infrastructure/ip-hasher';
import { AlertNotFoundError, AlertAlreadyResolvedError } from '../domain/backoffice.errors';
import {
  MONEY_ALERT_TYPES,
  visibleAlertTypes,
  withoutMoney,
  type StaffMember,
  type StaffRole,
} from '../domain/staff';
import type { ApplicationLogWriter } from '../../logs/application/ports/application-log-writer.port';
import { ADMIN_LOG_WRITER } from './admin-weddings.use-cases';
import {
  ADMIN_INSIGHTS_READER,
  type AdminAlertRow,
  type AdminInsightsReader,
  type AdminLogQuery,
  type AdminLogRow,
  type AdminOverview,
  type AdminSearchResult,
} from './ports/admin-insights.reader.port';
import type { Page } from './ports/admin-weddings.reader.port';

/** A Visão geral fica guardada por 5 minutos, por papel (RN04). */
export const OVERVIEW_CACHE_MS = 5 * 60_000;
/** O log da aplicação, sem filtro de período: os últimos 30 dias (RN11). */
export const DEFAULT_LOG_DAYS = 30;

/** O termo da busca vai ao log só em hash (B9-4), nunca em claro. */
export const SEARCH_TERM_HASHER = Symbol('SearchTermHasher');
export interface SearchTermHasher {
  hash(input: { term: string }): string;
}

/** Todos os tipos de alerta do modelo (o enum AlertType). */
export const ALERT_TYPES = [
  ...MONEY_ALERT_TYPES,
  'login_abuse',
  'photo_flood',
  'purge_failed',
  'access_email_changed',
  'access_email_locked',
  'access_email_unlocked',
] as const;

/**
 * Visão geral, busca, log e alertas do Backoffice (Backoffice - acesso RN02,
 * RN03, RN04, RN11 e RN12). O dinheiro sai da resposta do suporte no servidor.
 */
@Injectable()
export class AdminInsights {
  private readonly overviewCache = new Map<StaffRole, { at: number; value: AdminOverview }>();

  constructor(
    @Inject(ADMIN_INSIGHTS_READER) private readonly reader: AdminInsightsReader,
    @Inject(ADMIN_LOG_WRITER) private readonly log: ApplicationLogWriter,
    @Inject(SEARCH_TERM_HASHER) private readonly hasher: SearchTermHasher,
    private readonly ipHasher: IpHasher,
  ) {}

  async overview({ staff, now }: { staff: StaffMember; now: Date }): Promise<AdminOverview> {
    const cached = this.overviewCache.get(staff.role);
    if (cached && now.getTime() - cached.at < OVERVIEW_CACHE_MS) return cached.value;
    const value = await this.reader.overview({ role: staff.role, now });
    this.overviewCache.set(staff.role, { at: now.getTime(), value });
    return value;
  }

  async search({
    staff,
    term,
    ip,
  }: {
    staff: StaffMember;
    term: string;
    ip: string | null;
  }): Promise<AdminSearchResult> {
    const normalized = term.trim().replace(/\s+/g, ' ');
    const result = await this.reader.search({ term: normalized });
    await this.log.record({
      entry: {
        action: 'admin.search',
        actorKind: 'admin',
        actorUserId: staff.userId,
        data: {
          role: staff.role,
          termHash: this.hasher.hash({ term: normalized.toLocaleLowerCase('pt-BR') }),
          weddings: result.weddings.length,
          referrers: result.referrers.length,
        },
        ...(ip ? { ip } : {}),
      },
    });
    return result;
  }

  async logs({
    staff,
    query,
    now,
  }: {
    staff: StaffMember;
    query: Omit<AdminLogQuery, 'from' | 'to'> & { from?: Date; to?: Date };
    now: Date;
  }): Promise<Page<AdminLogRow>> {
    const page = await this.reader.logs({
      ...query,
      from: query.from ?? new Date(now.getTime() - DEFAULT_LOG_DAYS * 86_400_000),
      to: query.to ?? now,
    });
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        data: withoutMoney({ data: item.data, role: staff.role }),
      })),
    };
  }

  alerts({
    staff,
    status,
    page,
  }: {
    staff: StaffMember;
    status: 'open' | 'resolved';
    page: number;
  }): Promise<Page<AdminAlertRow> & { openCount: number }> {
    return this.reader.alerts({
      status,
      types: visibleAlertTypes({ role: staff.role, all: ALERT_TYPES }),
      page,
    });
  }

  /** Resolver (RN12): sem motivo, com quem resolveu; o suporte só os que vê. */
  async resolveAlert({
    staff,
    alertId,
    ip,
    now,
  }: {
    staff: StaffMember;
    alertId: string;
    ip: string | null;
    now: Date;
  }): Promise<void> {
    const result = await this.reader.resolveAlert({
      alertId,
      types: visibleAlertTypes({ role: staff.role, all: ALERT_TYPES }),
      byUserId: staff.userId,
      ipHash: ip ? this.ipHasher.hash({ ip }) : null,
      now,
    });
    if (result === 'not_found') throw new AlertNotFoundError();
    if (result === 'already_resolved') throw new AlertAlreadyResolvedError();
  }
}
