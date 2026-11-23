from dataclasses import replace
from unittest.mock import MagicMock
import pytest
from fastapi import HTTPException
from business_platform import BusinessScope, current_business_scope
from claim_reconciliation import compare_claim, project_report_scope
from depco_validation import norm, apply_validation
from shared_rates import rates_for_contract, require_individual_schedule


def claim(day='15/09/2026', code='PCD 90 - 125', rate=10, quantity=2):
    return dict(date=day, code=code, unit_rate=rate, quantity=quantity, line_cost=rate*quantity,
                hole_num='IB1', metres_from=0, metres_to=quantity, total_metres=quantity)


def header(**kwargs):
    return dict(period_start='2026-09-15', period_end='2026-09-16',
                validation_rates={norm('PCD 90 - 125'):dict(name='PCD 90 - 125',rate=10,unit='p/m',source='Validation Sheet!B1')},**kwargs)


def test_matching_requires_every_line_not_just_daily_net():
    source=[claim(quantity=2),claim(quantity=3)]
    live=[dict(source[0],line_cost=10),dict(source[1],line_cost=40)]
    result=compare_claim(header(),source,live)
    assert result['daily'][0]['daily_total_matches']
    assert result['daily'][0]['status']=='Activity review'
    assert result['totals']['review_activities']==2
    assert not result['reconciled']


def test_daily_offsets_do_not_reconcile():
    source=[claim(),claim('16/09/2026')]
    live=[dict(source[0],line_cost=10),dict(source[1],line_cost=30)]
    result=compare_claim(header(),source,live)
    assert result['totals']['difference']==0
    assert result['totals']['review_days']==2


def test_validation_overrides_submitted_rate():
    source=[claim(rate=20)]
    result=compare_claim(header(),source,[claim()])
    assert result['reconciled']
    assert result['totals']['claim_in_period']==40
    assert result['totals']['expected_priced']==20


def test_zero_exception_preserved_but_reviewed():
    result=compare_claim(header(),[claim(rate=0)],[claim(rate=0)])
    assert result['totals']['expected_priced']==0
    assert result['totals']['zero_exceptions']==1
    assert not result['reconciled']


def test_missing_rates_and_unpriced_costs_are_incomplete():
    h=header();h['validation_rates']={}
    result=compare_claim(h,[claim()],[dict(claim(),line_cost=None)])
    assert result['daily'][0]['expected'] is None
    assert result['totals']['unpriced_lines']==1
    assert not result['reconciled']


def test_dates_and_hole_aliases_not_silently_fixed():
    source=[claim(),claim('21/06/2026')]
    result=compare_claim(header(),source,[dict(claim(),hole_num='IF1')])
    assert result['totals']['outside_lines']==1
    assert result['totals']['matched_activities']==0
    assert result['warnings']


def test_free_and_billable_travel_distinct():
    assert norm('Crew Travel (<0.5hrs)') != norm('Crew Travel (>0.5hrs)')


def test_ambiguous_equal_lines_not_greedily_paired():
    result=compare_claim(header(),[claim(),claim()],[claim(),claim()])
    assert result['totals']['matched_activities']==0
    assert result['totals']['activity_pairs']==4


def test_scope_requires_full_project_and_restores_campaign():
    scope=BusinessScope('workspace','project','campaign',read_campaigns=('campaign',))
    token=current_business_scope.set(scope)
    try:
        with pytest.raises(HTTPException):
            with project_report_scope(): pass
        current_business_scope.set(replace(scope,read_projects=('project',)))
        with project_report_scope() as expanded:
            assert expanded.campaign_id=='' and expanded.workspace_id=='workspace'
        assert current_business_scope.get().campaign_id=='campaign'
        with pytest.raises(HTTPException):
            with project_report_scope(write=True): pass
    finally: current_business_scope.reset(token)


def test_shared_schedule_reads_single_record_and_rejects_duplicates():
    cur=MagicMock();cur.fetchone.return_value={'rates':[{'name':'Active','charge':630}]}
    result=rates_for_contract(cur,dict(id=3,workspace_id='w',rate_schedule_id=1))
    assert result[0]['charge']==630 and result[0]['shared_schedule']
    assert cur.execute.call_args.args[1]==(1,'w')
    cur.fetchone.return_value={'rate_schedule_id':1}
    with pytest.raises(HTTPException) as error: require_individual_schedule(cur,3)
    assert error.value.status_code==409


def test_unavailable_shared_schedule_does_not_fall_back():
    cur=MagicMock();cur.fetchone.return_value=None
    with pytest.raises(HTTPException): rates_for_contract(cur,dict(id=3,workspace_id='w',rate_schedule_id=1))


def test_validation_schedule_prices_depth_bands_and_requires_unknown_rates():
    import json
    from pathlib import Path
    from depco_rates import price_depco_activity
    rates=json.loads((Path(__file__).parent/'data/depco_exploration_validation_rates.json').read_text(encoding='utf-8'))['rates']
    assert len({r['cost_code'] for r in rates})==len(rates)
    for name,quantity,expected in [('Active Rig Rate',2,1260),('Standby Rate',2,970),('Wet Weather Standby',2,970)]:
        rate=next(r for r in rates if r['name']==name)
        result=price_depco_activity(dict(code=rate['cost_code'],total_time=quantity),rates)
        assert result['line_cost']==expected
    pcd=next(r for r in rates if r['name']=='PCD 90 - 125')
    assert price_depco_activity(dict(code=pcd['cost_code'],metres_from=90,metres_to=110,total_metres=20),rates)['line_cost']==717.8
    for rate in rates:
        if rate['charge'] is None:
            assert rate['status']=='Review'
            assert price_depco_activity(dict(code=rate['cost_code'],total_time=2,quantity=2),rates)['line_cost'] is None
