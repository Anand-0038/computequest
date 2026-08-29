import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("COMPUTEQUEST_BASE_URL", "http://localhost:3000")
SCREENSHOT = Path(
    os.environ.get("BROWSER_TEST_SCREENSHOT", "/tmp/computequest-runtime-readiness.png")
)


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path="/usr/bin/google-chrome",
        )
        page = browser.new_page(viewport={"width": 390, "height": 844})
        health_requests = 0

        def count_health(request):
            nonlocal health_requests
            if request.url.endswith("/api/health"):
                health_requests += 1

        page.on("request", count_health)
        page.goto(BASE_URL, wait_until="networkidle")

        alert = page.get_by_role("alert").filter(has_text="RUNTIME NOT READY")
        alert.wait_for()
        alert_text = alert.inner_text()
        health_response = page.request.get(f"{BASE_URL}/api/health")
        assert health_response.status == 503
        health = health_response.json()
        assert health["status"] == "configuration_required"
        assert health["missing"]
        assert all(name in alert_text for name in health["missing"])
        assert page.get_by_role("button", name="START BUILD — 24 CE").is_disabled()
        assert page.get_by_text("SESSION UNAVAILABLE").count() == 0

        with page.expect_response(
            lambda response: response.url.endswith("/api/health") and response.status == 503
        ):
            alert.get_by_role("button", name="RECHECK RUNTIME").click()
        alert.wait_for()

        layout = page.evaluate(
            """() => ({
              viewportWidth: window.innerWidth,
              documentWidth: document.documentElement.scrollWidth,
              bodyWidth: document.body.scrollWidth
            })"""
        )
        assert layout["documentWidth"] <= layout["viewportWidth"]
        assert layout["bodyWidth"] <= layout["viewportWidth"]

        SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        print(
            json.dumps(
                {
                    "baseUrl": BASE_URL,
                    "healthRequests": health_requests,
                    "runtimeAlert": alert_text,
                    "missingConfiguration": health["missing"],
                    "primaryActionDisabled": True,
                    "sessionCreationDeferred": True,
                    "layout": layout,
                    "screenshot": str(SCREENSHOT),
                    "boundary": "Actual local HTTP 503 readiness response and real Chromium UI; no API interception.",
                },
                indent=2,
            )
        )
        browser.close()


if __name__ == "__main__":
    main()
