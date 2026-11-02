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
    "/form-page-to-graded-work": form('action="/courses/101/assignments/501/submissions"'),
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

# A made-up Canvas, modelled on the public canvas-lms templates. Nothing here came from a real account.
# Every MARKER is something the Canvas check must never print, whichever way a page holds it.
CANVAS_COURSES = """
<title>MARKERPAGETITLE</title>
<script>window.ENV = {current_user: {display_name: "MARKERSTUDENT"}};</script>
<div class="header-bar"><h1>All Courses</h1></div><div class="ic-Action-header"></div>
<table id="my_courses_table" class="ic-Table course-list-table"><tbody>
  <tr class="course-list-table-row">
    <td class="course-list-course-title-column"><a href="/courses/101" title="MARKERCOURSE"><span class="name">MARKERCOURSE Biology</span></a></td>
    <td class="course-list-term-column">2026 Fall</td><td class="course-list-enrolled-as-column">Student</td>
  </tr>
  <tr class="course-list-table-row">
    <td class="course-list-course-title-column"><a href="/courses/102" title="MARKERCOURSE"><span class="name">MARKERCOURSE Writing</span></a></td>
    <td class="course-list-term-column">2026 Fall</td><td class="course-list-enrolled-as-column">Student</td>
  </tr>
</tbody></table>
<script>
  fetch('/api/graphql', {method: 'POST', body: '{"query":"MARKERQUERY"}'}).catch(() => {});
  fetch('/courses/101/users?who=MARKERSTUDENT').catch(() => {});
  fetch('/courses/101/quizzes/30?who=MARKERSTUDENT').catch(() => {});
</script>
"""

# Fills itself in after it has loaded, as Canvas's list does, and with a frame that holds a quiz.
CANVAS_ASSIGNMENTS = """
<title>MARKERPAGETITLE</title><div id="ag-list"></div>
<iframe src="/courses/101/quizzes/30/take"></iframe>
<script>
  window.addEventListener('load', () => setTimeout(async () => {
    const answer = await fetch('/api/v1/courses/101/assignment_groups');
    const assignments = await answer.json();
    document.getElementById('ag-list').innerHTML = assignments.map((one) =>
      '<li class="assignment"><div class="ig-row" id="assignment_' + one.id + '"><a class="ig-title" href="/courses/101/assignments/' + one.id + '">' + one.name + '</a>' +
      '<div class="assignment-date-due"><time datetime="' + one.due + '">soon</time></div></div></li>').join('');
  }, 200));
</script>
"""

CANVAS_GRADES = """
<title>MARKERPAGETITLE</title>
<table id="grades_summary"><tbody>
  <tr class="student_assignment assignment_graded" id="submission_501" data-muted="false">
    <th class="title"><a href="/courses/101/assignments/501/submissions/56">MARKERASSIGNMENT Lab</a></th>
    <td class="due">Nov 5 by 11:59pm</td><td class="submitted">Nov 1 at 8pm</td>
    <td class="assignment_score"><span class="grade">18</span><span>/ 20</span></td>
  </tr>
  <tr class="comments"><td><table class="score_details_table"><tr><td>Mean: MARKERCLASSMATE</td></tr></table></td></tr>
  <tr class="student_assignment hard_coded final_grade" id="submission_final-grade">
    <th class="title">Total</th><td class="assignment_score"><span class="grade">91.2%</span></td>
  </tr>
</tbody></table>
"""

CANVAS_ANNOUNCEMENTS = """
<title>MARKERPAGETITLE</title>
<div class="announcements-v2__wrapper">
  <div class="ic-announcement-row">
    <div class="ic-item-row__author-col"><span aria-label="MARKERCLASSMATE">X</span></div>
    <a class="ic-item-row__content-link" href="/courses/101/discussion_topics/900"><h3>MARKERANNOUNCEMENT title</h3></a>
    <div class="ic-announcement-row__content user_content"><p class="MARKERRICHCLASS">MARKERANNOUNCEMENT words</p></div>
    <span class="ic-item-row__meta-content-timestamp">Nov 1, 2026 at 9:00am</span>
  </div>
</div>
"""

# A page that's changed in a way the reader doesn't know, full of what a page could hold.
CANVAS_UNKNOWN = """
<title>MARKERPAGETITLE</title>
<div class="made-up-new-layout" role="region" data-course="MARKERCOURSE" title="MARKERCOURSE" aria-label="MARKERGRADE">
  <h2 class="made-up-heading">MARKERGRADE</h2>
  <a class="made-up-link" href="/courses/102/pages/markerslug?q=MARKERQUERY" data-id="MARKERATTRIBUTE">MARKERASSIGNMENT</a>
  <div class="user_content"><p class="MARKERRICHCLASS">MARKERANNOUNCEMENT</p></div>
</div>
"""

