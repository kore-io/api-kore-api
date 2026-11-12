import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
  validate,
} from 'class-validator';
import { toFieldErrors, type FieldError } from '../../../shared/http/validation-errors';
import { checkedAppearance } from '../../access/application/create-wedding.use-case';
import {
  BACKGROUND_MODES,
  FONT_PAIR_KEYS,
  HEX_COLOR,
  STARTER_PALETTE_KEYS,
  type BackgroundMode,
  type FontPairKey,
  type StarterPaletteKey,
} from '../../site/domain/appearance';
import { SECTION_LIMITS as L, normalizeSiteText } from '../../site/domain/site-sections';
import type { PlannerTemplateKind, TemplateSectionType } from '../domain/planner-template';

const text = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? normalizeSiteText({ value }) : value;

class StoryOrLodgingText {
  @Transform(text) @IsString() @IsNotEmpty() @MaxLength(L.storyText) text: string;
}

class DressCodeText {
  @Transform(text) @IsString() @IsNotEmpty() @MaxLength(L.dressCodeText) text: string;
}

class FaqQuestion {
  @Transform(text) @IsString() @IsNotEmpty() @MaxLength(L.question) question: string;
  @Transform(text) @IsString() @IsNotEmpty() @MaxLength(L.answer) answer: string;
}

class FaqTemplate {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(L.faqItems)
  @ValidateNested({ each: true })
  @Type(() => FaqQuestion)
  questions: FaqQuestion[];
}

class AppearanceTemplate {
  @IsIn(FONT_PAIR_KEYS) fontPairKey: FontPairKey;
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(STARTER_PALETTE_KEYS)
  starterPaletteKey?: StarterPaletteKey | null;
  @Matches(HEX_COLOR) primaryColor: string;
  @Matches(HEX_COLOR) accentColor: string;
  @IsIn(BACKGROUND_MODES) backgroundMode: BackgroundMode;
}

function classFor({
  kind,
  sectionType,
}: {
  kind: PlannerTemplateKind;
  sectionType: TemplateSectionType | null;
}): new () => object {
  if (kind === 'faq') return FaqTemplate;
  if (kind === 'appearance') return AppearanceTemplate;
  return sectionType === 'dress_code' ? DressCodeText : StoryOrLodgingText;
}

/**
 * Valida o `content` do modelo pelo tipo (Modelos RN04), com os limites das
 * seções da F2 e as mesmas regras do pipe global (campo desconhecido é 400,
 * RN03). Na Aparência, o mesmo guarda-corpo de contraste do Editor
 * (CONTRAST_TOO_LOW). Devolve o conteúdo gravado: só os campos do tipo.
 */
export async function validateTemplateContent({
  kind,
  sectionType,
  content,
}: {
  kind: PlannerTemplateKind;
  sectionType: TemplateSectionType | null;
  content: unknown;
}): Promise<{ ok: true; content: Record<string, unknown> } | { ok: false; errors: FieldError[] }> {
  if (typeof content !== 'object' || content === null || Array.isArray(content))
    return { ok: false, errors: [{ path: 'content', code: 'IS_OBJECT', params: {} }] };
  const value = plainToInstance(classFor({ kind, sectionType }), content);
  const validationErrors = await validate(value, { whitelist: true, forbidNonWhitelisted: true });
  if (validationErrors.length > 0)
    return { ok: false, errors: toFieldErrors({ validationErrors, parentPath: 'content' }).errors };

  if (kind === 'faq')
    return {
      ok: true,
      content: {
        questions: (value as FaqTemplate).questions.map(({ question, answer }) => ({
          question,
          answer,
        })),
      },
    };
  if (kind === 'appearance') {
    const appearance = value as AppearanceTemplate;
    // Lança ContrastTooLowError, o mesmo 422 da Aparência (revisão C6-4).
    return {
      ok: true,
      content: checkedAppearance({
        input: { ...appearance, starterPaletteKey: appearance.starterPaletteKey ?? null },
      }),
    };
  }
  return { ok: true, content: { text: (value as StoryOrLodgingText).text } };
}
