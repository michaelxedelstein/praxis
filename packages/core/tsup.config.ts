import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // Workspace + heavy deps stay external; consumers install them.
  external: ["@anthropic-ai/sdk", "@modelcontextprotocol/sdk", "@praxis/shared-types"],
});
