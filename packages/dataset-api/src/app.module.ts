import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CatalogsController } from "./catalogs/catalogs.controller";
import { CatalogsService } from "./catalogs/catalogs.service";
import { HealthController } from "./health.controller";
import { IconsController } from "./icons/icons.controller";
import { LocalGameIconsController } from "./icons/local-game-icons.controller";
import { IconService } from "./icons/icon.service";
import { S3Service } from "./s3/s3.service";
import { SfxController } from "./sfx/sfx.controller";
import { SfxService } from "./sfx/sfx.service";
import { GameIconsController } from "./game-icons/game-icons.controller";
import { GameIconsService } from "./game-icons/game-icons.service";
import { IconPathResolver } from "./icons/icon-path.resolver";
import { AdminController } from "./admin/admin.controller";
import { AdminEntitiesService } from "./admin/admin-entities.service";
import { AssetEmbeddingsService } from "./admin/asset-embeddings.service";
import { DatasetSearchService } from "./admin/dataset-search.service";
import { EntityLocalImagesController } from "./entities/entity-local-images.controller";
import { AdminMonsterLocalImagesService } from "./entities/monster-local-images.service";
import { AdminNpcLocalImagesService } from "./entities/npc-local-images.service";
import { MusicController } from "./music/music.controller";
import { AdminMusicService } from "./music/music-admin.service";
import { MusicCatalogService } from "./music/music-catalog.service";
import { BackgroundsController } from "./backgrounds/backgrounds.controller";
import { AdminBackgroundsService } from "./backgrounds/backgrounds-admin.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
    }),
  ],
  controllers: [
    HealthController,
    CatalogsController,
    IconsController,
    LocalGameIconsController,
    SfxController,
    GameIconsController,
    AdminController,
    EntityLocalImagesController,
    MusicController,
    BackgroundsController,
  ],
  providers: [
    CatalogsService,
    S3Service,
    IconService,
    IconPathResolver,
    SfxService,
    GameIconsService,
    DatasetSearchService,
    AssetEmbeddingsService,
    AdminEntitiesService,
    AdminMonsterLocalImagesService,
    AdminNpcLocalImagesService,
    MusicCatalogService,
    AdminMusicService,
    AdminBackgroundsService,
  ],
})
export class AppModule {}
