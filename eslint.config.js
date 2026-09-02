import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** DEV-PROCESS §9 + FR-14: no parseFloat/toFixed; packages/policy has no Date.now(). */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/dev.db",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: "FR-14: amounts are integer paise. Do not use parseFloat.",
        },
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: "FR-14: amounts are integer paise. Do not use toFixed.",
        },
      ],
    },
  },
  {
    files: ["packages/policy/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "packages/policy must not call Date.now(); pass `now` in.",
        },
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: "FR-14: amounts are integer paise. Do not use parseFloat.",
        },
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: "FR-14: amounts are integer paise. Do not use toFixed.",
        },
      ],
    },
  },
);
