import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import type { QrRenderer } from '../application/ports/qr-renderer.port';

/** As fontes da exportação da F1 (OFL; guests/infrastructure/fonts). */
const FONTS_DIR = join(__dirname, '..', '..', 'guests', 'infrastructure', 'fonts');
const DISPLAY_FONT = join(FONTS_DIR, 'CormorantGaramond-SemiBold.ttf');
const INK = '#241a1e';

/** A4 em pontos; o QR ocupa uma área de 360 pt no centro, com o nome embaixo. */
const PAGE = { width: 595.28, height: 841.89 };
const QR_SIZE = 360;
const QUIET_ZONE = 4;
const PNG_SIZE = 1024;

/**
 * Com a biblioteca `qrcode` (MIT, sem dependência nativa; decisão 217(12)),
 * sempre com correção de erro M (R4-6): o SVG rasterizado pelo `sharp` (que a
 * API já usa nas imagens) para o PNG, e a matriz (`QRCode.create`) desenhada
 * vetorial no `pdfkit`.
 */
@Injectable()
export class QrcodeRenderer implements QrRenderer {
  async png({ url }: { url: string }): Promise<Buffer> {
    // O SVG do qrcode rasterizado pelo sharp (nativo): o PNG em JS puro do
    // qrcode é lento demais para rodar dentro da transação da requisição.
    const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const svg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: QUIET_ZONE,
    });
    const cells = modules.size + QUIET_ZONE * 2;
    return sharp(Buffer.from(svg), { density: Math.ceil((72 * PNG_SIZE) / cells) })
      .resize(PNG_SIZE, PNG_SIZE, { kernel: 'nearest' })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
  }

  pdf({ pages }: { pages: readonly { url: string; name: string }[] }): Promise<Buffer> {
    const document = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    document.registerFont('display', DISPLAY_FONT);
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });
    for (const { url, name } of pages) {
      document.addPage();
      const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
      const cells = modules.size + QUIET_ZONE * 2;
      const cell = QR_SIZE / cells;
      const left = (PAGE.width - QR_SIZE) / 2;
      const top = 200;
      document.fillColor(INK);
      for (let row = 0; row < modules.size; row++)
        for (let column = 0; column < modules.size; column++)
          if (modules.get(row, column))
            document.rect(
              left + (column + QUIET_ZONE) * cell,
              top + (row + QUIET_ZONE) * cell,
              cell,
              cell,
            );
      document.fill();
      document
        .font('display')
        .fontSize(24)
        .fillColor(INK)
        .text(name, 48, top + QR_SIZE + 32, { width: PAGE.width - 96, align: 'center' });
    }
    document.end();
    return done;
  }
}
