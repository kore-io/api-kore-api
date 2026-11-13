import jsQR from 'jsqr';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
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

  it('RN09 - cada página do PDF leva o QR e o nome do seu grupo, e nenhum outro texto', async () => {
    const page = jest.spyOn(PDFDocument.prototype, 'addPage');
    const qr = jest.spyOn(QRCode, 'create');
    const text = jest.spyOn(PDFDocument.prototype, 'text');
    try {
      await renderer.pdf({
        pages: [
          { url: LINK, name: 'Família Moreira' },
          { url: `${LINK}x`, name: 'Tio <b>Zé</b> & Cia' },
        ],
      });
      const order = [
        ...page.mock.invocationCallOrder.map((at) => ({ at, event: 'página' })),
        ...qr.mock.calls.map((call, index) => ({
          at: qr.mock.invocationCallOrder[index],
          event: `qr ${call[0] as string}`,
        })),
        ...text.mock.calls.map((call, index) => ({
          at: text.mock.invocationCallOrder[index],
          event: `nome ${String(call[0])}`,
        })),
      ]
        .sort((left, right) => left.at - right.at)
        .map(({ event }) => event);
      expect(order).toEqual([
        'página',
        `qr ${LINK}`,
        'nome Família Moreira',
        'página',
        `qr ${LINK}x`,
        'nome Tio <b>Zé</b> & Cia',
      ]);
    } finally {
      page.mockRestore();
      qr.mockRestore();
      text.mockRestore();
    }
  });
});
