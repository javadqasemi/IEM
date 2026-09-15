import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
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
  controllers: [AuthController],
  providers: [AuthService],
  // `JwtModule` is exported because the global `JwtAuthGuard` verifies tokens
  // and is constructed outside this module.
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
