import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { LocalStorageAdapter, STORAGE } from "./storage";

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      // One place to swap local disk for S3 or Azure Blob — see the note on
      // `StorageAdapter`.
      provide: STORAGE,
      useFactory: (config: ConfigService) => new LocalStorageAdapter(config),
      inject: [ConfigService],
    },
  ],
  exports: [MediaService, STORAGE],
})
export class MediaModule {}
