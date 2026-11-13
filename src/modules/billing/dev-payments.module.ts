import { Module } from '@nestjs/common';
import { BillingModule } from './billing.module';
import { EmitDevPaymentEvent } from './application/emit-dev-payment-event.use-case';
import { DevPaymentsController } from './presentation/dev-payments.controller';

/**
 * A rota dev de pagamentos (Publicar e pagar RN15). Só é importado com
 * APP_ENV local ou test (ConditionalModule no AppModule): fora deles, a rota
 * nem existe e responde 404.
 */
@Module({
  imports: [BillingModule],
  controllers: [DevPaymentsController],
  providers: [EmitDevPaymentEvent],
})
export class DevPaymentsModule {}
