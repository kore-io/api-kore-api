import type { AccessIpLogEntry } from '../../domain/log-entries';

/** Porta usada pelos outros módulos para registrar o IP real de um acesso. */
export interface AccessIpLogWriter {
  record({ entry }: { entry: AccessIpLogEntry }): Promise<void>;
}

export const ACCESS_IP_LOG_WRITER = Symbol('AccessIpLogWriter');
