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
    // runtime data & local toolchains never need linting
    ".data/**",
    ".tools/**",
    ".venv/**",
    ".tmp/**",
  ]),
]);

export default eslintConfig;
