import { imagesInUse, isSectionEmpty, sectionImageIds } from './site-sections';

const ready = new Set(['img-1']);

describe('Seções do site: vazia e imagens (Seções RN03; Imagens RN08)', () => {
  it('RN03 - Nossa história sem texto e sem foto pronta está vazia; com foto pronta, não', () => {
    expect(
      isSectionEmpty({
        type: 'story',
        content: { text: '  ', imageIds: [] },
        readyImageIds: ready,
      }),
    ).toBe(true);
    expect(
      isSectionEmpty({
        type: 'story',
        content: { text: '', imageIds: ['img-9'] },
        readyImageIds: ready,
      }),
    ).toBe(true);
    expect(
      isSectionEmpty({
        type: 'story',
        content: { text: '', imageIds: ['img-1'] },
        readyImageIds: ready,
      }),
    ).toBe(false);
  });

  it('RN03 - Cerimônia sem local, Hospedagem sem texto, Dress code sem texto e sem foto e FAQ sem pergunta estão vazias', () => {
    expect(
      isSectionEmpty({ type: 'ceremony', content: { venues: [] }, readyImageIds: ready }),
    ).toBe(true);
    expect(isSectionEmpty({ type: 'lodging', content: { text: '' }, readyImageIds: ready })).toBe(
      true,
    );
    expect(
      isSectionEmpty({
        type: 'dress_code',
        content: { text: '', imageId: null },
        readyImageIds: ready,
      }),
    ).toBe(true);
    expect(
      isSectionEmpty({
        type: 'dress_code',
        content: { text: '', imageId: 'img-1' },
        readyImageIds: ready,
      }),
    ).toBe(false);
    expect(isSectionEmpty({ type: 'faq', content: { items: [] }, readyImageIds: ready })).toBe(
      true,
    );
  });

  it('RN03 - a contagem nunca está vazia', () => {
    expect(isSectionEmpty({ type: 'countdown', content: {}, readyImageIds: ready })).toBe(false);
  });

  it('RN08 - em uso: a capa, as fotos de Nossa história e a do Dress code', () => {
    expect(sectionImageIds({ type: 'faq', content: { items: [] } })).toEqual([]);
    expect(
      [
        ...imagesInUse({
          coverImageId: 'capa',
          sections: [
            { type: 'story', content: { text: '', imageIds: ['a', 'b'] } },
            { type: 'dress_code', content: { text: '', imageId: 'c' } },
            { type: 'lodging', content: { text: 'x' } },
          ],
        }),
      ].sort(),
    ).toEqual(['a', 'b', 'c', 'capa']);
  });
});
