import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@praxis/shared-types": new URL(
        "../shared-types/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
