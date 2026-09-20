import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MfaController } from "./mfa.controller";
import { MfaService } from "./mfa.service";
import { ReauthService } from "./reauth.service";
import { MailModule } from "../mail/mail.module";

@Module({
  imports: [
    MailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        signOptions: {
          // `jsonwebtoken`'s types narrow this to a template-literal union
          // (`"15m"`, `"2 days"`, …) that a value read from the environment
          // cannot satisfy at compile time. The cast is the narrow, honest
          // one: an invalid string still throws at sign time, which is where
          // a misconfiguration should surface.
          expiresIn: (config.get<string>("JWT_ACCESS_TTL") ??
            "15m") as unknown as number,
        },
      }),
    }),
  ],
  controllers: [AuthController, MfaController],
  providers: [AuthService, MfaService, ReauthService],
  /**
   * `JwtModule` is exported because the global `JwtAuthGuard` verifies tokens
   * and is constructed outside this module.
   *
   * `MfaService` and `ReauthService` are exported for `UsersModule`, which
   * serves the administrative reset. That is a cross-feature **command** of
   * the kind `users.module.ts` already documents for `AuthService`, and the
   * alternative — `UsersService` writing to `MfaCredential` itself — would be
   * a second writer of a security-critical table.
   *
   * There is no `forwardRef` here and there must not be one: `AuthService`
   * depends on `MfaService`, `MfaService` depends on `ReauthService`, and
   * nothing points back. A cycle would be the first sign that the boundary
   * between "who may have a session" and "what a second factor is" has been
   * lost.
   */
  exports: [AuthService, MfaService, ReauthService, JwtModule],
})
export class AuthModule {}
