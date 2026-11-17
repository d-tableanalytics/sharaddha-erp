import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { portalOrigin, portalLink } from '../utils/portalUrl.js';

const KEYS = ['APP_BASE_URL', 'EMPLOYEE_PORTAL_URL', 'FRONTEND_URL'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const set = (env) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
};

test('the preferred variable wins over FRONTEND_URL', () => {
  set({ EMPLOYEE_PORTAL_URL: 'https://fms.example.com', FRONTEND_URL: 'https://app.example.com' });
  assert.equal(portalOrigin('EMPLOYEE_PORTAL_URL'), 'https://fms.example.com');
});

test('falls back to FRONTEND_URL when the preferred variable is unset or blank', () => {
  set({ APP_BASE_URL: '  ', FRONTEND_URL: 'https://app.shraddhaimpex.net/' });
  assert.equal(portalOrigin('APP_BASE_URL'), 'https://app.shraddhaimpex.net');
  assert.equal(
    portalLink('EMPLOYEE_PORTAL_URL', '/fms/o2d/orders?open=1'),
    'https://app.shraddhaimpex.net/fms/o2d/orders?open=1',
  );
});

test('never returns a relative link: no origin means no link', () => {
  set({});
  assert.equal(portalOrigin('APP_BASE_URL'), '');
  assert.equal(portalLink('APP_BASE_URL', '/hrms/inbox'), null);
});

test('joins without a double or missing slash', () => {
  set({ APP_BASE_URL: 'https://app.shraddhaimpex.net//' });
  assert.equal(portalLink('APP_BASE_URL', '/hrms/inbox'), 'https://app.shraddhaimpex.net/hrms/inbox');
  assert.equal(portalLink('APP_BASE_URL', 'hrms/inbox'), 'https://app.shraddhaimpex.net/hrms/inbox');
  assert.equal(portalLink('APP_BASE_URL', ''), null);
});
