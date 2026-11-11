/** Origem do login em que a conta nasceu (RN06 de Login; decisão 138). */
export type AccountOrigin = 'invite' | 'referral' | 'couple_signup' | 'planner_signup' | 'none';
export type LoginMethod = 'email' | 'google';

/**
 * Eventos de produto da Fase 0 e da Fase 1 (lista do Parecer, decisões 135 e 138). Cada
 * fase acrescenta os seus aqui e no enum do banco.
 */
export type ProductEvent =
  | { name: 'conta_criada'; props: { origem: AccountOrigin; metodo: LoginMethod } }
  | { name: 'cerim_link_gerado'; weddingId: string }
  | { name: 'casal_aceitou'; weddingId: string }
  /** Importação RN14: linhas_erro na planilha são as linhas fora; na lista, o que saiu na prévia. */
  | {
      name: 'importacao';
      weddingId: string;
      props: { metodo: 'planilha' | 'lista'; linhas_erro: number };
    };

export type ProductEventName = ProductEvent['name'];
