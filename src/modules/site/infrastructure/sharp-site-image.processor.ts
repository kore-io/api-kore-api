import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import type {
  ProcessedSiteImage,
  ProcessedVersion,
  SiteImageProcessor,
} from '../application/ports/site-image-processor.port';
import {
  SITE_IMAGE_DISPLAY_MAX_PX,
  SITE_IMAGE_MAX_BYTES,
  SITE_IMAGE_MAX_INPUT_PIXELS,
  SITE_IMAGE_OG,
  SITE_IMAGE_THUMB_MAX_PX,
} from '../domain/site-image';
import { SiteImageInvalidError } from '../domain/site.errors';

// Qualidade das versões; desce até a versão caber no teto dela (a servida em
// 4 MB, o CHECK da tabela; a prévia em 300 KB).
const QUALITY = 82;
const QUALITIES = [82, 74, 66, 58, 50, 42, 34] as const;

/**
 * Recodificação com o sharp (S4 RN05). Cada processamento usa 1 thread do
 * libvips e o cache dele fica desligado: são no máximo 2 por instância (fila
 * em memória no caso de uso), num contêiner pequeno. O sharp não copia
 * metadado nenhum para a saída sem `keepMetadata`/`withMetadata`, então EXIF,
 * XMP, GPS e o perfil ICC ficam de fora.
 */
@Injectable()
export class SharpSiteImageProcessor implements SiteImageProcessor {
  constructor() {
    sharp.concurrency(1);
    sharp.cache(false);
  }

  async process({ source }: { source: Buffer }): Promise<ProcessedSiteImage> {
    try {
      // Uma decodificação do original; as outras versões saem da versão servida.
      const normalized = () =>
        sharp(source, { limitInputPixels: SITE_IMAGE_MAX_INPUT_PIXELS })
          // Aplica a orientação do EXIF antes de o EXIF sair.
          .rotate()
          // PNG com transparência vira JPEG com fundo branco.
          .flatten({ background: '#ffffff' })
          // Display P3 e outros perfis viram sRGB, para a cor não mudar.
          .toColorspace('srgb')
          .resize({
            width: SITE_IMAGE_DISPLAY_MAX_PX,
            height: SITE_IMAGE_DISPLAY_MAX_PX,
            fit: 'inside',
            withoutEnlargement: true,
          });
      const display = await this.fit(normalized, SITE_IMAGE_MAX_BYTES);
      const thumb = await this.jpeg(
        sharp(display.body).resize({
          width: SITE_IMAGE_THUMB_MAX_PX,
          height: SITE_IMAGE_THUMB_MAX_PX,
          fit: 'inside',
          withoutEnlargement: true,
        }),
        QUALITY,
      );
      return { display, thumb, og: await this.og(display.body) };
    } catch (error) {
      if (error instanceof SiteImageInvalidError) throw error;
      // Formato que o libvips não lê, arquivo truncado ou acima de 40 MP.
      throw new SiteImageInvalidError();
    }
  }

  /** 1200 × 630, recorte central, até 300 KB (Site público RN09). */
  private og(display: Buffer): Promise<ProcessedVersion> {
    return this.fit(
      () =>
        sharp(display).resize({
          width: SITE_IMAGE_OG.width,
          height: SITE_IMAGE_OG.height,
          fit: 'cover',
          position: 'centre',
        }),
      SITE_IMAGE_OG.maxBytes,
    );
  }

  /** A maior qualidade que cabe no teto; sem nenhuma, a imagem não serve. */
  private async fit(pipeline: () => sharp.Sharp, maxBytes: number): Promise<ProcessedVersion> {
    for (const quality of QUALITIES) {
      const version = await this.jpeg(pipeline(), quality);
      if (version.body.length <= maxBytes) return version;
    }
    throw new SiteImageInvalidError();
  }

  private async jpeg(pipeline: sharp.Sharp, quality: number): Promise<ProcessedVersion> {
    const { data, info } = await pipeline
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { body: data, width: info.width, height: info.height };
  }
}
