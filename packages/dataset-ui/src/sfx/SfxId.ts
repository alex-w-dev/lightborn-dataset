import { sfxCatalogUrl, sfxUrl as buildSfxAssetUrl } from "../vendor/shared-ui/config/game-icons-cdn";

/** Значение = id ассета в S3 `sfx/{id}/original.ogg` */
export const SfxId = {
  UiClick: "sfx_ui_click",
  UiOpen: "sfx_ui_open",
  UiClose: "sfx_ui_close",
  UiHover: "sfx_ui_hover",
  UiError: "sfx_ui_error",
  UiSuccess: "sfx_ui_success",
  UiToast: "sfx_ui_toast",
  UiTab: "sfx_ui_tab",

  MapTeleport: "sfx_map_teleport",
  MapSelect: "sfx_map_select",
  BattleStart: "sfx_battle_start",
  FarmStart: "sfx_farm_start",
  FarmStop: "sfx_farm_stop",

  BattleCountdown: "sfx_battle_countdown",
  BattleVictory: "sfx_battle_victory",
  BattleDefeat: "sfx_battle_defeat",
  BattleDeath: "sfx_battle_death",
  BattleLevelup: "sfx_battle_levelup",
  BattleLoot: "sfx_battle_loot",

  Hit: "sfx_hit",
  HitCrit: "sfx_hit_crit",
  HitMagic: "sfx_hit_magic",
  HitMagicCrit: "sfx_hit_magic_crit",
  HitMiss: "sfx_hit_miss",
  HitShield: "sfx_hit_shield",
  HitReflect: "sfx_hit_reflect",
  DotTick: "sfx_dot_tick",

  CastStartPhys: "sfx_cast_start_phys",
  CastStartMagic: "sfx_cast_start_magic",
  CastStartSong: "sfx_cast_start_song",
  SkillHitPhys: "sfx_skill_hit_phys",
  SkillHitMagic: "sfx_skill_hit_magic",
  SkillHeal: "sfx_skill_heal",
  SkillBuff: "sfx_skill_buff",
  SkillDebuff: "sfx_skill_debuff",
  SkillStun: "sfx_skill_stun",
  SkillToggleOn: "sfx_skill_toggle_on",
  SkillToggleOff: "sfx_skill_toggle_off",
  SkillReject: "sfx_skill_reject",
  PotionUse: "sfx_potion_use",
  Summon: "sfx_summon",

  ItemPickup: "sfx_item_pickup",
  ItemEquip: "sfx_item_equip",
  ItemUnequip: "sfx_item_unequip",
  ItemMove: "sfx_item_move",
  ItemDestroy: "sfx_item_destroy",
  Gold: "sfx_gold",
  EnchantStart: "sfx_enchant_start",
  EnchantSuccess: "sfx_enchant_success",
  EnchantFail: "sfx_enchant_fail",
  EnergyStart: "sfx_energy_start",
  EnergySuccess: "sfx_energy_success",
  EnergyRemove: "sfx_energy_remove",
  ChestOpen: "sfx_chest_open",
  ChestReward: "sfx_chest_reward",

  ShopBuy: "sfx_shop_buy",
  ShopSell: "sfx_shop_sell",
  BlackExchange: "sfx_black_exchange",
  CraftSuccess: "sfx_craft_success",
  CraftFail: "sfx_craft_fail",
  WarehouseIn: "sfx_warehouse_in",
  WarehouseOut: "sfx_warehouse_out",
  AuctionList: "sfx_auction_list",
  AuctionBuy: "sfx_auction_buy",
  AuctionMail: "sfx_auction_mail",
  TradeInvite: "sfx_trade_invite",
  TradeLock: "sfx_trade_lock",
  TradeDone: "sfx_trade_done",
  TradeCancel: "sfx_trade_cancel",

  SkillLearn: "sfx_skill_learn",
  SkillUpgrade: "sfx_skill_upgrade",
  QuestAccept: "sfx_quest_accept",
  QuestProgress: "sfx_quest_progress",
  QuestComplete: "sfx_quest_complete",
  QuestAbandon: "sfx_quest_abandon",
  NpcTalkMale: "sfx_npc_talk_male",
  NpcTalkFemale: "sfx_npc_talk_female",
  NpcTalkNone: "sfx_npc_talk_none",
  PartyInvite: "sfx_party_invite",
  PartyJoin: "sfx_party_join",
  PartyLeave: "sfx_party_leave",
  ChatSend: "sfx_chat_send",
} as const;

