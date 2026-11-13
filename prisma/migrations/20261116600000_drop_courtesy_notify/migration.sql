-- A Cortesia saiu na F3 (Publicar e pagar RN17; PR 4c, #122): a variante do
-- kore_app da notificação da primeira publicação ficou sem uso. A do worker,
-- notify_wedding_published_for, continua (RN05; G5).
DROP FUNCTION notify_wedding_published(uuid[]);
