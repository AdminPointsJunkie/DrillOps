// Decorative icons share the tool's visible name; they never replace its accessible label.
const paths={
 pin:'M12 22s7-8 7-14a7 7 0 0 0-14 0c0 6 7 14 7 14zM10 8h4',
 line:'M4 20 20 4M2 18h4v4H2zM18 2h4v4h-4z',
 route:'M5 4v12a4 4 0 0 0 8 0V8a4 4 0 0 1 8 0v12M2 4h6M18 17l3 3 3-3',
 polygon:'M4 5 17 3 21 15 10 21 3 13z',rectangle:'M3 5h18v14H3z',circle:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
 buffer:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10',
 centroid:'M4 5 17 3 21 15 10 21 3 13zM9 12h6M12 9v6',
 bounds:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8h8v8H8z',
 dissolve:'M3 6h7V3h8v7h3v10H3z',clip:'M8 2v14h14M2 8h14v14M3 3l18 18',
 count:'M3 3h18v18H3zM7 8h1M15 7h1M11 14h1M17 17h1',
 intersect:'M3 3h12v12H3zM9 9h12v12H9zM9 12h6M9 15h6',
 join:'M3 4h6v16H3zM15 4h6v16h-6zM9 12h6M12 9l3 3-3 3',
 merge:'M4 3v5l8 6 8-6V3M12 14v7M8 17l4 4 4-4',
 sample:'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18M9 9h6v6H9z',
 subtract:'M3 3h12v6H9v6H3zM9 9h12v12H9zM13 15h4',
 chart:'M3 3v18h18M7 17v-5h3v5M13 17V8h3v9M19 17V4h2v13',
 trend:'M3 3v18h18M5 16l5-6 4 3 6-8',histogram:'M3 21V12h6v9M9 21V5h6v16M15 21V9h6v12',
 statistic:'M18 4H6l6 8-6 8h12',time:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 6v6l4 3',
 filter:'M3 4h18l-7 8v7l-4 2v-9z',slider:'M3 7h18M3 17h18M7 4v6M16 14v6',
 single:'M3 3h18v18H3zM7 12l3 3 7-7',multi:'M8 3h13v13M3 8h13v13H3zM6 14l3 3 4-5',
 list:'M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1',
 layers:'M3 7l9-5 9 5-9 5zM3 12l9 5 9-5M3 17l9 5 9-5',
 upload:'M12 16V3M7 8l5-5 5 5M4 15v6h16v-6',paste:'M8 3h8v4H8zM8 5H4v17h16V5h-4M8 12h8M8 16h6',
 link:'M10 14l4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
 cloud:'M6 19a5 5 0 0 1-1-10 7 7 0 0 1 13-2 6 6 0 0 1 1 12z',
 file:'M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8',home:'M3 11l9-8 9 8M5 10v11h5v-7h4v7h5V10',
 settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
 draw:'M14 4l6 6-10 10H4v-6zM12 6l6 6',measure:'M3 15 15 3l6 6L9 21zM12 6l3 3M8 10l3 3',
 search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6',table:'M3 4h18v16H3zM3 9h18M9 9v11M15 9v11',
 help:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 16v1',
 user:'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-2a8 8 0 0 1 16 0v2',
 people:'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M2 21v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 7M19 14a7 7 0 0 1 3 7',
 mail:'M3 5h18v14H3zM3 5l9 8 9-8',key:'M8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 12l9 9M17 17l3-3',
 door:'M10 3H3v18h7M8 12h13M17 8l4 4-4 4',storage:'M3 5h18v6H3zM3 15h18v6H3zM6 8h1M6 18h1',
 print:'M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6z',image:'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M7 7h1',
 plus:'M12 4v16M4 12h16',close:'M5 5l14 14M19 5 5 19',quick:'M13 2 4 14h7l-1 8 10-13h-7z',more:'M4 12h1M11 12h1M18 12h1'
};
const exact={'Distance':'measure','Area':'polygon','Measure ›':'measure','Open in ›':'link','Compare…':'layers','Add comment…':'file',Pin:'pin',Line:'line',Route:'route',Polygon:'polygon',Rectangle:'rectangle',Circle:'circle',Bounds:'bounds',Buffer:'buffer',Centroid:'centroid',Dissolve:'dissolve','Clip polygons':'clip','Count points':'count','Intersect polygons':'intersect','Join attributes':'join','Merge layers':'merge','Sample raster':'sample','Subtract polygons':'subtract',Statistic:'statistic','Bar chart':'chart',Histogram:'histogram','Line chart':'trend',Filter:'filter','Time series':'time',List:'list',Slider:'slider','Single-select':'single','Multi-select':'multi',Home:'home',File:'file',Edit:'draw',View:'layers',Settings:'settings',More:'more','Quick actions':'quick','Close editing tools':'close','Print layout':'print','Export image':'image','Account settings':'user'};
export function toolIconName(label){
 if(exact[label])return exact[label];
 for(const [pattern,icon] of [[/paste/i,'paste'],[/upload/i,'upload'],[/URL|link/i,'link'],[/cloud/i,'cloud'],[/library|layer|tile/i,'layers'],[/component/i,'chart'],[/table/i,'table'],[/filter/i,'filter'],[/find|search/i,'search'],[/measure/i,'measure'],[/draw|annotation/i,'draw'],[/new project/i,'plus'],[/settings|admin/i,'settings'],[/invitation|invite/i,'mail'],[/people|member/i,'people'],[/storage/i,'storage'],[/password/i,'key'],[/sign in|sign out/i,'door'],[/help|guide/i,'help'],[/file|format/i,'file'],[/print/i,'print'],[/export|image/i,'image']])if(pattern.test(label))return icon;
 return 'quick';
}
export function addToolIcon(element){
 if(!element||element.querySelector('svg,[aria-hidden="true"]')||/^[✂＋]/.test(element.textContent.trim()))return;
 const name=toolIconName(element.getAttribute('aria-label')||element.textContent.trim());
 const svg=element.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','18');svg.setAttribute('height','18');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.65');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('tool-label-icon');
 const path=element.ownerDocument.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]);svg.append(path);element.prepend(svg);
}
export function decorateToolMenu(root){root.querySelectorAll('button,.app-submenu>summary').forEach(addToolIcon);}
