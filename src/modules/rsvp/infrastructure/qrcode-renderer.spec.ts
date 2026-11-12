import jsQR from 'jsqr';
import sharp from 'sharp';
import { QrcodeRenderer } from './qrcode-renderer';

const LINK = 'https://kore.com.br/ana-e-marcos/grupo/q3Xv8LmN2pRtY7wK1cZb4A';

/** Lê o QR do PNG, como a câmera do convidado. */
async function decode(
  png: Buffer,
): Promise<{ text: string | null; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return { text: code?.data ?? null, width: info.width, height: info.height };
}

describe('QR code do convite (Envios RN09)', () => {
  const renderer = new QrcodeRenderer();

  it('RN09 - o PNG de 1024 × 1024 leva só o link do grupo', async () => {
    expect(await decode(await renderer.png({ url: LINK }))).toEqual({
      text: LINK,
      width: 1024,
      height: 1024,
    });
  });

  it('RN09 - o PDF tem um QR por página', async () => {
    const pdf = await renderer.pdf({
      pages: [
        { url: LINK, name: 'Família Moreira' },
        { url: `${LINK}x`, name: 'Tio <b>Zé</b> & Cia' },
      ],
    });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true);
    expect(text.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(2);
  });
});
