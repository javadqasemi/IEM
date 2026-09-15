import { Global, Module } from "@nestjs/common";
import { MailService } from "./mail.service";

/**
 * Global because four unrelated modules send mail (auth, users, applications,
 * content review) and threading one stateless service through each of their
 * imports buys nothing.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
