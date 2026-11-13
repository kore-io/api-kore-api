-- O e-mail "Você tem comissão disponível" (Comissões do indicador RN09;
-- decisão 242): até onde as notificações `commission` da pessoa já foram
-- avisadas por e-mail, no "Na hora" ou no Resumo diário. Só o worker (backoffice)
-- lê e grava esta tabela.
ALTER TABLE "notification_digest_states" ADD COLUMN "commission_emailed_through" TIMESTAMPTZ(3);
