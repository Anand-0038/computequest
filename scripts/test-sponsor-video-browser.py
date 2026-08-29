import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Route, sync_playwright


BASE_URL = "http://localhost:3000"
TASK_ID = "00000000-0000-4000-8000-000000000101"
SESSION_ID = "00000000-0000-4000-8000-000000000102"
CAMPAIGN_ID = "00000000-0000-4000-8000-000000000103"
PAYZOLL_CAMPAIGN_ID = "00000000-0000-4000-8000-000000000104"
REQUIRED_SECONDS = 15


def wait_for_payload(page, payloads, predicate, after=0, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for payload in payloads[after:]:
            if predicate(payload):
                return payload
        page.wait_for_timeout(100)
    raise AssertionError(f"heartbeat payload not observed after index {after}: {payloads}")


def main():
    heartbeat_payloads = []
    api_requests = []
    heartbeat_bodies = []
    console_messages = []
    page_errors = []
    sequence = 0
    accumulated_ms = 0
    force_complete = False

    def api(route: Route):
        nonlocal sequence, accumulated_ms, force_complete
        request = route.request
        path = urlparse(request.url).path
        if path.startswith("/api/"):
            api_requests.append(f"{request.method} {path}")
        if path == "/api/health":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"status": "ready"}))
            return
        if path == "/api/session":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"ready": True, "balance": 4}))
            return
        if path == "/api/tasks" and request.method == "POST":
            route.fulfill(
                status=201,
                content_type="application/json",
                body=json.dumps(
                    {
                        "task": {"id": TASK_ID, "status": "AWAITING_CREDITS"},
                        "balance": 4,
                        "shortage": 20,
                    }
                ),
            )
            return
        if path == "/api/campaigns" and request.method == "GET":
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"campaigns": [
                    {
                        "id": CAMPAIGN_ID,
                        "sponsorName": "Monad",
                        "campaignLabel": "ECOSYSTEM CAMPAIGN",
                        "creativeTitle": "Monad parallel execution",
                        "creativeDescription": "Parallel execution on Monad.",
                        "destinationUrl": "https://docs.monad.xyz",
                        "disclosure": "Independent educational creative.",
                        "creditReward": 20,
                        "requiredActiveSeconds": 20,
                    },
                    {
                        "id": PAYZOLL_CAMPAIGN_ID,
                        "sponsorName": "PayZoll",
                        "campaignLabel": "PARTNER CAMPAIGN",
                        "creativeTitle": "USDC in. INR out.",
                        "creativeDescription": "Global stablecoin payments with local settlement.",
                        "destinationUrl": "https://payzoll.finance",
                        "disclosure": "Partner creative for PayZoll.",
                        "creditReward": 20,
                        "requiredActiveSeconds": REQUIRED_SECONDS,
                    },
                ]}),
            )
            return
        if path == "/api/quests" and request.method == "POST":
            request_payload = json.loads(request.post_data or "{}")
            if request_payload.get("campaignId") != PAYZOLL_CAMPAIGN_ID:
                route.fulfill(status=400, content_type="application/json", body=json.dumps({"error": "WRONG_CAMPAIGN_SELECTED"}))
                return
            route.fulfill(
                status=201,
                content_type="application/json",
                body=json.dumps(
                    {
                        "session": {
                            "id": SESSION_ID,
                            "state": "CREATED",
                            "accumulatedActiveMs": 0,
                            "lastHeartbeatSequence": 0,
                            "lastHeartbeatEligible": False,
                            "lastAttentionReason": "VIDEO_NOT_PLAYING",
                        },
                        "campaign": {
                            "id": PAYZOLL_CAMPAIGN_ID,
                            "sponsorName": "PayZoll",
                            "campaignLabel": "PARTNER CAMPAIGN",
                            "creativeTitle": "USDC in. INR out.",
                            "creativeUrl": "/media/payzoll-global-payments.mp4",
                            "creativeDescription": "Global stablecoin payments with local settlement.",
                            "destinationUrl": "https://payzoll.finance",
                            "disclosure": "Partner creative for PayZoll.",
                            "creditReward": 20,
                            "requiredActiveSeconds": REQUIRED_SECONDS,
                        },
                    }
                ),
            )
            return
        if request.method == "POST" and "/heartbeat" in path:
            raw_body = request.post_data
            heartbeat_bodies.append(raw_body)
            payload = json.loads(raw_body or "{}")
            heartbeat_payloads.append(payload)
            sequence = payload["sequence"]
            reason = "VERIFIED"
            if not payload["documentVisible"]:
                reason = "DOCUMENT_HIDDEN"
            elif not payload["windowFocused"]:
                reason = "WINDOW_BLURRED"
            elif not payload["fullscreen"]:
                reason = "FULLSCREEN_EXITED"
            elif payload["pictureInPicture"]:
                reason = "PICTURE_IN_PICTURE"
            elif payload["buffering"]:
                reason = "VIDEO_BUFFERING"
            elif not payload["mediaPlaying"]:
                reason = "VIDEO_NOT_PLAYING"
            elif abs(payload["playbackRate"] - 1) > 0.001:
                reason = "PLAYBACK_RATE_CHANGED"
            eligible = reason == "VERIFIED"
            if eligible:
                accumulated_ms = REQUIRED_SECONDS * 1000 if force_complete else min(REQUIRED_SECONDS * 1000, accumulated_ms + 3000)
            attention_verified = accumulated_ms >= REQUIRED_SECONDS * 1000
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(
                    {
                        "session": {
                            "id": SESSION_ID,
                            "state": "ATTENTION_VERIFIED" if attention_verified else ("ACTIVE" if eligible else "PAUSED"),
                            "accumulatedActiveMs": accumulated_ms,
                            "lastHeartbeatSequence": sequence,
                            "lastHeartbeatEligible": eligible and not attention_verified,
                            "lastAttentionReason": "ATTENTION_VERIFIED" if attention_verified else reason,
                        }
                    }
                ),
            )
            return
        if path.startswith("/api/"):
            route.fulfill(status=404, content_type="application/json", body=json.dumps({"error": "TEST_ROUTE_UNHANDLED"}))
            return
        route.continue_()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=False,
            executable_path="/usr/bin/google-chrome",
            args=["--autoplay-policy=no-user-gesture-required"],
        )
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.on("console", lambda message: console_messages.append(f"{message.type}: {message.text}"))
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.route("**/*", api)
        page.goto(BASE_URL, wait_until="networkidle")
        page.get_by_label("PITCH DECK BRIEF").fill(
            "Create an eight-slide technical pitch deck for ComputeQuest and its verified sponsor quest."
        )
        page.wait_for_timeout(500)
        if page.get_by_role("button", name="START BUILD — 24 CE").is_disabled():
            raise AssertionError(
                json.dumps(
                    {
                        "apiRequests": api_requests,
                        "heartbeatBodies": heartbeat_bodies,
                        "networkLabel": page.locator(".cq-network").inner_text(),
                        "messages": page.locator(".system-message").all_inner_texts(),
                        "console": console_messages,
                        "pageErrors": page_errors,
                    },
                    indent=2,
                )
            )
        page.get_by_role("button", name="START BUILD — 24 CE").click()
        page.get_by_role("radio", name="PayZoll", exact=False).click()
        page.get_by_role("button", name="START SELECTED QUEST").click()
        video = page.locator("video.sponsor-video")
        video.wait_for(state="visible")
        assert page.locator("#quest-answer").count() == 0
        page.get_by_text("No quiz or text answer is required.", exact=False).wait_for()
        assert video.get_attribute("src") == "/media/payzoll-global-payments.mp4"
        page.wait_for_function(
            """() => {
              const video = document.querySelector('video.sponsor-video');
              return video && Number.isFinite(video.duration) && video.duration >= 18;
            }"""
        )
        assert video.evaluate("element => element.duration") >= 18

        page.get_by_role("button", name="ENTER ATTENTION MODE").click()
        page.wait_for_function(
            """() => {
              const video = document.querySelector('video.sponsor-video');
              return video && !video.paused && !video.ended && video.readyState >= 2 && video.currentTime > 0.25;
            }"""
        )
        try:
            playing = wait_for_payload(page, heartbeat_payloads, lambda item: item["mediaPlaying"] is True)
        except AssertionError as error:
            raise AssertionError(
                json.dumps(
                    {
                        "cause": str(error),
                        "apiRequests": api_requests,
                        "heartbeatBodies": heartbeat_bodies,
                        "questState": page.locator(".quest-state").inner_text(),
                        "questErrors": page.locator(".quest-error").all_inner_texts(),
                        "video": video.evaluate(
                            "element => ({paused: element.paused, ended: element.ended, readyState: element.readyState, currentTime: element.currentTime, duration: element.duration})"
                        ),
                        "console": console_messages,
                        "pageErrors": page_errors,
                    },
                    indent=2,
                )
            ) from error
        assert playing["documentVisible"] is True
        assert playing["windowFocused"] is True
        assert playing["fullscreen"] is True
        assert playing["pictureInPicture"] is False
        assert playing["buffering"] is False
        assert playing["playbackRate"] == 1
        assert playing["mediaTimeMs"] > 0
        assert playing["durationMs"] >= 18_000

        pause_index = len(heartbeat_payloads)
        page.get_by_role("button", name="PAUSE ATTENTION SESSION").click()
        paused = wait_for_payload(page, heartbeat_payloads, lambda item: item["mediaPlaying"] is False, pause_index)
        assert paused["documentVisible"] is True

        page.get_by_role("button", name="ENTER ATTENTION MODE").click()
        wait_for_payload(page, heartbeat_payloads, lambda item: item["mediaPlaying"] is True, len(heartbeat_payloads))
        background_index = len(heartbeat_payloads)
        page.evaluate(
            """() => {
              Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
              document.hasFocus = () => false;
              document.dispatchEvent(new Event('visibilitychange'));
              window.dispatchEvent(new Event('blur'));
            }"""
        )
        background = wait_for_payload(
            page,
            heartbeat_payloads,
            lambda item: item["documentVisible"] is False and item["windowFocused"] is False,
            background_index,
        )
        assert background["mediaPlaying"] in (True, False)

        foreground_index = len(heartbeat_payloads)
        page.evaluate(
            """() => {
              Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
              document.hasFocus = () => true;
              document.dispatchEvent(new Event('visibilitychange'));
              window.dispatchEvent(new Event('focus'));
            }"""
        )
        foreground = wait_for_payload(
            page,
            heartbeat_payloads,
            lambda item: item["documentVisible"] is True and item["windowFocused"] is True,
            foreground_index,
        )
        assert foreground["mediaPlaying"] is True

        waiting_index = len(heartbeat_payloads)
        video.dispatch_event("waiting")
        page.get_by_text("VIDEO BUFFERING — PROGRESS PAUSED").wait_for()
        buffering = wait_for_payload(page, heartbeat_payloads, lambda item: item["buffering"] is True, waiting_index)
        assert buffering["documentVisible"] is True
        assert buffering["mediaPlaying"] in (True, False)

        ended_index = len(heartbeat_payloads)
        video.evaluate("element => { element.currentTime = Math.max(0, element.duration - 0.15); return element.play(); }")
        page.get_by_text("VIDEO ENDED — REPLAY TO CONTINUE").wait_for(timeout=5000)
        ended = wait_for_payload(page, heartbeat_payloads, lambda item: item["mediaPlaying"] is False, ended_index)
        assert ended["mediaPlaying"] is False

        force_complete = True
        page.get_by_role("button", name="ENTER ATTENTION MODE").click()
        page.get_by_text("✓ VERIFIED ACTIVE VIEW").wait_for(timeout=5000)
        page.get_by_text("15 / 15 SEC VERIFIED").wait_for()
        page.get_by_role("button", name="CLAIM +20 CE").wait_for()
        assert page.get_by_role("button", name="ENTER ATTENTION MODE").count() == 0
        frozen_heartbeat_count = len(heartbeat_payloads)
        page.wait_for_timeout(3500)
        assert len(heartbeat_payloads) == frozen_heartbeat_count

        screenshot = Path(os.environ.get("BROWSER_TEST_SCREENSHOT", "/tmp/computequest-sponsor-video-browser.png"))
        screenshot.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(screenshot), full_page=True)
        result = {
            "heartbeatCount": len(heartbeat_payloads),
            "observedPlaying": playing,
            "observedPaused": paused,
            "observedBackground": background,
            "observedForeground": foreground,
            "observedEnded": ended,
            "observedAttentionVerified": True,
            "heartbeatsStoppedAtRequirement": len(heartbeat_payloads) == frozen_heartbeat_count,
            "videoCurrentTime": video.evaluate("element => element.currentTime"),
            "videoDuration": video.evaluate("element => element.duration"),
            "screenshot": str(screenshot),
            "boundary": "Controlled API responses; real ComputeQuest component, Chromium, and MP4 playback.",
            "visibilityBoundary": "Visibility and focus transitions are injected browser state; play, pause, and ended are real media-element events.",
        }
        print(json.dumps(result, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
