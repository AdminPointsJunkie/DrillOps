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
function loadEosReportTables(){
 document.getElementById('eos-period-show-tables').checked=true;
 document.querySelectorAll('#eos-period-document .eos-period-data-table').forEach(el=>el.hidden=false);
 drawerNav(document.querySelector('.drawer-nav-item[data-page="reports"]'));
}
function unloadEosRawLogs(){
 eosRawLogsEnabled=false;activitiesRequestSequence++;
 document.getElementById('eos-period-show-tables').checked=false;
 document.querySelectorAll('#page-activities tbody,#eos-period-document tbody:not(#eos-period-register)').forEach(el=>el.replaceChildren());
 document.querySelectorAll('#eos-period-document .eos-period-data-table').forEach(el=>el.hidden=true);
 document.getElementById('activity-log-panel')?.classList.add('collapsed');
 activitiesData=[];consumablesData=[];reportConsumablesData=[];crewData=[];dailyReportsData=[];mccWeeklyReportsData=[];
 closeDailyReportDetail();updateEosSettings();toast('Logs and tables unloaded');
}
