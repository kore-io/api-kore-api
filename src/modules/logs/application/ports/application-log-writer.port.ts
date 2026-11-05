import type { ApplicationLogEntry } from '../../domain/log-entries';

/** Porta usada pelos outros módulos para registrar no log da aplicação. */
export interface ApplicationLogWriter {
  record({ entry }: { entry: ApplicationLogEntry }): Promise<void>;
}

export const APPLICATION_LOG_WRITER = Symbol('ApplicationLogWriter');
