"""Iteration 14 regression: mongoStore polling correctness, CRUD, Google Sheets sync webhook."""
import os, time, uuid, requests, pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://seen-my-file.preview.emergentagent.com").rstrip("/")
SYNC_TOKEN = "CHANGE_ME_SECRET"

s = requests.Session()

# ---------- Boot / health ----------
def test_builder_projects_list_available():
    r = s.get(f"{BASE}/api/v2/builder-projects", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j.get("ok") is True
    assert isinstance(j.get("data"), list)
    assert len(j["data"]) > 500  # was 546 baseline

def test_sync_setup_returns_webhook_info():
    r = s.get(f"{BASE}/api/sync/google-sheet/setup", timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert j["ok"] is True
    assert "webhookUrl" in j["data"]
    assert j["data"]["syncToken"] == SYNC_TOKEN

# ---------- mongoStore write-then-read-back correctness ----------
def test_rapid_create_readback_no_lag():
    """Create 3 builder projects back-to-back, immediately GET list, confirm all present."""
    created = []
    marker = f"TEST_ITER14_{uuid.uuid4().hex[:6]}"
    try:
        for i in range(3):
            payload = {
                "ProjectName": f"{marker}_P{i}",
                "BuilderName": f"{marker}_Builder",
                "Location1": "Vesu",
                "ProjectStatus": "Under Construction",
                "Category": "Residential",
            }
            r = s.post(f"{BASE}/api/v2/builder-projects", json=payload, timeout=10)
            assert r.status_code in (200, 201), f"create {i}: {r.status_code} {r.text[:200]}"
            j = r.json()
            assert j.get("ok") is True
            pid = j["data"]["ProjectID"]
            created.append(pid)
            # Immediate read-back same request cycle
            r2 = s.get(f"{BASE}/api/v2/builder-projects/{pid}", timeout=10)
            assert r2.status_code == 200
            assert r2.json()["data"]["ProjectName"] == payload["ProjectName"]

        # After 3 rapid writes, list should contain all 3
        r = s.get(f"{BASE}/api/v2/builder-projects", timeout=15)
        names = [p["ProjectName"] for p in r.json()["data"]]
        for i in range(3):
            assert f"{marker}_P{i}" in names, f"Missing {marker}_P{i} after rapid writes"
    finally:
        for pid in created:
            s.delete(f"{BASE}/api/v2/builder-projects/{pid}", timeout=10)

def test_update_persists_immediately():
    marker = f"TEST_ITER14U_{uuid.uuid4().hex[:6]}"
    r = s.post(f"{BASE}/api/v2/builder-projects", json={
        "ProjectName": marker, "BuilderName": "TESTB", "Location1": "Vesu"
    }, timeout=10)
    pid = r.json()["data"]["ProjectID"]
    try:
        r2 = s.patch(f"{BASE}/api/v2/builder-projects/{pid}",
                     json={"Location1": "Adajan"}, timeout=10)
        assert r2.status_code == 200
        r3 = s.get(f"{BASE}/api/v2/builder-projects/{pid}", timeout=10)
        assert r3.json()["data"]["Location1"] == "Adajan"
    finally:
        s.delete(f"{BASE}/api/v2/builder-projects/{pid}", timeout=10)

# ---------- Google Sheets sync webhook: create + update by phone ----------
def test_sheets_sync_auth_required():
    r = s.post(f"{BASE}/api/sync/google-sheet",
               json={"tab": "Comm", "rows": []}, timeout=10)
    assert r.status_code in (400, 401, 403)  # server may reject at validation stage

def test_sheets_sync_create_then_update():
    phone = f"9{uuid.uuid4().int % 1000000000:09d}"
    headers = {"X-Sync-Token": SYNC_TOKEN}
    row1 = {
        "Name": "TEST_ITER14 Sync Lead",
        "Phone": phone,
        "Email": "test_iter14@example.com",
        "Requirement": "2BHK Vesu",
        "Budget": "80L",
        "Source": "GoogleSheet",
    }
    r = s.post(f"{BASE}/api/sync/google-sheet",
               headers=headers,
               json={"tab": "Comm", "rows": [row1]}, timeout=20)
    assert r.status_code == 200, f"create sync failed: {r.status_code} {r.text[:300]}"
    j = r.json()
    assert j.get("ok") is True, j
    print("CREATE response:", j)

    # Verify create result: exactly 1 created
    assert j["summary"]["created"] == 1 and j["summary"]["failed"] == 0, j
    created_lead_id = j["results"][0]["leadId"]

    # Second sync with SAME phone but updated data -> match-by-phone update path
    row2 = dict(row1)
    row2["Name"] = "TEST_ITER14 Sync Lead Updated"
    row2["Budget"] = "1.2Cr"
    r = s.post(f"{BASE}/api/sync/google-sheet",
               headers=headers,
               json={"tab": "Comm", "rows": [row2]}, timeout=20)
    assert r.status_code == 200
    j2 = r.json()
    assert j2.get("ok") is True, j2
    print("UPDATE response:", j2)
    # Critical: update path invoked (not another create), and same leadId
    assert j2["summary"]["updated"] == 1, f"Expected updated=1, got {j2['summary']}"
    assert j2["summary"]["created"] == 0, f"Expected created=0, got {j2['summary']}"
    assert j2["results"][0]["leadId"] == created_lead_id, "leadId mismatch — match-by-phone broken"

    # Cleanup
    s.delete(f"{BASE}/api/leads/{created_lead_id}", timeout=10)

# ---------- Digital business card / broker profile ----------
def test_broker_profile_get():
    r = s.get(f"{BASE}/api/v2/broker-profile", timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert j["ok"] is True
    assert "Name" in j["data"]

def test_broker_network_active_count():
    r = s.get(f"{BASE}/api/v2/broker-network?active=true", timeout=10)
    assert r.status_code == 200
    assert isinstance(r.json().get("data"), list)

def test_leads_list():
    r = s.get(f"{BASE}/api/leads", timeout=10)
    assert r.status_code == 200

def test_inventory_list():
    r = s.get(f"{BASE}/api/inventory", timeout=10)
    assert r.status_code == 200
