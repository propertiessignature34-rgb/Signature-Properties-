"""Backend tests for brochure auto-fill + ConfigDetails feature.

Covers:
  1. POST /api/v2/builder-projects/extract-brochure  — validation + real AI call
  2. POST /api/v2/builder-projects with ConfigDetails — derives Configurations + AreaRange
  3. GET single project — round-trip persistence of ConfigDetails
  4. Legacy projects (Karma Group) still have Configurations + AreaRange but no ConfigDetails
  5. PATCH updates ConfigDetails correctly
  6. DELETE cleanup
"""
import base64
import io
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api/v2/builder-projects"


def _make_text_pdf(text: str) -> bytes:
    """Build a minimal valid single-page text-based PDF (parseable by pdf libs)."""
    # Escape parens for PDF strings
    safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    # Split into lines shown via multiple Tj ops so Gemini can read them
    lines = safe.split("\n")
    content_ops = "BT /F1 11 Tf 50 780 Td 14 TL\n"
    for i, ln in enumerate(lines):
        if i == 0:
            content_ops += f"({ln}) Tj\n"
        else:
            content_ops += f"T* ({ln}) Tj\n"
    content_ops += "ET"
    stream = content_ops.encode("latin-1", errors="replace")
    objs = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")
    objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for i, o in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode() + o + b"\nendobj\n")
    xref_pos = out.tell()
    out.write(f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode())
    for off in offsets[1:]:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode())
    return out.getvalue()


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


created_ids = []


# ─── extract-brochure endpoint validation ─────────────────────────────
def test_extract_missing_body_400(api):
    r = api.post(f"{API}/extract-brochure", json={})
    assert r.status_code == 400
    body = r.json()
    assert body.get("ok") is False
    assert "fileBase64" in body.get("error", "")


def test_extract_bad_base64_500(api):
    # empty base64 after prefix strip
    r = api.post(f"{API}/extract-brochure", json={"fileBase64": ""})
    # server treats empty as missing → 400
    assert r.status_code == 400


def test_extract_wrong_method(api):
    r = api.get(f"{API}/extract-brochure")
    assert r.status_code == 405


# ─── real AI extraction round trip (slow: 20-60s) ─────────────────────
@pytest.mark.timeout(120)
def test_extract_real_pdf_ai_call(api):
    text = (
        "SIGNATURE HEIGHTS BROCHURE\n"
        "Project: Signature Heights\n"
        "Developer: TESTBLD Realty Pvt Ltd\n"
        "Location: Vesu, Surat\n"
        "Address: Plot 42, Vesu Main Road, Surat 395007\n"
        "RERA: PR/GJ/SURAT/TEST/0001\n"
        "Category: Residential\n"
        "Status: Under Construction\n"
        "Total Units: 120\n"
        "2 BHK - 950 sqft starting Rs 45,00,000\n"
        "3 BHK - 1250 sqft starting Rs 65,00,000\n"
        "Possession: December 2026\n"
        "Amenities: Clubhouse, Gym, Swimming Pool, Kids Play Area\n"
    )
    pdf_bytes = _make_text_pdf(text)
    b64 = base64.b64encode(pdf_bytes).decode()
    t0 = time.time()
    r = api.post(f"{API}/extract-brochure", json={"filename": "brochure.pdf", "fileBase64": b64}, timeout=110)
    elapsed = time.time() - t0
    print(f"AI extract took {elapsed:.1f}s, status={r.status_code}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True, body
    d = body["data"]
    # Structural checks (be lenient on exact wording per instructions)
    assert isinstance(d, dict)
    assert "ProjectName" in d and "BuilderName" in d and "ConfigDetails" in d
    assert isinstance(d["ConfigDetails"], list)
    # Should have identified at least the 2 configs
    types = [str(c.get("Type", "")).upper() for c in d["ConfigDetails"]]
    assert any("2" in t and "BHK" in t for t in types), f"Expected 2 BHK in {types}"
    assert any("3" in t and "BHK" in t for t in types), f"Expected 3 BHK in {types}"
    # At least one area extracted
    areas = [c.get("AreaSqft") for c in d["ConfigDetails"] if c.get("AreaSqft")]
    assert areas, f"Expected some AreaSqft values in {d['ConfigDetails']}"


# ─── ConfigDetails create + derive Configurations/AreaRange ───────────
def test_create_project_with_configdetails(api):
    payload = {
        "ProjectName": "TEST_ConfigProj_1",
        "BuilderName": "TESTBLD Realty",
        "Location1": "Vesu",
        "ConfigDetails": [
            {"Type": "2 BHK", "AreaSqft": 950},
            {"Type": "3 BHK", "AreaSqft": 1250},
        ],
        "PriceMin": 4500000, "PriceMax": 6500000,
        "ProjectStatus": "Under Construction", "Category": "Residential",
    }
    r = api.post(API, json=payload)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    assert body.get("ok") is True, body
    created = body.get("data") or body.get("project") or body
    pid = created.get("ProjectID") or (created.get("data") or {}).get("ProjectID")
    assert pid, f"missing ProjectID: {body}"
    created_ids.append(pid)

    # Verify persistence via GET
    g = api.get(f"{API}/{pid}")
    assert g.status_code == 200, g.text
    proj = g.json().get("data") or g.json()
    assert isinstance(proj.get("ConfigDetails"), list)
    assert len(proj["ConfigDetails"]) == 2
    types = {c["Type"] for c in proj["ConfigDetails"]}
    assert types == {"2 BHK", "3 BHK"}
    # Derived fields
    assert set(proj.get("Configurations", [])) == {"2 BHK", "3 BHK"}
    ar = proj.get("AreaRange") or {}
    assert ar.get("min") == 950 and ar.get("max") == 1250, f"AreaRange mismatch: {ar}"


def test_patch_project_configdetails(api):
    if not created_ids:
        pytest.skip("no project to patch")
    pid = created_ids[0]
    payload = {"ConfigDetails": [
        {"Type": "2 BHK", "AreaSqft": 1000},
        {"Type": "3 BHK", "AreaSqft": 1300},
        {"Type": "4 BHK", "AreaSqft": 1800},
    ]}
    r = api.patch(f"{API}/{pid}", json=payload)
    assert r.status_code == 200, r.text
    g = api.get(f"{API}/{pid}").json().get("data") or {}
    assert len(g.get("ConfigDetails", [])) == 3
    ar = g.get("AreaRange") or {}
    assert ar.get("min") == 1000 and ar.get("max") == 1800


# ─── Legacy Karma Group projects still readable ───────────────────────
def test_legacy_karma_projects_have_configurations(api):
    r = api.get(API)
    assert r.status_code == 200
    data = r.json().get("data") or []
    assert data, "expected seed projects"
    # Legacy shape: no ConfigDetails, has Configurations array (possibly empty)
    legacy = [p for p in data if not p.get("ConfigDetails")]
    assert legacy, "expected some legacy projects without ConfigDetails"
    sample = legacy[0]
    assert isinstance(sample.get("Configurations"), list)


# ─── Cleanup ──────────────────────────────────────────────────────────
def test_cleanup_created(api):
    for pid in created_ids:
        r = api.delete(f"{API}/{pid}")
        assert r.status_code in (200, 204)
    created_ids.clear()
