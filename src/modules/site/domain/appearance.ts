/**
 * Aparência do site do casal (Aparência do site RN01 a RN07; Marca, Site do
 * casal: Aparência). O catálogo e as contas são os mesmos do app, provados pela
 * fixture appearance-contrast.fixture.json, versionada nos dois repositórios.
 */

export const FONT_PAIR_KEYS = ['romantico', 'classico', 'leve', 'moderno'] as const;
export type FontPairKey = (typeof FONT_PAIR_KEYS)[number];

export const BACKGROUND_MODES = ['light', 'cream', 'dark'] as const;
export type BackgroundMode = (typeof BACKGROUND_MODES)[number];

/** Os 6 tokens de cada fundo (Marca); fundo e texto não têm cor livre. */
export const BACKGROUNDS: Record<
  BackgroundMode,
  {
    background: string;
    surface: string;
    foreground: string;
    mutedForeground: string;
    border: string;
    koreSeal: string;
  }
> = {
  light: {
    background: '#FFFFFF',
    surface: '#F5F5F4',
    foreground: '#1F1F1F',
    mutedForeground: '#5E5E5B',
    border: '#E4E4E1',
    koreSeal: '#74233D',
  },
  cream: {
    background: '#FBF7F2',
    surface: '#FFFFFF',
    foreground: '#2E2A26',
    mutedForeground: '#6B6159',
    border: '#E8DFD4',
    koreSeal: '#74233D',
  },
  dark: {
    background: '#15171C',
    surface: '#1E2128',
    foreground: '#F2F0EC',
    mutedForeground: '#A9A59E',
    border: '#353944',
    koreSeal: '#F6E6EB',
  },
};

/** As 9 paletas de partida: primária, destaque e o fundo sugerido (RN01 e RN03). */
export const STARTER_PALETTES = {
  terracota: { primary: '#A94F37', accent: '#7A8B69', background: 'cream' },
  salvia: { primary: '#566C4B', accent: '#C9A66B', background: 'light' },
  rose: { primary: '#A3545E', accent: '#8C9A7E', background: 'cream' },
  marfim: { primary: '#7D6036', accent: '#1F2A44', background: 'cream' },
  marinho: { primary: '#1F2A44', accent: '#B08D57', background: 'light' },
  areia: { primary: '#2F6F7E', accent: '#D9A06B', background: 'cream' },
  'por-do-sol': { primary: '#B24F34', accent: '#2F6F7E', background: 'cream' },
  grafite: { primary: '#222222', accent: '#9A8C7A', background: 'light' },
  noite: { primary: '#E7D3B0', accent: '#9A8C7A', background: 'dark' },
} as const satisfies Record<
  string,
  { primary: string; accent: string; background: BackgroundMode }
>;
export type StarterPaletteKey = keyof typeof STARTER_PALETTES;
export const STARTER_PALETTE_KEYS = Object.keys(STARTER_PALETTES) as StarterPaletteKey[];

/** O padrão de todo casamento: Romântico + Terracota + Creme (RN02). */
export const DEFAULT_APPEARANCE = {
  fontPairKey: 'romantico',
  starterPaletteKey: 'terracota',
  primaryColor: '#A94F37',
  accentColor: '#7A8B69',
  backgroundMode: 'cream',
} as const;

/** `#RRGGBB`, sem diferenciar maiúsculas (RN06). */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const WHITE = '#FFFFFF';
/** O texto escuro sobre a primária (RN04). */
const DARK_TEXT = '#1F1F1F';
export const MIN_PRIMARY_FOREGROUND_RATIO = 4.5;
export const MIN_PRIMARY_BACKGROUND_RATIO = 3;
export const MIN_ACCENT_BACKGROUND_RATIO = 3;

/** Luminância relativa da WCAG 2.x (limiar de linearização 0,04045). */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Razão de contraste da WCAG 2.x, sem arredondar (RN04). */
export function contrastRatio(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Duas casas, para baixo: a resposta nunca mostra mais contraste do que há. */
export function floorRatio(ratio: number): number {
  return Math.floor(ratio * 100) / 100;
}

export type ContrastCheck = 'primary_foreground' | 'primary_background';

export interface AppearanceEvaluation {
  /** Branco ou o texto escuro, o que tiver mais contraste (no empate, branco). */
  primaryForeground: string;
  ratios: { primaryForeground: number; primaryBackground: number; accentBackground: number };
  /** O bloqueio (RN04 e RN05); com as duas regras falhando, vale o do texto. */
  blocked: { check: ContrastCheck; ratio: number } | null;
  /** O destaque abaixo de 3:1 só avisa (RN04). */
  accentLowContrast: boolean;
}

/** O guarda-corpo do seletor (RN04), com o fundo escolhido. Cores em `#RRGGBB`. */
export function evaluateAppearance({
  primaryColor,
  accentColor,
  backgroundMode,
}: {
  primaryColor: string;
  accentColor: string;
  backgroundMode: BackgroundMode;
}): AppearanceEvaluation {
  const background = BACKGROUNDS[backgroundMode].background;
  const onWhite = contrastRatio(primaryColor, WHITE);
  const onDark = contrastRatio(primaryColor, DARK_TEXT);
  const primaryForeground = onWhite >= onDark ? WHITE : DARK_TEXT;
  const ratios = {
    primaryForeground: Math.max(onWhite, onDark),
    primaryBackground: contrastRatio(primaryColor, background),
    accentBackground: contrastRatio(accentColor, background),
  };
  const blocked =
    ratios.primaryForeground < MIN_PRIMARY_FOREGROUND_RATIO
      ? { check: 'primary_foreground' as const, ratio: ratios.primaryForeground }
      : ratios.primaryBackground < MIN_PRIMARY_BACKGROUND_RATIO
        ? { check: 'primary_background' as const, ratio: ratios.primaryBackground }
        : null;
  return {
    primaryForeground,
    ratios,
    blocked,
    accentLowContrast: ratios.accentBackground < MIN_ACCENT_BACKGROUND_RATIO,
  };
}

/**
 * A paleta de partida fica só enquanto a primária e o destaque são os dela
 * (RN07); senão, nula ("cor própria"), sem erro.
 */
export function keptStarterPalette({
  starterPaletteKey,
  primaryColor,
  accentColor,
}: {
  starterPaletteKey: StarterPaletteKey | null;
  primaryColor: string;
  accentColor: string;
}): StarterPaletteKey | null {
  if (!starterPaletteKey) return null;
  const palette = STARTER_PALETTES[starterPaletteKey];
  return palette.primary === primaryColor && palette.accent === accentColor
    ? starterPaletteKey
    : null;
}
