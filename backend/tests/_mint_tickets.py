import sys, json, urllib.parse
sys.path.insert(0, "/app/backend/tests")
from test_clerk_preview_auth import clerk
out = {}
for k in ("alex", "blair"):
    u = clerk(f"/users?email_address={urllib.parse.quote(k + '+clerk_test@example.com')}", method="GET")[0]
    out[k] = {"user_id": u["id"], "ticket": clerk("/sign_in_tokens", {"user_id": u["id"], "expires_in_seconds": 900})["token"]}
print(json.dumps(out))
