#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ASSET_TYPES } from "./catalog.mjs";
import {
  getAsset,
  reindexEmbeddings,
  searchAssets,
} from "./embeddings.mjs";

async function main() {
  if (process.argv.includes("--reindex")) {
    const result = await reindexEmbeddings();
    console.log(JSON.stringify(result));
    return;
  }

  const server = new Server(
    { name: "dataset-mcp", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_assets",
        description:
          "Semantic search over shared game assets (images, icons, backgrounds, sfx, music) by description/prompt.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            types: {
              type: "array",
              items: { type: "string", enum: ASSET_TYPES },
            },
            limit: { type: "number" },
          },
          required: ["query"],
        },
      },
      {
        name: "get_asset",
        description: "Get one asset document by type and id.",
        inputSchema: {
          type: "object",
          properties: {
            type: { type: "string", enum: ASSET_TYPES },
            id: { type: "string" },
          },
          required: ["type", "id"],
        },
      },
      {
        name: "reindex_assets",
        description:
          "Rebuild local multilingual MiniLM embedding cache for asset descriptions.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    if (name === "search_assets") {
      const hits = await searchAssets(String(args.query ?? ""), {
        types: Array.isArray(args.types) ? args.types.map(String) : undefined,
        limit: args.limit != null ? Number(args.limit) : undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ hits }, null, 2) }],
      };
    }
    if (name === "get_asset") {
      const doc = getAsset(String(args.type ?? ""), String(args.id ?? ""));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(doc ?? { error: "not_found" }, null, 2),
          },
        ],
      };
    }
    if (name === "reindex_assets") {
      const result = await reindexEmbeddings();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
