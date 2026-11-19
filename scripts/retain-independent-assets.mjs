import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const releaseFile = 'asset-releases.json';
const retainedReleases = 3;
const maxFilesPerRelease = 250;
const maxAssetBytes = 25 * 1024 * 1024;
const assetName = /^[a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8}\.(?:js|mjs|css)$/;

async function assetFiles(directory) {
  const entries = await readdir(join(directory, 'assets'), { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && assetName.test(entry.name)).map(entry => entry.name).sort();
}

function readReleases(value) {
  if (value?.version !== 1 || !Array.isArray(value.releases) || value.releases.length > retainedReleases + 1 ||
      value.releases.some(files => !Array.isArray(files) || !files.length || files.length > maxFilesPerRelease ||
        files.some(file => typeof file !== 'string' || !assetName.test(file)))) {
    throw new Error('Matrix returned an invalid static asset release list.');
  }
  return value.releases.map(files => [...new Set(files)].sort());
}

async function currentReleaseList(origin, fetcher) {
  const response = await fetcher(new URL('/' + releaseFile, origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: { 'Cache-Control': 'no-cache' },
  });
  // Earlier versions have no list. Workers' SPA fallback served HTML for it.
  if (response.status === 404 || (response.ok && response.headers.get('content-type')?.startsWith('text/html'))) {
    await response.body?.cancel();
    return [];
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new Error(`Could not check the live Matrix asset release list (HTTP ${response.status}).`);
  }
  return readReleases(await response.json());
}

export async function retainIndependentAssets({ directory, origin, seedDirectories = [], fetcher = fetch }) {
  const upstream = new URL(origin);
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password) {
    throw new Error('Use the configured public HTTPS Matrix origin for retained assets.');
  }
  const manifestPath = join(directory, releaseFile);
  const staged = await readFile(manifestPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const available = new Set(await assetFiles(directory));
  const current = staged ? readReleases(JSON.parse(staged))[0] : [...available];
  if (!current?.length || current.length > maxFilesPerRelease || current.some(file => !available.has(file))) {
    throw new Error('Build the independent Matrix frontend before retaining previous releases.');
  }

  const seeds = await Promise.all(seedDirectories.map(assetFiles));
  if (seeds.some(files => files.length > maxFilesPerRelease)) {
    throw new Error('A seeded Matrix release contains too many assets.');
  }
  const live = await currentReleaseList(upstream, fetcher);
  const releases = [current];
  for (const files of [...live, ...seeds]) {
    if (releases.length >= retainedReleases + 1) break;
    if (files.length && !releases.some(release => release.join(' ') === files.join(' '))) releases.push(files);
  }

  const required = new Set(releases.flat());
  for (const filename of required) {
    if (available.has(filename)) continue;
    const output = join(directory, 'assets', filename);
    const localIndex = seeds.findIndex(files => files.includes(filename));
    if (localIndex >= 0) {
      await copyFile(join(seedDirectories[localIndex], 'assets', filename), output);
      continue;
    }
    const response = await fetcher(new URL(`/assets/${filename}`, upstream), {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    const contentType = response.headers.get('content-type') || '';
    const expectedType = filename.endsWith('.css') ? /^text\/css\b/i : /javascript|ecmascript/i;
    if (!response.ok || !expectedType.test(contentType) || Number(response.headers.get('content-length')) > maxAssetBytes) {
      throw new Error(`Previous Matrix asset ${filename} could not be retrieved as ${filename.endsWith('.css') ? 'CSS' : 'JavaScript'}.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > maxAssetBytes) throw new Error(`Invalid size for Matrix asset ${filename}.`);
    await writeFile(output, bytes);
  }
  await writeFile(manifestPath, JSON.stringify({ version: 1, releases }) + '\n');
  return { retainedFiles: required.size - current.length, builds: releases.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = JSON.parse(await readFile(join(root, 'independent/wrangler.json'), 'utf8'));
  const result = await retainIndependentAssets({
    directory: join(root, 'dist-independent/client'),
    origin: config.vars.APP_URL,
    // Built release directories from before the first asset manifest, newest first.
    seedDirectories: process.argv.slice(2).map(directory => resolve(directory)),
  });
  console.log(`Prepared ${result.builds} Matrix asset sets (${result.retainedFiles} cached files from previous releases).`);
}
