import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const forbidden = /(^|\/)(AGENTS\.md|CODEX_PROGRESS\.md|\.codex|ux-audit\.local|\.env(?:\..*)?|node_modules|dist|test-results|playwright-report|public\/test)(\/|$)/i;
const secret = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]{20,})/;
let decodedWasmLiterals = 0;
function hasSecret(content) {
  let decodedMatch = false;
  // Emscripten embeds valid WASM as base64. Scan its decoded bytes as well as
  // wrapper code; random encoded opcode sequences can resemble token prefixes.
  const wrapper = content.replace(/(["'])(AGFzbQ[A-Za-z0-9+/=]+)\1/g, (_literal, _quote, encoded) => {
    decodedWasmLiterals++;
    decodedMatch ||= secret.test(Buffer.from(encoded, 'base64').toString());
    return '';
  });
  return decodedMatch || secret.test(wrapper);
}
const failures = [];
const commits = git('rev-list', 'HEAD').toString().trim().split('\n');
for (const commit of commits) {
  for (const path of git('ls-tree', '-r', '--name-only', commit).toString().trim().split('\n')) {
    if (forbidden.test(path)) failures.push(`Internal history path: ${path}`);
  }
}
const objects = git('rev-list', '--objects', 'HEAD').toString().trim().split('\n');
for (const object of objects) {
  const [oid, ...parts] = object.split(' '), path = parts.join(' ');
  if (!path || git('cat-file', '-t', oid).toString().trim() !== 'blob') continue;
  if (hasSecret(git('cat-file', 'blob', oid).toString())) failures.push(`Credential-pattern history match: ${path}`);
}
const tracked = git('ls-files', '--cached', '--others', '--exclude-standard').toString().trim().split('\n');
for (const path of tracked) {
  if (forbidden.test(path)) failures.push(`Internal tracked path: ${path}`);
  if (hasSecret(readFileSync(path).toString())) failures.push(`Credential-pattern tree match: ${path}`);
}
const files = [];
function walk(root) {
  for (const name of readdirSync(root)) {
    const path = join(root, name); if (statSync(path).isDirectory()) walk(path); else files.push(path);
  }
}
walk('dist');
for (const path of files) {
  const relative = path.replaceAll('\\', '/').replace(/^dist\//, '');
  if (forbidden.test(relative) || relative.endsWith('.map') || !/^(?:index\.html|_headers|favicon\.svg|icons\.svg|(?:assets|vendor|licenses)\/.+)$/.test(relative)) failures.push(`Unexpected build artifact: ${relative}`);
  if (statSync(path).size > 25 * 1024 * 1024) failures.push(`Oversized static asset: ${relative}`);
  if (hasSecret(readFileSync(path).toString())) failures.push(`Credential-pattern artifact match: ${relative}`);
}
if (!files.some(path => path.replaceAll('\\', '/') === 'dist/_headers')) failures.push('Missing security headers');
if (!files.some(path => path.replaceAll('\\', '/').startsWith('dist/licenses/'))) failures.push('Missing redistribution notices');
if (failures.length) throw new Error([...new Set(failures)].join('\n'));
console.warn(JSON.stringify({ reachableCommits: commits.length, trackedFiles: tracked.length, staticFiles: files.length, largestAssetBytes: Math.max(...files.map(path => statSync(path).size)), decodedWasmLiterals, credentialPatternMatches: 0 }));
