import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  resolve: {
    alias: {
      "@pluto-agent-platform/contracts": path.resolve(
        __dirname,
        "packages/contracts/src/index.ts",
      ),
      "@pluto-agent-platform/control-plane": path.resolve(
        __dirname,
        "packages/control-plane/src/index.ts",
      ),
      "@pluto-agent-platform/server": path.resolve(
        __dirname,
        "packages/server/src/index.ts",
      ),
    },
  },
  test: {
    include: ["packages/**/src/**/*.test.ts"],
    exclude: [".local/**", "**/node_modules/**"],
  },
})
