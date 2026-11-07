"""Plan/actuals read queries with exact, deduplicated activity matches.

Build candidate pairs with equality joins. The previous OR join evaluated
normalisation and a correlated mapping lookup for every hole/activity pair.
"""


def borehole_actuals_query(contractor, report_date_sql):
    company = contractor == 'Company'
    target_scope = "b.contractor='Company'" if company else (
        "b.contractor IN (%(contractor)s, 'Company')" if contractor else "TRUE"
    )
    activity_scope = "contractor=%(contractor)s" if contractor and not company else "TRUE"
    params = {'contractor': contractor} if contractor and not company else {}
    extra = """
        UNION
        SELECT b.id, a.id FROM targets b JOIN activity_keys a ON a.hole_key=b.hole_key
        WHERE b.project='Ironbark' AND (a.project='Ironbark' OR BTRIM(COALESCE(a.project,''))='')
          AND BTRIM(COALESCE(a.hole_num,''))<>''
        UNION
        SELECT b.id, a.id FROM targets b JOIN activity_keys a ON a.site_key=b.site_key
        WHERE b.project='Ironbark' AND (a.project='Ironbark' OR BTRIM(COALESCE(a.project,''))='')
          AND BTRIM(COALESCE(b.site_id,''))<>'' AND BTRIM(COALESCE(a.hole_num,''))<>''
        UNION
        SELECT b.id, a.id FROM targets b JOIN activity_keys a ON a.hole_num='IB674'
        WHERE b.project='Ironbark' AND b.hole_id='IB674C'
          AND a.project='Ironbark' AND a.program='Exploration'
        UNION
        SELECT b.id, a.id FROM targets b
        JOIN boreholes mapped ON mapped.contractor='Company'
          AND BTRIM(COALESCE(mapped.site_id,''))=BTRIM(COALESCE(b.site_id,''))
        JOIN activity_keys a ON a.hole_num=mapped.hole_id
        WHERE COALESCE(b.site_id,'')<>''
        UNION
        SELECT b.id, a.id FROM targets b
        JOIN boreholes mapped ON mapped.contractor='Company'
          AND BTRIM(COALESCE(mapped.site_id,''))=BTRIM(COALESCE(b.site_id,''))
        JOIN activity_keys a ON a.site_name=mapped.site_id
        WHERE COALESCE(b.site_id,'')<>'' AND COALESCE(mapped.site_id,'')<>''
    """ if company else ''
    completion = f"""
        COALESCE(
            MAX(CASE WHEN COALESCE(a.notes,'') ~* '(^|[^a-z])(end of hole|eoh)([^a-z]|$)' THEN {report_date_sql} END),
            MAX(CASE WHEN a.code LIKE 'Drill_%%' THEN {report_date_sql} END),
            MAX({report_date_sql})
        )
    """ if company else """
        COALESCE(
            MAX(CASE WHEN COALESCE(a.notes,'') ~* '(^|[^a-z])(end of hole|eoh)([^a-z]|$)'
                AND a.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN a.date END),
            MAX(CASE WHEN a.code LIKE 'Drill_%%'
                AND a.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN a.date END)
        )
    """
    query = f"""
        WITH targets AS MATERIALIZED (
            SELECT b.id, b.hole_id, b.site_id, b.project, b.contractor,
                REGEXP_REPLACE(UPPER(COALESCE(b.hole_id,'')), '[^A-Z0-9]', '', 'g') AS hole_key,
                REGEXP_REPLACE(UPPER(COALESCE(b.site_id,'')), '[^A-Z0-9]', '', 'g') AS site_key
            FROM boreholes b WHERE {target_scope}
        ), activity_keys AS MATERIALIZED (
            SELECT id, contractor, project, program, hole_num, site_name,
                REGEXP_REPLACE(UPPER(COALESCE(hole_num,'')), '[^A-Z0-9]', '', 'g') AS hole_key,
                REGEXP_REPLACE(UPPER(COALESCE(site_name,'')), '[^A-Z0-9]', '', 'g') AS site_key,
                CASE hole_num WHEN 'ESPNG8' THEN 'ESPNG08' WHEN 'ESPGN8' THEN 'ESPNG08'
                    WHEN 'ESPGN10' THEN 'ESPNG10' WHEN 'ESPGN13' THEN 'ESPNG13' ELSE NULL END AS burton_alias
            FROM activities WHERE {activity_scope}
        ), matches AS (
            SELECT b.id AS borehole_id, a.id AS activity_id
            FROM targets b JOIN activity_keys a ON a.hole_num=b.hole_id
            UNION
            SELECT b.id, a.id FROM targets b JOIN activity_keys a ON a.site_name=b.site_id
            WHERE COALESCE(b.site_id,'')<>''
            UNION
            SELECT b.id, a.id FROM targets b JOIN activity_keys a ON a.burton_alias=b.hole_id
            WHERE b.project='BCC Fugitive Emissions' AND a.project='BCC Fugitive Emissions'
              AND a.contractor='Mitchells Drilling'
            {extra}
        )
        SELECT b.*,
            COALESCE(SUM(a.line_cost),0) AS eos_cost,
            COALESCE(SUM(CASE WHEN a.code LIKE 'Drill_%%'
                OR a.code IN ('H_Min_Shift','H_Casing_Install','H_Circulation_Flush','H_Circulation_Lost','H_Reaming','H_Rig_Cementing','H_Surface_Setup','H_Tripping_Rods')
                THEN a.line_cost ELSE 0 END),0) AS drilling_cost,
            SUM(CASE WHEN a.code LIKE 'Drill_%%' THEN a.total_metres ELSE 0 END) AS drilling_metres,
            SUM(a.total_metres) AS eos_metres,
            COALESCE(BOOL_OR(COALESCE(a.notes,'') ~* '(^|[^a-z])(end of hole|eoh)([^a-z]|$)'), FALSE) AS activity_complete,
            {completion} AS completion_date
        FROM boreholes b JOIN targets t ON t.id=b.id
        LEFT JOIN matches m ON m.borehole_id=b.id
        LEFT JOIN activities a ON a.id=m.activity_id {'' if contractor else 'AND a.contractor=b.contractor'}
        GROUP BY b.id ORDER BY b.drill_order
    """
    return query, params
