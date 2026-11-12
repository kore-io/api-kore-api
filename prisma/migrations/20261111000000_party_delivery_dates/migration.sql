-- Envio e primeira visualização do grupo (Modelo de Dados; Grupos RN10): o
-- status de envio volta a eles quando um grupo respondido passa a ter
-- pendente. Nulas até a Fase 4, que grava os envios.
ALTER TABLE "parties" ADD COLUMN "sent_at" TIMESTAMPTZ(3),
                      ADD COLUMN "first_viewed_at" TIMESTAMPTZ(3);
