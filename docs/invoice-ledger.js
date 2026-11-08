/* Invoice review ledger. Amounts are source values; missing values stay unknown. */
(function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const page = document.getElementById('page-invoices');
  if (!page) return;
  const entry = document.getElementById('manual-inv-contractor').closest('.table-wrap');
  document.getElementById('manual-inv-status').closest('.filter-group').hidden = true;
  const breakdown = document.getElementById('invoice-breakdown-panel');
  const supplier = document.getElementById('inv-contractor-filter');
  [supplier].forEach(el => { el.removeAttribute('style'); el.removeAttribute('onchange'); });
  page.innerHTML = `
    <header class="ledger-heading"><div><div class="ledger-eyebrow" id="ledger-scope">Commercial / Invoices</div><h2 id="ledger-title">Invoice ledger</h2><p>Posted invoices and credit notes. Actuals only.</p></div>
      <div class="ledger-actions"><button class="ledger-button" id="ledger-refresh">Refresh</button><button class="ledger-button" id="ledger-export">Export ledger</button><button class="ledger-button primary" id="ledger-add">Add invoice</button></div></header>
    <div id="ledger-message" class="ledger-notice" role="status" hidden></div>
    <div class="ledger-cards">
      <div class="ledger-card"><div class="ledger-card-label">Invoice actuals · ex GST</div><div class="ledger-card-value" id="inv-kpi-total">—</div><div class="ledger-card-note">Net invoices before opening credits</div></div>
      <div class="ledger-card"><div class="ledger-card-label">Invoice charges · ex GST</div><div class="ledger-card-value" id="inv-kpi-paid">—</div><div class="ledger-card-note">Positive invoice amounts</div></div>
      <div class="ledger-card"><div class="ledger-card-label">Credit notes · ex GST</div><div class="ledger-card-value" id="inv-kpi-due">—</div><div class="ledger-card-note">Reductions to the invoice total</div></div>
    </div>
    <p class="ledger-notice">Posted invoices and credit notes only; estimates and unbilled accruals are excluded. These are full invoice values before opening credits, so the net total is not the amount charged to this year’s budget. Missing payment and tax amounts show “Not recorded”.</p>
    <div class="ledger-shell"><div class="ledger-tabs" role="group" aria-label="Invoice views">
      <button class="ledger-tab" data-view="all" aria-pressed="true">All entries</button><button class="ledger-tab" data-view="credits" aria-pressed="false">Credit notes</button>
    </div><div class="ledger-filters"><label class="ledger-search">Search<input id="ledger-search" type="search" placeholder="Supplier, invoice or PO number"></label><label>Project<select id="ledger-project"><option value="">All projects</option></select></label><label id="ledger-supplier-label">Supplier</label><label>Invoice month<select id="ledger-month"><option value="">All months</option></select></label><button class="ledger-button" id="ledger-reset">Clear filters</button></div>
    <div class="ledger-count" id="ledger-count" aria-live="polite"></div>
    <div class="tbl-scroll"><table id="inv-table"><thead><tr><th scope="col">Date</th><th scope="col">Invoice / credit</th><th scope="col">Supplier</th><th scope="col">Project</th><th scope="col">Purchase order</th><th scope="col" class="ledger-num">PO used</th><th scope="col" class="ledger-num">Charge · ex GST</th><th scope="col" class="ledger-num">Credit · ex GST</th><th scope="col" class="ledger-num">Running total</th></tr></thead><tbody id="inv-body"></tbody></table></div>
    <div class="ledger-footer"><span>Oldest to newest · Running total covers filtered entries · PO used covers all matching invoices and credits, ex GST</span><strong id="ledger-total">—</strong></div></div>
    <section class="ledger-detail" id="ledger-detail" aria-label="Invoice details" hidden></section>
    <details class="ledger-entry" id="ledger-entry"><summary>Add an invoice manually</summary></details>`;
  document.getElementById('ledger-supplier-label').append(supplier);
  document.getElementById('ledger-entry').append(entry);
  breakdown.hidden = true;
  page.append(breakdown);
  let view = 'all', visibleRows = [], request = 0, ready = false, ledgerPOs = [];
  const el = id => document.getElementById(id);
  const known = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const cents = value => Math.round(Number(value) * 100);
  const money = value => known(value) ? Number(value).toLocaleString('en-AU', {style:'currency', currency:'AUD'}) : 'Not recorded';
  const linkedProject = () => typeof activeWorkspaceProject === 'function' ? activeWorkspaceProject() : null;
  const projectLabel = () => { const p=linkedProject(); return [p?.name||activeProjectName,p?.year].filter(Boolean).join(' '); };
  function rowProject(row) {
    const candidates=(typeof projects==='undefined'?[]:projects).filter(p=>projectNamesMatch(p.name,row.project)&&p.program===row.program);
    if(candidates.length===1)return candidates[0];
    const active=linkedProject();return active&&projectNamesMatch(active.name,row.project)&&active.program===row.program?active:null;
  }
  const rowProjectLabel = row => [row.project||'Not recorded',rowProject(row)?.year].filter(Boolean).join(' ');
  const norm = value => String(value || '').trim().toLowerCase();
  function poUsage(row) {
    const matches = ledgerPOs.filter(p => norm(p.po_number) === norm(row.po_reference) && norm(p.contractor) === norm(row.contractor) && norm(p.project) === norm(row.project) && norm(p.program) === norm(row.program));
    if (!row.po_reference || matches.length !== 1 || !known(matches[0].po_value) || Number(matches[0].po_value) <= 0) return null;
    const related = invoicesData.filter(r => norm(r.po_reference) === norm(row.po_reference) && norm(r.contractor) === norm(row.contractor) && norm(r.project) === norm(row.project) && norm(r.program) === norm(row.program));
    if (related.some(r => !known(r.subtotal))) return null;
    return related.reduce((sum,r) => sum+cents(r.subtotal),0)/cents(matches[0].po_value)*100;
  }
  function dateKey(value) {
    const s = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : '9999-99-99';
  }
  function message(text, error) { el('ledger-message').textContent = text; el('ledger-message').hidden = !text; el('ledger-message').classList.toggle('error', !!error); }
  function reset() { supplier.value = ''; el('ledger-search').value = ''; el('ledger-month').value = ''; el('ledger-project').value = ''; view = 'all'; filter(); }
  const projectKey = row => JSON.stringify([row.project||'',row.program||'']);
  function filter() {
    const search = el('ledger-search').value.trim().toLowerCase();
    const rows = (invoicesData || []).filter(r => (!supplier.value || r.contractor === supplier.value)
      && (!el('ledger-project').value || projectKey(r) === el('ledger-project').value)
      && (!el('ledger-month').value || r.billing_month === el('ledger-month').value)
      && (!search || [r.contractor,r.invoice_number,r.po_reference].join(' ').toLowerCase().includes(search))
      && (view === 'all' || view === 'credits' && known(r.subtotal) && Number(r.subtotal) < 0));
    page.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    renderLedger(rows);
  }
  window.loadInvoices = async function () {
    const current = ++request;
    ready = false; invoicesData = []; ledgerPOs = []; filter();
    el('ledger-detail').hidden = true; breakdown.hidden = true;
    el('ledger-scope').textContent = 'Account / All projects';
    el('ledger-title').textContent = 'Invoice ledger';
    message('Loading invoice ledger…');
    try {
      populateManualInvoiceForm();
      const response = await fetch(API+'/invoice-ledger', {cache:'no-store'});
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Your session cannot access invoices. Sign in again and refresh.' : 'The invoice ledger could not load. Refresh to try again.');
      const data = await response.json();
      if (!Array.isArray(data.invoices) || !Array.isArray(data.purchase_orders)) throw new Error('The invoice response could not be read. Refresh to try again.');
      if (current !== request) return;
      ledgerPOs = data.purchase_orders;
      const unique = new Map();
      data.invoices.forEach(r => unique.set(r.id, r));
      invoicesData = [...unique.values()]; ready = true;
      const previousSupplier = supplier.value, previousMonth = el('ledger-month').value, previousProject = el('ledger-project').value;
      const projectOptions = new Map(invoicesData.map(r=>[projectKey(r),[rowProjectLabel(r),r.program].filter(Boolean).join(' · ')]));
      el('ledger-project').innerHTML='<option value="">All projects</option>'+[...projectOptions].sort((a,b)=>a[1].localeCompare(b[1])).map(([key,label])=>`<option value="${escape(key)}">${escape(label)}</option>`).join('');
      el('ledger-project').value=previousProject;if(el('ledger-project').selectedIndex<0)el('ledger-project').value='';
      supplier.innerHTML = '<option value="">All suppliers</option>' + [...new Set(invoicesData.map(r => r.contractor).filter(Boolean))].sort().map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join('');
      supplier.value = previousSupplier; if (supplier.selectedIndex < 0) supplier.value = '';
      el('ledger-month').innerHTML = '<option value="">All months</option>' + [...new Set(invoicesData.map(r => r.billing_month).filter(Boolean))].sort((a,b) => a.slice(-4).localeCompare(b.slice(-4)) || a.localeCompare(b)).map(month => `<option value="${escape(month)}">${escape(month)}</option>`).join('');
      el('ledger-month').value = previousMonth; if (el('ledger-month').selectedIndex < 0) el('ledger-month').value = '';
      message(''); filter();
      const count=document.getElementById('db-count');if(count)count.textContent=invoicesData.length.toLocaleString();
    } catch (error) {
      if (current !== request) return;
      invoicesData = []; filter(); message(error.message || 'The invoice ledger could not load. Refresh to try again.', true);
    }
  };
  window.renderInvoices = filter;
  function renderLedger(rows) {
    visibleRows = [...rows].sort((a,b) => dateKey(a.invoice_date).localeCompare(dateKey(b.invoice_date)) || Number(a.id)-Number(b.id));
    let debit = 0, credit = 0, running = 0;
    const missing = rows.filter(r => !known(r.subtotal)).length;
    rows.forEach(r => { if (known(r.subtotal)) { const n = cents(r.subtotal); if (n >= 0) debit += n; else credit -= n; } });
    const total = debit-credit;
    el('inv-kpi-total').textContent = ready ? money(total/100)+(missing?' *':'') : '—';
    el('inv-kpi-paid').textContent = ready ? money(debit/100)+(missing?' *':'') : '—';
    el('inv-kpi-due').textContent = ready ? money(credit/100)+(missing?' *':'') : '—';
    el('ledger-count').textContent = ready ? `${rows.length} of ${invoicesData.length} records · All amounts in AUD`+(missing?` · * ${missing} missing subtotal(s); totals include recorded amounts only`:'') : 'Ledger not loaded';
    el('ledger-total').textContent = ready ? 'Net '+money(total/100)+(missing?' · incomplete':'') : '—';
    el('ledger-export').disabled = !ready || !rows.length;
    el('inv-body').innerHTML = visibleRows.map(r => {
      const n = known(r.subtotal) ? cents(r.subtotal) : null;
      if (n !== null) running += n;
      const kind = n < 0 ? 'Credit note' : 'Invoice';
      return `<tr data-inv-id="${Number(r.id)}"><td>${escape(r.invoice_date || 'Not recorded')}</td><td><button class="ledger-ref" data-invoice="${Number(r.id)}">${escape(r.invoice_number || 'View entry')}</button><span class="ledger-sub">${kind}</span></td><td>${escape(r.contractor || 'Not recorded')}</td><td>${escape(rowProjectLabel(r))}<span class="ledger-sub">${escape(r.program || 'Program not recorded')}</span></td><td>${escape(r.po_reference || '—')}</td><td class="ledger-num" title="Net invoices and credits ÷ PO value, ex GST; all ledger entries before filters">${poUsage(r) === null ? '—' : poUsage(r).toFixed(1)+'%'}</td><td class="ledger-num">${n === null ? 'Not recorded' : n >= 0 ? money(n/100) : '—'}</td><td class="ledger-num ledger-credit">${n !== null && n < 0 ? money(-n/100) : '—'}</td><td class="ledger-num">${money(running/100)}${missing?' *':''}</td></tr>`;
    }).join('') || `<tr><td class="ledger-empty" colspan="9">${!ready?'Load the ledger to view invoices.':invoicesData.length?'No entries match these filters. Clear filters to see all entries.':'No invoices recorded.'}</td></tr>`;
  };
  function openDetails(id) {
    const row = invoicesData.find(r => Number(r.id) === id); if (!row) return;
    const detail = el('ledger-detail'); detail.hidden = false;
    detail.innerHTML = `<div class="ledger-heading"><div><h3>${escape(row.invoice_number || 'Invoice')}</h3><span>${escape(row.contractor || '')} · ${escape(row.po_reference || 'No PO recorded')}</span></div><button class="ledger-button" id="ledger-close">Close details</button></div><dl class="ledger-detail-grid">${[['Subtotal · ex GST',row.subtotal],['GST',row.gst],['Total · incl GST',row.total_aud],['Amount paid',row.amount_paid],['Amount due',row.amount_due]].map(([label,value]) => `<div><dt>${label}</dt><dd>${money(value)}</dd></div>`).join('')}<div><dt>Project</dt><dd>${escape(rowProjectLabel(row))} · ${escape(row.program || 'Program not recorded')}</dd></div><div><dt>Invoice month</dt><dd>${escape(row.billing_month || 'Not recorded')}</dd></div></dl><div class="ledger-actions"><button class="ledger-button" id="ledger-lines">View line breakdown</button><button class="ledger-button" id="ledger-attachments">Attachments</button>${row.source_file && !String(row.source_file).startsWith('manual:')?'<button class="ledger-button" id="ledger-pdf">View invoice PDF</button>':''}</div><h4>Reconciliation notes</h4><pre>${escape([row.notes,row.query_notes].filter(Boolean).join('\n\n') || 'No notes recorded.')}</pre>`;
    el('ledger-close').onclick = () => { detail.hidden = true; breakdown.hidden = true; };
    el('ledger-lines').onclick = () => { breakdown.hidden = false; loadInvoiceBreakdown(id); breakdown.scrollIntoView({behavior:'smooth',block:'start'}); };
    el('ledger-attachments').onclick = () => openInvoiceAttachments(id);
    if (el('ledger-pdf')) el('ledger-pdf').onclick = () => viewInvoicePdf(id);
    detail.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function exportLedger() {
    if (!ready || !visibleRows.length) return;
    let running = 0;
    const records = [['Project ID','Project','Project year','Program','Date','Invoice / credit','Supplier','PO','PO used % (all entries, ex GST)','Charge ex GST','Credit ex GST','Running recorded total ex GST']];
    visibleRows.forEach(r => { const n = known(r.subtotal)?cents(r.subtotal):null; if(n !== null) running += n; records.push([rowProject(r)?.id||'',r.project,rowProject(r)?.year||'',r.program,r.invoice_date,r.invoice_number,r.contractor,r.po_reference,poUsage(r) === null?'':Number(poUsage(r).toFixed(1)),n === null?'':n >= 0?n/100:'',n !== null && n < 0?-n/100:'',running/100]); });
    const quote = value => { let s = String(value ?? ''); if (typeof value !== 'number' && /^[=+@\-\t\r]/.test(s)) s = "'"+s; return '"'+s.replace(/"/g,'""')+'"'; };
    const url = URL.createObjectURL(new Blob(['\uFEFF'+records.map(row => row.map(quote).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a'); link.href=url; link.download='invoice-ledger.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  el('ledger-refresh').onclick = () => loadInvoices(); el('ledger-export').onclick = exportLedger;
  el('ledger-reset').onclick = reset;
  el('ledger-add').onclick = () => { el('ledger-entry').open = true; populateManualInvoiceForm(); el('ledger-entry').scrollIntoView({behavior:'smooth'}); };
  [supplier,el('ledger-month'),el('ledger-project')].forEach(control => control.addEventListener('change',filter));
  el('ledger-search').addEventListener('input',filter);
  page.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',() => { view=button.dataset.view; filter(); }));
  el('inv-body').addEventListener('click',event => { const button=event.target.closest('[data-invoice]'); if(button) openDetails(Number(button.dataset.invoice)); });
  filter();
})();
