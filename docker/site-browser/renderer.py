"""Render a single page. Every intercepted request goes through the gateway."""

import asyncio
import os
import re
from urllib.parse import urljoin

from playwright.async_api import Error as PlaywrightError, TimeoutError as PlaywrightTimeout
from scrapling.fetchers import AsyncDynamicSession
from yarl import URL

from site_gateway import PolicyError, public_url


class BrowserFailure(RuntimeError):
    pass


class QueuedNavigation(Exception):
    def __init__(self, target, status=302):
        self.target = target
        self.status = status


def same_domain(first, second):
    return first.removeprefix("www.") == second.removeprefix("www.")


def browser_url(value):
    url = URL(value).with_fragment(None)
    return url if url.raw_path != "/" else url.with_path("/", keep_query=True)


async def render_page(url, deadline_ms, fetch, *, executable=None, queue_navigation=False):
    try:
        _, domain, _ = public_url(url)
    except PolicyError as error:
        raise BrowserFailure(str(error)) from error

    snapshot = {}
    blocked_navigation = False
    active = set()
    requests = 0
    bytes_read = 0
    resource_limited = False
    entries = {}
    pending_redirect = None
    queued_navigation = None
    deadline = asyncio.get_running_loop().time() + deadline_ms / 1000

    async def follow(value, method, headers, navigation):
        original = browser_url(value)
        for _ in range(6):
            _, host, _ = public_url(value)
            if navigation and not same_domain(domain, host):
                raise PolicyError("URL_BLOCKED")
            reply = await fetch(value, method, headers)
            location = reply["headers"].get("location")
            if reply["status"] not in {301, 302, 303, 307, 308} or not location:
                if not navigation and original.origin() != browser_url(value).origin():
                    reply = {**reply, "headers": {key: header for key, header in reply["headers"].items() if key != "set-cookie"}}
                return value, reply
            target = urljoin(value, location)
            old, _, _ = public_url(value)
            new, _, _ = public_url(target)
            if navigation and queue_navigation:
                raise QueuedNavigation(target, reply["status"])
            if (old.scheme, old.netloc) != (new.scheme, new.netloc):
                headers = {key: header for key, header in headers.items() if key != "cookie"}
            value = target
        raise PolicyError("REDIRECT_LIMIT")

    async def route_request(route):
        nonlocal requests, bytes_read, blocked_navigation, pending_redirect, queued_navigation, resource_limited
        task = asyncio.current_task()
        active.add(task)
        request = route.request
        navigation = request.is_navigation_request()
        main_navigation = False
        try:
            main_navigation = navigation and request.frame.parent_frame is None
            if navigation and queue_navigation and not main_navigation:
                await route.abort()
                return
            if request.method not in {"GET", "HEAD"} or request.resource_type in {"media", "image", "font"}:
                await route.abort()
                return
            _, host, _ = public_url(request.url)
            if navigation and not same_domain(domain, host):
                raise PolicyError("URL_BLOCKED")
            if main_navigation and queue_navigation and browser_url(request.url) != browser_url(url):
                raise QueuedNavigation(request.url)
            requests += 1
            if requests > 120 or bytes_read >= 20_000_000:
                raise PolicyError("PAGE_RESOURCE_LIMIT")
            key = browser_url(request.url)
            reply = entries.pop(key, None) if main_navigation else None
            if reply is None:
                resolved, reply = await follow(request.url, request.method, await request.all_headers(), navigation)
                if navigation and browser_url(resolved) != key:
                    # Chromium can bypass route interception on a native 3xx.
                    # Restart only the navigation, using the already validated
                    # response at its real URL so relative links remain correct.
                    if main_navigation:
                        entries[browser_url(resolved)] = reply
                        pending_redirect = resolved
                    await route.abort()
                    return
            bytes_read += len(reply["body"])
            if bytes_read > 20_000_000:
                raise PolicyError("PAGE_RESOURCE_LIMIT")
            await route.fulfill(status=reply["status"], headers=reply["headers"], body=reply["body"])
        except QueuedNavigation as redirect:
            queued_navigation = redirect
            await route.abort()
        except PolicyError as error:
            if str(error) == "PAGE_RESOURCE_LIMIT":
                resource_limited = True
            if main_navigation and str(error) == "URL_BLOCKED":
                blocked_navigation = True
            await route.abort()
        except (OSError, PlaywrightError, ValueError):
            await route.abort()
        finally:
            active.discard(task)

    async def setup(page):
        await page.context.route("**/*", route_request)
        await page.context.route_web_socket("**/*", lambda websocket: websocket.close())

    async def capture(page):
        nonlocal pending_redirect
        more = page.get_by_role("button", name=re.compile(r"^(carregar mais|load more|mostrar mais)$", re.I))
        for click in range(4):
            try:
                await page.wait_for_load_state("networkidle", timeout=min(1400, deadline_ms))
            except PlaywrightTimeout:
                pass
            if pending_redirect:
                target, pending_redirect = pending_redirect, None
                await page.goto(target)
                await page.wait_for_load_state("domcontentloaded")
            if not await more.first.is_visible():
                break
            if click == 3:
                snapshot["pagination_limited"] = True
                break
            try:
                await more.first.click(timeout=min(800, deadline_ms))
            except PlaywrightError:
                if not pending_redirect:
                    raise
        snapshot.update(await page.evaluate("""() => ({
            url: location.href,
            text: document.body?.innerText?.slice(0, 24001) ?? '',
            links: [...document.querySelectorAll('a[href]')].slice(0, 1501).map(a => a.href)
        })"""))

    # Fail closed if Chromium bypasses request interception, including background
    # traffic and a redirect the framework does not expose to the route handler.
    browser_env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL",
                   "SYSTEMROOT", "SystemRoot", "WINDIR", "LOCALAPPDATA") if key in os.environ}
    settings = {"headless": True, "google_search": False, "retries": 1, "max_pages": 1,
                "proxy": "http://127.0.0.1:9", "extra_flags": ["--proxy-bypass-list=<-loopback>",
                    "--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
                "additional_args": {"service_workers": "block", "accept_downloads": False, "env": browser_env}}
    if executable:
        settings["executable_path"] = executable
    try:
        async with asyncio.timeout(deadline_ms / 1000):
            final_url, entry = await follow(url, "GET", {}, True)
            entries[browser_url(final_url)] = entry
            async with AsyncDynamicSession(**settings) as session:
                try:
                    remaining = int((deadline - asyncio.get_running_loop().time()) * 1000) - 200
                    if remaining <= 0:
                        raise TimeoutError
                    response = await session.fetch(final_url, timeout=remaining, page_setup=setup, page_action=capture)
                finally:
                    tasks = tuple(active)
                    for task in tasks:
                        task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
    except QueuedNavigation as redirect:
        return {"redirect": redirect.target, "status": redirect.status}
    except (TimeoutError, PlaywrightTimeout) as error:
        if queued_navigation:
            return {"redirect": queued_navigation.target, "status": queued_navigation.status}
        raise BrowserFailure("PAGE_TIMEOUT") from error
    except PolicyError as error:
        raise BrowserFailure(str(error)) from error
    except (PlaywrightError, RuntimeError) as error:
        if queued_navigation:
            return {"redirect": queued_navigation.target, "status": queued_navigation.status}
        raise BrowserFailure("URL_BLOCKED" if blocked_navigation else "PAGE_UNAVAILABLE") from error

    if queued_navigation:
        return {"redirect": queued_navigation.target, "status": queued_navigation.status}
    if blocked_navigation:
        raise BrowserFailure("URL_BLOCKED")
    if not snapshot:
        raise BrowserFailure("PAGE_UNAVAILABLE")
    text = snapshot["text"].strip()
    links = {}
    for link in snapshot["links"]:
        try:
            parsed, host, _ = public_url(link)
        except PolicyError:
            continue
        if same_domain(domain, host):
            links[parsed._replace(fragment="").geturl()] = None
    return {"url": snapshot["url"], "status": response.status, "text": text[:24000],
            "truncated": (len(text) > 24000 or len(links) > 500 or len(snapshot["links"]) > 1500
                          or resource_limited or snapshot.get("pagination_limited", False)), "links": list(links)[:500]}
