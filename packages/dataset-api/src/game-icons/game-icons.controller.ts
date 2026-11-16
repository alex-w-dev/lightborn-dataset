import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import { GameIconsService } from "./game-icons.service";

@Controller("game-icons")
export class GameIconsController {
  constructor(private readonly gameIcons: GameIconsService) {}

  @Get("raw")
  listRaw() {
    return this.gameIcons.listRaw();
  }

  @Post("from-clipboard")
  fromClipboard(@Body() body: Record<string, unknown>) {
    return this.gameIcons.fromClipboard(body as never);
  }

  @Post("raw")
  saveRaw(@Body() body: Record<string, unknown>) {
    return this.gameIcons.saveRaw(body as never);
  }

  @Post("raw/apply")
  applyRaw(@Body() body: { icon?: string }) {
    return this.gameIcons.applyRawAsIs(String(body?.icon ?? ""));
  }

  @Post("transform")
  transform(
    @Body() body: { icon?: string; op?: "flipHorizontal" | "rotate180" },
  ) {
    return this.gameIcons.transformLocal(
      String(body?.icon ?? ""),
      body?.op as "flipHorizontal" | "rotate180",
    );
  }

  @Delete("raw/:icon")
  deleteRaw(@Param("icon") icon: string) {
    return this.gameIcons.deleteRaw(icon);
  }

  @Get("pending-sync")
  pendingSync() {
    return this.gameIcons.listPendingSync();
  }

  @Delete("pending-sync/:icon")
  clearPending(@Param("icon") icon: string) {
    return this.gameIcons.clearPendingSyncIcon(icon);
  }

  @Get("need-local-update")
  needLocal() {
    return this.gameIcons.listNeedLocalUpdate();
  }

  @Put("need-local-update")
  writeNeedLocal(@Body() body: { icons?: string[] }) {
    return this.gameIcons.writeNeedLocalUpdateIconsList(body?.icons ?? []);
  }

  @Post("apply")
  apply(@Body() body: Record<string, unknown>) {
    return this.gameIcons.apply(body as never);
  }

  @Get("retouch/raw")
  retouchRaw() {
    return this.gameIcons.listRetouchRaw();
  }

  @Post("retouch/raw")
  saveRetouchRaw(@Body() body: Record<string, unknown>) {
    return this.gameIcons.saveRetouchRaw(body as never);
  }

  @Post("retouch/raw/apply")
  applyRetouchRaw(@Body() body: { icon?: string }) {
    return this.gameIcons.applyRetouchRaw(String(body?.icon ?? ""));
  }

  @Post("retouch/from-clipboard")
  retouchClipboard(@Body() body: Record<string, unknown>) {
    return this.gameIcons.fromRetouchClipboard(body as never);
  }

  @Get("retouch/pending-sync")
  retouchPending() {
    return this.gameIcons.listRetouchPendingSync();
  }

  @Delete("retouch/pending-sync/:icon")
  clearRetouchPending(@Param("icon") icon: string) {
    return this.gameIcons.clearRetouchPendingSyncIcon(icon);
  }

  @Get("retouch/need-local-update")
  retouchNeedLocal() {
    return this.gameIcons.listRetouchNeedLocalUpdate();
  }

  @Get("retouch/updated-locally")
  retouchUpdatedLocally() {
    return this.gameIcons.listRetouchUpdatedLocally();
  }

  @Post("retouch/transform")
  retouchTransform(
    @Body() body: { icon?: string; op?: "flipHorizontal" | "rotate180" },
  ) {
    return this.gameIcons.transformRetouchLocal(
      String(body?.icon ?? ""),
      body?.op as "flipHorizontal" | "rotate180",
    );
  }

  @Post("retouch/apply")
  retouchApply(@Body() body: Record<string, unknown>) {
    return this.gameIcons.applyRetouch(body as never);
  }
}
