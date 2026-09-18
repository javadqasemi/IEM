import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";

/**
 * `AuthModule` is imported because inviting a user issues a token and
 * revoking one kills its sessions — both `AuthService`'s to do.
 *
 * It is a cross-feature **command**, which the architecture allows; the
 * alternative would be `UsersService` writing to `RefreshToken` itself, which
 * is the same table `AuthService` guards with reuse detection. Two writers of a
 * security-critical table is the worse arrangement by a distance.
 *
 * `MailModule` because the controller sends the invitation. Both imports were
 * invisible until F12: with every provider on the root module they resolved
 * from one flat scope, and nothing anywhere recorded that users depend on auth
 * and mail. That the dependency is now *written down* is most of the point of
 * the stage.
 */
@Module({
  imports: [AuthModule, MailModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}