CANVAS_PAGES = {
    "/courses": CANVAS_COURSES,
    "/courses/101/assignments": CANVAS_ASSIGNMENTS,
    "/courses/101/grades": CANVAS_GRADES,
    "/courses/101/announcements": CANVAS_ANNOUNCEMENTS,
    "/courses/102/assignments": CANVAS_UNKNOWN,
    "/courses/102/announcements": '<div class="announcements-v2__wrapper"><h2>No Announcements</h2></div>',
}
CANVAS_ASSIGNMENT_LIST = json.dumps(
    [
        {"id": 501, "name": "MARKERASSIGNMENT Lab", "due": "2026-11-06T04:59:00Z"},
        {"id": 502, "name": "MARKERASSIGNMENT Essay", "due": "2026-11-20T04:59:00Z"},
    ]
)

# A made-up TUportal, modelled on Banner's View Holds table. Nothing here came from a real account.
# Every MARKER is something the TUportal check must never print, whichever way a page holds it.
TUPORTAL_HOLDS = """
<title>MARKERPAGETITLE</title>
<h2>View Holds</h2>
<table class="datadisplaytable">
  <tr><th>Hold Type</th><th>Reason</th><th>Originator</th></tr>
  <tr><td>MARKERHOLD Bursar</td><td>MARKERREASON</td><td>MARKERSTAFF</td></tr>
</table>
<iframe src="/group/home/registration"></iframe>
<script>
  fetch('/group/home/student-record-services', {method: 'POST', body: 'x=1'}).catch(() => {});
  fetch('/group/home/add-drop?who=MARKERSTUDENT').catch(() => {});
</script>
"""

# The empty message is there all along, and it's the stylesheet that hides it, while the holds are in a layout the reader doesn't know.
TUPORTAL_HIDDEN_EMPTY_MESSAGE = """
<title>View Holds</title>
<style>.empty-state { display: none; }</style>
<div class="empty-state">No holds exist</div>
<div class="made-up-card">MARKERHOLD Bursar</div>
"""

# The real Cost & Aid tab keeps the balance in a frame, and words outside it mustn't count.
TUPORTAL_COST_AND_AID = """
<title>MARKERPAGETITLE</title>
<h2>Student Account</h2>
<p>Current Balance: $111.11</p>
<iframe src="/html/TEMPLE/apps/tup/Channels/index.jsp"></iframe>
"""

# Fills itself in after it has loaded, as a portal's channels can.
TUPORTAL_BALANCE = """
<title>MARKERPAGETITLE</title>
<div id="snapshot"></div>
<script>
  setTimeout(() => {
    document.getElementById('snapshot').innerHTML = '<table><tr><th>Current Balance</th><td>$876.54</td></tr></table>';
  }, 100);
</script>
"""

TUPORTAL_REGISTRATION = """
<title>MARKERPAGETITLE</title>
<dl><dt>Term:</dt><dd>MARKERTERM</dd><dt>Registration Status:</dt><dd>MARKERSTATUS</dd></dl>
<a href="/group/home/registration">Register for Classes (Add/Drop)</a>
"""

TUPORTAL_PAGES = {
    "/group/home": '<title>MARKERPAGETITLE</title><h1>Welcome, MARKERSTUDENT</h1><a href="/group/home/costs-and-aid">Cost &amp; Aid</a>',
    "/group/home/student-record-services?holds?pweb": TUPORTAL_HOLDS,
    "/group/home/costs-and-aid": TUPORTAL_COST_AND_AID,
    "/html/TEMPLE/apps/tup/Channels/index.jsp": TUPORTAL_BALANCE,
    "/group/home/student": TUPORTAL_REGISTRATION,
}

# A made-up Outlook on the web. The server sends an empty page, and its script asks for the mail by POST
# and builds what the reader wants late, as the real app does. Nothing here came from a real account.
OUTLOOK_MESSAGES = [
    {"id": "AAQkMadeUpOne=", "address": "made.up.markerperson@temple.edu", "name": "MARKERNAME", "subject": "MARKERSUBJECT", "body": "MARKERWORDS"},
    {"id": "AAQkMadeUpTwo=", "address": "markerstranger@elsewhere.test", "name": "MARKERNAME", "subject": "MARKERSUBJECT", "body": "MARKERNEVEROPENED"},
]
OUTLOOK_STATE = {"unread": True}