export type SfxId = (typeof SfxId)[keyof typeof SfxId];

export const ALL_SFX_IDS: readonly SfxId[] = Object.values(SfxId);

/** UI + боевые хиты — грузим первыми после unlock. */
export const CRITICAL_SFX_IDS: readonly SfxId[] = [
  SfxId.UiClick,
  SfxId.UiOpen,
  SfxId.UiClose,
  SfxId.UiTab,
  SfxId.UiError,
  SfxId.UiSuccess,
  SfxId.UiToast,
  SfxId.Hit,
  SfxId.HitCrit,
  SfxId.HitMagic,
  SfxId.HitMagicCrit,
  SfxId.HitMiss,
  SfxId.HitShield,
  SfxId.BattleStart,
  SfxId.BattleVictory,
  SfxId.BattleDefeat,
  SfxId.BattleDeath,
];

export function sfxUrl(id: SfxId, variant = 1): string {
  return buildSfxAssetUrl(sfxAssetKey(id, variant));
}

/** Публичный JSON: S3 `sfx/catalog.json` — id → число вариантов. */
export type SfxCatalogFile = Record<string, number>;

/**
 * Fallback до загрузки catalog.json (тесты / оффлайн).
 * Источник правды в рантайме — `setActiveSfxCatalog`.
 */
export const SFX_VARIANT_COUNT: Partial<Record<SfxId, number>> = {
  [SfxId.HitMiss]: 3,
  [SfxId.BattleDeath]: 5,
};

let activeSfxCatalog: SfxCatalogFile | null = null;

export function setActiveSfxCatalog(catalog: SfxCatalogFile | null): void {
  activeSfxCatalog = catalog;
}

export function getActiveSfxCatalog(): SfxCatalogFile | null {
  return activeSfxCatalog;
}

export function sfxVariantCount(id: SfxId): number {
  const fromCatalog = activeSfxCatalog?.[id];
  const n = fromCatalog ?? SFX_VARIANT_COUNT[id] ?? 1;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Имя файла без .ogg: base или `base_2`… */
export function sfxAssetKey(id: string, variant = 1): string {
  const v = Math.floor(variant);
  if (v <= 1) return id;
  return `${id}_${v}`;
}

/** `sfx_foo` → variant 1; `sfx_foo_3` → base `sfx_foo`, variant 3. */
export function parseSfxAssetKey(assetKey: string): {
  id: string;
  variant: number;
} {
  const m = /^(.+)_([2-9]|[1-9]\d+)$/.exec(String(assetKey ?? "").trim());
  if (m) return { id: m[1], variant: Number(m[2]) };
  return { id: String(assetKey ?? "").trim(), variant: 1 };
}

export type SfxCatalogEntry = {
  id: SfxId;
  variant: number;
  assetKey: string;
  variantCount: number;
};

/** Каталог для админки: каждый вариант отдельной строкой. */
export function expandSfxCatalog(
  ids: readonly SfxId[] = ALL_SFX_IDS,
  catalog: SfxCatalogFile | null = activeSfxCatalog,
): SfxCatalogEntry[] {
  const out: SfxCatalogEntry[] = [];
  for (const id of ids) {
    const raw = catalog?.[id] ?? SFX_VARIANT_COUNT[id] ?? 1;
    const variantCount =
      Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
    for (let variant = 1; variant <= variantCount; variant++) {
      out.push({
        id,
        variant,
        assetKey: sfxAssetKey(id, variant),
        variantCount,
      });
    }
  }
  return out;
}
