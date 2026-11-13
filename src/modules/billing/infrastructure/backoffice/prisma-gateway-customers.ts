import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { GatewayCustomers } from '../../application/ports/payment-request.store.port';

/**
 * O cliente do gateway por pagador do casamento (B2-11). Sem GRANT ao
 * kore_app (RN20): a API grava pela conexão do backoffice, fora da transação
 * do pedido.
 */
@Injectable()
export class PrismaGatewayCustomers implements GatewayCustomers {
  constructor(private readonly db: BackofficePrismaService) {}

  async find({
    weddingId,
    gateway,
    payerTaxIdHash,
  }: {
    weddingId: string;
    gateway: 'local' | 'asaas';
    payerTaxIdHash: string;
  }): Promise<string | null> {
    const customer = await this.db.gatewayCustomer.findUnique({
      where: {
        weddingId_gateway_payerTaxIdHash: { weddingId, gateway, payerTaxIdHash },
      },
      select: { gatewayCustomerId: true },
    });
    return customer?.gatewayCustomerId ?? null;
  }

  /** Dois pedidos ao mesmo tempo: fica o primeiro cliente gravado. */
  async save(input: {
    weddingId: string;
    gateway: 'local' | 'asaas';
    payerTaxIdHash: string;
    gatewayCustomerId: string;
  }): Promise<string> {
    await this.db.gatewayCustomer.createMany({ data: [input], skipDuplicates: true });
    const saved = await this.find(input);
    return saved ?? input.gatewayCustomerId;
  }
}
