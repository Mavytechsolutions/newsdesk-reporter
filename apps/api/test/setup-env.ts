// Runs before any test file: point the app at a separate test database.
import 'dotenv/config';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/mavy_test';
process.env.SMS_PROVIDER = 'console';
process.env.DISABLE_SCHEDULER = '1';
process.env.NODE_ENV = 'test';
process.env.SEED_ADMIN_EMAIL = 'admin@test.mavy';
process.env.SEED_ADMIN_PASSWORD = 'AdminPass12345';
