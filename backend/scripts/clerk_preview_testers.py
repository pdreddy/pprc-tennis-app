"""Create Clerk dev test users + sample rated matches for UI checks (preview only). Prints JSON with tickets."""
import json
import os
import urllib.parse
import urllib.request

from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
SK = os.environ["CLERK_SECRET_KEY"]
API = "http://localhost:8001/api"
CLUB = "82a25bc1-9def-58d4-bc37-4be4c1b8fd6d"


def clerk(path, body=None, method="POST"):
    req = urllib.request.Request("https://api.clerk.com/v1" + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": "Bearer " + SK, "Content-Type": "application/json", "User-Agent": "emergent-test"})
    return json.load(urllib.request.urlopen(req))


def user(email, first):
    found = clerk(f"/users?email_address={urllib.parse.quote(email)}", method="GET")
    if found:
        return found[0]
    return clerk("/users", {"email_address": [email], "password": "Test-pass-12345!", "skip_password_checks": True, "first_name": first, "last_name": "Tester"})


def token(uid):
    session = clerk("/sessions", {"user_id": uid})
    return clerk(f"/sessions/{session['id']}/tokens", {"expires_in_seconds": 900})["jwt"]


def api(method, path, tok, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


out = {}
a, b = user("alex+clerk_test@example.com", "Alex"), user("blair+clerk_test@example.com", "Blair")
ta, tb = token(a["id"]), token(b["id"])
for tok, name, level in ((ta, "Alex Tester", 7.0), (tb, "Blair Tester", 7.0)):
    api("POST", f"/v1/clubs/{CLUB}/join", tok)
    api("PUT", f"/v1/clubs/{CLUB}/players/me", tok, {"display_name": name, "city": "Prosper", "visibility": "public"} if api("GET", f"/v1/clubs/{CLUB}/players/me", tok)["profile"]["has_profile"] else {"display_name": name, "city": "Prosper", "visibility": "public", "starting_singles": level, "starting_doubles": level})
me = api("GET", f"/v1/clubs/{CLUB}/players/me", ta)
if me["ratings"]["singles"]["verified_matches"] < 5:
    for score in ("6-2 6-3", "6-4 6-4", "7-5 6-3", "6-1 6-2", "6-3 7-6"):
        result = api("POST", f"/v1/clubs/{CLUB}/match-results", ta, {"opponent_ids": [b["id"]], "score_text": score})
        api("POST", f"/v1/match-results/{result['id']}/confirm", tb)
out["alex"] = {"id": a["id"], "ticket": clerk("/sign_in_tokens", {"user_id": a["id"], "expires_in_seconds": 900})["token"]}
out["milestones"] = [m["title"] for m in api("GET", f"/v1/clubs/{CLUB}/players/me", ta)["milestones"]]
print(json.dumps(out))
