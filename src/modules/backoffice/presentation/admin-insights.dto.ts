import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  AdminAlertRow,
  AdminLogRow,
  AdminOverview,
  AdminSearchResult,
} from '../application/ports/admin-insights.reader.port';
import type { Page } from '../application/ports/admin-weddings.reader.port';
import { ALERT_TYPES } from '../application/admin-insights.use-cases';
import { AdminWeddingRowResponse } from './admin-weddings.dto';

class MonthPointResponse {
  @ApiProperty({ example: '2026-11' }) month: string;
  value: number;
}

class OverviewChartsResponse {
  @ApiProperty({ type: [MonthPointResponse] }) created: MonthPointResponse[];
  @ApiProperty({ type: [MonthPointResponse] }) published: MonthPointResponse[];
  /** Só para o Admin. */
  @ApiProperty({ type: [MonthPointResponse], required: false }) revenueCents?: MonthPointResponse[];
}

class OverviewRevenueResponse {
  publicationsCents: number;
  extensionsCents: number;
}

class OverviewPayoutsResponse {
  count: number;
  amountCents: number;
}

/** A Visão geral (RN04); o dinheiro só para o Admin (RN02): o suporte não recebe os campos. */
export class AdminOverviewResponse {
  @ApiProperty({ example: '2026-11' }) month: string;
  weddingsCreated: number;
  weddingsPublished: number;
  @ApiProperty({ type: Number, nullable: true }) activationPercent: number | null;
  plannersActive: number;
  plannersNew: number;
  @ApiProperty({ type: Number, nullable: true }) rsvpAveragePercent: number | null;
  openAlerts: number;
  @ApiProperty({ type: OverviewChartsResponse }) charts: OverviewChartsResponse;
  @ApiProperty({ type: OverviewRevenueResponse, required: false })
  revenue?: OverviewRevenueResponse;
  @ApiProperty({ type: OverviewPayoutsResponse, required: false })
  payoutsRequested?: OverviewPayoutsResponse;

  static from({ overview }: { overview: AdminOverview }): AdminOverviewResponse {
    return { ...overview };
  }
}

export class AdminSearchQuery {
  /** Casal, slug, e-mail, cerimonialista ou código de indicação. */
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;
}

class AdminSearchReferrerResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['planner', 'seller'] }) kind: 'planner' | 'seller';
  name: string;
  referralCode: string;
  @ApiProperty({ enum: ['active', 'blocked', 'inactive'] }) status: string;
}

export class AdminSearchResponse {
  @ApiProperty({ type: [AdminWeddingRowResponse] }) weddings: AdminWeddingRowResponse[];
  @ApiProperty({ type: [AdminSearchReferrerResponse] }) referrers: AdminSearchReferrerResponse[];

  static from({ result }: { result: AdminSearchResult }): AdminSearchResponse {
    return { weddings: result.weddings, referrers: result.referrers };
  }
}

class PageQuery {
  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;
}

/** O Log da aplicação (RN11): sem período, os últimos 30 dias. */
export class AdminLogsQuery extends PageQuery {
  @ApiProperty({ required: false, example: 'wedding.blocked' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() userId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() weddingId?: string;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

class AdminLogRowResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  action: string;
  @ApiProperty({ enum: ['user', 'party', 'admin', 'system'] }) actorKind: string;
  @ApiProperty({ type: String, nullable: true }) actorUserId: string | null;
  @ApiProperty({ type: String, nullable: true }) weddingId: string | null;
  @ApiProperty({ type: String, nullable: true }) supportSessionId: string | null;
  @ApiProperty({ type: String, nullable: true }) entityType: string | null;
  @ApiProperty({ type: String, nullable: true }) entityId: string | null;
  /** Para o suporte, sem os valores em centavos (RN02). */
  @ApiProperty({ type: Object, nullable: true }) data: unknown;
  /** O hash do IP, curto; nunca o IP. */
  @ApiProperty({ type: String, nullable: true }) ipHashShort: string | null;
}

export class AdminLogsResponse {
  @ApiProperty({ type: [AdminLogRowResponse] }) items: AdminLogRowResponse[];
  page: number;
  pageSize: number;
  total: number;

  static from({ page }: { page: Page<AdminLogRow> }): AdminLogsResponse {
    return {
      ...page,
      items: page.items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    };
  }
}

export class AdminAlertsQuery extends PageQuery {
  @ApiProperty({ enum: ['open', 'resolved'], required: false, default: 'open' })
  @IsOptional()
  @IsIn(['open', 'resolved'])
  status?: 'open' | 'resolved';
}

class AdminAlertUserResponse {
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
}

class AdminAlertResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ALERT_TYPES }) type: string;
  @ApiProperty({ enum: ['open', 'resolved'] }) status: 'open' | 'resolved';
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, nullable: true }) weddingId: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Ana & Marcos' }) coupleNames:
    string | null;
  @ApiProperty({ type: String, nullable: true }) userId: string | null;
  /** A pessoa do alerta de usuário. */
  @ApiProperty({ type: AdminAlertUserResponse, nullable: true })
  user: AdminAlertUserResponse | null;
  entityType: string;
  entityId: string;
  /** O detalhe do tipo; o app monta o texto (RN12). */
  @ApiProperty({ type: Object, nullable: true }) data: unknown;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) resolvedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) resolvedByName: string | null;
}

/** Os alertas do papel (RN12): os de dinheiro só para o Admin. `openCount` é o contador da Topbar. */
export class AdminAlertsResponse {
  @ApiProperty({ type: [AdminAlertResponse] }) items: AdminAlertResponse[];
  page: number;
  pageSize: number;
  total: number;
  openCount: number;

  static from({
    page,
  }: {
    page: Page<AdminAlertRow> & { openCount: number };
  }): AdminAlertsResponse {
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        resolvedAt: item.resolvedAt?.toISOString() ?? null,
      })),
    };
  }
}

export class AdminAlertResolvedResponse {
  @ApiProperty({ enum: ['resolved'] }) status: 'resolved';
}
