// Applies all pending database migrations. Run with: npm run db:migrate
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'path';
import { config } from '../config';

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  await migrate(drizzle(pool), { migrationsFolder: path.join(__dirname, '..', '..', 'drizzle') });
  await pool.end();
  console.log('✔ Database is up to date');
}

main().catch((e) => {
  console.error('✖ Migration failed:', e.message);
  process.exit(1);
});
