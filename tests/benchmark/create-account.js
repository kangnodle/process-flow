import http from 'k6/http';
import { administratorCredentials, testAccount } from './account.js';

export const options = { vus: 1, iterations: 1 };
const api = (__ENV.BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '') + '/api/v1';

export function setup() {
  const account = testAccount();
  if (!account) throw new Error('BENCH_MANAGED_ACCOUNT=1 is required');
  const params = { headers: { 'Content-Type': 'application/json' }, redirects: 0, timeout: '10s' };
  const login = http.post(api + '/auth/login', JSON.stringify(administratorCredentials()), params);
  if (login.status !== 200) throw new Error(`Administrator login failed: HTTP ${login.status}`);
  try {
    if (login.json().isAdmin !== true) throw new Error('Account provisioning requires an administrator');
    const created = http.post(api + '/users', JSON.stringify(account), params);
    if (created.status !== 201) throw new Error(`Test account creation failed: HTTP ${created.status}`);
    const user = created.json();
    if (user.email !== account.email || user.name !== account.name || user.isAdmin || !user.active) {
      throw new Error('Created test account does not match the requested account');
    }
    console.log(`Created test account ${user.email} (${user.id})`);
  } finally {
    const logout = http.post(api + '/auth/logout', null, params);
    if (logout.status !== 204) console.warn(`Administrator logout failed: HTTP ${logout.status}`);
  }
}

export default function () {}
