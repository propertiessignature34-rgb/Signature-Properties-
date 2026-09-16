"""PIN-auth regression tests for Signature Properties CRM."""
import requests

BASE_URL = "https://seen-my-file.preview.emergentagent.com"


def test_root_redirects_to_pin_screen():
    r = requests.get(f"{BASE_URL}/", allow_redirects=False)
    assert r.status_code == 302
    assert "/login.html?next=%2F" in str(r.headers.get("Location", ""))


def test_login_page_is_pin_only():
    r = requests.get(f"{BASE_URL}/login.html", allow_redirects=False)
    assert r.status_code == 200
    assert "Enter your CRM access PIN" in r.text
    assert "Work email" not in r.text
    assert "App access key" not in r.text
    assert "Sign in with Google" not in r.text


def test_gated_pages_redirect_to_login_without_session():
    for path in ["/clients.html", "/inventory.html", "/builder-projects.html"]:
        r = requests.get(f"{BASE_URL}{path}", allow_redirects=False)
        assert r.status_code == 302, path
        assert "/login.html?next=" in str(r.headers.get("Location", ""))


def test_oauth_state_and_session_exchange_removed():
    r1 = requests.get(f"{BASE_URL}/api/auth/login-state", allow_redirects=False)
    assert r1.status_code == 404
    r2 = requests.post(
        f"{BASE_URL}/api/auth/session-exchange",
        json={"session_id": "dummy", "state": "dummy"},
        allow_redirects=False,
    )
    assert r2.status_code == 404


def test_business_api_regression_endpoints():
    for path in ["/api/leads", "/api/inventory", "/api/v2/builder-projects"]:
        r = requests.get(f"{BASE_URL}{path}")
        assert r.status_code == 401, path
