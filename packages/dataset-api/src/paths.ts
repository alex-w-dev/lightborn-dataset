import path from "node:path";

/** packages/dataset/src/generated — общий ассет-датасет. */
export function assetGeneratedDir(): string {
  return path.resolve(__dirname, "../../dataset/src/generated");
}

export function assetGeneratedFile(name: string): string {
  return path.join(assetGeneratedDir(), name);
}

/** @deprecated → assetGeneratedDir */
export function generatedDir(): string {
  return assetGeneratedDir();
}

/** @deprecated → assetGeneratedFile */
export function generatedFile(name: string): string {
  return assetGeneratedFile(name);
}
