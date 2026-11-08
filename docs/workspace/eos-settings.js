/* Only raw tables are opt-in; the PLOD register is always available. */
function updateEosSettings(){
 productionSet('eos-raw-status',eosRawLogsEnabled?'Loaded for this session':'Not loaded');
 productionSet('eos-load-raw',eosRawLogsEnabled?'Open raw logs':'Load raw logs');
 document.body.classList.toggle('eos-raw-logs-enabled',eosRawLogsEnabled);
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
 document.querySelectorAll('#act-body,#con-body,#crew-body,#mcc-personnel-body,#mcc-weekly-audit-body,#eos-period-document .eos-period-data-table tbody').forEach(el=>el.replaceChildren());
 document.querySelectorAll('#eos-period-document .eos-period-data-table').forEach(el=>el.hidden=true);
 document.getElementById('activity-log-panel')?.classList.add('collapsed');
 activityMissingCodesOnly=false;updateMissingCodeButton();
 updateEosSettings();toast('Raw logs and optional tables unloaded');
}
