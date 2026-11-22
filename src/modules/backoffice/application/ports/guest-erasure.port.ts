/**
 * Como o pedido do titular chegou (RN10; decisão 256(2)): lista fechada, para
 * o nome do titular nunca ir ao log. Rótulos: E-mail · WhatsApp · Telefone ·
 * Pelo casal · Outro.
 */
export const REQUEST_CHANNELS = ['email', 'whatsapp', 'phone', 'couple', 'other'] as const;
export type RequestChannel = (typeof REQUEST_CHANNELS)[number];

/**
 * Remover os dados de um convidado a pedido do titular (Backoffice - acesso
 * RN10; decisão 253(3)), numa transação do backoffice: apaga de vez (também
 * da lixeira) o convidado, as respostas (cascade) e os vínculos de tag,
 * recalcula os números e grava o log sem o nome. O grupo de uma pessoa só
 * com o nome dela vira "Grupo removido" e o nome some dos avisos de RSVP.
 */
export interface GuestErasure {
  erase(input: {
    weddingId: string;
    guestId: string;
    byUserId: string;
    requestChannel: RequestChannel;
    ipHash: string | null;
    now: Date;
  }): Promise<'erased' | 'not_found'>;
}

export const GUEST_ERASURE = Symbol('GuestErasure');
