-- A rotina de 5 minutos (Publicar e pagar RN09; B2-5) procura os eventos
-- gravados e não processados, pela data de recebimento.
CREATE INDEX "idx_gateway_events_received_at_unprocessed"
  ON "gateway_events" ("received_at") WHERE "processed_at" IS NULL;
