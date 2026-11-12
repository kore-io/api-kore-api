/** As 6 seções da F2, na ordem fixa do Editor e do site (Seções RN01). */
export const SITE_SECTION_TYPES = [
  'story',
  'countdown',
  'ceremony',
  'lodging',
  'dress_code',
  'faq',
] as const;
export type SiteSectionType = (typeof SITE_SECTION_TYPES)[number];

/** O conteúdo gravado (jsonb), já validado pelo DTO do tipo na gravação (RN12). */
export type SectionContent = Record<string, unknown>;

const text = (content: SectionContent): string =>
  typeof content.text === 'string' ? content.text : '';
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Os ids de imagem citados no conteúdo: as fotos de Nossa história e a do Dress code. */
export function sectionImageIds({
  type,
  content,
}: {
  type: SiteSectionType;
  content: SectionContent;
}): string[] {
  if (type === 'story')
    return list(content.imageIds).filter((id): id is string => typeof id === 'string');
  if (type === 'dress_code' && typeof content.imageId === 'string') return [content.imageId];
  return [];
}

/**
 * Seção vazia (Seções RN03): não aparece no site, e o Editor a marca "vazia".
 * Só contam as imagens `ready` (decisão 207, item 3). A contagem nunca está
 * vazia: ela some sem data (RN06), que é outra regra.
 */
export function isSectionEmpty({
  type,
  content,
  readyImageIds,
}: {
  type: SiteSectionType;
  content: SectionContent;
  readyImageIds: ReadonlySet<string>;
}): boolean {
  const images = sectionImageIds({ type, content }).filter((id) => readyImageIds.has(id));
  switch (type) {
    case 'story':
    case 'dress_code':
      return text(content).trim() === '' && images.length === 0;
    case 'countdown':
      return false;
    case 'ceremony':
      return list(content.venues).length === 0;
    case 'lodging':
      return text(content).trim() === '';
    case 'faq':
      return list(content.items).length === 0;
  }
}

/**
 * As imagens em uso no casamento (Imagens do site RN08): a capa e as que as
 * seções citam. As outras `ready` ficam fora de uso e saem em 24 horas.
 */
export function imagesInUse({
  coverImageId,
  sections,
}: {
  coverImageId: string | null;
  sections: readonly { type: SiteSectionType; content: SectionContent }[];
}): Set<string> {
  const ids = new Set(sections.flatMap((section) => sectionImageIds(section)));
  if (coverImageId) ids.add(coverImageId);
  return ids;
}

/** Limites das seções (Seções RN05 a RN10); todos conferidos no servidor (RN12). */
export const SECTION_LIMITS = {
  title: 80,
  storyText: 5000,
  storyImages: 12,
  venues: 4,
  venueTitle: 40,
  placeName: 80,
  address: 200,
  lodgingText: 5000,
  dressCodeText: 2000,
  faqItems: 30,
  question: 200,
  answer: 1000,
} as const;

/**
 * Texto simples (Seções RN04): trim, `\r\n` → `\n` e sem caracteres de
 * controle (fica só a quebra de linha). A saída é sempre escapada no site.
 */
export function normalizeSiteText({ value }: { value: string }): string {
  return (
    value
      .replace(/\r\n?/g, '\n')
      // Toda letra de controle (Unicode Cc), menos a quebra de linha.
      .replace(/(?!\n)\p{Cc}/gu, '')
      .trim()
  );
}
