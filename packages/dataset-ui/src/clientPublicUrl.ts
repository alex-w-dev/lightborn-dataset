import { buildPublicAssetUrl } from "@l-fight/shared-ui/config/game-icons-cdn";

/** Постоянные public-ассеты с CDN S3 (`?v=<major>`). */
export function clientPublicUrl(path: string, cacheBust?: number): string {
  return buildPublicAssetUrl(path.replace(/^\//, ""), cacheBust);
}
