"""Backend tests for Kanban tap-to-move + Builder Projects images (iteration 7)."""
import os
import pytest
import requests

# Use loopback to hit Node CRM directly for auth-gated endpoints
CRM = "http://localhost:3001"
SECRET = "loopback-test-72f0c9a1b4e84d6c"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(
        f"{CRM}/api/auth/test-session",
        headers={"Host": "localhost", "Content-Type": "application/json"},
        json={"email": "propertiessignature34@gmail.com", "secret": SECRET},
    )
    assert r.status_code == 200 and r.json().get("ok"), r.text
    s.headers.update({"Host": "localhost"})
    return s


# --- Leads Kanban ---
class TestLeadsBoard:
    def test_leads_board_returns_data(self, session):
        r = session.get(f"{CRM}/api/v2/leads-board")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert isinstance(body["data"], list)
        assert len(body["data"]) > 0
        keys = body["data"][0].keys()
        assert "LeadID" in keys and "ClientStatus" in keys

    def test_move_lead_to_lost_and_back(self, session):
        board = session.get(f"{CRM}/api/v2/leads-board").json()["data"]
        # pick a lead that is NOT already Lost so we can revert cleanly
        lead = next(l for l in board if l["ClientStatus"] != "Lost")
        lid = lead["LeadID"]
        original = lead["ClientStatus"]

        # move to Lost
        r = session.patch(
            f"{CRM}/api/v2/leads-board/{lid}/status",
            headers={"Origin": "http://localhost", "Content-Type": "application/json"},
            json={"status": "Lost"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"]["ClientStatus"] == "Lost"

        # verify persistence via GET
        board2 = session.get(f"{CRM}/api/v2/leads-board").json()["data"]
        assert next(l for l in board2 if l["LeadID"] == lid)["ClientStatus"] == "Lost"

        # revert to original
        r = session.patch(
            f"{CRM}/api/v2/leads-board/{lid}/status",
            headers={"Origin": "http://localhost", "Content-Type": "application/json"},
            json={"status": original},
        )
        assert r.status_code == 200
        assert r.json()["data"]["ClientStatus"] == original

        board3 = session.get(f"{CRM}/api/v2/leads-board").json()["data"]
        assert next(l for l in board3 if l["LeadID"] == lid)["ClientStatus"] == original

    def test_free_movement_allows_any_stage(self, session):
        # transition validation intentionally disabled; test moving to arbitrary stage
        board = session.get(f"{CRM}/api/v2/leads-board").json()["data"]
        lead = next(l for l in board if l["ClientStatus"] != "Lost")
        lid = lead["LeadID"]; original = lead["ClientStatus"]
        for stage in ["Site Visit", "Negotiation", "Won"]:
            r = session.patch(
                f"{CRM}/api/v2/leads-board/{lid}/status",
                headers={"Origin": "http://localhost", "Content-Type": "application/json"},
                json={"status": stage},
            )
            assert r.status_code == 200, f"{stage}: {r.text}"
            assert r.json()["data"]["ClientStatus"] == stage
        # revert
        session.patch(
            f"{CRM}/api/v2/leads-board/{lid}/status",
            headers={"Origin": "http://localhost", "Content-Type": "application/json"},
            json={"status": original},
        )


# --- Builder Projects images ---
class TestBuilderProjectsImages:
    def test_csp_allows_https_images(self, session):
        r = session.get(f"{CRM}/builder-projects.html")
        csp = r.headers.get("Content-Security-Policy", "")
        assert "img-src" in csp
        # img-src must include https:
        img_src = [p for p in csp.split(";") if "img-src" in p][0]
        assert "https:" in img_src, f"CSP img-src missing https: -> {img_src}"

    def test_projects_have_photo_urls(self, session):
        r = session.get(f"{CRM}/api/v2/builder-projects?limit=1000")
        assert r.status_code == 200
        items = r.json().get("data") or []
        assert len(items) > 500, f"expected >500 projects, got {len(items)}"
        with_photos = [p for p in items if p.get("Photos")]
        # spec expects ~732 with photos out of 758
        assert len(with_photos) > 500, f"only {len(with_photos)} projects have photos"
        # every photo should have an https Url
        sample = with_photos[:20]
        for p in sample:
            url = (p["Photos"][0] or {}).get("Url") or (p["Photos"][0] or {}).get("SourceUrl")
            assert url and url.startswith("https://"), f"bad photo url {url}"


# --- Regression ---
class TestRegression:
    def test_pin_login_endpoint(self):
        r = requests.post(
            f"{CRM}/api/auth/pin-login",
            headers={"Host": "localhost", "Content-Type": "application/json",
                     "Origin": "http://localhost"},
            json={"pin": "1234"},
        )
        assert r.status_code == 200 and r.json().get("ok") is True

    def test_pages_load(self, session):
        for path in ["/", "/calculators.html", "/inventory.html", "/clients.html",
                     "/leads-kanban.html", "/builder-projects.html",
                     "/property-investment-analyzer.html"]:
            r = session.get(f"{CRM}{path}")
            assert r.status_code == 200, f"{path} -> {r.status_code}"

    def test_pia_defaults_gross_yield(self, session):
        payload = {"currentMarketValue": 15000000, "propertyValue": 15000000,
                   "purchasePrice": 15000000, "monthlyRent": 76000,
                   "rentGrowthPct": 5, "appreciationPct": 5, "holdingYears": 10,
                   "rentFrequency": "monthly"}
        r = session.post(
            f"{CRM}/api/v2/property-investment/calculate",
            headers={"Origin": "http://localhost", "Content-Type": "application/json"},
            json=payload,
        )
        assert r.status_code == 200, r.text
        body = r.json()["data"]
        gy = body.get("metrics", {}).get("grossYieldPct")
        assert gy is not None, body
        assert abs(float(gy) - 6.08) < 0.05, f"grossYieldPct={gy}"
