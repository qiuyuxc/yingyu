#!/usr/bin/env python3
"""Render the AboutLibraries release inventory into the app's offline notices."""
import argparse
import html
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
inventory = json.loads((root / 'android/app/build/reports/aboutlibraries.json').read_text())
licenses = inventory['licenses']
parts = ["映屿 Android · 开源许可\n\n" + (root / 'NOTICE').read_text(), (root / 'LICENSE').read_text(),
         "Miuix\nCopyright 2025, compose-miuix-ui contributors\nhttps://github.com/compose-miuix-ui/miuix\nApache License 2.0",
         (root / 'android/licenses/liquidglass.txt').read_text(),
         (root / 'android/licenses/samples.txt').read_text()]
for library in sorted(inventory['libraries'], key=lambda item: item['uniqueId']):
    identifiers = library.get('licenses', [])
    if not identifiers:
        raise SystemExit('Missing license: ' + library['uniqueId'])
    names = [licenses[key]['name'] for key in identifiers]
    developers = ', '.join(d.get('name', '') for d in library.get('developers', []))
    parts.append('\n'.join(filter(None, [library['uniqueId'] + ' ' + library.get('artifactVersion', ''),
                                        library.get('name', ''), developers, library.get('website', ''), ', '.join(names)])))
for identifier, license in sorted(licenses.items()):
    content = license.get('content', '')
    if not content:
        raise SystemExit('Missing license text: ' + identifier)
    content = html.unescape(re.sub(r'<[^>]+>', '', re.sub(r'<br\s*/?>', '\n', content)))
    parts.append(license['name'] + '\n' + content)
output = '\n\n' + ('\n\n' + '=' * 72 + '\n\n').join(parts) + '\n'
output = '\n'.join(line.rstrip() for line in output.split('\n'))
target = root / 'android/app/src/main/assets/third-party-notices.txt'
if args.check:
    if not target.exists() or target.read_text() != output:
        raise SystemExit('Android notices are outdated. Run python3 scripts/android-notices.py')
else:
    target.write_text(output)
print(f"Android notices verified for {len(inventory['libraries'])} dependencies")
