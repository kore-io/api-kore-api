import { detectSiteImageType, siteImageKeys } from './site-image';

describe('siteImageKeys (Imagens do site RN06)', () => {
  it('RN06 e decisão 229(f) - as chaves levam só o token aleatório, sem o casamento nem o id', () => {
    expect(siteImageKeys({ keyToken: 'abc' })).toEqual({
      original: 'site/abc/original',
      display: 'site/abc/display.jpg',
      thumb: 'site/abc/thumb.jpg',
      og: 'site/abc/og.jpg',
    });
  });
});

describe('detectSiteImageType (Imagens do site RN05)', () => {
  const bytes = (...values: number[]) => Uint8Array.from(values);

  it('RN05 - reconhece JPEG e PNG pela assinatura', () => {
    expect(detectSiteImageType({ head: bytes(0xff, 0xd8, 0xff, 0xe0) })).toBe('jpeg');
    expect(
      detectSiteImageType({ head: bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0) }),
    ).toBe('png');
  });

  it('RN05 - o resto é recusado, mesmo declarado como image/jpeg (PDF, GIF, vazio)', () => {
    expect(detectSiteImageType({ head: Buffer.from('%PDF-1.7') })).toBeNull();
    expect(detectSiteImageType({ head: Buffer.from('GIF89a') })).toBeNull();
    expect(detectSiteImageType({ head: bytes() })).toBeNull();
    expect(detectSiteImageType({ head: bytes(0xff, 0xd8) })).toBeNull();
  });
});
