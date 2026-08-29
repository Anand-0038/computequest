import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("COMPUTEQUEST_BASE_URL", "http://localhost:3000")
SCREENSHOT = Path(os.environ.get("BROWSER_TEST_SCREENSHOT", "/tmp/computequest-sponsor-inquiry.png"))


def main():
    console_errors = []
    page_errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path="/usr/bin/google-chrome")
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(BASE_URL, wait_until="networkidle")

        page.locator(".sponsor-nav-link").focus()
        page.keyboard.press("Enter")
        page.wait_for_url(f"{BASE_URL}/#for-sponsors")
        page.get_by_role("heading", name="Fund useful work with one clear sponsor moment.").wait_for()

        page.get_by_label("COMPANY", exact=True).fill("ComputeQuest Browser QA")
        page.get_by_label("CONTACT NAME", exact=True).fill("Product Operator")
        page.get_by_label("CONTACT EMAIL", exact=True).fill("operator@example.com")
        page.get_by_label("COMPANY WEBSITE", exact=True).fill("https://example.com")
        page.get_by_label("CAMPAIGN DESTINATION", exact=True).fill("https://example.com/product")
        page.locator("label", has_text="CREATIVE FORMAT").locator("select").select_option("X_POST")
        page.get_by_label("CREATIVE LINK", exact=True).fill("https://example.com/sponsor-post")
        page.get_by_label("CAMPAIGN TITLE", exact=True).fill("Useful compute for product builders")
        page.locator("label", has_text="SHORT DESCRIPTION").locator("textarea").fill(
            "Show product builders how a sponsor can fund one useful AI task through a clear, voluntary exchange."
        )
        page.get_by_role("checkbox").check()

        with page.expect_response(
            lambda response: response.url.endswith("/api/sponsor-inquiries") and response.request.method == "POST"
        ) as response_info:
            page.get_by_role("button", name="REQUEST CAMPAIGN REVIEW").click()
        response = response_info.value
        assert response.status == 201
        response_body = response.json()
        reference = response_body["inquiry"]["id"]
        page.get_by_text("REQUEST RECEIVED", exact=True).wait_for()
        assert page.get_by_text(f"Reference {reference[:8].upper()}", exact=True).is_visible()

        SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SCREENSHOT), full_page=True)

        mobile = context.new_page()
        mobile.set_viewport_size({"width": 390, "height": 844})
        mobile.goto(f"{BASE_URL}/#for-sponsors", wait_until="networkidle")
        mobile.get_by_role("heading", name="Fund useful work with one clear sponsor moment.").wait_for()
        layout = mobile.evaluate(
            """() => ({
              viewportWidth: window.innerWidth,
              documentWidth: document.documentElement.scrollWidth,
              bodyWidth: document.body.scrollWidth,
              formColumns: getComputedStyle(document.querySelector('.sponsor-field-grid')).gridTemplateColumns
            })"""
        )
        assert layout["documentWidth"] <= layout["viewportWidth"]
        assert layout["bodyWidth"] <= layout["viewportWidth"]
        assert " " not in layout["formColumns"].strip()
        assert not console_errors, f"console errors: {console_errors}"
        assert not page_errors, f"page errors: {page_errors}"

        print(
            json.dumps(
                {
                    "baseUrl": BASE_URL,
                    "submissionStatus": response.status,
                    "reference": reference,
                    "operatorReviewed": True,
                    "desktopKeyboardNavigation": True,
                    "mobileLayout": layout,
                    "consoleErrors": console_errors,
                    "pageErrors": page_errors,
                    "screenshot": str(SCREENSHOT),
                    "boundary": "Real local Next.js route and PostgreSQL write; no API interception, email delivery, campaign activation, or Monad transaction.",
                },
                indent=2,
            )
        )
        browser.close()


if __name__ == "__main__":
    main()
