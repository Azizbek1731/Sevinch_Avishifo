// Generates RS256 keypair for JWT signing into .keys/ (gitignored).
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keysDir = join(root, '.keys');
const privPath = join(keysDir, 'jwt-private.pem');
const pubPath = join(keysDir, 'jwt-public.pem');

if (existsSync(privPath) && !process.argv.includes('--force')) {
  console.log('Keys already exist at .keys/ — use --force to regenerate.');
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

mkdirSync(keysDir, { recursive: true });
writeFileSync(privPath, privateKey, { mode: 0o600 });
writeFileSync(pubPath, publicKey);
console.log('Generated .keys/jwt-private.pem and .keys/jwt-public.pem');
