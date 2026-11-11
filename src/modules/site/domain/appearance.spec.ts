import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKGROUNDS,
  FONT_PAIR_KEYS,
  STARTER_PALETTES,
  evaluateAppearance,
  floorRatio,
  keptStarterPalette,
  type BackgroundMode,
} from './appearance';

interface FixtureCase {
  name: string;
  primaryColor: string;
  accentColor: string;
  backgroundMode: BackgroundMode;
  expected: {
    primaryForeground: string;
    primaryForegroundRatio: number;
    primaryBackgroundRatio: number;
    accentBackgroundRatio: number;
    blocked: string | null;
    accentLowContrast: boolean;
  };
}

// A mesma fixture vive no web-kore-app: se um dos lados divergir, o teste dele falha.
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'appearance-contrast.fixture.json'), 'utf8'),
) as {
  fontPairKeys: string[];
  backgrounds: unknown;
  starterPalettes: unknown;
  cases: FixtureCase[];
};

describe('Aparência do site: o catálogo e o guarda-corpo (Aparência RN01, RN04, RN05 e RN07)', () => {
  it('RN01 - o catálogo é o da fixture compartilhada com o app', () => {
    expect([...FONT_PAIR_KEYS]).toEqual(fixture.fontPairKeys);
    expect(BACKGROUNDS).toEqual(fixture.backgrounds);
    expect(STARTER_PALETTES).toEqual(fixture.starterPalettes);
  });

  it('RN05 - os 27 pares das 9 paletas nos 3 fundos e os casos de borda dão o resultado da fixture', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(27);
    for (const { name, primaryColor, accentColor, backgroundMode, expected } of fixture.cases) {
      const result = evaluateAppearance({ primaryColor, accentColor, backgroundMode });
      expect({
        name,
        primaryForeground: result.primaryForeground,
        primaryForegroundRatio: floorRatio(result.ratios.primaryForeground),
        primaryBackgroundRatio: floorRatio(result.ratios.primaryBackground),
        accentBackgroundRatio: floorRatio(result.ratios.accentBackground),
        blocked: result.blocked?.check ?? null,
        accentLowContrast: result.accentLowContrast,
      }).toEqual({ name, ...expected });
    }
  });

  it('RN04 - a comparação é sem arredondar: 4,478 com o branco bloqueia', () => {
    const result = evaluateAppearance({
      primaryColor: '#777777',
      accentColor: '#7A8B69',
      backgroundMode: 'light',
    });
    expect(result.ratios.primaryForeground).toBeGreaterThan(4.47);
    expect(result.blocked).toMatchObject({ check: 'primary_foreground' });
  });

  it('RN07 - a paleta de partida fica só com a primária e o destaque dela', () => {
    expect(
      keptStarterPalette({
        starterPaletteKey: 'salvia',
        primaryColor: '#566C4B',
        accentColor: '#C9A66B',
      }),
    ).toBe('salvia');
    expect(
      keptStarterPalette({
        starterPaletteKey: 'salvia',
        primaryColor: '#566C4C',
        accentColor: '#C9A66B',
      }),
    ).toBeNull();
    expect(
      keptStarterPalette({
        starterPaletteKey: null,
        primaryColor: '#566C4B',
        accentColor: '#C9A66B',
      }),
    ).toBeNull();
  });
});
