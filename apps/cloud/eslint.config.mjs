import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals, ...nextTs,
  // The existing core uses a deliberately structural database boundary.
  { files: ["src/server/db.ts", "src/server/tools.ts", "tests/helpers/fake-db.ts", "tests/unit/tools.test.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
  globalIgnores([".next/**", ".screenshots/**", "next-env.d.ts"]),
]);
