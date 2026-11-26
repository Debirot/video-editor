import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Scripts de desenvolvimento rodam no Node.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // src/engine roda no Worker: não pode importar React nem painéis.
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom", "react/*"], message: "src/engine não importa React." },
            { group: ["@/panels/*", "@/app/*", "@/components/*", "**/panels/**"], message: "src/engine não importa a interface." },
          ],
        },
      ],
    },
  },
  {
    // src/project é TypeScript puro: sem React e sem Tauri.
    files: ["src/project/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["react", "react-dom", "@tauri-apps/*", "@/engine/*", "@/panels/*"], message: "src/project é TypeScript puro." }] },
      ],
    },
  },
);
