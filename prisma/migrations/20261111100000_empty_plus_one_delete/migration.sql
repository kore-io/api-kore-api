-- Diminuir as vagas apaga de vez a vaga vazia pendente (Grupos RN07: "não tem
-- dado nem resposta, e não vai à lixeira"). É a única linha de guests que a
-- API apaga; o resto é remoção lógica e só o expurgo apaga (Lixeira RN10).
GRANT DELETE ON "guests" TO kore_app;
CREATE POLICY "guests_member_delete_empty_plus_one" ON "guests" FOR DELETE
  USING ("wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id())
         AND "is_plus_one" AND "name" IS NULL AND "rsvp_status" = 'pending');
