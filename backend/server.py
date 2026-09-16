"""Reverse proxy: forwards all requests received on :8001 to the Signature
Realty CRM Node server running internally on :3001.

The platform ingress routes /api/* to this FastAPI service (:8001) and
everything else to the frontend (:3000). Both entry points transparently
proxy to the single Node CRM process on :3001, which owns both the HTML
pages and the /api endpoints.
"""
import os
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import Response
from starlette.background import BackgroundTask

CRM_TARGET = os.environ.get("CRM_TARGET", "http://127.0.0.1:3001")

app = FastAPI()

client = httpx.AsyncClient(base_url=CRM_TARGET, timeout=httpx.Timeout(120.0))

# Hop-by-hop headers that must not be forwarded.
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length", "host",
}


@app.on_event("shutdown")
async def _shutdown():
    await client.aclose()


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy(request: Request, path: str):
    url = httpx.URL(path="/" + path, query=request.url.query.encode("utf-8"))

    # Preserve the browser-facing host/scheme so the CRM can resolve the
    # real public origin for the OAuth redirect and secure cookies.
    incoming_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    incoming_proto = request.headers.get("x-forwarded-proto") or "https"

    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in HOP_BY_HOP
    }
    if incoming_host:
        headers["host"] = incoming_host
        headers["x-forwarded-host"] = incoming_host
    headers["x-forwarded-proto"] = incoming_proto

    body = await request.body()

    rp_req = client.build_request(
        request.method, url, headers=headers, content=body,
    )
    rp_resp = await client.send(rp_req, stream=True)

    content = await rp_resp.aread()
    await rp_resp.aclose()

    response = Response(content=content, status_code=rp_resp.status_code)
    # Preserve every header (including multiple Set-Cookie) verbatim.
    response.raw_headers = [
        (k.encode("latin-1"), v.encode("latin-1"))
        for k, v in rp_resp.headers.multi_items()
        if k.lower() not in HOP_BY_HOP
    ]
    return response
