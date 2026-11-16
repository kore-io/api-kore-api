import type { Provider } from '@nestjs/common';
import { AppConfigService } from '@/shared/config/app-config.service';
import { LOCAL_KEY_ENVS } from '@/shared/config/env.schema';
import { EMAIL_SENDER, type EmailSender } from '@/shared/email/application/email-sender.port';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '@/modules/billing/application/ports/payment-gateway.port';
import {
  INTEGRATION_PROBES,
  type IntegrationProbes,
} from '@/modules/backoffice/application/ports/integration-probes.port';

/**
 * O Testar conexão pelas portas que já existem (decisão 267(1)): o gateway
 * pelo testConnection e o e-mail pelo ping. O SES e o Asaas entram com a
 * infraestrutura e o card 65; até lá, os dois respondem como locais.
 */
export const integrationProbesProvider: Provider = {
  provide: INTEGRATION_PROBES,
  inject: [PAYMENT_GATEWAY, EMAIL_SENDER, AppConfigService],
  useFactory: (
    gateway: PaymentGateway,
    email: EmailSender,
    config: AppConfigService,
  ): IntegrationProbes => ({
    asaas: {
      local: config.get({ key: 'PAYMENT_GATEWAY_PROVIDER' }) === 'local',
      ping: async () => {
        const { ok } = await gateway.testConnection();
        if (!ok) throw new Error('O gateway não confirmou a conexão.');
      },
    },
    email: {
      // Só SMTP por enquanto: em local e test, o Mailpit.
      local: LOCAL_KEY_ENVS.includes(config.get({ key: 'APP_ENV' })),
      ping: () => email.ping(),
    },
  }),
};
