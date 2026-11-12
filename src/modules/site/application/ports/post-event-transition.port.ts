/** A passagem ao pós-evento (Publicação RN08), pela conexão do backoffice. */
export interface PostEventTransition {
  /**
   * Numa transação: `published → post_event` quando a `eventDate` já passou no
   * fuso de cada casamento (sem fuso, o de Brasília, RN12), e o log
   * `wedding.post_event` só para as linhas mudadas. Devolve os ids mudados.
   */
  moveDue({ now }: { now: Date }): Promise<string[]>;
}

export const POST_EVENT_TRANSITION = Symbol('PostEventTransition');
