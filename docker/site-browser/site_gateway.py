"""Read-only network boundary for the browser service."""

import asyncio
import ipaddress
import re
import socket
from urllib.parse import urlsplit

from aiohttp.abc import AbstractResolver


MAX_BODY = 1_048_576
REQUEST_HEADERS = {"accept", "accept-language", "cookie", "origin", "range", "user-agent"}
HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
               "te", "trailer", "transfer-encoding", "upgrade", "content-length"}


class PolicyError(ValueError):
    pass


def public_address(value):
    address = ipaddress.ip_address(value)
    if isinstance(address, ipaddress.IPv6Address):
        # The gateway supports ordinary public IPv6 and IPv4. Avoid transition
        # addresses whose embedded IPv4 may lead to a private destination.
        if address.ipv4_mapped or address.sixtofour or address.teredo or address.scope_id:
            return False
        if address in ipaddress.ip_network("64:ff9b::/96") or address in ipaddress.ip_network("64:ff9b:1::/48"):
            return False
    return address.is_global and not address.is_multicast and not address.is_reserved


def public_url(value):
    try:
        if not isinstance(value, str) or len(value) > 3000 or re.search(r"[\x00-\x20\x7f\\]", value):
            raise ValueError
        url = urlsplit(value)
        if url.scheme not in {"http", "https"} or url.username is not None or url.password is not None:
            raise ValueError
        port = 443 if url.scheme == "https" else 80
        host = (url.hostname or "").rstrip(".").encode("idna").decode("ascii")
        if url.port not in {None, port} or not host or host.endswith((".local", ".internal", ".localhost")):
            raise ValueError
        try:
            ipaddress.ip_address(host)
        except ValueError:
            if not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}", host):
                raise ValueError
        else:
            if not public_address(host):
                raise ValueError
        return url, host, port
    except (ValueError, UnicodeError) as error:
        raise PolicyError("URL_BLOCKED") from error


class PublicResolver(AbstractResolver):
    def __init__(self, resolve=None):
        self.lookup = resolve

    async def resolve(self, host, port=0, family=socket.AF_UNSPEC):
        lookup = self.lookup or asyncio.get_running_loop().getaddrinfo
        entries = await lookup(host, port, type=socket.SOCK_STREAM)
        if not entries or any(not public_address(entry[4][0]) for entry in entries):
            raise PolicyError("URL_BLOCKED")
        return [{"hostname": host, "host": entry[4][0], "port": port, "family": entry[0],
                 "proto": entry[2], "flags": socket.AI_NUMERICHOST} for entry in entries]

    async def close(self):
        pass


async def fetch_public(session, value, method, headers):
    if method not in {"GET", "HEAD"}:
        raise PolicyError("METHOD_BLOCKED")
    public_url(value)
    safe_headers = {key: header for key, header in headers.items() if key in REQUEST_HEADERS
                    and isinstance(header, str) and len(header) <= 4000 and "\r" not in header and "\n" not in header}
    safe_headers.setdefault("user-agent", "PrometeusCadence/1.0 (public company research)")
    safe_headers["accept-encoding"] = "identity"
    async with session.request(method, value, headers=safe_headers, allow_redirects=False) as response:
        body = bytearray()
        async for chunk in response.content.iter_chunked(65536):
            body.extend(chunk)
            if len(body) > MAX_BODY:
                raise PolicyError("RESPONSE_TOO_LARGE")
        response_headers = {}
        for key, header in response.headers.items():
            key = key.lower()
            if key not in HOP_HEADERS:
                response_headers[key] = response_headers[key] + "\n" + header if key == "set-cookie" and key in response_headers else header
        return {"status": response.status, "headers": response_headers, "body": bytes(body)}
