import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const port = Number(process.env.PORT ?? 4300);
const app = createApp();

app.listen(port, "127.0.0.1", () => {
  console.info(`Job Search Agent API listening at http://127.0.0.1:${port}`);
});
