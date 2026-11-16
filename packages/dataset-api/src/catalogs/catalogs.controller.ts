import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from "@nestjs/common";
import {
  AssetImageRow,
  CatalogKey,
  CatalogsService,
} from "./catalogs.service";

@Controller("catalogs")
export class CatalogsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get()
  list() {
    return { catalogs: this.catalogs.listKeys() };
  }

  @Get(":key")
  getAll(@Param("key") key: CatalogKey) {
    return this.catalogs.getAll(key);
  }

  @Get(":key/:id")
  getOne(@Param("key") key: CatalogKey, @Param("id") id: string) {
    return this.catalogs.getOne(key, id);
  }

  @Post(":key")
  upsert(@Param("key") key: CatalogKey, @Body() body: AssetImageRow) {
    return this.catalogs.upsert(key, body);
  }

  @Delete(":key/:id")
  async remove(@Param("key") key: CatalogKey, @Param("id") id: string) {
    await this.catalogs.remove(key, id);
    return { ok: true };
  }
}
