import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type SearchHit = {
  type: string;
  id: string;
  text: string;
  score: number;
  meta?: Record<string, unknown>;
};

type EmbeddingsModule = {
  searchAssets: (
    query: string,
    opts?: { types?: string[]; limit?: number },
  ) => Promise<SearchHit[]>;
  reindexEmbeddings: () => Promise<{
    count: number;
    updated: number;
    model: string;
  }>;
};

/** Debounced multilingual MiniLM reindex + in-process semantic search. */
@Injectable()
export class AssetEmbeddingsService {
  private readonly logger = new Logger(AssetEmbeddingsService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private pending = false;
  private modPromise: Promise<EmbeddingsModule> | null = null;

  private embeddingsPath(): string {
    return path.resolve(__dirname, "../../../dataset-mcp/src/embeddings.mjs");
  }

  private indexScriptPath(): string {
    return path.resolve(__dirname, "../../../dataset-mcp/src/index.mjs");
  }

  private loadModule(): Promise<EmbeddingsModule> {
    if (!this.modPromise) {
      // tsc CJS переписывает import() в require(); обходим через Function.
      const dynImport = new Function(
        "u",
        "return import(u)",
      ) as (u: string) => Promise<EmbeddingsModule>;
      this.modPromise = dynImport(pathToFileURL(this.embeddingsPath()).href);
    }
    return this.modPromise;
  }

  /** Schedule rebuild after asset description changes. */
  scheduleReindex(delayMs = 2000): void {
    this.pending = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  /** Run embeddings reindex now (admin search reindex button). */
  async reindexNow(): Promise<{
    count: number;
    updated: number;
    model: string;
  } | null> {
    try {
      const mod = await this.loadModule();
      const result = await mod.reindexEmbeddings();
      this.logger.log(
        `embeddings reindex: ${JSON.stringify(result)}`,
      );
      return result;
    } catch (err) {
      this.logger.error(
        `embeddings reindex failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  async search(
    query: string,
    opts: { types?: string[]; limit?: number } = {},
  ): Promise<SearchHit[]> {
    const mod = await this.loadModule();
    return mod.searchAssets(query, opts);
  }

  private async flush(): Promise<void> {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.pending = false;
    this.running = this.runOnce().finally(() => {
      this.running = null;
      if (this.pending) this.scheduleReindex(500);
    });
    await this.running;
  }

  private async runOnce(): Promise<void> {
    const script = this.indexScriptPath();
    const node = process.execPath;
    try {
      const { stdout, stderr } = await execFileAsync(
        node,
        [script, "--reindex"],
        {
          cwd: path.dirname(script),
          timeout: 30 * 60 * 1000,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env },
        },
      );
      const line = String(stdout || "").trim();
      if (line) this.logger.log(`embeddings reindex: ${line}`);
      if (stderr?.trim()) this.logger.warn(stderr.trim());
    } catch (err) {
      this.logger.error(
        `embeddings reindex failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
