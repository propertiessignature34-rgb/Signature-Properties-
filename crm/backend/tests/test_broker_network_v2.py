"""Broker Network V2 backend tests — BN1..BN5 + REGRESSION."""
import os, time, requests, pytest, subprocess

BASE = "https://seen-my-file.preview.emergentagent.com"
API = f"{BASE}/api/v2"

PII_FIELDS = {"ClientName", "PrimaryMobile", "Phone", "Email", "LeadID",
              "TransactionID", "RequirementID"}
ALLOWED_REQ_FIELDS = {"RequirementCode","Category","SubCategory","TransactionType",
                      "Location1","Location2","BHK","BudgetMin","BudgetMax",
                      "CarpetAreaMin","CarpetAreaMax","FurnishingPreference",
                      "Purpose","Timeline","ReadyToMove","Amenities"}

s = requests.Session()

# stash across tests
state = {}


# ── BN1: Broker Registry CRUD ─────────────────────────────────────────
def test_bn1_create_broker():
    phone = f"+91{int(time.time()*1000)%10000000000:010d}"
    r = s.post(f"{API}/broker-network", json={
        "Name": "TEST_Broker One", "Phone": phone, "Agency": "TestAgency",
        "TrustLevel": "High", "Specializations": ["Vesu","3BHK"]
    })
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    assert d["NetworkBrokerID"].startswith("BNB")
    assert d["TrustLevel"] == "High"
    assert d["Specializations"] == ["Vesu","3BHK"]
    state["broker_id"] = d["NetworkBrokerID"]
    state["broker_phone"] = phone
    state["broker_phone_digits"] = phone.replace("+","")


def test_bn1_list_contains_broker():
    r = s.get(f"{API}/broker-network")
    assert r.status_code == 200
    ids = [b["NetworkBrokerID"] for b in r.json()["data"]]
    assert state["broker_id"] in ids


def test_bn1_dedupe_by_phone_digits():
    # same digits but formatted differently
    variant = f" ({state['broker_phone_digits'][:2]}) {state['broker_phone_digits'][2:]} "
    r = s.post(f"{API}/broker-network", json={
        "Name": "TEST_Dup", "Phone": variant
    })
    assert r.status_code == 400
    assert "exist" in r.json().get("error","").lower()


def test_bn1_patch_broker():
    r = s.patch(f"{API}/broker-network/{state['broker_id']}",
                json={"Name": "TEST_Broker Renamed"})
    assert r.status_code == 200
    assert r.json()["data"]["Name"] == "TEST_Broker Renamed"
    # verify persistence
    r2 = s.get(f"{API}/broker-network")
    row = [b for b in r2.json()["data"] if b["NetworkBrokerID"] == state["broker_id"]][0]
    assert row["Name"] == "TEST_Broker Renamed"


# ── BN2: Share create ─────────────────────────────────────────────────
def test_bn2_share_create():
    r = s.post(f"{API}/requirements/REQ-0001/network-share", json={
        "brokerIds":[state["broker_id"]], "message":"urgent"
    })
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    assert d["count"] == 1
    sh = d["shares"][0]
    assert sh["Token"] and len(sh["Token"]) >= 16
    assert sh["BrokerName"] and sh["BrokerPhone"]
    state["token"] = sh["Token"]
    state["share_id"] = sh["ShareID"]


def test_bn2_share_no_valid_brokers():
    r = s.post(f"{API}/requirements/REQ-0001/network-share", json={"brokerIds":[]})
    assert r.status_code == 400


