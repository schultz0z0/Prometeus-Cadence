"""Controlled Chromium smoke for the proposed website renderer.

Run with scrapling[fetchers]==0.4.6 and the SCRAPLING_TEST_CHROME executable path.
The script directs navigation to a loopback fixture. It creates no prospecting jobs.
"""

import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from os import environ
from threading import Thread
from time import sleep

from scrapling.fetchers import AsyncDynamicSession


class Site(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == "/lenta":
            sleep(3)
        if self.path == "/contato":
            body = "<main>Contato da empresa: teste@example.com</main>"
        else:
            body = """<main id="content"></main>
<script>
setTimeout(() => {
  document.querySelector('#content').innerHTML = `
    <p>Empresa [RE] renderizada por JavaScript</p>
    <button id="more">Carregar mais</button>`;
  document.querySelector('#more').onclick = () => {
    document.querySelector('#content').insertAdjacentHTML('beforeend',
      '<a href="/contato">Contato</a>');
  };
}, 150);
</script>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        try:
            self.wfile.write(body.encode())
        except (BrokenPipeError, ConnectionResetError):
            pass


async def check(origin):
    async def show_contact(page):
        await page.get_by_role("button", name="Carregar mais").click()

    async with AsyncDynamicSession(
        executable_path=environ["SCRAPLING_TEST_CHROME"],
        headless=True,
        google_search=False,
        retries=1,
    ) as browser:
        home = await browser.fetch(origin, page_action=show_contact, timeout=5000)
        assert "renderizada por JavaScript" in home.css("main p::text").get("")
        assert home.css("main a::attr(href)").get() == "/contato"

        try:
            await browser.fetch(origin + "/lenta", timeout=250)
        except Exception as error:
            assert "timeout" in type(error).__name__.lower(), type(error).__name__
        else:
            raise AssertionError("A página lenta deveria exceder o prazo")

        contact = await browser.fetch(origin + "/contato", timeout=5000)
        assert "teste@example.com" in contact.css("main::text").get("")


def main():
    with ThreadingHTTPServer(("127.0.0.1", 0), Site) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            asyncio.run(check(f"http://127.0.0.1:{server.server_port}"))
        finally:
            server.shutdown()
            thread.join()
    print("Chromium: JavaScript, ação de leitura, link e nova página após timeout OK")


if __name__ == "__main__":
    main()
