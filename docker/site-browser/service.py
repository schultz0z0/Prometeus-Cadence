import argparse
import asyncio
import base64
import hmac
import json
import logging
import os

from aiohttp import ClientError, ClientSession, ClientTimeout, DummyCookieJar, TCPConnector, web

from renderer import BrowserFailure, render_page
from site_gateway import PolicyError, PublicResolver, fetch_public


SESSION = web.AppKey("session", ClientSession)
INGRESS = web.AppKey("ingress", ClientSession)


def app_for(role, token, gateway="http://site-browser-gateway:8081/fetch"):
    if not token or len(token) < 32:
        raise RuntimeError("SITE_BROWSER_TOKEN requires at least 32 characters")
    render_capacity = asyncio.Semaphore(2)
    fetch_capacity = asyncio.Semaphore(16)

    async def http_session(app):
        connector = TCPConnector(resolver=PublicResolver(), use_dns_cache=False, force_close=True, limit=16) if role == "gateway" else None
        async with ClientSession(connector=connector, timeout=ClientTimeout(total=8),
                                 cookie_jar=DummyCookieJar(), trust_env=False, auto_decompress=False) as session:
            app[SESSION] = session
            if role == "gateway":
                async with ClientSession(timeout=ClientTimeout(total=29), cookie_jar=DummyCookieJar(), trust_env=False) as ingress:
                    app[INGRESS] = ingress
                    yield
            else:
                yield

    async def handle(request):
        provided = request.headers.get("Authorization", "")
        if not hmac.compare_digest(provided.encode(), ("Bearer " + token).encode()):
            return web.json_response({"code": "UNAUTHORIZED"}, status=401)
        capacity = fetch_capacity if request.path == "/fetch" else render_capacity
        if capacity.locked():
            return web.json_response({"code": "BUSY"}, status=503)
        async with capacity:
            try:
                async with asyncio.timeout(2):
                    body = await request.json()
                if not isinstance(body, dict):
                    raise ValueError
                if request.path == "/fetch":
                    if set(body) != {"url", "method", "headers"} or not isinstance(body["headers"], dict):
                        raise ValueError
                    result = await fetch_public(request.app[SESSION], body["url"], body["method"], body["headers"])
                    return web.json_response({**result, "body": base64.b64encode(result["body"]).decode("ascii")})
                if set(body) != {"url", "timeoutMs"} or type(body["timeoutMs"]) is not int or not 1000 <= body["timeoutMs"] <= 25000:
                    raise ValueError
                if role == "gateway":
                    # Fixed private destination. User-provided URLs never route this connection.
                    async with request.app[INGRESS].post("http://site-browser:8080/render", json=body,
                            headers={"Authorization": provided}, allow_redirects=False) as response:
                        return web.json_response(await response.json(), status=response.status)

                async def gateway_read(url, method, headers):
                    async with request.app[SESSION].post(gateway, json={"url": url, "method": method, "headers": headers},
                                                           headers={"Authorization": "Bearer " + token}, allow_redirects=False) as result:
                        raw = await result.json()
                        if result.status != 200:
                            if result.status == 504:
                                raise TimeoutError
                            raise PolicyError(raw.get("code", "GATEWAY_UNAVAILABLE"))
                        return {**raw, "body": base64.b64decode(raw["body"], validate=True)}

                return web.json_response(await render_page(body["url"], body["timeoutMs"], gateway_read))
            except (BrowserFailure, PolicyError) as error:
                code = str(error)
                status = 504 if code == "PAGE_TIMEOUT" else 503 if code == "BUSY" else 422
                return web.json_response({"code": code}, status=status)
            except TimeoutError:
                return web.json_response({"code": "PAGE_TIMEOUT"}, status=504)
            except (OSError, ClientError):
                return web.json_response({"code": "PAGE_UNAVAILABLE"}, status=502)
            except (json.JSONDecodeError, ValueError, TypeError):
                return web.json_response({"code": "INVALID_REQUEST"}, status=400)

    async def health(_request):
        if role == "gateway":
            try:
                async with _request.app[INGRESS].get("http://site-browser:8080/health", timeout=2, allow_redirects=False) as response:
                    if response.status != 200:
                        raise RuntimeError
            except (ClientError, OSError, TimeoutError, RuntimeError):
                return web.json_response({"status": "unavailable"}, status=503)
        return web.json_response({"status": "ok"})

    app = web.Application(client_max_size=16000)
    app.cleanup_ctx.append(http_session)
    app.router.add_get("/health", health)
    app.router.add_post("/render", handle)
    if role == "gateway":
        app.router.add_post("/fetch", handle)
    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=["browser", "gateway"])
    role = parser.parse_args().role
    # The upstream library logs full target URLs and browser trace messages.
    logging.disable(logging.CRITICAL)
    web.run_app(app_for(role, os.environ.get("SITE_BROWSER_TOKEN")), host="0.0.0.0",
                port=8080 if role == "browser" else 8081, access_log=None, print=None, handler_cancellation=True)
