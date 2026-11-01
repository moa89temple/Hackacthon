"""Local pages for the container checks. Runs inside the test container and never touches Temple.

/home needs a login. Without one it redirects to /login, like Canvas does.
/login logs the browser in, the way a Student finishing a Takeover would.
"""
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Pages(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        cookies = SimpleCookie(self.headers.get("cookie", ""))
        if self.path == "/login":
            self.send_response(200)
            # A session cookie, like Canvas's: it has no expiry date.
            self.send_header("set-cookie", "session=signed-in; Path=/; HttpOnly")
            self.page("Sign in", "<h1>Sign in</h1><p>You are signed in.</p>")
        elif self.path == "/home" and "session" in cookies:
            self.send_response(200)
            self.page("Dashboard", '<h1>Dashboard</h1><p>Your courses</p><button>Open a course</button>')
        elif self.path == "/home":
            self.send_response(302)
            self.send_header("location", "/login-required")
            self.end_headers()
        elif self.path == "/login-required":
            self.send_response(200)
            self.page("Please log in", "<h1>Please log in</h1>")
        else:
            self.send_response(404)
            self.end_headers()

    def page(self, title, body):
        document = f"<!doctype html><title>{title}</title><body>{body}</body>".encode()
        self.send_header("content-type", "text/html")
        self.send_header("content-length", str(len(document)))
        self.end_headers()
        self.wfile.write(document)


ThreadingHTTPServer(("127.0.0.1", 8000), Pages).serve_forever()
