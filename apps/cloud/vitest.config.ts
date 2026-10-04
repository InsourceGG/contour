import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
export default defineConfig({ resolve: { alias: { 'server-only': fileURLToPath(new URL('./tests/helpers/server-only.ts', import.meta.url)), '@': fileURLToPath(new URL('./src', import.meta.url)) } }, test: { include: ['tests/**/*.test.ts'], testTimeout: 15000 } });
