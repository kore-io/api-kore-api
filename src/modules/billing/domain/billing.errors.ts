/** Publicação de casamento fora de rascunho (Preço RN04; Publicar e pagar RN01). */
export class BillingNotDraftError extends Error {
  override name = 'BillingNotDraftError';
}

/** Extensão de casamento que nunca publicou (Data de saída do ar; Preço RN04). */
export class NotPublishedError extends Error {
  override name = 'NotPublishedError';
}

/** Sem data do casamento ou sem fuso (Preço RN04; Cortesia RN04). */
export class BillingEventDateMissingError extends Error {
  override name = 'BillingEventDateMissingError';
}

/** Sem endereço do site (Publicar e pagar RN01). */
export class BillingSlugMissingError extends Error {
  override name = 'BillingSlugMissingError';
}

/** Data de saída do ar fora dos limites (Preço RN03). */
export class BillingEndDateOutOfRangeError extends Error {
  override name = 'BillingEndDateOutOfRangeError';
  constructor(
    readonly endDateMin: string | null,
    readonly endDateMax: string | null,
  ) {
    super();
  }
}
