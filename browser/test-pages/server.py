"""Local pages for the container checks. Runs inside the test container and never touches Temple.

/home needs a login. Without one it redirects to /login, like Canvas does.
/login logs the browser in, the way a Student finishing a Takeover would.

Everything else is for the network guard and the form-submit routine. /ledger says which requests
reached this server, so a check can see what really got out of the browser, and /ledger/clear
empties it.
"""
import base64
import hashlib
import json
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LEDGER = []
WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

FORM_FIELDS = """
  <input type="hidden" name="token" value="from-the-page">
  <label>Subject <input name="subject"></label>
  <label>Note <textarea name="note"></textarea></label>
  <label>Kind <select name="kind"><option value="question">Question</option><option value="other">Other</option></select></label>
  <label><input type="checkbox" name="urgent" value="yes"> Urgent</label>
"""


def form(attributes='action="/forms/send"', fields=FORM_FIELDS, extra=""):
    return (
        f'<form id="advising" method="post" {attributes}>{fields}{extra}'
        '<button type="submit">Send</button><button type="submit" name="draft" value="1">Save draft</button></form>'
    )


FORM_PAGES = {
    "/form-page": form(),
    "/form-page-extra-field": form(extra='<input name="cc">'),
    "/form-page-extra-hidden-field": form(extra='<input type="hidden" name="to" value="someone-else">'),
    "/form-page-missing-field": form(fields='<input type="hidden" name="token" value="x"><input name="subject">'),
    "/form-page-elsewhere": form('action="/forms/somewhere-else"'),
    "/form-page-gets": form('action="/forms/send" data-x="y"').replace('method="post"', 'method="get"'),
    "/form-page-password": form(extra='<input type="password" name="password">'),
    "/form-page-to-error": form('action="/forms/error"'),
    "/form-page-redirects-post": form('action="/forms/307"'),
    "/form-page-to-quiz": form('action="/quizzes/1/submit"'),
    # Changes what's being sent at the last moment, after Buddy's checks.
    "/form-page-swaps-value": form()
    + "<script>document.getElementById('advising').addEventListener('submit', (event) => {"
    "event.target.elements.subject.value = 'Something else'; });</script>",
    # Sends something else alongside the form, and tries to send the form twice.
    "/form-page-sends-more": form()
    + "<script>document.getElementById('advising').addEventListener('submit', () => {"
    "fetch('/analytics', {method: 'POST', body: 'x=1'});"
    "});</script>",
    # Presses nothing and sends nothing.
    "/form-page-refuses": form()
    + "<script>document.getElementById('advising').addEventListener('submit', (event) => event.preventDefault());</script>",
    # The two identical requests an unlucky double submit would make.
    "/form-page-sends-twice": form()
    + "<script>document.getElementById('advising').addEventListener('submit', (event) => {"
    "event.preventDefault(); const body = new URLSearchParams(new FormData(event.target));"
    "const send = () => fetch('/forms/send', {method: 'POST', body});"
    "send(); send(); setTimeout(send, 100);"
    "});</script>",
}

ACTIVE_PAGE = """
<title>Active</title><h1>Active</h1>
<img src="/img-ok">
<iframe src="/frame-same"></iframe>
<iframe src="http://127.0.0.2:8000/frame-other"></iframe>
<script>
  fetch('/changes', {method: 'POST', body: 'x=1'}).catch(() => {});
  fetch('/changes-too', {method: 'DELETE'}).catch(() => {});
  fetch('/changes-as-well', {method: 'PUT', body: 'x=1'}).catch(() => {});
  navigator.sendBeacon('/beacon', 'x=1');
  fetch('/search', {method: 'POST', body: 'q=read'}).catch(() => {});
  fetch('/search-ish', {method: 'POST', body: 'q=read'}).catch(() => {});
  new Worker('/worker.js');
  try { new WebSocket('ws://127.0.0.1:8000/socket'); } catch (error) {}
  const auto = document.createElement('form');
  auto.method = 'post'; auto.action = '/auto-submitted'; auto.target = 'hidden-frame';
  const frame = document.createElement('iframe'); frame.name = 'hidden-frame';
  document.body.append(frame, auto);
  auto.submit();
</script>
"""

SERVICE_WORKER_PAGE = """
<title>Has a worker</title><h1>Has a worker</h1>
<script>
  navigator.serviceWorker.register('/sw.js').then(() => { document.title = 'Registered'; });
</script>
"""

PAGES = {
    "/active": ACTIVE_PAGE,
    "/has-service-worker": SERVICE_WORKER_PAGE,
    "/ticking": "<title>Ticking</title><script>new Worker('/ticking-worker.js');</script>",
    "/private-resource": '<title>Loads from a private address</title><img src="http://127.0.0.3:8000/from-private">',
    "/public-resources": '<title>Loads from a public address</title><img src="http://cdn.elsewhere.test:8000/img-ok">'
    '<iframe src="http://cdn.elsewhere.test:8000/frame-same"></iframe>',
    "/link-away": '<title>Goes elsewhere</title><script>location.href = "http://cdn.elsewhere.test:8000/public";</script>',
    "/frame-same": "<title>Frame</title><script>fetch('/from-frame', {method: 'POST', body: 'x=1'}).catch(() => {});</script>",
    "/frame-other": "<title>Frame</title><script>fetch('/from-other-frame', {method: 'POST', body: 'x=1'}).catch(() => {});</script>",
    "/quizzes/1": "<title>A quiz</title><h1>A quiz</h1>",
    "/forms/sent": "<title>Sent</title><h1>Your form was sent</h1>",
    "/forms/landing": "<title>Landing</title><h1>Landing</h1>",
    "/public": "<title>Public page</title><h1>A public page</h1>",
    "/secret": "<title>Secret</title><h1>Somewhere Buddy may not go</h1>",
}

