import { Global, Module } from '@nestjs/common';
import { OBJECT_STORAGE } from './application/object-storage.port';
import { S3ObjectStorage } from './infrastructure/s3-object-storage';

/** Armazenamento de arquivos (Imagens do site; a Galeria da F8 reaproveita). */
@Global()
@Module({
  providers: [{ provide: OBJECT_STORAGE, useClass: S3ObjectStorage }],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
