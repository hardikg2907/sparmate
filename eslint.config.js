import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "data/**", "container/**", "package-lock.json"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["src/server/**/*.ts", "src/shared/**/*.ts", "scripts/**/*.{ts,mjs}", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/web/public/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    // These scripts drive a browser and run page code through puppeteer, so they use both sets of globals.
    files: ["scripts/e2e/**/*.mjs", "scripts/smoke-ui.mjs", "src/web/dev/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      // A leading underscore marks a deliberately ignored binding (skipped tuple slots, omitted object keys).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      // Best-effort cleanup (kill, unlink, close) is meant to ignore failures.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      // Test doubles stand in for SDK and browser objects whose full types are not worth reproducing.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettier,
);
