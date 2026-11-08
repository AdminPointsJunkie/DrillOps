/* Raw registers and detailed tables are opt-in for the current browser tab. */
function updateEosSettings(){
 productionSet('eos-raw-status',eosRawLogsEnabled?'Loaded for this session':'Not loaded');
 productionSet('eos-load-raw',eosRawLogsEnabled?'Open raw logs':'Load raw logs');
 document.querySelectorAll('.eos-raw-nav').forEach(el=>el.hidden=!eosRawLogsEnabled);
}
function loadEosRawLogs(){
 eosRawLogsEnabled=true;updateEosSettings();
 const panel=document.getElementById('activity-log-panel');if(panel)panel.classList.remove('collapsed');
 productionSet('activity-log-toggle-label','Hide activity log');
 drawerNav(document.querySelector('.drawer-nav-item[data-page="activities"]'));
}
function loadEosReportTables(page){
 const production=page==='production',id=production?'production-show-tables':'eos-period-show-tables';
 document.getElementById(id).checked=true;
 if(production)document.getElementById('production-show-detail').checked=true;
 document.querySelectorAll(production?'#production-report .production-data-table':'#eos-period-document .eos-period-data-table').forEach(el=>el.hidden=false);
 drawerNav(document.querySelector('.drawer-nav-item[data-page="'+page+'"]'));
}
function unloadEosRawLogs(){
 eosRawLogsEnabled=false;activitiesRequestSequence++;
 for(const id of ['production-show-tables','production-show-detail','eos-period-show-tables'])document.getElementById(id).checked=false;
 document.querySelectorAll('#page-activities tbody,#production-report tbody,#eos-period-document tbody').forEach(el=>el.replaceChildren());
 document.querySelectorAll('#production-report .production-data-table,#eos-period-document .eos-period-data-table,#production-detail').forEach(el=>el.hidden=true);
 document.getElementById('activity-log-panel')?.classList.add('collapsed');
 activitiesData=[];consumablesData=[];reportConsumablesData=[];crewData=[];dailyReportsData=[];mccWeeklyReportsData=[];
 closeDailyReportDetail();updateEosSettings();toast('Logs and tables unloaded');
}
