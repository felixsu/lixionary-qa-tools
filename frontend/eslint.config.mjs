import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Typing debt, not correctness — demoted to warnings so errors can gate
      // CI at zero while the warning count ratchets down over time (CI runs
      // with --max-warnings pinned to the current baseline).
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow the destructure-to-omit pattern ({ omitted, ...rest }) and
      // deliberate _-prefixed unused bindings.
      "@typescript-eslint/no-unused-vars": ["warn", {
        ignoreRestSiblings: true,
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      // Mount-initialization setState is a pervasive, intentional pattern in
      // this codebase (load-from-storage gates, derived-state reseeding).
      "react-hooks/set-state-in-effect": "warn",
      // Flags forward references between sibling callbacks (a closure calling
      // a function declared later in the component) — runtime-safe, since
      // nothing invokes them during initialization. Effects that ran into it
      // have been relocated below their callees; the rest is style.
      "react-hooks/immutability": "warn",
    },
  },
]);

export default eslintConfig;
