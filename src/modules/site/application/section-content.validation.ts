import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
  validate,
} from 'class-validator';
import { toFieldErrors, type FieldError } from '../../../shared/http/validation-errors';
import { DATE_ONLY } from '../../access/presentation/weddings.dto';
import {
  SECTION_LIMITS as L,
  normalizeSiteText,
  type SectionContent,
  type SiteSectionType,
} from '../domain/site-sections';

const text = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? normalizeSiteText({ value }) : value;
/** `HH:mm`, de 00:00 a 23:59 (Seções RN07). */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

class StoryContent {
  @Transform(text) @IsString() @MaxLength(L.storyText) text: string;
  @IsArray() @ArrayMaxSize(L.storyImages) @IsUUID('all', { each: true }) imageIds: string[];
}

class Venue {
  @Transform(text) @IsString() @IsNotEmpty() @MaxLength(L.venueTitle) title: string;
  @Transform(text) @IsString() @IsNotEmpty() @MaxLength(L.placeName) placeName: string;
  /** Horário local do casamento, sem conversão (RN07). */
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  date: string | null;
  @ValidateIf((_, value) => value !== null) @Matches(TIME) time: string | null;
  @Transform(text) @IsString() @IsNotEmpty() @MaxLength(L.address) address: string;
}

class CeremonyContent {
  @IsArray()
  @ArrayMaxSize(L.venues)
  @ValidateNested({ each: true })
  @Type(() => Venue)
  venues: Venue[];
}

class LodgingContent {
  @Transform(text) @IsString() @MaxLength(L.lodgingText) text: string;
}

class DressCodeContent {
  @Transform(text) @IsString() @MaxLength(L.dressCodeText) text: string;
  @ValidateIf((_, value) => value !== null) @IsUUID() imageId: string | null;
}

class FaqItem {
  @Transform(text) @IsString() @IsNotEmpty() @MaxLength(L.question) question: string;
  @Transform(text) @IsString() @IsNotEmpty() @MaxLength(L.answer) answer: string;
}

class FaqContent {
  @IsArray()
  @ArrayMaxSize(L.faqItems)
  @ValidateNested({ each: true })
  @Type(() => FaqItem)
  items: FaqItem[];
}

const CONTENT_CLASS: Record<Exclude<SiteSectionType, 'countdown'>, new () => object> = {
  story: StoryContent,
  ceremony: CeremonyContent,
  lodging: LodgingContent,
  dress_code: DressCodeContent,
  faq: FaqContent,
};

/** O conteúdo gravado: só os campos do tipo, já normalizados. */
function toStored({ type, value }: { type: SiteSectionType; value: object }): SectionContent {
  switch (type) {
    case 'story': {
      const { text: body, imageIds } = value as StoryContent;
      return { text: body, imageIds };
    }
    case 'countdown':
      return {};
    case 'ceremony':
      return {
        venues: (value as CeremonyContent).venues.map(
          ({ title, placeName, date, time, address }) => ({
            title,
            placeName,
            date,
            time,
            address,
          }),
        ),
      };
    case 'lodging':
      return { text: (value as LodgingContent).text };
    case 'dress_code': {
      const { text: body, imageId } = value as DressCodeContent;
      return { text: body, imageId };
    }
    case 'faq':
      return {
        items: (value as FaqContent).items.map(({ question, answer }) => ({ question, answer })),
      };
  }
}

/**
 * Valida o `content` pelo DTO do tipo (Seções RN12): o `type` vem no caminho, e
 * o ValidationPipe global não escolhe o DTO por parâmetro. Mesmas regras do
 * pipe (`whitelist` e `forbidNonWhitelisted`) e o mesmo `errors[]`, com o
 * prefixo `content.`. Os campos ausentes são exigidos pelo próprio DTO.
 */
export async function validateSectionContent({
  type,
  content,
}: {
  type: SiteSectionType;
  content: unknown;
}): Promise<{ ok: true; content: SectionContent } | { ok: false; errors: FieldError[] }> {
  if (typeof content !== 'object' || content === null || Array.isArray(content))
    return { ok: false, errors: [{ path: 'content', code: 'IS_OBJECT', params: {} }] };
  // A contagem não tem campo nenhum: um DTO vazio cairia no forbidUnknownValues.
  if (type === 'countdown') {
    const extra = Object.keys(content).map((key) => ({
      path: `content.${key}`,
      code: 'WHITELIST_VALIDATION',
      params: {},
    }));
    return extra.length > 0 ? { ok: false, errors: extra } : { ok: true, content: {} };
  }
  const value = plainToInstance(CONTENT_CLASS[type], content);
  const validationErrors = await validate(value, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (validationErrors.length > 0)
    return {
      ok: false,
      errors: toFieldErrors({ validationErrors, parentPath: 'content' }).errors,
    };
  return { ok: true, content: toStored({ type, value }) };
}
