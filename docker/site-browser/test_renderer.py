import asyncio
import os
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from renderer import BrowserFailure, render_page
from service import app_for
from site_gateway import PolicyError, PublicResolver, fetch_public, public_url


def reply(body, *, status=200, headers=None):
    return {"status": status, "headers": headers or {"content-type": "text/html; charset=utf-8"}, "body": body}


class RendererTests(unittest.IsolatedAsyncioTestCase):
    async def test_link_cap_is_reported_as_partial(self):
        async def fixture(_url, _method, _headers):
            return reply("".join(f'<a href="/page/{i}">[RE] Link</a>' for i in range(501)))

        result = await render_page("https://example.com/", 8000, fixture, executable=os.getenv("SITE_BROWSER_TEST_CHROME"))
        self.assertEqual(len(result["links"]), 500)
        self.assertTrue(result["truncated"])

    async def test_queue_returns_http_and_browser_redirects_without_visiting_target(self):
        seen = []

        async def fixture(url, _method, _headers):
            seen.append(url)
            if url.endswith("/old"):
                return reply("", status=301, headers={"location": "/restrito"})
            return reply("<script>location.assign('/restrito')</script>")

        for path, status in (("old", 301), ("script", 302)):
            result = await render_page("https://example.com/" + path, 8000, fixture,
                                       executable=os.getenv("SITE_BROWSER_TEST_CHROME"), queue_navigation=True)
            self.assertEqual(result, {"redirect": "https://example.com/restrito", "status": status})
        self.assertEqual(seen, ["https://example.com/old", "https://example.com/script"])

    async def test_real_javascript_link_pagination_and_context_isolation(self):
        seen = []

        async def fixture(url, method, headers):
            seen.append((url, method, headers.get("cookie")))
            if url.endswith("/start"):
                return reply("", status=302, headers={"location": "/catalogo"})
            if url.endswith("/pagina-2"):
                return reply("<main>Página dois [RE]</main>")
            return reply("""<main></main><script>
                const old = document.cookie || 'sem cookie';
                const stored = localStorage.getItem('fixture') || 'sem armazenamento';
                document.cookie = 'fixture=yes';
                localStorage.setItem('fixture', 'yes');
                setTimeout(() => {
                  document.querySelector('main').innerHTML = '<p>[RE] JS: '+old+', '+stored+'</p><button>Carregar mais</button>';
                  document.querySelector('button').onclick = () => {
                    document.querySelector('main').insertAdjacentHTML('beforeend', '<a href="/pagina-2">Página dois</a>');
                    document.querySelector('button').remove();
                  };
                }, 70);
            </script>""")

        result = await render_page("https://example.com/start", 8000, fixture, executable=os.getenv("SITE_BROWSER_TEST_CHROME"))
        self.assertEqual(result["url"], "https://example.com/catalogo")
        self.assertEqual(result["status"], 200)
        self.assertIn("[RE] JS: sem cookie, sem armazenamento", result["text"])
        self.assertIn("https://example.com/pagina-2", result["links"])
        next_page = await render_page(result["links"][0], 8000, fixture, executable=os.getenv("SITE_BROWSER_TEST_CHROME"))
        self.assertIn("Página dois [RE]", next_page["text"])
        self.assertIn(("https://example.com/pagina-2", "GET", None), seen)
        second_context = await render_page("https://example.com/catalogo", 8000, fixture, executable=os.getenv("SITE_BROWSER_TEST_CHROME"))
        self.assertIn("[RE] JS: sem cookie, sem armazenamento", second_context["text"])

    async def test_private_redirect_and_browser_subrequests_are_blocked(self):
        seen = []
        private_requests = []

        async def private_page(request):
            private_requests.append(request.method)
            return web.Response(text="[RE] private")

        async def fixture(url, method, headers):
            seen.append((url, method))
            if url.endswith("/redirect"):
                return reply("", status=302, headers={"location": private_url})
            return reply("""<main>[RE] Público</main><script>
                fetch('PRIVATE_URL').catch(() => {});
                fetch('/write', {method:'POST', body:'never'}).catch(() => {});
            </script>""".replace("PRIVATE_URL", private_url))

        private_app = web.Application()
        private_app.router.add_get("/secret", private_page)
        async with TestServer(private_app) as private_server:
            private_url = str(private_server.make_url("/secret"))
            with self.assertRaisesRegex(BrowserFailure, "URL_BLOCKED"):
                await render_page("http://example.com/redirect", 8000, fixture, executable=os.getenv("SITE_BROWSER_TEST_CHROME"))
            response = await render_page("http://example.com/", 8000, fixture, executable=os.getenv("SITE_BROWSER_TEST_CHROME"))
        self.assertIn("Público", response["text"])
        self.assertEqual(seen, [("http://example.com/redirect", "GET"), ("http://example.com/", "GET")])
        self.assertEqual(private_requests, [])

    async def test_redirect_after_pagination_preserves_final_url_and_relative_links(self):
        async def fixture(url, _method, _headers):
            if url.endswith("/antigo"):
                return reply("", status=302, headers={"location": "/novo/"})
            if url.endswith("/novo/"):
                return reply('<main>[RE] Página nova <a href="contato">Contato</a></main>')
            return reply('<button onclick="location.assign(\'/antigo\')">Carregar mais</button>')

        result = await render_page("https://example.com/", 10000, fixture, executable=os.getenv("SITE_BROWSER_TEST_CHROME"))
        self.assertEqual(result["url"], "https://example.com/novo/")
        self.assertEqual(result["links"], ["https://example.com/novo/contato"])

    async def test_timed_out_read_releases_its_browser(self):
        cancelled = asyncio.Event()

        async def fixture(url, _method, _headers):
            if url.endswith("/slow-script"):
                try:
                    await asyncio.sleep(30)
                finally:
                    cancelled.set()
            if url.endswith("/slow"):
                return reply('<main>[RE] Esperando recurso</main><script src="/slow-script"></script>')
            return reply("<main>[RE] Leitura concluída</main>")

        with self.assertRaisesRegex(BrowserFailure, "PAGE_TIMEOUT"):
            await render_page("https://example.com/slow", 4000, fixture, executable=os.getenv("SITE_BROWSER_TEST_CHROME"))
        self.assertTrue(cancelled.is_set())
        response = await render_page("https://example.com/", 8000, fixture, executable=os.getenv("SITE_BROWSER_TEST_CHROME"))
        self.assertIn("Leitura concluída", response["text"])


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def test_mixed_public_private_resolution_and_local_destinations_are_refused(self):
        async def mixed(_host, _port, **_options):
            return [(0, 0, 0, "", ("93.184.216.34", 443)), (0, 0, 0, "", ("169.254.169.254", 443))]

        for url in ("http://127.0.0.1/", "http://[::ffff:127.0.0.1]/", "http://host.docker.internal/", "https://example.com:8080/"):
            with self.subTest(url=url), self.assertRaises(PolicyError):
                public_url(url)
        with self.assertRaises(PolicyError):
            await PublicResolver(mixed).resolve("example.com", 443)

    async def test_gateway_refuses_post_without_resolving(self):
        with self.assertRaisesRegex(PolicyError, "METHOD_BLOCKED"):
            await fetch_public(None, "https://example.com/", "POST", {})

    async def test_api_requires_authorization_and_applies_gateway_policy(self):
        token = "fixture-" * 5
        async with TestClient(TestServer(app_for("gateway", token))) as api:
            body = {"url": "http://169.254.169.254/latest/meta-data/", "method": "GET", "headers": {}}
            async with api.post("/fetch", json=body) as response:
                self.assertEqual(response.status, 401)
            async with api.post("/fetch", json=body, headers={"Authorization": "Bearer " + token}) as response:
                self.assertEqual(response.status, 422)
                self.assertEqual(await response.json(), {"code": "URL_BLOCKED"})

    async def test_timeout_releases_an_http_slot(self):
        token = "fixture-" * 5
        occupied = asyncio.Event()
        time_out = asyncio.Event()
        finish = asyncio.Event()
        count = 0

        async def renderer(url, _timeout, _gateway, **_options):
            nonlocal count
            count += 1
            if count == 2:
                occupied.set()
            if url.endswith("/slow"):
                await time_out.wait()
                raise BrowserFailure("PAGE_TIMEOUT")
            if url.endswith("/waiting"):
                await finish.wait()
            return {"status": 200}

        with patch("service.render_page", renderer):
            async with TestClient(TestServer(app_for("browser", token))) as api:
                async def post(path):
                    async with api.post("/render", headers={"Authorization": "Bearer " + token},
                                        json={"url": "https://example.com/" + path, "timeoutMs": 1000}) as response:
                        return response.status

                slow = asyncio.create_task(post("slow"))
                waiting = asyncio.create_task(post("waiting"))
                try:
                    await asyncio.wait_for(occupied.wait(), 2)
                    self.assertEqual(await post("third"), 503)
                    time_out.set()
                    self.assertEqual(await slow, 504)
                    self.assertEqual(await post("third"), 200)
                finally:
                    finish.set()
                    time_out.set()
                    await asyncio.gather(slow, waiting)


if __name__ == "__main__":
    unittest.main()
