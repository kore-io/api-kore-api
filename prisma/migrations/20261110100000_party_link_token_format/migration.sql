-- Token do link do grupo: 128 bits em base64url, 22 caracteres (Grupos RN11;
-- sugestão do Crivo na feature/67-modelo-convidados). SQL manual.
ALTER TABLE "parties" ADD CONSTRAINT "chk_parties_link_token"
  CHECK ("link_token" ~ '^[A-Za-z0-9_-]{22}$');