OUTLOOK_INBOX = """
<title>MARKERPAGETITLE</title><div id="appRoot"></div>
<script>
  setTimeout(async () => {
    const answer = await fetch('/owa/service.svc?action=FindConversation&app=Mail', {method: 'POST', headers: {action: 'FindConversation'}});
    const {messages, unread} = await answer.json();
    document.getElementById('appRoot').innerHTML = '<div role="listbox" aria-label="Message list">' + messages.map((one) =>
      '<div role="option" data-convid="' + one.id + '" aria-label="' + (unread ? 'Unread ' : '') + one.name + '">' +
      '<span title="' + one.address + '">' + one.name + '</span><span title="' + one.subject + '">' + one.subject + '</span>' +
      '<span title="Mon 11/2/2026 10:32 AM">10:32 AM</span></div>').join('') + '</div>';
  }, 1500);
</script>
"""

# Once it has shown the message it tries to mark it read, by address and by header, as the real app would.
OUTLOOK_MESSAGE = """
<title>MARKERPAGETITLE</title><div id="appRoot"></div>
<script>
  setTimeout(async () => {
    const answer = await fetch('/owa/service.svc?action=GetConversationItems&app=Mail', {method: 'POST', headers: {action: 'GetConversationItems'}});
    const one = await answer.json();
    document.getElementById('appRoot').innerHTML = '<div id="ReadingPaneContainerId" aria-label="Reading Pane">' +
      '<div role="heading">' + one.subject + '</div><div aria-label="From: ' + one.name + '">' + one.name + ' &lt;' + one.address + '&gt;</div>' +
      '<div data-testid="SentReceivedSavedTime">Mon 11/2/2026 10:32 AM</div>' +
      '<div aria-label="Message body"><p class="x_MARKERCLASS">' + one.body + '</p></div></div>';
    fetch('/owa/service.svc?action=UpdateItem&app=Mail', {method: 'POST', headers: {action: 'UpdateItem'}}).catch(() => {});
    fetch('/owa/service.svc?action=GetItem&app=Mail', {method: 'POST', headers: {action: 'UpdateItem'}}).catch(() => {});
    fetch('/owa/graphql', {method: 'POST', body: 'mutation'}).catch(() => {});
  }, 1500);
</script>
"""

# A made-up Navigate360, modelled on the public scripts at /app/, /app/v1/ and /app/v2/: a page that picks
# the version, then one that fetches late and draws inside its own element. Nothing here came from an account.
NAVIGATE360_PAGES = {
    "/app/": """
<title>Navigate360</title>
<script>
  (async () => {
    const answer = await fetch('/api/v1/core/appconfig/');
    const target = new URL(location.href);
    target.pathname = answer.ok ? '/app/v2/' : '/app/v1/';
    if (answer.ok) target.hash = '';
    location.replace(target.href);
  })();
</script>""",
    "/app/v1/": """
<title>Navigate360</title><h1>Search Temple University</h1>
<script>if (!location.hash) location.replace('#/authentication/');</script>""",
    "/app/v2/": """
<title>Navigate360 Student</title><main id="app" class="suh-content"></main>
<script>
  customElements.define('made-up-view', class extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      setTimeout(async () => {
        const team = location.hash.includes('/people/');
        const answer = await fetch(team ? '/api/students/7/support_team' : "/api/v2/scheduling/current_user?slim=%27true%27");
        const { data } = await answer.json();
        root.innerHTML = '<h1>MARKER' + 'DRAWN</h1><button>' + (data.team ? data.team[0].first_name : 'Schedule') + '</button>';
        fetch('/api/v2/scheduling/appointments/', { method: 'POST', body: 'x=1' }).catch(() => {});
      }, 300);
    }
  });
  document.getElementById('app').append(document.createElement('made-up-view'));
</script>""",
}
NAVIGATE360_ANSWERS = {
    "/api/v1/core/appconfig/": {"member_features": {"core-student_web_experience_v2": True}},
    "/api/students/7/support_team": {
        "data": {
            "team": [
                {
                    "id": 501,
                    "first_name": "MARKERADVISOR",
                    "last_name": "MARKERSURNAME",
                    "email": "markeremail@temple.edu",
                    "work_phone": "215-555-0142",
                    "relationship": "Primary Advisor",
                },
                {"id": 502, "first_name": "MARKERINSTRUCTOR", "last_name": "X", "email": "markerother@temple.edu", "relationship": "Instructor"},
            ]
        }
    },
    "/api/v2/scheduling/current_user": {
        "data": {"user": {"upcoming_appointments": [{"id": 9, "start": "2099-01-01T15:00:00Z", "name": "MARKERVISIT", "location": {"name": "MARKERPLACE"}}]}}
    },
}

