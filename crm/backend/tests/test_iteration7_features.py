"""
Iteration 7 backend tests - retained non-scraping features:
  1) Builder Name Cleanup (duplicate-builders + merge-builders)
  2) Site Visit Route (indirect - verify booking with 2+ properties fetchable
     with Properties[].SocietyName/Location1 so frontend can build maps URL)
"""
import os
import pytest
import requests

BASE_URL = "https://seen-my-file.preview.emergentagent.com"

API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ── 1) Builder Name Cleanup ──────────────────────────────────────────────────
class TestBuilderCleanup:
    created_ids = []

    def test_duplicate_builders_endpoint_shape(self, api):
        r = api.get(f"{API}/v2/builder-projects/duplicate-builders")
        assert r.status_code == 200
        j = r.json()
        assert j["ok"] is True
        assert "data" in j and isinstance(j["data"], list)
        assert "count" in j
        # With 546 real deduped projects, expect 0 duplicates
        print(f"Duplicate groups (baseline): {j['count']}")

    def test_create_variants_then_merge(self, api):
        # Create 2 test projects with same normalized builder root
        payload_a = {
            "ProjectName": "TEST_MergeProjA",
            "BuilderName": "RAJHANS TEST",
            "Location1": "Vesu",
            "City": "Surat",
            "Category": "Residential",
            "ProjectStatus": "Under Construction",
        }
        payload_b = {
            "ProjectName": "TEST_MergeProjB",
            "BuilderName": "Rajhans Test Group",
            "Location1": "Vesu",
            "City": "Surat",
            "Category": "Residential",
            "ProjectStatus": "Under Construction",
        }
        ra = api.post(f"{API}/v2/builder-projects", json=payload_a)
        rb = api.post(f"{API}/v2/builder-projects", json=payload_b)
        assert ra.status_code in (200, 201), ra.text
        assert rb.status_code in (200, 201), rb.text
        ja = ra.json(); jb = rb.json()
        assert ja.get("ok") is True and jb.get("ok") is True
        id_a = (ja.get("data") or {}).get("ProjectID") or (ja.get("data") or {}).get("id")
        id_b = (jb.get("data") or {}).get("ProjectID") or (jb.get("data") or {}).get("id")
        assert id_a and id_b, f"missing ids: {ja} / {jb}"
        TestBuilderCleanup.created_ids = [id_a, id_b]

        # Cleanup listing now should include the merged group
        r = api.get(f"{API}/v2/builder-projects/duplicate-builders")
        assert r.status_code == 200
        groups = r.json().get("data", [])
        target = None
        for g in groups:
            names = [v["name"] for v in g["variants"]]
            if "RAJHANS TEST" in names and "Rajhans Test Group" in names:
                target = g
                break
        assert target is not None, f"Expected merge group not found. Groups: {groups}"
        assert len(target["variants"]) >= 2
        assert target["suggestedCanonical"] in ("RAJHANS TEST", "Rajhans Test Group")

        # Merge - pick canonical
        canonical = "Rajhans Test Group"
        variants = ["RAJHANS TEST", "Rajhans Test Group"]
        r2 = api.post(f"{API}/v2/builder-projects/merge-builders",
                      json={"canonicalName": canonical, "variants": variants})
        assert r2.status_code == 200, r2.text
        j2 = r2.json()
        assert j2["ok"] is True
        assert j2["data"]["updated"] >= 1

        # Verify both projects now share canonical name
        for pid in TestBuilderCleanup.created_ids:
            rg = api.get(f"{API}/v2/builder-projects/{pid}")
            assert rg.status_code == 200
            row = rg.json().get("data") or {}
            assert row.get("BuilderName") == canonical, f"proj {pid} builder={row.get('BuilderName')}"

    def test_zzz_cleanup_test_projects(self, api):
        # Named zzz to run after merge test
        for pid in TestBuilderCleanup.created_ids:
            r = api.delete(f"{API}/v2/builder-projects/{pid}")
            assert r.status_code in (200, 204), r.text

    def test_merge_validation_missing_fields(self, api):
        r = api.post(f"{API}/v2/builder-projects/merge-builders", json={})
        assert r.status_code == 400
        assert r.json().get("ok") is False


# ── 2) Site Visit Bookings - shape needed for Route Planning ────────────────
class TestSiteVisitBookingRouteShape:
    def test_list_bookings_shape(self, api):
        # Fetch all bookings (some scoped by leadId/reqId). Try both listing modes.
        # Use existing requirements first
        r = api.get(f"{API}/v2/requirements")
        if r.status_code != 200:
            pytest.skip("No requirements endpoint")
        reqs = (r.json() or {}).get("data", [])
        found_multi = False
        for req in reqs[:30]:
            rid = req.get("RequirementID") or req.get("id")
            if not rid:
                continue
            rb = api.get(f"{API}/v2/site-visit-bookings?requirementId={rid}")
            if rb.status_code != 200:
                continue
            for b in (rb.json() or {}).get("data", []):
                props = b.get("Properties") or []
                if len(props) >= 2:
                    found_multi = True
                    # verify shape needed by openVisitRoute()
                    assert "VisitBookingID" in b
                    for p in props:
                        assert "SocietyName" in p or "Location1" in p
                    print(f"Found booking {b['VisitBookingID']} with {len(props)} properties")
                    return
        if not found_multi:
            pytest.skip("No existing multi-property bookings to verify route shape (frontend test will attempt to create one)")
