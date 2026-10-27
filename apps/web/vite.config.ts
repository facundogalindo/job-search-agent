import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(WEB_DIR, "../..");

export default defineConfig({
  root: WEB_DIR,
  envDir: ROOT_DIR,
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4300",
    },
  },
});
