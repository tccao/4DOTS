import html
import json
import re
import subprocess
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest


ROOT = Path(__file__).resolve().parents[1]
CODE_PATH = ROOT / "apps-script" / "Code.gs"
INDEX_PATH = ROOT / "docs" / "index.html"

BACKEND_BOOTSTRAP = r"""
const fs = require("fs");
const vm = require("vm");
const context = { console };
vm.createContext(context);
const source = fs.readFileSync("apps-script/Code.gs", "utf8")
  + "\n;globalThis.__test = { validatePayload_, safeCell_, escapeHtml_ };";
vm.runInContext(source, context);
"""


def run_node(script):
    return subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def validate_payload(**overrides):
    payload = {
        "fullName": "Nguyen Van A",
        "phone": "0912345678",
        "email": "lead@example.com",
        "services": ["Định hình & Xây kênh"],
        "industry": "Khác",
        "website": "",
        "message": "",
        "source": "test",
        "consent": "yes",
        "company": "",
        "turnstileToken": "test-token",
    }
    payload.update(overrides)
    script = BACKEND_BOOTSTRAP + f"""
const payload = {json.dumps(payload, ensure_ascii=False)};
try {{
  context.__test.validatePayload_(payload);
  process.stdout.write("ok");
}} catch (error) {{
  process.stdout.write("error:" + error.message);
}}
"""
    return run_node(script)


def extract_backend_values(constant_name):
    code = CODE_PATH.read_text(encoding="utf-8")
    match = re.search(
        rf"const {constant_name} = Object\.freeze\(\[(.*?)\]\);",
        code,
        re.DOTALL,
    )
    assert match, f"{constant_name} was not found"
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def extract_frontend_values():
    markup = INDEX_PATH.read_text(encoding="utf-8")
    services = {
        html.unescape(value)
        for value in re.findall(r'name="services" value="([^"]+)"', markup)
    }
    industry_select = re.search(
        r'<select name="industry".*?>(.*?)</select>',
        markup,
        re.DOTALL,
    )
    assert industry_select, "industry select was not found"
    industries = {
        html.unescape(re.sub(r"<[^>]+>", "", label)).strip()
        for label in re.findall(r"<option(?: [^>]*)?>(.*?)</option>", industry_select.group(1))
    }
    industries.discard("Chọn ngành nghề")
    return services, industries


def test_manifest_uses_valid_iana_timezone():
    manifest = json.loads((ROOT / "apps-script" / "appsscript.json").read_text())
    assert "/" in manifest["timeZone"]
    assert ZoneInfo(manifest["timeZone"]).key == manifest["timeZone"]


def test_project_uses_standard_requirements_file():
    requirements = (ROOT / "requirements.txt").read_text()
    workflow = (ROOT / ".github" / "workflows" / "test.yml").read_text()
    readme = (ROOT / "README.md").read_text()
    assert "pytest" in requirements
    assert "requirements.txt" in workflow
    assert "requirements.txt" in readme
    assert "requirements-dev.txt" not in workflow
    assert "requirements-dev.txt" not in readme


def test_project_uses_node_24():
    workflow = (ROOT / ".github" / "workflows" / "test.yml").read_text()
    assert (ROOT / ".node-version").read_text().strip() == "24"
    assert (ROOT / ".nvmrc").read_text().strip() == "24"
    assert 'node-version-file: ".node-version"' in workflow


def test_cloudflare_pages_configuration():
    config = json.loads((ROOT / "wrangler.jsonc").read_text())
    assert config["name"] == "4dots"
    assert config["pages_build_output_dir"] == "./docs"
    assert "assets" not in config
    assert "main" not in config
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", config["compatibility_date"])
    assert not (ROOT / "docs" / ".nojekyll").exists()


def test_readme_uses_pages_deploy_command():
    readme = (ROOT / "README.md").read_text()
    assert "npx wrangler pages deploy docs" in readme
    assert "Do not use `npx wrangler deploy`" in readme


def test_cloudflare_pages_security_headers():
    headers = (ROOT / "docs" / "_headers").read_text()
    assert "X-Content-Type-Options: nosniff" in headers
    assert "X-Frame-Options: DENY" in headers
    assert "Referrer-Policy: strict-origin-when-cross-origin" in headers
    assert "Permissions-Policy:" in headers


def test_frontend_allowed_values_match_backend():
    services, industries = extract_frontend_values()
    assert services == extract_backend_values("ALLOWED_SERVICES")
    assert industries == extract_backend_values("ALLOWED_INDUSTRIES")


@pytest.mark.parametrize(
    "phone",
    [
        "0912345678",
        "+84 912 345 678",
        "(028) 1234-5678",
    ],
)
def test_backend_accepts_supported_phone_formats(phone):
    assert validate_payload(phone=phone) == "ok"


@pytest.mark.parametrize("phone", ["--------", "++++++++", "........", "()()()()"])
def test_backend_rejects_phone_values_without_digits(phone):
    assert validate_payload(phone=phone).startswith("error:")


def test_backend_rejects_unknown_service():
    assert validate_payload(services=["Unknown"]).startswith("error:")


def test_backend_neutralizes_spreadsheet_formulas():
    script = BACKEND_BOOTSTRAP + """
process.stdout.write(context.__test.safeCell_('=IMPORTXML("x")'));
"""
    assert run_node(script).startswith("'=")


def test_javascript_sources_parse():
    subprocess.run(["node", "--check", "docs/app.js"], cwd=ROOT, check=True)
    run_node(
        """
const fs = require("fs");
const vm = require("vm");
new vm.Script(fs.readFileSync("apps-script/Code.gs", "utf8"));
"""
    )


def test_turnstile_errors_expose_diagnostic_code():
    app = (ROOT / "docs" / "app.js").read_text()
    backend = CODE_PATH.read_text()
    assert '"error-callback": (errorCode)' in app
    assert 'console.error("Turnstile error:", errorCode)' in app
    assert '"Turnstile validation failed: "' in backend
    assert 'errorCodes: result["error-codes"] || []' in backend


def test_apps_script_return_link_escapes_sandboxed_frame():
    backend = CODE_PATH.read_text()
    assert '<base target="_top">' in backend
    assert '<a href="${safeReturnUrl}" target="_top"${returnAction}>' in backend
