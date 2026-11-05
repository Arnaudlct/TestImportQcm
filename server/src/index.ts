import { createApp } from './app';
import { requireProfessor } from './auth';
import { createPool } from './db';

const pool = createPool();
const port = Number(process.env.PORT ?? 3000);

createApp(pool, requireProfessor(pool)).listen(port, () => {
  console.log(`API Corelab sur http://localhost:${port}`);
});
