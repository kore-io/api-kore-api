import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
import {
  SITE_IMAGE_MAX_BYTES,
  SITE_IMAGE_UPLOAD_CONTENT_TYPES,
  type SiteImageUploadContentType,
} from '../domain/site-image';

export class SiteImageUploadAuthorizationBody {
  /** O app sempre envia JPEG (RN03). */
  @ApiProperty({ enum: SITE_IMAGE_UPLOAD_CONTENT_TYPES, example: 'image/jpeg' })
  @IsIn(SITE_IMAGE_UPLOAD_CONTENT_TYPES)
  contentType: SiteImageUploadContentType;

  /** De 1 byte a 4 MB (RN03). */
  @ApiProperty({ minimum: 1, maximum: SITE_IMAGE_MAX_BYTES, example: 1048576 })
  @IsInt()
  @Min(1)
  @Max(SITE_IMAGE_MAX_BYTES)
  sizeBytes: number;
}

class SiteImageUploadHeaders {
  @ApiProperty({ example: 'image/jpeg' }) 'Content-Type': string;
  /** Informativo: o navegador tira o tamanho do Blob e não deixa definir este cabeçalho. */
  @ApiProperty({ example: '1048576' }) 'Content-Length': string;
}

export class SiteImageUploadAuthorizationResponse {
  @ApiProperty({ format: 'uuid' }) imageId: string;
  /** PUT pré-assinado do original, no bucket privado, válido por 5 minutos (RN04). */
  @ApiProperty() uploadUrl: string;
  @ApiProperty({ enum: ['PUT'] }) method: 'PUT';
  @ApiProperty({ type: SiteImageUploadHeaders }) headers: SiteImageUploadHeaders;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}

export class ConfirmSiteImageBody {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  imageId: string;
}

/** A imagem pronta (S4 RN05); a og.jpg não vem: é só da prévia do link. */
export class SiteImageResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['ready'] }) status: 'ready';
  /** display.jpg, até 2560 px, pelo CDN. */
  @ApiProperty() url: string;
  /** thumb.jpg, 640 px, pelo CDN. */
  @ApiProperty() thumbUrl: string;
  @ApiProperty() width: number;
  @ApiProperty() height: number;
}
