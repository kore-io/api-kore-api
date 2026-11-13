import { randomUUID } from 'node:crypto';
import type { BackofficePrismaService } from '../../../../../shared/database/backoffice-prisma.service';
import type {
  GatewayChargeStatus,
  GatewayTransferStatus,
} from '../../../application/ports/payment-gateway.port';

/** O esquema do adaptador local (Publicar e pagar RN14; decisão 231, rec. 18; B2-14). */
export const LOCAL_GATEWAY_SCHEMA = 'local_gateway';

/** Taxa fixa de teste do gateway local, em centavos (RN12). */
export const LOCAL_GATEWAY_FEE_CENTS = 199;

export interface LocalChargeRow {
  id: string;
  external_reference: string;
  customer_id: string;
  method: 'pix' | 'card';
  amount_cents: number;
  installments: number;
  status: GatewayChargeStatus;
  charged_cents: number | null;
  fee_cents: number | null;
  net_cents: number | null;
  pix_copy_paste: string | null;
  due_at: Date | null;
  card_last4: string | null;
  failure_reason: string | null;
  created_at: Date;
}

export interface LocalTransferRow {
  id: string;
  external_reference: string;
  amount_cents: number;
  status: GatewayTransferStatus;
  failure_reason: string | null;
}

// As tabelas do gateway falso. Sem CPF: do pagador, só os 4 últimos dígitos.
const DDL = `
CREATE TABLE IF NOT EXISTS ${LOCAL_GATEWAY_SCHEMA}.customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  tax_id_last4 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ${LOCAL_GATEWAY_SCHEMA}.charges (
  id text PRIMARY KEY,
  external_reference text NOT NULL UNIQUE,
  customer_id text NOT NULL,
  method text NOT NULL,
  amount_cents integer NOT NULL,
  installments integer NOT NULL,
  status text NOT NULL,
  charged_cents integer,
  fee_cents integer,
  net_cents integer,
  pix_copy_paste text,
  due_at timestamptz,
  card_last4 text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ${LOCAL_GATEWAY_SCHEMA}.transfers (
  id text PRIMARY KEY,
  external_reference text NOT NULL UNIQUE,
  amount_cents integer NOT NULL,
  status text NOT NULL,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ${LOCAL_GATEWAY_SCHEMA}.controls (
  name text PRIMARY KEY,
  value integer NOT NULL
)`;

function failureControl(scope?: string): string {
  return scope ? `fail_next_calls:${scope}` : 'fail_next_calls';
}

/**
 * O estado do gateway local no Postgres, e não em memória: a API cria a
 * cobrança e o worker a consulta, em processos diferentes (B2-14). O esquema é
 * criado pelo `db:users` (só local e test), e as tabelas, por este adaptador,
 * pela conexão do backoffice.
 */
