export type ApplicationLogActorKind = 'user' | 'party' | 'admin' | 'system';
export type AccessIpLogActorKind = 'user' | 'party';

/**
 * Registro do log da aplicação. O IP entra aberto e é gravado só como hash
 * (o IP real vai para o log de IP real, separado).
 */
export interface ApplicationLogEntry {
  action: string;
  actorKind: ApplicationLogActorKind;
  actorUserId?: string;
  weddingId?: string;
  supportSessionId?: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  ip?: string;
}

/** Registro do log de IP real: um acesso de usuário ou de grupo. */
export interface AccessIpLogEntry {
  action: string;
  ip: string;
  occurredAt: Date;
  actorKind: AccessIpLogActorKind;
  actorUserId?: string;
  partyId?: string;
}
