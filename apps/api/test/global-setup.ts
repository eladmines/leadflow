import { execSync } from 'node:child_process';

const DEFAULT_TEST_DB = 'postgresql://leadflow:leadflow@localhost:5432/leadflow_test';

/** Applies all migrations to the dedicated test database before the suite runs. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB;
  process.env.TEST_DATABASE_URL = url;
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
