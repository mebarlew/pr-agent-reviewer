import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import n from "eslint-plugin-n";
import pluginPromise from "eslint-plugin-promise";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";

export default defineConfig([
  { ignores: ["node_modules/**"] },
  js.configs.recommended,
  pluginPromise.configs["flat/recommended"],
  unicorn.configs.recommended,
  ...n.configs["flat/mixed-esm-and-cjs"],
  {
    files: ["**/*.js"],
    ignores: ["app/**"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.nodeBuiltin },
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    files: ["app/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },
  {
    // rendererSmokeCheck is stringified and executed in the browser, so the
    // file legitimately references DOM globals.
    files: ["scripts/electron-smoke.cjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    rules: {
      "no-shadow": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // fetch/Response are stable in practice on the supported Node range.
      "n/no-unsupported-features/node-builtins": [
        "error",
        { ignores: ["fetch", "Response"] },
      ],
      // Electron APIs hand us callbacks inside promise chains by design.
      "promise/no-callback-in-promise": ["error", { exceptions: ["callback"] }],
      "promise/always-return": ["error", { ignoreLastCallback: true }],
      // Deliberate repo style: JSON-API null semantics, short conventional
      // names, module-level mutable state, forEach, window in browser code,
      // and globalThis.fetch swapping in tests.
      "unicorn/prevent-abbreviations": "off",
      "unicorn/name-replacements": "off",
      "unicorn/no-null": "off",
      "unicorn/no-top-level-assignment-in-function": "off",
      "unicorn/no-for-each": "off",
      "unicorn/prefer-global-this": "off",
      "unicorn/no-unnecessary-global-this": "off",
      "unicorn/no-global-object-property-assignment": "off",
      "unicorn/import-style": "off",
      "unicorn/no-await-expression-member": "off",
      "unicorn/consistent-boolean-name": "off",
      "unicorn/prefer-early-return": "off",
      "unicorn/no-negated-condition": "off",
      "unicorn/prefer-minimal-ternary": "off",
      "unicorn/prefer-top-level-await": "off",
      "unicorn/prefer-await": "off",
      "unicorn/no-array-reduce": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/require-array-sort-compare": "off",
      "unicorn/no-array-callback-reference": "off",
      "unicorn/prefer-event-target": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/consistent-class-member-order": "off",
      "unicorn/no-declarations-before-early-exit": "off",
      "unicorn/no-computed-property-existence-check": "off",
      // Iterator#toArray needs Node 22; engines allow 20.
      "unicorn/prefer-iterator-to-array": "off",
    },
  },
  {
    // Browser code; Node feature-support checks don't apply. Placed after
    // the shared rules block so it takes precedence.
    files: ["app/**/*.js"],
    rules: {
      "n/no-unsupported-features/node-builtins": "off",
    },
  },
  prettier,
]);
