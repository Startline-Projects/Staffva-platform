import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // One-off operational scripts (migration appliers, load tests, seeders).
    // They are not part of the deployed app and are excluded from the build's
    // type-check too; linting them adds noise without protecting production.
    "scripts/**",
  ]),
]);

export default eslintConfig;
