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
    }
  /** Exportação RN08: a cada exportação com a coluna Restrição alimentar. */
  | {
      name: 'exportacao_buffet';
      weddingId: string;
      props: {
        formato: 'xlsx' | 'pdf';
        quem: 'owner' | 'collaborator';
        filtro: 'all' | 'confirmed' | 'tag';
      };
    }
  /** Simule RN11: o funil do simulador, anônimo: sem casamento, sem props e sem o IP. */
  | { name: SimulatorEventName };

export type ProductEventName = ProductEvent['name'];

/** Os nomes do funil do Simule o site (Simule RN11; decisão 205, D26). */
export const SIMULATOR_EVENT_NAMES = [
  'simule_iniciado',
  'simule_nomes',
  'simule_pronto',
  'simule_outra_cor_aberta',
  'simule_outra_cor_desistiu',
] as const;
export type SimulatorEventName = (typeof SIMULATOR_EVENT_NAMES)[number];
