"""The public homepage is independent of authenticated application shells."""
from pathlib import Path
from site_brand import navigation, footer

def build_home():
    docs = Path(__file__).resolve().parents[1] / 'docs'
    content = (docs / 'website/home.html').read_text()
    source = '''<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DrillOps</title><meta name="description" content="Practical software for reports, accounts, project planning and field maps.">
<meta name="theme-color" content="#315d49"><link rel="canonical" href="https://www.drillops.com.au/">
<link rel="icon" type="image/svg+xml" href="./favicon.svg">
<script src="./public-entry.js?v=20261108-layout1"></script>
<link rel="stylesheet" href="./public-layout.css?v=20261108-layout1">
<script defer src="./public-navigation.js?v=20261108-layout1"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-18535443929"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','AW-18535443929');</script>
</head><body class="site" data-public-home="true"><a class="skip" href="#main">Skip to content</a>
'''
    (docs / 'index.html').write_text(source + navigation() + content + footer() + '</body></html>\n')

if __name__ == '__main__':
    build_home()
