import unittest

from mcc_site_services import (
    extract_site_ids,
    parse_mcc_site_services,
    work_groups_for_sites,
)


class MCCSiteServicesTests(unittest.TestCase):
    def test_extracts_and_normalises_all_site_ids(self):
        sites = extract_site_ids("GR20, IB-26-19, MG08-2 and MG08-01V")
        self.assertEqual(sites, ["GR20", "IB-26-019", "MG08-02", "MG08-01V"])
        self.assertEqual(work_groups_for_sites(sites), ["Exploration", "Gas Riser", "SIS"])

    def test_parses_equipment_and_labour_with_row_level_scope(self):
        table = [
            ["Manning", None, "Actual", "Comments"],
            ["Supervisors", None, "1", "Michael Chilby"],
            ["Equipment ID", "Description", None, "Start Hrs End Hours Operating Hrs", None, None, "Operator", "Descripion of Works"],
            ["LD04", "Backhoe", None, "5081.8", "5087.7", "5.9", "Michael Chilby", "Rehab IB-26-057 and shift material on MG09-2"],
            ["", "#N/A", None, "", "", "0.0", "", ""],
            ["Tradesperson/Labourer", None, None, "Hrs", "Construction Works Completed"],
            ["Daniel Bruton", None, None, "12", "Plumbing works at GR20"],
        ]
        header, rows, _, crew, _ = parse_mcc_site_services(
            "ARGO SITE SERVICES DAILY REPORT\nDS 8/24/2026",
            [table],
            "20260824-MCC-ARGO-REP-SiteServicesReport.pdf",
        )
        self.assertEqual(header["date"], "24/08/2026")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["program"], "Exploration, SIS")
        self.assertEqual(rows[0]["site_name"], "IB-26-057, MG09-02")
        self.assertEqual(rows[0]["total_time"], "5:54")
        self.assertEqual(rows[1]["program"], "Gas Riser")
        self.assertEqual(rows[1]["site_name"], "GR20")
        self.assertTrue(any(item["name"] == "Daniel Bruton" for item in crew))


if __name__ == "__main__":
    unittest.main()
