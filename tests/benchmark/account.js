import crypto from 'k6/crypto';
import { benchmarkRunDescription } from './seed-project.js';

export function administratorCredentials() {
  return { email: __ENV.BENCH_EMAIL, password: __ENV.BENCH_PASSWORD };
}

export function testAccount() {
  if (__ENV.BENCH_MANAGED_ACCOUNT !== '1') return null;
  if (!benchmarkRunDescription()) throw new Error('BENCH_RUN_ID is required for a managed test account');
  if (!__ENV.BENCH_PASSWORD) throw new Error('BENCH_PASSWORD is required for account provisioning');
  return {
    email: `k6-${__ENV.BENCH_RUN_ID.toLowerCase()}@benchmark.invalid`,
    name: `k6-benchmark-account-${__ENV.BENCH_RUN_ID}`,
    password: crypto.hmac('sha256', __ENV.BENCH_PASSWORD, `process-flow-benchmark-${__ENV.BENCH_RUN_ID}`, 'hex'),
  };
}

export function benchmarkCredentials() {
  const account = testAccount();
  return account ? { email: account.email, password: account.password } : administratorCredentials();
}
