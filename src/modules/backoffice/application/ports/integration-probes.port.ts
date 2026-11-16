import type { IntegrationName } from '@/modules/backoffice/domain/referral-settings';

/** Uma integração que o Testar conexão alcança (Backoffice - cobrança RN10; B10-8). */
export interface IntegrationProbe {
  /** O adaptador local (o gateway local, o SMTP do Mailpit): "Conectado (local)". */
  local: boolean;
  /** Só confere que o serviço responde; falha com erro. */
  ping(): Promise<void>;
}

/** Só as que existem na API: o mapa fica de fora (decisão 267(1)). */
export type IntegrationProbes = Partial<Record<IntegrationName, IntegrationProbe>>;

export const INTEGRATION_PROBES = Symbol('IntegrationProbes');
