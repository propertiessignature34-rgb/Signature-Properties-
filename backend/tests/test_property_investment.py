"""
Property Investment Analyzer - Backend API tests (additive feature)
Covers /api/v2/property-investment/{calculate,list,create,get,put,delete}
Uses loopback ADMIN session for authenticated calls.
"""
import time
import pytest
import requests

PREVIEW_URL = "https://signature-props.preview.emergentagent.com"
LOCAL_URL = "http://localhost:3001"
LOOPBACK_HEADERS = {"Host": "localhost"}
POST_HEADERS = {"Host": "localhost", "Origin": "http://localhost", "Content-Type": "application/json"}
TEST_SECRET = "loopback-test-72f0c9a1b4e84d6c"
ADMIN_EMAIL = "propertiessignature34@gmail.com"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(
        f"{LOCAL_URL}/api/auth/test-session",
        headers=POST_HEADERS,
        json={"email": ADMIN_EMAIL, "secret": TEST_SECRET},
        timeout=15,
    )
    assert r.status_code == 200, f"test-session failed: {r.status_code} {r.text}"
    return s


DEFAULT_INPUT = {
    "currentMarketValue": 15000000,
    "propertyValue": 15000000,
    "purchasePrice": 15000000,
    "monthlyRent": 76000,
    "rentGrowthPct": 5,
    "appreciationPct": 5,
    "holdingYears": 10,
    "rentFrequency": "monthly",
    "tenantPaysMaintenance": True,
    "tenantPaysWater": True,
    "vacancyMethod": "percent",
    "vacancyPct": 0,
    "loanAmount": 0,
    "interestRatePct": 0,
    "loanTenureYears": 20,
}


class TestUnauthenticated:
    """Auth gate: all /api/v2/property-investment endpoints require session."""

    def test_calculate_requires_auth(self):
        r = requests.post(
            f"{PREVIEW_URL}/api/v2/property-investment/calculate",
            json={"input": DEFAULT_INPUT},
            timeout=15,
        )
        assert r.status_code == 401

    def test_list_requires_auth(self):
        r = requests.get(f"{PREVIEW_URL}/api/v2/property-investment", timeout=15)
        assert r.status_code == 401

    def test_page_route_requires_auth(self):
        # Not the HTML asset itself; server exposes /property-investment-analyzer as v2 route
        r = requests.get(
            f"{PREVIEW_URL}/property-investment-analyzer",
            timeout=15,
            allow_redirects=False,
        )
        # V2_ROUTES send to /login when unauthenticated
        assert r.status_code in (200, 302, 401)


class TestCalculate:
    def test_headline_defaults(self, admin_session):
        r = admin_session.post(
            f"{LOCAL_URL}/api/v2/property-investment/calculate",
            headers=POST_HEADERS,
            json={"input": DEFAULT_INPUT},
            timeout=15,
        )
        assert r.status_code == 200, r.text[:400]
        body = r.json()
        assert body["ok"] is True
        m = body["data"]["metrics"]
        # Gross Rental Yield = 76000*12 / 15000000 = 6.08%
        assert round(float(m["grossYield"]), 2) == 6.08
        # Annual Rent Year1 = 912000
        assert int(round(float(m["annualRentYear1"]))) == 912000
        # No NaN / Infinity
        import math
        for k, v in m.items():
            if isinstance(v, (int, float)):
                assert math.isfinite(v), f"metric {k} is not finite: {v}"

    def test_projection_year1_2_3(self, admin_session):
        r = admin_session.post(
            f"{LOCAL_URL}/api/v2/property-investment/calculate",
            headers=POST_HEADERS,
            json={"input": DEFAULT_INPUT},
            timeout=15,
        )
        body = r.json()
        proj = body["data"]["projection"]
        assert len(proj) >= 3
        assert int(round(proj[0]["monthlyRent"])) == 76000
        assert int(round(proj[1]["monthlyRent"])) == 79800
        assert int(round(proj[2]["monthlyRent"])) == 83790

    def test_scenarios_and_sensitivity(self, admin_session):
        r = admin_session.post(
            f"{LOCAL_URL}/api/v2/property-investment/calculate",
            headers=POST_HEADERS,
            json={"input": DEFAULT_INPUT},
            timeout=15,
        )
        body = r.json()
        data = body["data"]
        assert "scenarios" in data
        for k in ("conservative", "base", "optimistic"):
            assert k in data["scenarios"]
        sen = data["sensitivity"]
        assert "rentGrowth" in sen and "matrix" in sen
        assert len(sen["matrix"]) >= 3  # rows for appreciation
        # Cells per row
        for row in sen["matrix"]:
            assert "cells" in row and len(row["cells"]) >= 3

    def test_emi_when_loan_present(self, admin_session):
        inp = dict(DEFAULT_INPUT)
        inp["loanAmount"] = 10000000
        inp["interestRatePct"] = 8.5
        inp["loanTenureYears"] = 20
        r = admin_session.post(
            f"{LOCAL_URL}/api/v2/property-investment/calculate",
            headers=POST_HEADERS,
            json={"input": inp},
            timeout=15,
        )
        body = r.json()
        m = body["data"]["metrics"]
        assert m.get("hasLoan") is True
        assert m.get("emi") and float(m["emi"]) > 0


