/* One report identity for screen, popup PDFs and repeating EOS print headers. */
(function(){
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const css=`
 .do-report-header,body .eos-document-heading.do-report-header{display:flex!important;flex-direction:row!important;align-items:flex-start!important;justify-content:space-between!important;gap:20px!important;position:static!important;height:auto!important;min-height:0!important;top:auto!important;padding:0 0 16px!important;margin:0 0 20px!important;background:#fff!important;border:0!important;border-bottom:2px solid #315d49!important;color:#26352d!important;box-shadow:none!important;text-align:left!important;break-inside:avoid;break-after:avoid;font-family:'DM Sans',Arial,sans-serif!important;line-height:1.4}
 .do-report-header .do-report-brand{font:800 24px/1.2 'Manrope','DM Sans',Arial,sans-serif;letter-spacing:-.8px;color:#26352d;white-space:nowrap}
 .do-report-header .do-report-product{font:500 16px/1.2 'Manrope','DM Sans',Arial,sans-serif;color:#63736a;letter-spacing:-.2px;margin-left:8px}
 .do-report-header .do-report-title,.do-report-header h2.do-report-title{font:600 18px/1.3 'Manrope','DM Sans',Arial,sans-serif!important;letter-spacing:-.3px!important;color:#26352d!important;margin:12px 0 4px!important}
 .do-report-header .do-report-context{font:400 11px/1.5 'DM Sans',Arial,sans-serif!important;color:#63736a!important;margin:0!important}
 .do-report-header .do-report-meta{font:500 11px/1.5 'DM Sans',Arial,sans-serif;text-align:right;color:#26352d;max-width:45%;padding-top:3px}
 .do-report-header .do-report-meta small{display:block;font:400 10px/1.5 'DM Sans',Arial,sans-serif;color:#63736a;letter-spacing:0;margin:0 0 4px}
 .do-report-header .do-report-meta strong{font-weight:500;display:block}
 @media screen and (max-width:600px){body .do-report-header,body .eos-document-heading.do-report-header{flex-direction:column!important}.do-report-header .do-report-meta{max-width:none;text-align:left}}
 @media print{.do-report-header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
 `;
 function header(product,title,context,period){return '<header class="do-report-header"><div><div class="do-report-brand">DrillOps<span class="do-report-product">'+escape(product)+'</span></div><h2 class="do-report-title">'+escape(title)+'</h2><p class="do-report-context">'+escape(context)+'</p></div><div class="do-report-meta"><small>Reporting period</small><strong>'+escape(period)+'</strong></div></header>';}
 const fonts='<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">';window.DrillOpsReport={css,header,fonts};const style=document.createElement('style');style.dataset.drillopsReport='shared';style.textContent=css;document.head.appendChild(style);
})();
