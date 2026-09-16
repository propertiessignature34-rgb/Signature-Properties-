"""Backend tests for Builder Projects module & RERA removal."""
import base64
import os
import pytest
import requests

BASE_URL = "https://seen-my-file.preview.emergentagent.com"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ── RERA removal regression ──────────────────────────────────────────────
class TestReraRemoval:
    def test_rera_import_page_404(self, api):
        r = api.get(f"{BASE_URL}/rera-import")
        assert r.status_code == 404

    def test_rera_api_routes_gone(self, api):
        for path in ["/api/v2/rera", "/api/v2/rera/projects",
                     "/api/v2/rera/pending", "/api/v2/rera/import/preview"]:
            r = api.get(f"{BASE_URL}{path}")
            assert r.status_code == 404, f"{path} should 404, got {r.status_code}"

    def test_inventory_no_rera_master_rows(self, api):
        r = api.get(f"{BASE_URL}/api/v2/inventory")
        assert r.status_code == 200
        payload = r.json()
        data = payload.get("data", payload) if isinstance(payload, dict) else payload
        assert isinstance(data, list)
        rera = [x for x in data if x.get("IsReraMaster")]
        assert len(rera) == 0, f"Expected 0 IsReraMaster rows, found {len(rera)}"


# ── Builder Projects CRUD ────────────────────────────────────────────────
class TestBuilderProjectsCRUD:
    created_id = None

    def test_list(self, api):
        r = api.get(f"{BASE_URL}/api/v2/builder-projects")
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True
        assert isinstance(j.get("data"), list)

    def test_create_missing_required(self, api):
        r = api.post(f"{BASE_URL}/api/v2/builder-projects",
                     json={"BuilderName": "X", "Location1": "Adajan"})
        assert r.status_code in (400, 422, 200)
        j = r.json()
        assert j.get("ok") is False
        assert "ProjectName" in (j.get("error") or "")

    def test_create_success(self, api):
        payload = {
            "ProjectName": "TEST_ProjectA",
            "BuilderName": "TEST_Builder",
            "Location1": "Vesu",
            "RERANumber": "PR/GJ/SURAT/TEST/001",
            "ProjectStatus": "Under Construction",
            "Configurations": ["2 BHK", "3 BHK"],
            "TotalUnits": 50,
            "CarpetAreaMin": 800,
            "CarpetAreaMax": 1200,
            "PriceMin": 4000000,
            "PriceMax": 6000000,
            "Amenities": ["Pool", "Gym"],
            "Notes": "test row"
        }
        r = api.post(f"{BASE_URL}/api/v2/builder-projects", json=payload)
        assert r.status_code in (200, 201)
        j = r.json()
        assert j.get("ok") is True
        data = j["data"]
        assert data["ProjectName"] == "TEST_ProjectA"
        assert data["ProjectID"].startswith("BLDP-")
        assert data["AreaRange"] == {"min": 800, "max": 1200}
        assert data["PriceRange"] == {"min": 4000000, "max": 6000000}
        TestBuilderProjectsCRUD.created_id = data["ProjectID"]

    def test_get_by_id(self, api):
        pid = TestBuilderProjectsCRUD.created_id
        assert pid
        r = api.get(f"{BASE_URL}/api/v2/builder-projects/{pid}")
        assert r.status_code == 200
        assert r.json()["data"]["ProjectID"] == pid

    def test_update(self, api):
        pid = TestBuilderProjectsCRUD.created_id
        r = api.patch(f"{BASE_URL}/api/v2/builder-projects/{pid}",
                      json={"ProjectStatus": "Ready to Move", "TotalUnits": 75})
        assert r.status_code == 200
        assert r.json()["data"]["ProjectStatus"] == "Ready to Move"
        # verify GET
        g = api.get(f"{BASE_URL}/api/v2/builder-projects/{pid}").json()["data"]
        assert g["ProjectStatus"] == "Ready to Move"
        assert g["TotalUnits"] == 75

    def test_search_filter(self, api):
        r = api.get(f"{BASE_URL}/api/v2/builder-projects?q=TEST_ProjectA")
        assert r.status_code == 200
        j = r.json()
        assert any(p["ProjectName"] == "TEST_ProjectA" for p in j["data"])

    def test_delete(self, api):
        pid = TestBuilderProjectsCRUD.created_id
        r = api.delete(f"{BASE_URL}/api/v2/builder-projects/{pid}")
        assert r.status_code == 200
        assert r.json()["ok"] is True
        # verify soft-deleted (not in list)
        listed = api.get(f"{BASE_URL}/api/v2/builder-projects").json()["data"]
        assert not any(p["ProjectID"] == pid for p in listed)


# ── Bulk CSV Import ──────────────────────────────────────────────────────
CSV_SAMPLE = """Project Name,Builder Name,Location,RERA Number,Status,Unit Type,Unit Count,Carpet Area,Price Min,Price Max,Possession Date
TEST_Bulk1,TEST_BuilderZ,Piplod,,New Launch,2 BHK,30,900,4500000,5000000,2027-01-01
TEST_Bulk1,TEST_BuilderZ,Piplod,,New Launch,3 BHK,20,1300,6500000,7500000,2027-01-01
TEST_Bulk2,TEST_BuilderY,Adajan,PR/GJ/SURAT/TEST/999,Under Construction,3 BHK,40,1400,7000000,8000000,2028-06-01
"""


class TestBulkImport:
    inserted_ids = []

    def test_preview(self, api):
        b64 = base64.b64encode(CSV_SAMPLE.encode()).decode()
        r = api.post(f"{BASE_URL}/api/v2/builder-projects/import/preview",
                     json={"filename": "TEST_bulk.csv", "fileBase64": b64})
        assert r.status_code == 200
        j = r.json()
        assert j["ok"] is True
        assert j["data"]["totalRows"] == 3
        assert j["data"]["summary"]["projects"] == 2

    def test_commit(self, api):
        b64 = base64.b64encode(CSV_SAMPLE.encode()).decode()
        r = api.post(f"{BASE_URL}/api/v2/builder-projects/import/commit",
                     json={"filename": "TEST_bulk.csv", "fileBase64": b64})
        assert r.status_code == 200
        j = r.json()
        assert j["ok"] is True
        # Either inserted or updated to 2
        assert (j["data"]["Inserted"] + j["data"]["Updated"]) == 2
        TestBulkImport.inserted_ids = j["data"].get("InsertedProjectIDs", []) + j["data"].get("UpdatedProjectIDs", [])

    def test_history(self, api):
        r = api.get(f"{BASE_URL}/api/v2/builder-projects/import/history")
        assert r.status_code == 200
        j = r.json()
        assert j["ok"] is True
        assert any(h.get("Filename") == "TEST_bulk.csv" for h in j["data"])

    def test_cleanup(self, api):
        for pid in TestBulkImport.inserted_ids:
            api.delete(f"{BASE_URL}/api/v2/builder-projects/{pid}")


# ── Regression: other modules ───────────────────────────────────────────
class TestRegression:
    @pytest.mark.parametrize("endpoint", [
        "/api/v2/clients",
        "/api/requirements",
        "/api/v2/inventory",
        "/api/v2/broker-network",
    ])
    def test_endpoints_ok(self, api, endpoint):
        r = api.get(f"{BASE_URL}{endpoint}")
        assert r.status_code == 200, f"{endpoint} returned {r.status_code}"
