/**
 * Trabalho que só pode acontecer depois que a transação da requisição grava
 * (decisão 170): e-mail e evento de produto nunca saem de algo que o banco
 * desfez. Se a transação desfaz, o trabalho é descartado.
 */
export interface AfterCommit {
  schedule(work: () => Promise<void>): void;
}

export const AFTER_COMMIT = Symbol('AfterCommit');