export class LocalGatewayStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly db: BackofficePrismaService) {}

  /** Cria as tabelas uma vez por processo; a trava evita a corrida entre a API e o worker. */
  ensureTables(): Promise<void> {
    this.ready ??= this.db
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('${LOCAL_GATEWAY_SCHEMA}'))`,
        );
        for (const statement of DDL.split(';')) await tx.$executeRawUnsafe(statement);
      })
      .catch((error: unknown) => {
        this.ready = null;
        throw error;
      });
    return this.ready;
  }

  /**
   * "O gateway não responde nas próximas N chamadas" (RN15; B2-15). Sem
   * escopo, vale para qualquer chamada (a rota dev e o Bruno); com escopo, só
   * para as chamadas daquele cliente (pelo nome), referência ou cobrança.
   */
  async failNextCalls({ count, scope }: { count: number; scope?: string }): Promise<void> {
    await this.ensureTables();
    await this.db.$executeRawUnsafe(
      `INSERT INTO ${LOCAL_GATEWAY_SCHEMA}.controls (name, value) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
      failureControl(scope),
      count,
    );
  }

  /** Consome uma falha programada (a do escopo, depois a global); true quando esta chamada deve falhar. */
  async consumeFailure({ scope }: { scope?: string } = {}): Promise<boolean> {
    await this.ensureTables();
    for (const name of scope ? [failureControl(scope), failureControl()] : [failureControl()]) {
      const rows = await this.db.$queryRawUnsafe<{ value: number }[]>(
        `UPDATE ${LOCAL_GATEWAY_SCHEMA}.controls SET value = value - 1
         WHERE name = $1 AND value > 0 RETURNING value`,
        name,
      );
      if (rows.length > 0) return true;
    }
    return false;
  }

  async createCustomer({
    name,
    taxIdLast4,
  }: {
    name: string;
    taxIdLast4: string;
  }): Promise<string> {
    await this.ensureTables();
    const id = `cus_local_${randomUUID()}`;
    await this.db.$executeRawUnsafe(
      `INSERT INTO ${LOCAL_GATEWAY_SCHEMA}.customers (id, name, tax_id_last4) VALUES ($1, $2, $3)`,
      id,
      name,
      taxIdLast4,
    );
    return id;
  }

  /** Cria a cobrança; a mesma referência devolve a mesma cobrança (idempotente). */
  async createCharge(input: {
    externalReference: string;
    customerId: string;
    method: 'pix' | 'card';
    amountCents: number;
    installments: number;
    status: GatewayChargeStatus;
    pixCopyPaste: string | null;
    dueAt: Date | null;
    cardLast4: string | null;
    failureReason: string | null;
  }): Promise<LocalChargeRow> {
    await this.ensureTables();
    await this.db.$executeRawUnsafe(
      `INSERT INTO ${LOCAL_GATEWAY_SCHEMA}.charges (id, external_reference, customer_id, method,
         amount_cents, installments, status, pix_copy_paste, due_at, card_last4, failure_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (external_reference) DO NOTHING`,
      `pay_local_${randomUUID()}`,
      input.externalReference,
      input.customerId,
      input.method,
      input.amountCents,
      input.installments,
      input.status,
      input.pixCopyPaste,
      input.dueAt,
      input.cardLast4,
      input.failureReason,
    );
    const charge = await this.chargeByReference({ externalReference: input.externalReference });
    if (!charge) throw new Error('Gateway local: cobrança não gravada.');
    return charge;
  }

  async chargeByReference({
    externalReference,
  }: {
    externalReference: string;
  }): Promise<LocalChargeRow | null> {
    await this.ensureTables();
    const rows = await this.db.$queryRawUnsafe<LocalChargeRow[]>(
      `SELECT * FROM ${LOCAL_GATEWAY_SCHEMA}.charges WHERE external_reference = $1`,
      externalReference,
    );
    return rows[0] ?? null;
  }

  async chargeById({ id }: { id: string }): Promise<LocalChargeRow | null> {
    await this.ensureTables();
    const rows = await this.db.$queryRawUnsafe<LocalChargeRow[]>(
      `SELECT * FROM ${LOCAL_GATEWAY_SCHEMA}.charges WHERE id = $1`,
      id,
    );
    return rows[0] ?? null;
  }

  async chargesCreatedBetween({ from, to }: { from: Date; to: Date }): Promise<LocalChargeRow[]> {
    await this.ensureTables();
    return this.db.$queryRawUnsafe<LocalChargeRow[]>(
      `SELECT * FROM ${LOCAL_GATEWAY_SCHEMA}.charges
       WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at`,
      from,
      to,
    );
  }

  /** Muda o estado da cobrança; na confirmação, grava o total, a taxa e o líquido. */
  async updateCharge({
    id,
    status,
    chargedCents,
    failureReason = null,
  }: {
    id: string;
    status: GatewayChargeStatus;
    chargedCents?: number | null;
    failureReason?: string | null;
  }): Promise<void> {
    await this.ensureTables();
    const fee = chargedCents == null ? null : LOCAL_GATEWAY_FEE_CENTS;
    await this.db.$executeRawUnsafe(
      `UPDATE ${LOCAL_GATEWAY_SCHEMA}.charges
       SET status = $2,
           charged_cents = COALESCE($3, charged_cents),
           fee_cents = COALESCE($4, fee_cents),
           net_cents = COALESCE($3 - $4, net_cents),
           failure_reason = $5,
           updated_at = now()
       WHERE id = $1`,
      id,
      status,
      chargedCents ?? null,
      fee,
      failureReason,
    );
  }

  /** Pix de saída: a mesma referência devolve o mesmo envio (idempotente). */
  async createTransfer({
    externalReference,
    amountCents,
  }: {
    externalReference: string;
    amountCents: number;
  }): Promise<LocalTransferRow> {
    await this.ensureTables();
    await this.db.$executeRawUnsafe(
      `INSERT INTO ${LOCAL_GATEWAY_SCHEMA}.transfers (id, external_reference, amount_cents, status)
       VALUES ($1, $2, $3, 'processing') ON CONFLICT (external_reference) DO NOTHING`,
      `tra_local_${randomUUID()}`,
      externalReference,
      amountCents,
    );
    const transfer = await this.transferByReference({ externalReference });
    if (!transfer) throw new Error('Gateway local: Pix de saída não gravado.');
    return transfer;
  }

  async transferByReference({
    externalReference,
  }: {
    externalReference: string;
  }): Promise<LocalTransferRow | null> {
    await this.ensureTables();
    const rows = await this.db.$queryRawUnsafe<LocalTransferRow[]>(
      `SELECT id, external_reference, amount_cents, status, failure_reason
       FROM ${LOCAL_GATEWAY_SCHEMA}.transfers WHERE external_reference = $1`,
      externalReference,
    );
    return rows[0] ?? null;
  }

  async updateTransfer({
    externalReference,
    status,
    failureReason = null,
  }: {
    externalReference: string;
    status: GatewayTransferStatus;
    failureReason?: string | null;
  }): Promise<void> {
    await this.ensureTables();
    await this.db.$executeRawUnsafe(
      `UPDATE ${LOCAL_GATEWAY_SCHEMA}.transfers SET status = $2, failure_reason = $3, updated_at = now()
       WHERE external_reference = $1`,
      externalReference,
      status,
      failureReason,
    );
  }
}
