import { access, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file is generated only in the independent build. Never put these headers
// in shared public/: the legacy Sites host has its own embedding/auth requirements.
export const independentSecurityHeaders = `/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; media-src 'self' data: blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000
`;

export async function writeIndependentSecurityHeaders() {
  const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = resolve(project, 'dist-independent', 'client');
  try { await access(resolve(directory, 'index.html')); }
  catch { throw new Error('Build the independent frontend before generating its static security headers.'); }
  const output = resolve(directory, '_headers');
  await writeFile(output, independentSecurityHeaders, 'utf8');
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeIndependentSecurityHeaders();
  console.log('Independent static security headers generated.');
}
