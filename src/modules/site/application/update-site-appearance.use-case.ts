import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  evaluateAppearance,
  floorRatio,
  keptStarterPalette,
  type BackgroundMode,
  type FontPairKey,
  type StarterPaletteKey,
} from '../domain/appearance';
import { ContrastTooLowError } from '../domain/site.errors';
import { SITE_STORE, type SiteStore } from './ports/site-store.port';

export interface SiteAppearanceInput {
  fontPairKey: FontPairKey;
  starterPaletteKey: StarterPaletteKey | null;
  /** `#RRGGBB`, qualquer caixa. */
  primaryColor: string;
  accentColor: string;
  backgroundMode: BackgroundMode;
}

export interface SiteAppearanceView {
  fontPairKey: FontPairKey;
  starterPaletteKey: StarterPaletteKey | null;
  primaryColor: string;
  primaryForeground: string;
  accentColor: string;
  backgroundMode: BackgroundMode;
  warnings: { code: 'ACCENT_LOW_CONTRAST'; ratio: number }[];
}

/**
 * PUT …/site/appearance (Aparência RN01 a RN07 e RN10): grava a Aparência
 * inteira, com as cores em maiúsculas. O guarda-corpo é o mesmo do app (a
 * fixture compartilhada): cor bloqueada é 422 e nada é gravado; o destaque
 * pouco visível só avisa. A paleta de partida fica só com as cores dela.
 */
@Injectable()
export class UpdateSiteAppearance {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(SITE_STORE) private readonly store: SiteStore,
  ) {}

  async execute({
    userId,
    weddingId,
    input,
    now,
  }: {
    userId: string;
    weddingId: string;
    input: SiteAppearanceInput;
    now: Date;
  }): Promise<SiteAppearanceView> {
    await this.authorization.require({ userId, weddingId, action: 'manage_site' });
    const primaryColor = input.primaryColor.toUpperCase();
    const accentColor = input.accentColor.toUpperCase();
    const evaluation = evaluateAppearance({
      primaryColor,
      accentColor,
      backgroundMode: input.backgroundMode,
    });
    if (evaluation.blocked)
      throw new ContrastTooLowError({
        check: evaluation.blocked.check,
        ratio: floorRatio(evaluation.blocked.ratio),
      });

    const appearance = {
      fontPairKey: input.fontPairKey,
      starterPaletteKey: keptStarterPalette({
        starterPaletteKey: input.starterPaletteKey,
        primaryColor,
        accentColor,
      }),
      primaryColor,
      accentColor,
      backgroundMode: input.backgroundMode,
    };
    await this.store.updateAppearance({ weddingId, appearance, now });
    return {
      ...appearance,
      primaryForeground: evaluation.primaryForeground,
      warnings: evaluation.accentLowContrast
        ? [
            {
              code: 'ACCENT_LOW_CONTRAST',
              ratio: floorRatio(evaluation.ratios.accentBackground),
            },
          ]
        : [],
    };
  }
}
