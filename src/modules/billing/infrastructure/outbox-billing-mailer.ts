import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  EMAIL_OUTBOX,
  type EmailOutbox,
} from '../../../shared/email/application/email-outbox.port';
import type {
  BillingMailer,
  PaymentConfirmedNotice,
  PixExpiredNotice,
  RefundCompletedNotice,
  EndDateSoonNotice,
  GraceNotice,
  SiteExpiredNotice,
} from '../application/ports/billing-mailer.port';
import {
  endDateSoonEmail,
  graceEmail,
  paymentConfirmedEmail,
  pixExpiredEmail,
  refundCompletedEmail,
  siteExpiredEmail,
} from './emails/billing.email';

/** Cobrança e publicação, na Área do Casal (página 21). */
const BILLING_PATH = '/app/cobranca';

@Injectable()
export class OutboxBillingMailer implements BillingMailer {
  private readonly appUrl: string;

  constructor(
    @Inject(EMAIL_OUTBOX) private readonly outbox: EmailOutbox,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' });
  }

  async paymentConfirmed({ notice }: { notice: PaymentConfirmedNotice }): Promise<void> {
    const url = new URL(BILLING_PATH, this.appUrl).toString();
    await this.outbox.enqueue({
      message: paymentConfirmedEmail({ notice, url }),
      priority: 'default',
    });
  }

  async pixExpired({ notice }: { notice: PixExpiredNotice }): Promise<void> {
    const url = new URL(BILLING_PATH, this.appUrl).toString();
    await this.outbox.enqueue({ message: pixExpiredEmail({ notice, url }), priority: 'default' });
  }

  async refundCompleted({ notice }: { notice: RefundCompletedNotice }): Promise<void> {
    const url = new URL(BILLING_PATH, this.appUrl).toString();
    await this.outbox.enqueue({
      message: refundCompletedEmail({ notice, url }),
      priority: 'default',
    });
  }

  async endDateSoon({ notice }: { notice: EndDateSoonNotice }): Promise<void> {
    await this.outbox.enqueue({
      message: endDateSoonEmail({ notice, url: this.billingUrl() }),
      priority: 'default',
    });
  }

  async graceStarted({ notice }: { notice: GraceNotice }): Promise<void> {
    await this.outbox.enqueue({
      message: graceEmail({ notice, url: this.billingUrl() }),
      priority: 'default',
    });
  }

  async siteExpired({ notice }: { notice: SiteExpiredNotice }): Promise<void> {
    await this.outbox.enqueue({
      message: siteExpiredEmail({ notice, url: this.billingUrl() }),
      priority: 'default',
    });
  }

  private billingUrl(): string {
    return new URL(BILLING_PATH, this.appUrl).toString();
  }
}
