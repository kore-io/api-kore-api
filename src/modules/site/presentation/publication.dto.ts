import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';
import { DATE_ONLY } from '../../access/presentation/weddings.dto';
import type { PublicationResult } from '../application/publish-wedding.use-case';

/** A data de saída do ar (Publicação RN04). */
export class PublishWeddingBody {
  /** `AAAA-MM-DD`: do dia seguinte ao casamento até 12 meses depois dele. */
  @ApiProperty({ example: '2027-02-14' })
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  endDate: string;
}

export class PublicationResponse {
  @ApiProperty({ enum: ['published'] }) status: 'published';
  @ApiProperty({ format: 'date-time' }) publishedAt: string;
  @ApiProperty({ example: '2027-02-14' }) endDate: string;
  @ApiProperty({ enum: ['courtesy'] }) publicationSource: 'courtesy';

  static from({ result }: { result: PublicationResult }): PublicationResponse {
    return { ...result, publishedAt: result.publishedAt.toISOString() };
  }
}
