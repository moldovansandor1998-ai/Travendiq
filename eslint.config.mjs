import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      // Server Components and Server Actions intentionally calculate request-
      // time timestamps/identifiers; these are not client render side effects.
      "react-hooks/purity": "off",
      // Existing mount effects synchronize browser-only state such as camera,
      // map and mobile-menu state.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "playwright-report/**", "test-results/**"]),
]);
