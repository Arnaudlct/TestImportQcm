import pg from 'pg';

export const DEFAULT_DATABASE_URL = 'postgres://corelab:corelab@localhost:5434/corelab';

export function createPool(connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL) {
  return new pg.Pool({ connectionString });
}
