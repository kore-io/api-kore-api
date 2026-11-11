import { siteImageKeys } from './site-image';

describe('siteImageKeys (Imagens do site RN06)', () => {
  it('RN06 - as chaves levam só o id da imagem, sem o casamento', () => {
    expect(siteImageKeys({ imageId: 'abc' })).toEqual({
      original: 'site/abc/original',
      display: 'site/abc/display.jpg',
      thumb: 'site/abc/thumb.jpg',
      og: 'site/abc/og.jpg',
    });
  });
});
