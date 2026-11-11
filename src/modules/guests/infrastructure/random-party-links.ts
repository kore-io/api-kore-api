import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppConfigService } from '../../../shared/config/app-config.service';
import type { PartyLinks } from '../application/ports/party-links.port';

/** 16 bytes aleatórios em base64url: 22 caracteres, 128 bits (Grupos RN11). */
@Injectable()
export class RandomPartyLinks implements PartyLinks {
  private readonly siteUrl: string;

  constructor(config: AppConfigService) {
    this.siteUrl = config.get({ key: 'SITE_URL' }).replace(/\/+$/, '');
  }

  newToken(): string {
    return randomBytes(16).toString('base64url');
  }

  url({ slug, token }: { slug: string | null; token: string }): string | null {
    return slug ? `${this.siteUrl}/${slug}/grupo/${token}` : null;
  }
}
