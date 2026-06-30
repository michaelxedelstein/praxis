import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // Bundle the workspace packages into the server output so the Docker image
  // only needs the server's own runtime deps installed.
  noExternal: [
    "@praxis/core",
    "@praxis/transport",
    "@praxis/bridge-adapter",
    "@praxis/voice-elevenlabs",
    "@praxis/shared-types",
  ],
});
