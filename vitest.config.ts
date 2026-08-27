import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node", coverage: { reporter: ["text", "json"] } },
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
});