# ── BN3: Public anonymized GET (CRITICAL PII check) ───────────────────
def test_bn3_public_anonymized_no_pii():
    r = s.get(f"{API}/public/req/{state['token']}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    data = body["data"]
    payload_str = str(data)

    # Broker name should be there
    assert data.get("BrokerName")

    req = data["Requirement"]
    # Only whitelisted keys
    extra = set(req.keys()) - ALLOWED_REQ_FIELDS
    assert not extra, f"Non-whitelisted keys in Requirement: {extra}"

    # No PII anywhere in payload
    for pii in PII_FIELDS:
        assert pii not in req, f"PII field {pii} present in Requirement!"
        # LeadID/etc. must not be top-level either
        if pii in ("LeadID", "TransactionID", "RequirementID", "ClientName",
                   "PrimaryMobile", "Phone", "Email"):
            assert pii not in data, f"PII field {pii} at top level"

    # RequirementCode is allowed but not RequirementID
    assert "RequirementID" not in payload_str or "RequirementCode" in payload_str
    # Explicit substring guard for LeadID pattern
    assert "LEAD-" not in payload_str, "LeadID value leaked in payload"


def test_bn3_viewcount_increments():
    r1 = s.get(f"{API}/requirements/REQ-0001/network-shares")
    shares = r1.json()["data"]
    before = [x for x in shares if x["ShareID"] == state["share_id"]][0]["ViewCount"]
    s.get(f"{API}/public/req/{state['token']}")
    r2 = s.get(f"{API}/requirements/REQ-0001/network-shares")
    after = [x for x in r2.json()["data"] if x["ShareID"] == state["share_id"]][0]["ViewCount"]
    assert after > before


# ── BN4: Public POST response → Inventory + Shortlist ──────────────────
def test_bn4_submit_response_creates_inventory_and_shortlist():
    payload = {
        "Title": "TEST_3BHK Flat Ratnakar", "BHK": "3 BHK", "Location1": "Vesu",
        "AskingPrice": 12500000, "CarpetArea": 1350,
        "FurnishingType": "Semi-Furnished", "ExpectedSplit": "50-50",
        "Notes": "Corner unit"
    }
    r = s.post(f"{API}/public/req/{state['token']}/response", json=payload)
    assert r.status_code == 201, r.text
    nrsp = r.json()["data"]["NetworkResponseID"]
    assert nrsp.startswith("NRSP")
    state["nrsp"] = nrsp

    # Inventory
    inv = s.get(f"{API}/inventory")
    assert inv.status_code == 200, inv.text
    inv_rows = inv.json().get("data") or inv.json().get("items") or []
    matches = [p for p in inv_rows
               if p.get("InventorySource") == "NetworkSubmission"
               and p.get("Title") == payload["Title"]]
    assert matches, f"NetworkSubmission inventory row not found. Sample: {inv_rows[:2]}"
    prop = matches[0]
    assert prop.get("AskingPrice") == 12500000
    assert prop.get("BHK") == "3 BHK"
    assert prop.get("SubmittedByBrokerName")
    state["property_id"] = prop["PropertyID"]

    # Shortlist
    sl = s.get(f"{BASE}/api/v2/shortlist/REQ-0001", params={"status":"Active"})
    assert sl.status_code == 200, sl.text
    sl_rows = sl.json().get("data") or sl.json().get("items") or []
    hit = [x for x in sl_rows if x.get("PropertyID") == state["property_id"]]
    assert hit, f"Shortlist entry not created for new property {state['property_id']}"
    assert (hit[0].get("Notes") or "").startswith("[Network]")


# ── BN5: Revoke + Expired ─────────────────────────────────────────────
def test_bn5_revoke():
    r = s.post(f"{API}/network-shares/{state['share_id']}/revoke")
    assert r.status_code == 200
    r2 = s.get(f"{API}/public/req/{state['token']}")
    body = r2.json()
    assert body["ok"] is False
    assert body.get("code") == "REVOKED"


def test_bn5_expired():
    # create share with 30 days, then patch DB? No DB access. Instead
    # create then revoke path is above. For expired, we manipulate via
    # sharing with 0 days: expiresInDays=0 => ExpiresAt = now → immediately past.
    # First need active broker with unique phone.
    phone = f"+91{int(time.time()*1000)%10000000000:010d}9"
    br = s.post(f"{API}/broker-network", json={
        "Name":"TEST_ExpBroker","Phone":phone,"TrustLevel":"Low"
    })
    assert br.status_code == 201, br.text
    bid = br.json()["data"]["NetworkBrokerID"]
    sh = s.post(f"{API}/requirements/REQ-0001/network-share",
                json={"brokerIds":[bid],"message":"exp","expiresInDays":-1})
    assert sh.status_code == 201, sh.text
    tok = sh.json()["data"]["shares"][0]["Token"]
    time.sleep(1.2)
    r = s.get(f"{API}/public/req/{tok}")
    body = r.json()
    assert body["ok"] is False
    assert body.get("code") == "EXPIRED", body


# ── BN1 cleanup: DELETE ────────────────────────────────────────────────
def test_bn1_delete_broker():
    r = s.delete(f"{API}/broker-network/{state['broker_id']}")
    assert r.status_code == 200
    r2 = s.get(f"{API}/broker-network")
    ids = [b["NetworkBrokerID"] for b in r2.json()["data"]]
    assert state["broker_id"] not in ids


# ── REGRESSION 1: inventory still loads ────────────────────────────────
def test_reg1_inventory_loads():
    r = s.get(f"{API}/inventory")
    assert r.status_code == 200
    assert isinstance(r.json().get("data") or r.json().get("items"), list)


# ── REGRESSION 3: dashboard  ───────────────────────────────────────────
def test_reg3_dashboard_page():
    r = s.get(f"{BASE}/")
    assert r.status_code == 200


# ── REGRESSION 4: Mongo persistence after restart ──────────────────────
def test_reg4_mongo_persistence_after_restart():
    # Create a marker broker
    phone = f"+91{int(time.time()*1000)%10000000000:010d}77"
    r = s.post(f"{API}/broker-network", json={
        "Name":"TEST_PersistMarker","Phone":phone,"TrustLevel":"Medium"
    })
    assert r.status_code == 201
    bid = r.json()["data"]["NetworkBrokerID"]
    # restart
    subprocess.run(["sudo","supervisorctl","restart","realty"],
                   capture_output=True, timeout=30)
    # wait for it to come back
    for _ in range(30):
        try:
            hr = s.get(f"{API}/broker-network", timeout=3)
            if hr.status_code == 200:
                break
        except Exception:
            pass
        time.sleep(1)
    r2 = s.get(f"{API}/broker-network")
    assert r2.status_code == 200
    ids = [b["NetworkBrokerID"] for b in r2.json()["data"]]
    assert bid in ids, "Marker broker not persisted across restart"
    # cleanup
    s.delete(f"{API}/broker-network/{bid}")
