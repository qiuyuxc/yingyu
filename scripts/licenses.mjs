// Copyright 2026 qiuyuxc. SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8').replace(/\r\n?/g, '\n');
const mode = process.argv[2];
if (!['--write', '--check'].includes(mode)) throw new Error('Use --write or --check');
const lock = JSON.parse(read('package-lock.json'));
const projectLicense = read('LICENSE');
if (!projectLicense.includes('Apache License') || !projectLicense.includes('Grant of Patent License')) {
  throw new Error('The Apache-2.0 license text is required for the AWS SDK notices');
}
const supported = new Set(['Apache-2.0', 'MIT', 'MIT-0', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause']);
const components = [];
const texts = new Map();
const fingerprint = text => createHash('sha256').update(text.trim().split('\n').map(line => line.trim()).join('\n')).digest('hex');
const addText = (text, component, filename) => {
  const key = fingerprint(text);
  if (!texts.has(key)) texts.set(key, { text: text.trim() + '\n', usedBy: [] });
  texts.get(key).usedBy.push(component + ' (' + filename + ')');
};
for (const [path, metadata] of Object.entries(lock.packages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
  if (!path || metadata.dev) continue;
  const installed = resolve(root, path);
  const info = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8'));
  if (info.version !== metadata.version) throw new Error('Installed version of ' + info.name + ' differs from package-lock.json; run npm ci');
  const license = info.license || metadata.license;
  if (!supported.has(license)) throw new Error('Review the license of ' + info.name + ': ' + license);
  const component = info.name + '@' + info.version;
  components.push(component + ' | ' + license);
  const files = readdirSync(installed).filter(name =>
    /^(licen[cs]e|notice|copyrightnotice)(?:$|[._-])/i.test(name) && statSync(resolve(installed, name)).isFile(),
  ).sort();
  if (!files.some(name => /^licen[cs]e/i.test(name))) {
    if (license !== 'Apache-2.0') throw new Error('Missing license text for ' + component);
    // Some AWS SDK subpackages declare Apache-2.0 but omit a LICENSE in their
    // npm archives. Supply the canonical license, preserving any other notices.
    addText(projectLicense, component, 'Apache-2.0 text supplied from LICENSE');
  }
  for (const filename of files) {
    addText(readFileSync(resolve(installed, filename), 'utf8').replace(/\r\n?/g, '\n'), component, filename);
  }
}
const sections = [];
for (const { text, usedBy } of texts.values()) {
  sections.push('============================================================\n' +
    usedBy.join('\n') + '\n============================================================\n\n' + text);
}
const thirdParty = [
  'Third-party software notices for 映屿 (Yingyu)',
  '',
  'Generated from the production dependency versions in package-lock.json.',
  'Each component retains its original license and copyright notices.',
  'Identical license texts are reproduced once with all relevant components.',
  '',
  'COMPONENT | SPDX LICENSE',
  ...components,
  '',
  ...sections,
].join('\n').trimEnd() + '\n';
const publicNotice = [
  read('NOTICE').trim(),
  '',
  'PROJECT LICENSE',
  projectLicense.trim(),
  '',
  thirdParty.trim(),
  '',
  'DEMONSTRATION PHOTOGRAPHS',
  read('public/samples/README.md').trim(),
  '',
].join('\n');
for (const [path, expected] of [
  ['THIRD_PARTY_NOTICES.txt', thirdParty],
  ['public/third-party-notices.txt', publicNotice],
]) {
  if (mode === '--write') writeFileSync(resolve(root, path), expected);
  else if (read(path) !== expected) throw new Error(path + ' is stale; run npm run licenses:update');
}
console.log('License notices ' + (mode === '--write' ? 'generated' : 'verified') + ' for ' + components.length + ' production dependencies');