REDIRECTS = {
    "/redirect-to-quiz": "/quizzes/1",
    # What Canvas does when a teacher has hidden a course's Grades page.
    "/courses/102/grades": "/courses/102",
    "/courses/101/grades-redirects-to-quiz": "/courses/101/quizzes/30",
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
            OUTLOOK_STATE["unread"] = True
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
        elif self.path == "/made-up-canvas-login":
            self.send_response(200)
            self.send_header("set-cookie", "canvas_session=signed-in; Path=/; HttpOnly")
            self.page("Signed in", "<h1>Signed in</h1>")
        elif self.path == "/login/made-up-saml":
            self.send_response(200)
            self.page("MARKERPAGETITLE", "<h1>MARKERSTUDENT, log in</h1>")
        elif self.path == "/made-up-tuportal-login":
            self.send_response(200)
            self.send_header("set-cookie", "tuportal_session=signed-in; Path=/; HttpOnly")
            self.page("Signed in", "<h1>Signed in</h1>")
        elif self.path == "/c/portal/login":
            self.send_response(200)
            self.page("MARKERPAGETITLE", "<h1>MARKERSTUDENT, log in</h1>")
        elif self.path == "/tuportal-hidden-empty-message":
            self.send_response(200)
            self.page_with_type("text/html", f"<!doctype html>{TUPORTAL_HIDDEN_EMPTY_MESSAGE}".encode())
        elif self.path in TUPORTAL_PAGES and "tuportal_session" not in cookies:
            self.redirect("/c/portal/login")
        elif self.path in TUPORTAL_PAGES:
            self.send_response(200)
            self.page_with_type("text/html", f"<!doctype html>{TUPORTAL_PAGES[self.path]}".encode())
        elif self.path == "/made-up-outlook-login":
            self.send_response(200)
            self.send_header("set-cookie", "outlook_session=signed-in; Path=/; HttpOnly")
            self.page("Signed in", "<h1>Signed in</h1>")
        elif self.path == "/made-up-microsoft-sign-in":
            self.send_response(200)
            self.page("MARKERPAGETITLE", '<form><input name="loginfmt" placeholder="MARKERSTUDENT"></form>')
        elif self.path.startswith("/mail/inbox") and "outlook_session" not in cookies:
            self.redirect("http://127.0.0.6:8000/made-up-microsoft-sign-in")
        elif self.path == "/mail/inbox":
            self.send_response(200)
            self.page_with_type("text/html", f"<!doctype html>{OUTLOOK_INBOX}".encode())
        elif self.path.startswith("/mail/inbox/id/"):
            self.send_response(200)
            self.page_with_type("text/html", f"<!doctype html>{OUTLOOK_MESSAGE}".encode())
        elif self.path in CANVAS_PAGES and "canvas_session" not in cookies:
            self.redirect("/login/made-up-saml")
        elif self.path in CANVAS_PAGES:
            self.send_response(200)
            self.page_with_type("text/html", f"<!doctype html>{CANVAS_PAGES[self.path]}".encode())
        elif self.path == "/api/v1/courses/101/assignment_groups":
            self.send_response(200)
            self.page_with_type("application/json", CANVAS_ASSIGNMENT_LIST.encode())
        elif self.path == "/made-up-navigate360-login":
            self.send_response(200)
            self.send_header("set-cookie", "navigate360_session=signed-in; Path=/; HttpOnly")
            self.page("Signed in", "<h1>Signed in</h1>")
        elif self.path in NAVIGATE360_PAGES:
            self.send_response(200)
            self.page_with_type("text/html", f"<!doctype html>{NAVIGATE360_PAGES[self.path]}".encode())
        elif self.path.split("?")[0] in NAVIGATE360_ANSWERS:
            signed_in = "navigate360_session" in cookies
            self.send_response(200 if signed_in else 401)
            body = NAVIGATE360_ANSWERS[self.path.split("?")[0]] if signed_in else {"error": "MARKERERROR"}
            self.page_with_type("application/json", json.dumps(body).encode())
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
        if self.path.startswith("/owa/service.svc?action=FindConversation"):
            self.send_response(200)
            self.page_with_type("application/json", json.dumps({"messages": OUTLOOK_MESSAGES, "unread": OUTLOOK_STATE["unread"]}).encode())
        elif self.path.startswith("/owa/service.svc?action=GetConversationItems"):
            self.send_response(200)
            self.page_with_type("application/json", json.dumps(OUTLOOK_MESSAGES[0]).encode())
        elif self.path.startswith("/owa/service.svc") or self.path.startswith("/owa/graphql"):
            OUTLOOK_STATE["unread"] = False
            self.answer(200)
        elif self.path == "/forms/send":
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
