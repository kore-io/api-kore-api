import { Global, Module } from '@nestjs/common';
import { EMAIL_SENDER } from './application/email-sender.port';
import { SmtpEmailSender } from './infrastructure/smtp-email-sender';

@Global()
@Module({
  providers: [{ provide: EMAIL_SENDER, useClass: SmtpEmailSender }],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
