"""MCC Schedule of Rates dated 23 April 2026."""

import re


MCC_SCHEDULE_DATE = "23 April 2026"
MCC_SCHEDULE_EXCLUSIONS = "Rates exclude accommodation and diesel"
MCC_SCHEDULE_RATES = [
    ("MCC_LABOURER", "Labourer", 85.00, "hour", "labour", ["labourer"]),
    ("MCC_CONSTRUCTION_TRADE", "Construction Trade", 100.00, "hour", "labour", ["construction trade", "construc4on trade"]),
    ("MCC_MECHANICAL_TRADE", "Mechanical Trade", 115.00, "hour", "labour", ["mechanical trade"]),
    ("MCC_PUMP_CREW_OPERATOR", "Pump Crew Operator", 95.00, "hour", "labour", ["pump crew operator"]),
    ("MCC_MULTI_SKILLED_OPERATOR", "Multi Skilled Operator", 100.00, "hour", "labour", ["multi skilled operator", "mul4 skilled operator"]),
    ("MCC_SUPERVISOR", "Supervisor", 120.00, "hour", "labour", ["supervisor"]),
    ("MCC_PROJECT_MANAGER", "Project Manager", 140.00, "hour", "labour", ["project manager"]),
    ("MCC_LIGHT_VEHICLE", "Light Vehicle", 105.00, "day", "equipment", ["light vehicle", "light vehicles", "lv"]),
    ("MCC_5T_EXCAVATOR", "5t Excavator", 50.00, "hour", "equipment", ["5t excavator", "pc45 excavator", "komatsu pc45", "ex02"]),
    ("MCC_13T_EXCAVATOR", "13t Excavator", 85.00, "hour", "equipment", ["13t excavator", "hitachi 135 excavator", "hitachi zx135us-7 excavator", "zx135", "ex16"]),
    ("MCC_36T_EXCAVATOR", "36t Excavator", 115.00, "hour", "equipment", ["36t excavator"]),
    ("MCC_SKID_STEER", "Skid Steer", 50.00, "hour", "equipment", ["skid steer"]),
    ("MCC_10T_BODY_TIP_TRUCK", "10t Body Tip Truck", 50.00, "hour", "equipment", ["10t body tip truck"]),
    ("MCC_BODY_WATER_TRUCK", "Body Water Truck", 80.00, "hour", "equipment", ["body water truck", "water truck", "hino fm500 water truck", "wt01"]),
    ("MCC_105HP_TRACTOR", "105 Horsepower Tractor", 85.00, "hour", "equipment", ["105 horsepower tractor"]),
    ("MCC_SMALL_TOOL_HIRE", "Small Tool Hire", 50.00, "day", "equipment", ["small tool hire", "chainsaw", "whipper snipper"]),
    ("MCC_355MM_POLYWELDER", "355mm Polywelder", 150.00, "day", "equipment", ["355mm polywelder", "polywelder"]),
    ("MCC_TRAILER_HIRE", "Trailer Hire", 100.00, "day", "equipment", ["trailer hire"]),
    ("MCC_EQUIPMENT_ATTACHMENT", "Attachment for Equipment", 25.00, "hour", "equipment", ["attachment for equipment", "grader", "auger", "rock breaker", "slasher"]),
    ("MCC_120T_EXCAVATOR", "120t Excavator", 220.00, "hour", "equipment", ["120t excavator"]),
    ("MCC_90T_EXCAVATOR", "90t Excavator", 180.00, "hour", "equipment", ["90t excavator"]),
    ("MCC_100T_DUMP_WATER_TRUCK", "100t Dump Truck Class/Water Truck", 165.00, "hour", "equipment", ["100t dump truck", "100t water truck"]),
    ("MCC_40T_ARTICULATED_WATER_TRUCK", "40t Articulated Water Truck", 130.00, "hour", "equipment", ["40t articulated water truck", "40t ar4culated water truck"]),
    ("MCC_IT_LOADER", "IT Loader 15-20t Class", 85.00, "hour", "equipment", ["it loader", "15-20t class"]),
    ("MCC_LOADER_110T", "Loader 110t Class", 230.00, "hour", "equipment", ["loader 110t"]),
    ("MCC_SERVICE_TRUCK", "Service Truck", 80.00, "hour", "equipment", ["service truck"]),
    ("MCC_14_GRADER", "14ft Grader", 125.00, "hour", "equipment", ["14ft grader", "14^ grader", "14 grader"]),
    ("MCC_16_GRADER", "16ft Grader", 145.00, "hour", "equipment", ["16ft grader", "16^ grader", "16 grader"]),
    ("MCC_30T_ARTICULATED_DUMP_TRUCK", "30t Articulated Dump Truck", 105.00, "hour", "equipment", ["30t articulated dump truck", "30t ar4culated dump truck"]),
    ("MCC_40T_ARTICULATED_DUMP_TRUCK", "40t Articulated Dump Truck", 130.00, "hour", "equipment", ["40t articulated dump truck", "40t ar4culated dump truck"]),
    ("MCC_D11_DOZER", "D11 Dozer", 225.00, "hour", "equipment", ["d11 dozer"]),
    ("MCC_D10_DOZER", "D10 Dozer", 185.00, "hour", "equipment", ["d10 dozer"]),
]
MCC_CUSTOM_RATES = [
    ("MCC_BACKHOE", "Backhoe", 65.00, "hour", "equipment", ["backhoe", "caterpillar 432", "caterpillar 432 backhoe", "ld04"]),
    ("MCC_VAC_TRUCK", "Vacuum Truck", 810.00, "day", "equipment", ["vac truck", "vacuum truck", "isuzu npr400 vac truck", "mcc39"]),
]
MCC_CUSTOM_RATE_CODES = {row[0] for row in MCC_CUSTOM_RATES}
MCC_RATE_TABLE = MCC_SCHEDULE_RATES + MCC_CUSTOM_RATES


def _normalise(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def mcc_schedule_match(value, group=None):
    haystack = _normalise(value)
    if not haystack:
        return None
    for code, description, rate, unit, rate_group, aliases in MCC_RATE_TABLE:
        if group and rate_group != group:
            continue
        for alias in aliases + [description]:
            needle = _normalise(alias)
            if needle and (needle == haystack or needle in haystack or haystack in needle):
                return {
                    "code": code,
                    "description": description,
                    "rate": rate,
                    "unit": unit,
                    "group": rate_group,
                    "source": "custom" if code in MCC_CUSTOM_RATE_CODES else "schedule",
                }
    return None


def apply_mcc_schedule_rate(row, rate_group, rate_text):
    """Assign a matched MCC rate and calculated line cost to an activity row."""
    match = mcc_schedule_match(rate_text, rate_group)
    if not match:
        return False
    quantity = 1 if match["unit"] == "day" else row.get("quantity")
    line_cost = None
    if quantity is not None:
        line_cost = round(float(quantity) * float(match["rate"]), 2)
    row.update({
        "code": match["code"],
        "unit_rate": match["rate"],
        "quantity": quantity,
        "line_cost": line_cost,
        "rate_basis": (
            f"MCC custom rate - {match['description']} (${match['rate']:,.2f}/{match['unit']})"
            if match["source"] == "custom"
            else f"MCC schedule {MCC_SCHEDULE_DATE} - {match['description']} "
                 f"(${match['rate']:,.2f}/{match['unit']}); excludes accommodation and diesel"
        ),
    })
    return True
