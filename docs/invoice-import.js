(function(){
 const input=document.getElementById('inv-file-input-sidebar');if(!input)return;
 const project=document.getElementById('inv-import-project'),po=document.getElementById('inv-import-po'),button=document.getElementById('inv-import-btn-sidebar'),log=document.getElementById('inv-import-log-sidebar'),status=document.getElementById('inv-import-destination');
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const norm=v=>String(v||'').trim().toLowerCase();
 let files=[],pos=[],invoices=[],busy=false,ready=false,request=0;
 function selectedProject(){return projects.find(p=>String(p.id)===project.value);}
 function selectedPO(){return pos.find(p=>String(p.id)===po.value);}
 function update(){
  button.disabled=busy||!ready||!files.length||!selectedProject()||!selectedPO();
  button.textContent=busy?'Importing…':files.length?'Import '+files.length+' invoice(s)':'Import Invoices';
 }
 function showPOs(){
  const p=selectedProject(),old=po.value;
  const matches=p?pos.filter(item=>norm(item.project)===norm(p.name)&&norm(item.program)===norm(projectProgram(p))):[];
  po.innerHTML='<option value="">'+(p?'Choose PO number':'Choose project first')+'</option>'+matches.map(item=>'<option value="'+Number(item.id)+'">'+escape(item.po_number+' · '+item.contractor)+'</option>').join('');
  po.value=old;if(po.selectedIndex<0)po.value='';po.disabled=busy||!p||!matches.length;
  status.textContent=p&&!matches.length?'No purchase orders recorded for this project. Add the PO under Purchase orders first.':selectedPO()?'Supplier: '+selectedPO().contractor:'';
  update();
 }
 window.loadInvoiceImportOptions=async function(){
  const current=++request;ready=false;update();status.textContent='Loading projects and purchase orders…';
  const previous=project.value;
  project.innerHTML='<option value="">Choose project</option>'+projects.map(p=>'<option value="'+Number(p.id)+'">'+escape([p.name,p.year,projectProgram(p)].filter(Boolean).join(' · '))+'</option>').join('');
  project.value=previous;if(project.selectedIndex<0)project.value='';
  try{
   const response=await fetch(API+'/invoice-ledger',{cache:'no-store'});if(!response.ok)throw new Error('Could not load purchase orders. Reopen Import invoices to retry.');
   const data=await response.json();if(!Array.isArray(data.purchase_orders)||!Array.isArray(data.invoices))throw new Error('Could not read purchase orders.');if(current!==request)return;
   pos=data.purchase_orders;invoices=data.invoices;ready=true;showPOs();
  }catch(error){if(current!==request)return;status.textContent=error.message;update();}
 };
 function chooseFiles(list){
  files=Array.from(list).filter(f=>/\.pdf$/i.test(f.name));log.replaceChildren();
  for(const file of files){if(invoices.some(i=>i.source_file===file.name))append('warning',file.name+' — this filename is already recorded. The invoice number and PDF will be checked before saving.');}
  update();
 }
 function append(kind,message){const row=document.createElement('div');row.style.color=kind==='success'?'var(--green)':kind==='warning'?'var(--yellow)':'var(--red)';row.textContent=message;log.append(row);}
 project.addEventListener('change',()=>{po.value='';showPOs();});po.addEventListener('change',showPOs);
 input.addEventListener('change',event=>chooseFiles(event.target.files));
 const drop=document.getElementById('inv-drop-zone-sidebar');drop.addEventListener('dragover',event=>event.preventDefault());drop.addEventListener('drop',event=>{event.preventDefault();if(!busy)chooseFiles(event.dataTransfer.files);});
 button.addEventListener('click',async()=>{
  if(button.disabled)return;
  const p=selectedProject(),purchase=selectedPO(),batch=[...files];busy=true;project.disabled=true;po.disabled=true;input.disabled=true;update();log.replaceChildren();
  const failed=[];
  try{
   for(const file of batch){
    const data=new FormData();data.append('file',file);data.append('project_id',p.id);data.append('po_id',purchase.id);
    try{
     const response=await fetch(API+'/invoices/import',{method:'POST',body:data});const result=await response.json();
     if(!response.ok)throw new Error(result.detail||'Import failed.');
     if(result.status==='imported'){append('success',file.name+' — imported '+result.invoice_number+' to '+p.name+' / '+purchase.po_number);invoices.push({source_file:file.name});}
     else if(result.status==='duplicate'){const old=result.existing_invoice||{};append('warning',file.name+' — DUPLICATE: '+(old.invoice_number||'invoice')+' is already recorded'+(old.project?' under '+old.project:'')+(old.po_reference?' / '+old.po_reference:'')+'. Nothing added.');}
     else if(result.status==='skipped')append('warning',file.name+' — already imported. Nothing added.');
     else throw new Error('The import response was not recognised.');
    }catch(error){failed.push(file);append('error',file.name+' — '+error.message);}
   }
  }finally{files=failed;busy=false;project.disabled=false;input.disabled=false;input.value='';showPOs();}
 });
})();
