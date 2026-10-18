// Apply the supplied clinic identity through the normal audited settings API.
// No database seed/reset, patient changes, or software-brand replacement.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const clinicId = args.find((arg) => arg.startsWith('--clinic-id='))?.slice('--clinic-id='.length);
const apply = args.includes('--apply');
const base = (process.env.CLINIC_PROFILE_API_URL || process.env.API_URL || 'http://localhost:3101').replace(/\/$/, '');

async function request(path, token, body, method = 'GET') {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  if (!response.ok || result.success === false) {
    throw new Error(`${method} ${path}: HTTP ${response.status}; ${result.error?.code || 'request failed'}`);
  }
  return result.data;
}

try {
  if (!clinicId) throw new Error('Specify --clinic-id=<expected clinic UUID>. Default is preview; add --apply to save.');
  let token = process.env.CLINIC_PROFILE_ACCESS_TOKEN;
  if (!token) {
    const identifier = process.env.CLINIC_PROFILE_LOGIN;
    const password = process.env.CLINIC_PROFILE_PASSWORD;
    if (!identifier || !password) throw new Error('Provide CLINIC_PROFILE_ACCESS_TOKEN or CLINIC_PROFILE_LOGIN and CLINIC_PROFILE_PASSWORD through environment variables.');
    const login = await request('/auth/login', null, { identifier, password }, 'POST');
    token = login.accessToken;
    if (!token) throw new Error('Login needs additional verification. Use an authenticated access token.');
  }
  const current = await request('/clinic', token);
  if (current.id !== clinicId) throw new Error('Authenticated clinic does not match --clinic-id. No changes made.');

  const profilePath = resolve(root, 'clinic/smc-health-urganch/profile.json');
  const profile = JSON.parse(await readFile(profilePath, 'utf8'));
  const logo = await readFile(resolve(dirname(profilePath), profile.logoFile));
  const logoUrl = `data:image/png;base64,${logo.toString('base64')}`;
  if (logoUrl.length > 800_000) throw new Error('Logo exceeds the clinic profile limit.');
  const patch = {
    name: profile.name,
    legalName: profile.legalName,
    phone: profile.phone,
    address: profile.address,
    logoUrl,
  };
  console.log(JSON.stringify({ clinicId, mode: apply ? 'apply' : 'preview', name: patch.name, phone: patch.phone, address: patch.address, logoBytes: logo.length }));
  if (apply) {
    await request('/clinic', token, patch, 'PATCH');
    await request('/clinic/settings', token, { receipt: profile.receipt }, 'PATCH');
    const saved = await request('/clinic', token);
    const settings = await request('/clinic/settings', token);
    if (Object.entries(patch).some(([key, value]) => saved[key] !== value)
      || Object.entries(profile.receipt).some(([key, value]) => settings.receipt?.[key] !== value)) {
      throw new Error('Profile verification failed. Check the saved clinic settings before retrying.');
    }
    console.log('Clinic identity and receipt logo settings saved and verified.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
