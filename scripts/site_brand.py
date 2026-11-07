"""Shared company navigation. DrillOps is the company; each app has its own page."""
import html

PRODUCTS = [('drillops.html', 'EOS'), ('accounting.html', 'Account'),
            ('project-management.html', 'Project'), ('fieldops.html', 'FieldOps'),
            ('fieldmaps.html', 'FieldMaps')]
SIGN_IN = {'drillops.html': './eos.html', 'accounting.html': './account.html',
           'project-management.html': './project.html', 'fieldmaps.html': './maps/?signin=1'}

def wordmark(product='', href='./index.html', stacked=False):
    cls = 'do-wordmark' + (' do-wordmark-stacked' if stacked else '')
    label = 'DrillOps' + (' ' + product if product else '')
    return (f'<a class="{cls}" href="{html.escape(href)}" aria-label="{html.escape(label)} home">'
            '<span class="do-company">DrillOps</span>'
            + (f'<span class="do-product">{html.escape(product)}</span>' if product else '')
            + ('<small>BUILT FOR THE FIELD</small>' if stacked else '') + '</a>')

def navigation(current=''):
    links = ''.join(f'<a href="./{path}"'+(' aria-current="page"' if path == current else '')+f'>{name}</a>' for path, name in PRODUCTS)
    action = (f'<a class="button" href="{SIGN_IN[current]}">Sign in <span aria-hidden="true">↗</span></a>'
              if current in SIGN_IN else '<a class="text-link" href="./support.html">Support ↗</a>')
    return ('<nav class="site-nav" aria-label="Main navigation">'+wordmark()
            +'<div class="nav-links">'+links+'</div><details class="mobile-menu"><summary>Products</summary><div>'
            +links+'<a href="./support.html">Support</a></div></details><div class="nav-action">'+action+'</div></nav>')

def footer():
    links = ''.join(f'<a href="./{path}">{name}</a>' for path, name in PRODUCTS)
    return ('<footer class="site-footer"><div class="wrap"><div class="footer-main"><div>'+wordmark()
            +'<p>Practical tools for work in the field.</p></div><div class="footer-links">'+links
            +'<a href="./support.html">Support</a></div></div><div class="footer-bottom"><span>© 2026 DrillOps</span>'
            +'<span><a href="./privacy.html">DrillOps privacy</a> · <a href="./fieldops-privacy.html">FieldOps privacy</a> · '
            +'<a href="mailto:admin@drillops.com.au">Contact</a></span></div></div></footer>')
