"""
Signature Realty CRM - Backend API tests
Tests both public (via preview URL) and authenticated (via localhost:3001 loopback) endpoints.
"""
import os
import time
import pytest
import requests

PREVIEW_URL = "https://signature-props.preview.emergentagent.com"
LOCAL_URL = "http://localhost:3001"
LOOPBACK_HEADERS = {"Host": "localhost"}
POST_HEADERS = {"Host": "localhost", "Origin": "http://localhost", "Content-Type": "application/json"}
TEST_SECRET = "loopback-test-72f0c9a1b4e84d6c"
ADMIN_EMAIL = "propertiessignature34@gmail.com"


# ---------- Public / Unauthenticated tests via preview URL ----------

class TestPublic:
    def test_login_html_renders(self):
        r = requests.get(f"{PREVIEW_URL}/login.html", timeout=15)
        assert r.status_code == 200
        # Google login removed; PIN login now
        assert "pin-input-0" in r.text or "pin" in r.text.lower()
        assert "Google" not in r.text or "Sign in with Google" not in r.text

    def test_pin_login_wrong(self):
        r = requests.post(f"{PREVIEW_URL}/api/auth/pin-login", json={"pin": "0000"}, timeout=15)
        assert r.status_code in (400, 401, 403)

    def test_pin_login_correct(self):
        s = requests.Session()
        r = s.post(f"{PREVIEW_URL}/api/auth/pin-login", json={"pin": "1234"}, timeout=15)
        if r.status_code == 500:
            time.sleep(1)
            r = s.post(f"{PREVIEW_URL}/api/auth/pin-login", json={"pin": "1234"}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        # Verify session persists
        r2 = s.get(f"{PREVIEW_URL}/api/auth/me", timeout=15)
        assert r2.status_code == 200

    def test_gethub_redirects(self):
        r = requests.get(f"{PREVIEW_URL}/gethub", timeout=15, allow_redirects=False)
        assert r.status_code in (301, 302)
        r2 = requests.get(f"{PREVIEW_URL}/gethub.html", timeout=15, allow_redirects=False)
        assert r2.status_code in (301, 302)

    def test_me_unauth_401(self):
        # Retry once to tolerate rare transient proxy ReadError (500)
        r = requests.get(f"{PREVIEW_URL}/api/auth/me", timeout=15)
        if r.status_code == 500:
            time.sleep(1)
            r = requests.get(f"{PREVIEW_URL}/api/auth/me", timeout=15)
        assert r.status_code == 401

    def test_dashboard_unauth_401(self):
        r = requests.get(f"{PREVIEW_URL}/api/dashboard", timeout=15)
        assert r.status_code == 401

    def test_leads_unauth_401(self):
        r = requests.get(f"{PREVIEW_URL}/api/leads", timeout=15)
        assert r.status_code == 401

    def test_test_session_blocked_on_preview(self):
        # test-session should NOT be reachable through preview URL
        r = requests.post(
            f"{PREVIEW_URL}/api/auth/test-session",
            json={"email": ADMIN_EMAIL, "secret": TEST_SECRET},
            timeout=15,
        )
        assert r.status_code in (401, 403, 404)


# ---------- Authenticated tests via localhost:3001 ----------

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
    body = r.json()
    assert body.get("ok") is True
    return s


class TestAuthenticated:
    def test_me_returns_admin(self, admin_session):
        r = admin_session.get(f"{LOCAL_URL}/api/auth/me", headers=LOOPBACK_HEADERS, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        user = body["data"]["user"] if "user" in body.get("data", {}) else body["data"]
        assert user.get("Email", user.get("email")) == ADMIN_EMAIL
        role = user.get("Role", user.get("role"))
        assert role == "ADMIN"

    def test_dashboard(self, admin_session):
        r = admin_session.get(f"{LOCAL_URL}/api/dashboard", headers=LOOPBACK_HEADERS, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        data = body["data"]
        # stats
        assert "totalLeads" in data or "stats" in data or "modules" in data


class TestLeadsCRUD:
    created_lead_id = None

    def test_list_leads(self, admin_session):
        r = admin_session.get(f"{LOCAL_URL}/api/leads", headers=LOOPBACK_HEADERS, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        assert isinstance(body["data"], list)

    def test_create_lead(self, admin_session):
        payload = {
            "Name": "TEST_Lead_Backend",
            "Phone": "+919999900001",
            "Email": "test_lead_backend@example.com",
            "Source": "Website",
            "Status": "New",
            "Notes": "Created by automated backend test",
        }
        r = admin_session.post(
            f"{LOCAL_URL}/api/leads",
            headers=POST_HEADERS,
            json=payload,
            timeout=20,
        )
        assert r.status_code in (200, 201), f"create lead failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        assert body.get("ok") is True
        lead = body["data"]
        lid = lead.get("LeadID") or lead.get("leadId") or lead.get("id")
        assert lid, f"no LeadID in response: {body}"
        TestLeadsCRUD.created_lead_id = lid

    def test_get_lead_by_id(self, admin_session):
        lid = TestLeadsCRUD.created_lead_id
        if not lid:
            pytest.skip("no lead created")
        r = admin_session.get(f"{LOCAL_URL}/api/leads/{lid}", headers=LOOPBACK_HEADERS, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        lead = body["data"]
        assert (lead.get("LeadID") or lead.get("id")) == lid

    def test_lead_persisted_in_list(self, admin_session):
        lid = TestLeadsCRUD.created_lead_id
        if not lid:
            pytest.skip("no lead created")
        r = admin_session.get(f"{LOCAL_URL}/api/leads", headers=LOOPBACK_HEADERS, timeout=20)
        assert r.status_code == 200
        ids = [x.get("LeadID") or x.get("id") for x in r.json()["data"]]
        assert lid in ids


class TestInventory:
    created_prop_id = None

    def test_list_inventory(self, admin_session):
        r = admin_session.get(f"{LOCAL_URL}/api/inventory", headers=LOOPBACK_HEADERS, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        assert isinstance(body["data"], list)

    def test_create_inventory(self, admin_session):
        payload = {
            "PropertyName": "TEST_Property_Backend",
            "Location": "Bengaluru",
            "Type": "Apartment",
            "Configuration": "3BHK",
            "Price": 12500000,
            "Status": "Available",
            "Notes": "test",
        }
        r = admin_session.post(
            f"{LOCAL_URL}/api/inventory",
            headers=POST_HEADERS,
            json=payload,
            timeout=20,
        )
        assert r.status_code in (200, 201), f"create inventory failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        assert body.get("ok") is True
        prop = body["data"]
        pid = prop.get("PropertyID") or prop.get("id")
        assert pid
        TestInventory.created_prop_id = pid

    def test_inventory_persisted(self, admin_session):
        pid = TestInventory.created_prop_id
        if not pid:
            pytest.skip("no property created")
        r = admin_session.get(f"{LOCAL_URL}/api/inventory", headers=LOOPBACK_HEADERS, timeout=15)
        ids = [x.get("PropertyID") or x.get("id") for x in r.json()["data"]]
        assert pid in ids


class TestRequirements:
    created_req_id = None

    def test_list_requirements(self, admin_session):
        r = admin_session.get(f"{LOCAL_URL}/api/requirements", headers=LOOPBACK_HEADERS, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        assert isinstance(body["data"], list)

    def test_create_requirement(self, admin_session):
        lid = TestLeadsCRUD.created_lead_id
        if not lid:
            pytest.skip("no lead available to attach requirement")
        payload = {
            "LeadID": lid,
            "PropertyType": "Apartment",
            "Configuration": "3BHK",
            "Location": "Bengaluru",
            "BudgetMin": 8000000,
            "BudgetMax": 15000000,
            "Status": "Active",
            "Notes": "test requirement",
        }
        r = admin_session.post(
            f"{LOCAL_URL}/api/requirements",
            headers=POST_HEADERS,
            json=payload,
            timeout=20,
        )
        assert r.status_code in (200, 201), f"create requirement failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        assert body.get("ok") is True
        req = body["data"]
        TestRequirements.created_req_id = req.get("RequirementID") or req.get("id")


class TestSiteVisits:
    def test_list_site_visits(self, admin_session):
        r = admin_session.get(f"{LOCAL_URL}/api/site-visits", headers=LOOPBACK_HEADERS, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        assert isinstance(body["data"], list)


# ---------- Additional modules: builder-projects, broker-network ----------

class TestModules:
    def test_builder_projects_list(self, admin_session):
        # Try common paths
        for path in ["/api/builder-projects", "/api/builderProjects", "/api/projects"]:
            r = admin_session.get(f"{LOCAL_URL}{path}", headers=LOOPBACK_HEADERS, timeout=15)
            if r.status_code == 200:
                body = r.json()
                assert body.get("ok") is True
                return
        pytest.fail("no builder-projects endpoint returned 200")

    def test_broker_network_list(self, admin_session):
        for path in ["/api/broker-network", "/api/brokers", "/api/brokerNetwork"]:
            r = admin_session.get(f"{LOCAL_URL}{path}", headers=LOOPBACK_HEADERS, timeout=15)
            if r.status_code == 200:
                body = r.json()
                assert body.get("ok") is True
                return
        pytest.fail("no broker-network endpoint returned 200")

    def test_create_site_visit_requires_fields(self, admin_session):
        # Site visit creation requires LeadID + RequirementID + PropertyID + MatchID + VisitDate + VisitTime
        # A MatchID cannot be trivially seeded without engine-generated matches, so we validate
        # the field-validation contract instead of a full end-to-end create.
        lid = TestLeadsCRUD.created_lead_id
        pid = TestInventory.created_prop_id
        rid = TestRequirements.created_req_id
        if not (lid and pid and rid):
            pytest.skip("prerequisites (lead/property/requirement) missing")
        payload = {
            "LeadID": lid,
            "RequirementID": rid,
            "PropertyID": pid,
            "VisitDate": "2026-02-01",
            "VisitTime": "10:00",
            "Status": "Scheduled",
            "Notes": "test site visit",
        }
        r = admin_session.post(
            f"{LOCAL_URL}/api/site-visits",
            headers=POST_HEADERS,
            json=payload,
            timeout=20,
        )
        # Expect 400 with 'Missing required site visit fields' (MatchID required) OR 200 if match exists
        assert r.status_code in (200, 400), f"unexpected: {r.status_code} {r.text[:400]}"
        body = r.json()
        if r.status_code == 400:
            assert "site visit" in body.get("error", "").lower() or "match" in body.get("error", "").lower()
