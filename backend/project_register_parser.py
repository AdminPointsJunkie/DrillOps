"""Read the four operational workbook layouts without executing workbook content."""
import hashlib,io,re,zipfile
from collections import Counter
from datetime import date,datetime
from decimal import Decimal,InvalidOperation
import openpyxl

KINDS={'boreholes':'Master boreholes','samples':'Sample tracking','canisters':'Gas canisters','gas':'Gas compliance'}
def text(v):return '' if v is None else str(v).strip()
def norm(v):return re.sub(r'\s+',' ',text(v)).lower()
def value(v):
    if isinstance(v,(date,datetime)):return v.isoformat()[:10]
    return v if isinstance(v,(str,int,float,bool)) or v is None else str(v)
def number(v):
    try:
        n=Decimal(str(v));return float(n) if n.is_finite() else None
    except (InvalidOperation,TypeError,ValueError):return None
def day(v):
    if isinstance(v,(date,datetime)):return v.isoformat()[:10]
    for fmt in ('%Y-%m-%d','%d/%m/%Y','%d/%m/%y'):
        try:return datetime.strptime(text(v),fmt).date().isoformat()
        except ValueError:pass
    return None

def parse_workbook(content,filename):
    if len(content)>20*1024*1024:raise ValueError('Workbook must be smaller than 20 MB.')
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        if sum(i.file_size for i in z.infolist())>100*1024*1024:raise ValueError('Workbook expands beyond the import limit.')
    wb=openpyxl.load_workbook(io.BytesIO(content),read_only=True,data_only=True,keep_links=False)
    names=wb.sheetnames
    if any('canister register' in s.lower() for s in names):kind='canisters'
    elif 'All Holes Final' in names:kind='boreholes'
    elif 'Surface' in names and 'Inseam' in names:kind='gas'
    elif any(norm(c.value)=='geotech samples taken' for s in wb for row in s.iter_rows(max_row=3,max_col=20) for c in row):kind='samples'
    else:raise ValueError('Workbook layout not recognised. Use one of the four register templates.')
    result=[];ignored=[];sheets=[];warnings=[]
    for s in wb:
        if s.max_row>20000 or s.max_column>500:raise ValueError('Worksheet exceeds the import limits.')
        raw=list(s.iter_rows(values_only=True));headers={};start=0;keycol=None
        if kind=='canisters':
            if 'canister register' not in s.title.lower():ignored.append(s.title);continue
            start=3;keycol=0;headers={i:text(v) for i,v in enumerate(raw[2]) if text(v)}
        elif kind=='samples':start=2;keycol=1;headers={i:text(v) for i,v in enumerate(raw[1]) if text(v)}
        elif kind=='gas':
            if s.title=='Surface':start=6;keycol=0;headers={0:'Borehole number',1:'Date core taken',2:'Location',**{i:'Sample '+str(i-2) for i in range(3,9)},9:'Maximum Sample Value',10:'Pass / Fail',11:'Weighted Average'}
            else:start=5;keycol=1;headers={1:'GeoGAS Sample Number',2:'Superseded',3:'Date core taken',4:'Easting',5:'Northing',6:'Location',11:'Sample Value',12:'Pass / Fail'}
        else:
            for idx,row in enumerate(raw[:6]):
                for c,v in enumerate(row):
                    if norm(v) in ('hole id','bore id'):
                        start=idx+1;keycol=c;headers={i:text(v) for i,v in enumerate(row) if text(v)};break
                if keycol is not None:break
            if keycol is None:
                # Preserve the small headerless continuation and delay register as archive rows.
                if s.title=='Sheet2':start=0;keycol=0;headers=dict(enumerate(['Hole ID','RIG','Easting','Northing','RL','TD','Core','Hitch/Spud','LHD From','LHD To']))
                elif s.title=='Service Hole delay tracker':start=1;keycol=0;headers={i:text(v) for i,v in enumerate(raw[0]) if text(v)}
                else:ignored.append(s.title);continue
        sheets.append(s.title);seen=Counter()
        for index,row in enumerate(raw[start:],start+1):
            get=lambda i:row[i] if i<len(row) else None
            ident=text(get(keycol))
            if not ident or ident.startswith('#') or norm(ident) in ('hole id','borehole number','total','canister number'):continue
            if kind!='boreholes' and not re.search(r'\d',ident):continue
            fields={re.sub(r'\s+',' ',label):value(get(i)) for i,label in headers.items() if get(i) is not None and text(get(i))}
            # Retain extra populated columns rather than silently dropping source details.
            fields.update({openpyxl.utils.get_column_letter(i+1):value(v) for i,v in enumerate(row) if i not in headers and v is not None and text(v)})
            lookup={norm(k):v for k,v in fields.items()}
            fetch=lambda *keys:next((lookup[norm(k)] for k in keys if norm(k) in lookup),None)
            hole=ident;site='';record_date=None;status='';category='';metrics={}
            if kind=='canisters':
                hole=text(get(4));record_date=day(get(1));status='Received by GeoGAS' if day(get(5)) else 'Returned' if day(get(3)) else 'On site' if day(get(2)) else 'Dispatched' if record_date else 'Date not recorded'
                year=(re.search(r'20\d{2}',s.title) or [''])[0];metrics={'canister':ident,'returned':day(get(3)),'received_geogas':day(get(5)),'hire_days':{str(m+1):number(get(m+6)) for m in range(12)}}
            elif kind=='samples':
                site=text(get(2));record_date=None;year='20'+site[3:5] if re.match(r'^IB-\d{2}-',site) else ''
                batches=[]
                for cat,taken,sent,reports in [('Geotech',5,6,[7,8]),('FI',9,10,[11]),('Spon Comb',12,13,[14]),('CQ',15,16,[17])]:
                    reportvalues=[text(get(i)) for i in reports if norm(get(i)) not in ('','n/a','na','no','-')]
                    dispatch=day(get(sent));dates=[day(get(i)) for i in reports];valid=[d for d in dates if d]
                    if norm(get(taken)) not in ('yes','y') and not dispatch and not reportvalues:continue
                    state='Results received' if reportvalues and all(day(get(i)) or norm(get(i)) in ('n/a','na') for i in reports) else 'Partial results' if reportvalues else 'Dispatched' if dispatch else 'Collected'
                    batches.append({'category':cat,'status':state,'sent_on':dispatch,'results_on':max(valid) if valid else None,'report_notes':reportvalues})
                metrics={'batches':batches};status='Results received' if batches and all(b['status']=='Results received' for b in batches) else 'Pending results' if batches else 'No samples recorded'
            elif kind=='gas':
                record_date=day(get(1 if s.title=='Surface' else 3));year=record_date[:4] if record_date else '';status=text(get(10 if s.title=='Surface' else 12)) or 'Not recorded'
                metrics={'maximum':number(get(9 if s.title=='Surface' else 11)),'weighted_average':number(get(11)) if s.title=='Surface' else None,'sample_count':sum(number(get(i)) is not None for i in range(3,9)) if s.title=='Surface' else int(number(get(11)) is not None)}
                if s.title=='Inseam':hole=''
            else:
                site=text(fetch('Site','Site Name'));record_date=day(fetch('Hitch/Spud'));year=record_date[:4] if record_date else ''
                metrics={k:number(fetch(*labels)) for k,labels in {'easting':['Easting'],'northing':['Northing'],'rl':['RL','Surface RL'],'eoh_depth':['TD','Total Depth'],'total_core':['Core']}.items()}
                metrics.update(rig=text(fetch('RIG')),purpose=text(fetch('Purpose')),bh_type=text(fetch('Hole Type')))
                status=text(fetch('Borehole Status','Cement Status','Cemented')) or 'Not recorded'
            if not year and kind in ('samples','boreholes') and re.match(r'^IB-\d{2}-',site):year='20'+site[3:5]
            if record_date and not 1900<=int(record_date[:4])<=date.today().year+1:
                warnings.append(s.title+' row '+str(index)+': date '+record_date+' is outside the expected range; source value retained.')
            seen[ident]+=1;key=hashlib.sha256((s.title+'\0'+ident.upper()+'\0'+str(seen[ident])).encode()).hexdigest()
            result.append(dict(kind=kind,sheet=s.title,source_key=key,identifier=ident,hole_id=hole,site_id=site,year=year,record_date=record_date,status=status,fields=fields,metrics=metrics,source_row=index))
    wb.close()
    if not result:raise ValueError('No register records found.')
    if len(result)>15000:raise ValueError('Too many records in one import.')
    return {'kind':kind,'label':KINDS[kind],'filename':filename,'sha256':hashlib.sha256(content).hexdigest(),'records':result,'sheets':sheets,'ignored_sheets':ignored,'warnings':warnings}
