import { SetMetadata } from '@nestjs/common';

export const OWN_TRANSACTIONS = 'ownTransactions';

/**
 * A rota não roda dentro da transação da requisição: ela abre as suas, curtas,
 * pelo WeddingScope. Para trabalho lento fora do banco (o processamento das
 * imagens do site, S4 RN05), que não pode segurar uma transação aberta.
 */
export const OwnTransactions = (): MethodDecorator => SetMetadata(OWN_TRANSACTIONS, true);
