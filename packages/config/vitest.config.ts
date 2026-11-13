import { defineConfig } from "vitest/config";

const config = defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

export { config };
