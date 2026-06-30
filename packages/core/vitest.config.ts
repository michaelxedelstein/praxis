import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Resolve the workspace types package to its source so tests don't need a
      // prior build of dependencies.
      "@praxis/shared-types": new URL(
        "../shared-types/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
