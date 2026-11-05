import { defineConfig } from 'vitest/config';

// Les tests qui touchent la base vident ses tables : ils tournent les uns après les autres.
export default defineConfig({ test: { fileParallelism: false } });
