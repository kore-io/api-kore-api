import type { Provider } from '@nestjs/common';
import { AppConfigService } from '../../../../shared/config/app-config.service';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../../application/ports/payment-gateway.port';
import { LocalGatewayStore } from './local-gateway/local-gateway.store';
import { LocalPaymentGateway } from './local-gateway/local-payment-gateway';

/**
 * A porta do gateway pela PAYMENT_GATEWAY_PROVIDER (Publicar e pagar RN14): só
 * `local` por enquanto; o Asaas entra com o card 65. A API e o worker montam o
 * mesmo adaptador, com o estado no mesmo Postgres.
 */
export const PAYMENT_GATEWAY_PROVIDERS: Provider[] = [
  {
    provide: LocalGatewayStore,
    inject: [BackofficePrismaService],
    useFactory: (db: BackofficePrismaService) => new LocalGatewayStore(db),
  },
  {
    provide: PAYMENT_GATEWAY,
    inject: [AppConfigService, LocalGatewayStore],
    useFactory: (config: AppConfigService, store: LocalGatewayStore): PaymentGateway =>
      new LocalPaymentGateway(store, {
        appEnv: config.get({ key: 'APP_ENV' }),
        webhookSecret: config.get({ key: 'PAYMENT_WEBHOOK_SECRET' }),
      }),
  },
];
