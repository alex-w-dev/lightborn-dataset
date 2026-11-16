import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const datasetApiUrl = process.env.DATASET_API_URL || "http://localhost:3006";

export default defineConfig({
  root: __dirname,
  base: "/dataset/",
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^@l-fight\/shared-ui\/(.*)$/,
        replacement: path.resolve(__dirname, "src/vendor/shared-ui/$1"),
      },
    ],
  },
  server: {
    port: Number(process.env.PORT || 3005),
    fs: {
      allow: [
        path.resolve(__dirname, ".."),
        path.resolve(__dirname, "../.."),
      ],
    },
    proxy: {
      "/api": {
        target: datasetApiUrl,
        changeOrigin: true,
      },
    },
  },
});