REDIRECTS = {
    "/redirect-to-quiz": "/quizzes/1",
    "/redirect-away": "http://127.0.0.3:8000/secret",
    "/redirect-to-public": "http://127.0.0.2:8000/public",
}

SCRIPTS = {
    "/worker.js": "fetch('/worker-ran').catch(() => {});"
    "fetch('/from-worker', {method: 'POST', body: 'x=1'}).catch(() => {});"
    "try { new WebSocket('ws://127.0.0.1:8000/socket-from-worker'); } catch (error) {}"
    "new Worker('/nested-worker.js');",
    "/ticking-worker.js": "setInterval(() => fetch('/tick').catch(() => {}), 100);",
    "/nested-worker.js": "fetch('/nested-worker-ran').catch(() => {});"
    "fetch('/from-nested-worker', {method: 'POST', body: 'x=1'}).catch(() => {});"
    "try { new WebSocket('ws://127.0.0.1:8000/socket-from-nested-worker'); } catch (error) {}",
    "/sw.js": "const send = () => fetch('/from-service-worker', {method: 'POST', body: 'x=1'}).catch(() => {});"
    "self.addEventListener('install', () => { self.skipWaiting(); send(); });"
    "self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));"
    "self.addEventListener('fetch', () => { send(); });",
}


class Pages(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def note(self, body=""):
        LEDGER.append({"method": self.command, "path": self.path, "host": self.headers.get("host", ""), "body": body})

    def do_GET(self):
        cookies = SimpleCookie(self.headers.get("cookie", ""))
        if self.path == "/ledger":
            self.send_response(200)
            self.page_with_type("application/json", json.dumps(LEDGER).encode())
            return
        if self.path == "/ledger/clear":
            LEDGER.clear()
            self.send_response(200)
            self.page_with_type("application/json", b"[]")
            return
        self.note()
        if self.path in ("/socket", "/socket-from-worker", "/socket-from-nested-worker"):
            self.open_socket()
        elif self.path == "/login":
            self.send_response(200)
            # A session cookie, like Canvas's: it has no expiry date.
            self.send_header("set-cookie", "session=signed-in; Path=/; HttpOnly")
            self.page("Sign in", "<h1>Sign in</h1><p>You are signed in.</p>")
        elif self.path == "/home" and "session" in cookies:
            self.send_response(200)
            self.page("Dashboard", '<h1>Dashboard</h1><p>Your courses</p><button>Open a course</button>')
        elif self.path == "/home":
            self.redirect("/login-required")
        elif self.path == "/login-required":
            self.send_response(200)
            self.page("Please log in", "<h1>Please log in</h1>")
        elif self.path in FORM_PAGES:
            self.send_response(200)
            self.page("A form", FORM_PAGES[self.path])
        elif self.path in PAGES:
            self.send_response(200)
            self.page_with_type("text/html", f"<!doctype html>{PAGES[self.path]}".encode())
        elif self.path in REDIRECTS:
            self.redirect(REDIRECTS[self.path])
        elif self.path in SCRIPTS:
            self.send_response(200)
            self.page_with_type("text/javascript", SCRIPTS[self.path].encode())
        else:
            self.answer(404)

    def do_POST(self):
        self.receive()
        if self.path == "/forms/send":
            self.redirect("/forms/sent", 303)
        elif self.path == "/forms/307":
            self.redirect("/forms/landing", 307)
        elif self.path == "/forms/error":
            self.answer(500)
        else:
            self.answer(200)

    def do_PUT(self):
        self.receive()
        self.answer(200)

    def do_DELETE(self):
        self.receive()
        self.answer(200)

    def receive(self):
        length = int(self.headers.get("content-length", 0))
        self.note(self.rfile.read(length).decode())

    def open_socket(self):
        accept = base64.b64encode(
            hashlib.sha1((self.headers.get("sec-websocket-key", "") + WEBSOCKET_GUID).encode()).digest()
        ).decode()
        self.send_response(101)
        self.send_header("upgrade", "websocket")
        self.send_header("connection", "upgrade")
        self.send_header("sec-websocket-accept", accept)
        self.end_headers()
        self.close_connection = True

    def redirect(self, location, status=302):
        self.send_response(status)
        self.send_header("location", location)
        self.send_header("content-length", "0")
        self.end_headers()

    def answer(self, status):
        self.send_response(status)
        self.send_header("content-length", "0")
        self.end_headers()

    def page(self, title, body):
        document = f"<!doctype html><title>{title}</title><body>{body}</body>".encode()
        self.page_with_type("text/html", document)

    def page_with_type(self, content_type, document):
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(document)))
        self.end_headers()
        self.wfile.write(document)


# On every address, for the checks that need a second or third host name. Nothing publishes this port.
ThreadingHTTPServer(("0.0.0.0", 8000), Pages).serve_forever()
