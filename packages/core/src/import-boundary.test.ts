import { describe, it, expect, beforeAll } from "vitest";
import { ESLint } from "eslint";
import * as fs from "fs";
import * as path from "path";

// Absolute path to the root of the repository
const ROOT_DIR = "/Users/kashyap/ProjectsFromOldMac/OldCompProjects/WebstormProjects/kash-spending-tracker";

describe("M0 import-boundary rule", () => {
  let eslint;

  beforeAll(async () => {
    // Read the config file directly
    const eslintConfigPath = path.join(ROOT_DIR, "eslint.config.ts");
    if (!fs.existsSync(eslintConfigPath)) {
      throw new Error(`ESLint config not found at ${eslintConfigPath}`);
    }
    
    // Evaluate the config (it's a TypeScript/JS module that exports default)
    const configModule = await import(`file://${eslintConfigPath}`);
    eslint = new ESLint({
      fix: false,
      baseConfig: Array.isArray(configModule.default) ? configModule.default : [configModule.default],
    });
  });

  it("should report an error when importing 'next' in packages/core", async () => {
    const code = "import 'next'\n";
    const results = await eslint.lintText(code, {
      filePath: path.join(ROOT_DIR, "packages/core/src/bad-import.ts"),
    });

    expect(results).toHaveLength(1);
    expect(results[0].errorCount).toBeGreaterThan(0);
    
    const messages = results[0].messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toHaveProperty("ruleId", "@typescript-eslint/no-restricted-imports");
    expect(messages[0].message).toContain("packages/core must not import from next");
    expect(messages[0]).toHaveProperty("severity", 2); // 2 = error
  });

  it("should pass when importing clean code in packages/core", async () => {
    const code = "export const hello = 'world'\n";
    const results = await eslint.lintText(code, {
      filePath: path.join(ROOT_DIR, "packages/core/src/clean-file.ts"),
    });

    expect(results).toHaveLength(1);
    expect(results[0].errorCount).toBe(0);
    expect(results[0].warningCount).toBe(0);
  });
});
