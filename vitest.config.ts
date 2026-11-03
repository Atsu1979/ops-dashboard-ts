import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts", "src/web/api.ts"],
      exclude: ["src/server/main.ts"], // process entry point; exercised by `npm run smoke`
      reporter: ["text", "json-summary"],
    },
  },
});