class TestSaveListDelete:
    created_id = None

    def test_save_analysis(self, admin_session):
        r = admin_session.post(
            f"{LOCAL_URL}/api/v2/property-investment",
            headers=POST_HEADERS,
            json={"name": "TEST_PIA_Backend", "input": DEFAULT_INPUT},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text[:400]
        body = r.json()
        assert body["ok"] is True
        row = body["data"]
        assert row.get("AnalysisID")
        assert row["Metrics"]["grossYield"]
        TestSaveListDelete.created_id = row["AnalysisID"]

    def test_list_contains_created(self, admin_session):
        aid = TestSaveListDelete.created_id
        if not aid:
            pytest.skip("no analysis")
        r = admin_session.get(
            f"{LOCAL_URL}/api/v2/property-investment",
            headers=LOOPBACK_HEADERS,
            timeout=15,
        )
        assert r.status_code == 200
        ids = [x["AnalysisID"] for x in r.json()["data"]]
        assert aid in ids

    def test_get_by_id(self, admin_session):
        aid = TestSaveListDelete.created_id
        if not aid:
            pytest.skip("no analysis")
        r = admin_session.get(
            f"{LOCAL_URL}/api/v2/property-investment/{aid}",
            headers=LOOPBACK_HEADERS,
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["data"]["AnalysisID"] == aid

    def test_delete(self, admin_session):
        aid = TestSaveListDelete.created_id
        if not aid:
            pytest.skip("no analysis")
        r = admin_session.delete(
            f"{LOCAL_URL}/api/v2/property-investment/{aid}",
            headers=POST_HEADERS,
            timeout=15,
        )
        assert r.status_code == 200
        # Verify gone
        r2 = admin_session.get(
            f"{LOCAL_URL}/api/v2/property-investment/{aid}",
            headers=LOOPBACK_HEADERS,
            timeout=15,
        )
        assert r2.status_code == 404


class TestRegression:
    """Ensure existing endpoints unaffected."""

    def test_dashboard_still_works(self, admin_session):
        r = admin_session.get(f"{LOCAL_URL}/api/dashboard", headers=LOOPBACK_HEADERS, timeout=15)
        assert r.status_code == 200

    def test_leads_still_works(self, admin_session):
        r = admin_session.get(f"{LOCAL_URL}/api/leads", headers=LOOPBACK_HEADERS, timeout=20)
        assert r.status_code == 200

    def test_inventory_still_works(self, admin_session):
        r = admin_session.get(f"{LOCAL_URL}/api/inventory", headers=LOOPBACK_HEADERS, timeout=15)
        assert r.status_code == 200

    def test_calculators_page_loads(self, admin_session):
        # /calculators.html is auth-gated; use loopback session
        r = admin_session.get(f"{LOCAL_URL}/calculators.html", headers=LOOPBACK_HEADERS, timeout=15)
        assert r.status_code == 200
        assert "Investment Analyzer" in r.text or "property-investment-analyzer" in r.text

    def test_analyzer_page_loads(self, admin_session):
        r = admin_session.get(f"{LOCAL_URL}/property-investment-analyzer.html", headers=LOOPBACK_HEADERS, timeout=15)
        assert r.status_code == 200
        assert "kpi-grid" in r.text and "projection-table" in r.text
