"""Preserve the published portal at /OLD before the standalone-app release.

The portal documents, scripts and styles are frozen to the release below.
Unchanged shared imagery and the separate FieldMaps app keep their root URLs.
Authentication and API data remain shared; this is not a database snapshot.
"""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'cfb28bf4858f841cb3cc2622e7406dbab0b759ce'
DEST = ROOT / 'docs' / 'OLD'
paths = subprocess.check_output(
    ['git', 'ls-tree', '-r', '--name-only', SOURCE, 'docs'], cwd=ROOT, text=True
).splitlines()

for path in paths:
    relative = Path(path).relative_to('docs')
    if relative.parts[0] in {'assets', 'maps', 'OLD', 'CNAME'}:
        continue
    content = subprocess.check_output(['git', 'show', f'{SOURCE}:{path}'], cwd=ROOT)
    if relative.suffix in {'.html', '.css', '.js', '.mjs', '.json'}:
        text = content.decode()
        # Both quoted URLs and dynamic map-overlay paths occur in the old portal.
        text = re.sub(r'(?<![\w/.-])(?:\./)?(assets|maps)/', r'/\1/', text)
        if relative.as_posix() == 'index.html':
            # The published portal still schedules its retired analytics panel.
            # Avoid rendering into missing elements when the retained portal opens.
            text = text.replace(
                'async function loadAnalytics(hole){',
                "async function loadAnalytics(hole){\n  if(!document.getElementById('kpi-total'))return;",
                1,
            )
        content = text.encode()
    target = DEST / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)

print(f'Preserved published portal at docs/OLD from {SOURCE}')
