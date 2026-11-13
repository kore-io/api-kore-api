import { BullModule } from '@nestjs/bullmq';
import { AppConfigService } from '../config/app-config.service';

/**
 * A fila do lado que produz (a API), sem fila offline: com o Redis fora, o
 * `add` falha na hora em vez de esperar o Redis voltar. Quem enfileira decide
 * o que fazer (o e-mail manda direto; o aviso da notificação fica para a rede
 * de segurança de 15 minutos), e a requisição responde logo.
 */
export const producerQueue = (name: string) =>
  BullModule.registerQueueAsync({
    name,
    inject: [AppConfigService],
    useFactory: (config: AppConfigService) => ({
      connection: { url: config.get({ key: 'REDIS_URL' }), enableOfflineQueue: false },
    }),
  });
