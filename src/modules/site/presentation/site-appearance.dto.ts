import { ApiProperty } from '@nestjs/swagger';
import { IsIn, Matches, ValidateIf } from 'class-validator';
import {
  BACKGROUND_MODES,
  FONT_PAIR_KEYS,
  HEX_COLOR,
  STARTER_PALETTE_KEYS,
  type BackgroundMode,
  type FontPairKey,
  type StarterPaletteKey,
} from '../domain/appearance';

/** A Aparência inteira; os 5 campos são obrigatórios (PUT …/site/appearance). */
export class UpdateSiteAppearanceBody {
  @ApiProperty({ enum: FONT_PAIR_KEYS }) @IsIn(FONT_PAIR_KEYS) fontPairKey: FontPairKey;

  /** Null é "cor própria"; se não bater com as cores, o servidor grava null (RN07). */
  @ApiProperty({ enum: STARTER_PALETTE_KEYS, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsIn(STARTER_PALETTE_KEYS)
  starterPaletteKey: StarterPaletteKey | null;

  /** `#RRGGBB`, sem diferenciar maiúsculas; gravada em maiúsculas (RN06). */
  @ApiProperty({ example: '#A94F37' }) @Matches(HEX_COLOR) primaryColor: string;
  @ApiProperty({ example: '#7A8B69' }) @Matches(HEX_COLOR) accentColor: string;

  @ApiProperty({ enum: BACKGROUND_MODES }) @IsIn(BACKGROUND_MODES) backgroundMode: BackgroundMode;
}

class AppearanceWarning {
  @ApiProperty({ enum: ['ACCENT_LOW_CONTRAST'] }) code: 'ACCENT_LOW_CONTRAST';
  /** A razão do destaque sobre o fundo, com duas casas para baixo. */
  ratio: number;
}

export class SiteAppearanceResponse {
  @ApiProperty({ enum: FONT_PAIR_KEYS }) fontPairKey: FontPairKey;
  @ApiProperty({ enum: STARTER_PALETTE_KEYS, nullable: true })
  starterPaletteKey: StarterPaletteKey | null;
  primaryColor: string;
  /** #FFFFFF ou #1F1F1F, o que tiver mais contraste com a primária (RN04 e RN09). */
  primaryForeground: string;
  accentColor: string;
  @ApiProperty({ enum: BACKGROUND_MODES }) backgroundMode: BackgroundMode;
  /** Avisos que não bloqueiam (RN04). */
  @ApiProperty({ type: [AppearanceWarning] }) warnings: AppearanceWarning[];
}
