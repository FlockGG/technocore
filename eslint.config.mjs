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
      /**
       * Folester's state lives in localStorage, which cannot be read during SSR.
       * Every flagged site is the same deliberate shape: read the synchronous
       * external store once on mount, then subscribe for changes. useSyncExternalStore
       * is the idiomatic replacement, but its snapshots must be referentially
       * stable and the store returns freshly built arrays, so adopting it means
       * adding a snapshot cache to the store layer. Kept as a warning so the
       * signal survives for genuinely accidental cascades.
       */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
