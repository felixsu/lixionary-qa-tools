import { defineConfig } from "vitest/config";

// Standalone unit-test harness (flow runner scheduling logic). Deliberately
// not integrated with Next's build — see AGENTS.md.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
