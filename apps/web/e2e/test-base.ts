import { test as base } from '@playwright/test';

/**
 * Per-worker synthetic client IP so repeated logins across the suite don't
 * trip the API's per-IP auth throttle (API runs behind `trust proxy`).
 */
const workerIp = `10.77.${process.pid % 250}.${Math.floor(Math.random() * 250) + 1}`;

export const test = base.extend({});
test.use({ extraHTTPHeaders: { 'x-forwarded-for': workerIp } });

export { expect } from '@playwright/test';
