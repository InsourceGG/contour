import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 15000 } });
