/**
 * O detalhe do casamento na Área do cerimonialista, dentro de Meus casamentos
 * (Meus casamentos RN08, decisão 260(1); Cadastro e perfil do cerimonialista
 * RN07): o destino dos avisos de aceite, recusa e expurgo (decisão 310(1)).
 */
export const plannerWeddingPath = (weddingId: string) =>
  `/cerimonialista?casamento=${encodeURIComponent(weddingId)}`;
