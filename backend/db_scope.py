"""Transaction-local authorization, safe behind PostgreSQL transaction poolers."""


class ScopedConnection:
    def __init__(self, connection, business_scope, audit):
        self._connection = connection
        self._business_scope = business_scope
        self._settings = {key: '' for key in (
            'app.workspace_id', 'app.business_project_id', 'app.campaign_id',
            'app.read_projects', 'app.write_projects', 'app.read_campaigns', 'app.write_campaigns')}
        self._settings['app.workspace_admin'] = 'false'
        if business_scope is not None:
            self._settings.update(business_scope.settings())
        self._settings.update({
            'app.actor_user_id': audit.user_id, 'app.request_id': audit.request_id,
            'app.request_method': audit.method, 'app.request_path': audit.path})
        self._apply()

    def _apply(self):
        # All statements run inside one transaction and therefore on one pooler backend.
        # NONE also neutralizes any role left by an older deployment's session SET ROLE.
        with self._connection.cursor() as cur:
            cur.execute('SET LOCAL ROLE NONE')
            cur.execute('SELECT set_config(k,v,TRUE) FROM unnest(%s::text[],%s::text[]) AS settings(k,v)',
                        (list(self._settings), list(self._settings.values())))
            if self._business_scope is not None:
                cur.execute('SET LOCAL ROLE drillops_business')

    def commit(self):
        self._connection.commit()
        self._apply()

    def rollback(self):
        self._connection.rollback()
        self._apply()

    def __getattr__(self, name):
        return getattr(self._connection, name)
