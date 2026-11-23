"""Resolve a contract's single shared schedule without copying its rate rows."""
from fastapi import HTTPException


def rates_for_contract(cur, contract):
    if contract.get('rate_schedule_id'):
        cur.execute('SELECT rates FROM shared_rate_schedules WHERE id=%s AND workspace_id=%s',
                    (contract['rate_schedule_id'], contract['workspace_id']))
        schedule = cur.fetchone()
        if not schedule:
            raise HTTPException(409, 'The linked rate schedule is unavailable')
        return [dict(row, id=-(index + 1), contract_id=contract['id'], shared_schedule=True)
                for index, row in enumerate(schedule['rates'])]
    cur.execute('SELECT * FROM cost_contract_rates WHERE contract_id=%s ORDER BY sort_order, id', (contract['id'],))
    return [dict(row) for row in cur.fetchall()]


def require_individual_schedule(cur, contract_id):
    cur.execute('SELECT rate_schedule_id FROM cost_contracts WHERE id=%s', (contract_id,))
    contract = cur.fetchone()
    if not contract:
        raise HTTPException(404, 'Cost contract not found')
    if contract.get('rate_schedule_id'):
        raise HTTPException(409, 'This contract uses the shared Validation Sheet schedule; duplicate rate lists cannot be added')
