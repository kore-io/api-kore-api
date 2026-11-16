/**
 * Cores dos e-mails, com os valores dos tokens do Design System (DS v0.16,
 * lib-kore-design: coreColors e semanticColorRefs). Constante copiada até o
 * pacote @kore-io/design ser publicado (decisão 142); o teste
 * email-theme.spec.ts compara com os tokens do homolog do lib-kore-design.
 * Quando o pacote for publicado, trocar esta constante pela dependência.
 */
export const EMAIL_THEME = {
  /** Fundo da página: `color.paper` (Papel). */
  pageBackground: '#FCFAF7',
  /** Quadro do e-mail: `color.white` (o `card` do semântico). */
  cardBackground: '#FFFFFF',
  /** Texto: `color.ink` (Tinta), o `foreground`. */
  text: '#241A1E',
  /** Texto secundário (rodapé): `gray.700`, o `muted-foreground`. */
  mutedText: '#5C5055',
  /** Botão: `primary.dark` (Vinho), o `primary` do semântico. */
  buttonBackground: '#74233D',
  /** Texto do botão: `color.paper`, o `primary-foreground`. */
  buttonText: '#FCFAF7',
} as const;
