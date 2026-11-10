"""Central app grants; unknown management routes remain owner-only."""
ALL_APPS=frozenset({'eos','account','project'})
READ_SHARED={'/clients','/projects','/contractors','/project-contractors'}
def route_apps(path,method):
    if path=='/account-accruals/project-summary' and method in {'GET','HEAD'}:return frozenset({'account','project'})
    if path in READ_SHARED and method in {'GET','HEAD'}:return ALL_APPS
    if path.startswith(('/admin','/reset','/imports/cleanup','/imports/ocr-integrity','/imports/qa-existing')):return frozenset()
    if path=='/mobile/me':return frozenset({'field','eos','account','project','fieldmaps'})
    if path.startswith('/mobile/'):return frozenset({'field'})
    if path.startswith(('/project-registers','/rig-schedule','/project-hole-report-data','/project-labs','/project-budget','/cost-centre-forecast','/training','/boreholes')):return frozenset({'project'})
    if path.startswith(('/account-accruals','/invoice','/ironbark-posted-invoices','/purchase_orders','/reconciliation')):return frozenset({'account'})
    if path.startswith(('/projects','/clients')):return frozenset({'project'})
    if path.startswith('/contractors'):return frozenset({'account'})
    if path in {'/activity-report-data','/exploration-metres-summary'} and method in {'GET','HEAD'}:return frozenset({'eos','project'})
    if path.startswith(('/eos/weather','/activities','/activity-','/report-approvals','/consumables','/crew','/filters','/analytics','/costing','/rates','/rate-library','/cost-contract','/depco-','/minimum-shift','/reprice','/source_files','/mcc/','/day-rate-tracking','/import')):return frozenset({'eos'})
    return frozenset()

def can_access(auth,path,method):
    return auth.owner or bool(set(auth.apps)&route_apps(path,method))
