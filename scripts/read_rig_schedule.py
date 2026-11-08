"""Read the supplied XLSM without executing macros; emit reviewable booking JSON."""
import argparse, datetime as dt, hashlib, json, re, zipfile
import xml.etree.ElementTree as ET
N={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def read(path):
    with zipfile.ZipFile(path) as z:
        strings=[''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',N)]
        rel={x.get('Id'):x.get('Target') for x in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        sheets={}
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',N):
            path=rel[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            path=path.lstrip('/') if path.startswith('/') else 'xl/'+path
            rows={}
            for row in ET.fromstring(z.read(path)).findall('s:sheetData/s:row',N):
                data={}
                for c in row:
                    v=c.findtext('s:v','',N)
                    if c.get('t')=='s':v=strings[int(v)] if v else ''
                    if c.get('t')=='inlineStr':v=''.join(c.find('s:is',N).itertext())
                    if v:data[re.sub(r'\d','',c.get('r'))]=v.strip()
                if data:rows[int(row.get('r'))]=data
            sheets[sheet.get('name')]=rows
        return sheets
def date(v):return dt.date(1899,12,30)+dt.timedelta(days=float(v))
def site(v):return re.sub(r'\s+-.*$','',v.strip().upper())
def extract(path):
    sheets=read(path);details={site(r['K']):r for i,r in sheets['2026 EXP'].items() if i>5 and r.get('K')}
    rig_by_site={site(r['E']):('DR17' if r.get('F','').lower()=='depco exp' else '1218' if r.get('F','').lower()=='mitchells' else '' if r.get('F','').upper()=='TBA' else None) for i,r in sheets['LMP SCHEDULE'].items() if r.get('E') and r.get('D')=='Exploration'}
    cancelled={site(r['K']) for i,r in sheets['2026 EXP'].items() if i>5 and r.get('F','').upper()=='CANCELLED'}
    daily=[]
    for i,r in sheets['RIG Schedule'].items():
        if i<3 or not r.get('B','').isdigit():continue
        day=date(r['B']).isoformat()
        for rig,pc,sc,nc in [('1218','J','K','L'),('DR28','T','U','V'),('DR17','AD','AE','AF')]:
            label=r.get(sc,'');raw=r.get(pc,'')
            if not label:continue
            kind='Break' if label.lower()=='break' else 'Drilling'
            project={'IB':'Ironbark','CD':'Carborough Downs','Broadley':'Broadlea'}.get(raw,raw)
            if kind=='Break':project='Roster breaks'
            if not project:raise ValueError(f'Unresolved project: row {i}, {rig}, {label}')
            sid=('IB'+label if label.startswith('GR') and raw=='IB' else 'CD'+label if label.startswith('GR') and raw=='CD' else label)
            if site(sid) in cancelled:continue
            detail=details.get(site(sid),{})
            hole=detail.get('L','') or (label if not re.match(r'^(IB|CD)-',label) else '')
            if kind=='Break':hole='Break';sid=''
            if label=='Chip HR':kind='Other';hole=label
            daily.append(dict(project=project,program='Gas Riser' if rig=='DR28' else 'Exploration',planned_year='2026',assigned_rig=rig,hole_id=hole,site_id=sid,scheduled_start=day,scheduled_end=day,kind=kind,status='Planned',notes=(day+': '+r[nc]) if r.get(nc) else '',source_reference=f'RIG Schedule!B{i}:{nc}{i}'))
    grouped=[]
    for rig in ('1218','DR28','DR17'):
        for r in [r for r in daily if r['assigned_rig']==rig]:
            prev=grouped[-1] if grouped else None
            if prev and all(prev[k]==r[k] for k in ('project','assigned_rig','site_id','hole_id','kind')) and dt.date.fromisoformat(prev['scheduled_end'])+dt.timedelta(days=1)==dt.date.fromisoformat(r['scheduled_start']):
                prev['scheduled_end']=r['scheduled_end'];prev['notes']='\n'.join(filter(None,[prev['notes'],r['notes']]));prev['source_reference']+='; '+r['source_reference'].split('!')[1]
            else:grouped.append(dict(r))
    detailed_sites={r['site_id'] for r in daily if r['site_id']}
    detailed_days={(r['assigned_rig'],r['scheduled_start']) for r in daily}
    skipped=[];older=[]
    for i,r in sheets['EXP Schedule'].items():
        if i<6 or not r.get('D') or not r.get('E','').isdigit():continue
        sid=site(r['D'])
        if sid in cancelled:skipped.append(sid);continue
        if sid in detailed_sites:continue
        # These formula finish dates equal start + duration: they are handover dates.
        rig=rig_by_site.get(sid,'1218')
        if rig is None:rig='1218'
        start=date(r['E']);end=date(r['F'])-dt.timedelta(days=1)
        # A newer daily assignment supersedes the whole older forecast booking.
        # Do not trim a five-day hole into an invented one-day booking.
        if any((rig,(start+dt.timedelta(days=n)).isoformat()) in detailed_days for n in range((end-start).days+1)):continue
        segments=[[start,end]]
        for a,b in segments:
            older.append(dict(project='Ironbark',program='Exploration',planned_year='2026',assigned_rig=rig,hole_id=r.get('C','') if r.get('C')!='0' else '',site_id=sid,scheduled_start=a.isoformat(),scheduled_end=b.isoformat(),kind='Drilling',status='Planned',notes='',source_reference=f'EXP Schedule!C{i}:H{i}; finish {date(r["F"]).isoformat()} is the next booking handover'+('; rig from LMP SCHEDULE' if sid in rig_by_site else '')))
    entries=[r for r in older+grouped if r['assigned_rig']!='DR28']
    for r in entries:r['source_key']='schedule-2026:'+hashlib.sha256((r['source_reference']+r['assigned_rig']+r['scheduled_start']).encode()).hexdigest()[:24]
    return dict(entries=entries,cancelled_sites=sorted(cancelled),excluded_schedule_sites=sorted(set(skipped)),source='2026 Exploration Schedule .xlsm')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('workbook');p.add_argument('output');args=p.parse_args()
    result=extract(args.workbook)
    with open(args.output,'w') as f:json.dump(result,f,indent=2)
    print(json.dumps({'bookings':len(result['entries']),'cancelled_sites':len(result['cancelled_sites']),'excluded_schedule_sites':result['excluded_schedule_sites'],'rows':sorted(set((r['project'],r['assigned_rig']) for r in result['entries']))},indent=2))
