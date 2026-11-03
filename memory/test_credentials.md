# Test credentials (preview only)

Sign-in is DEMO mode in the preview (`VITE_AUTH_MODE=demo`): no password. Open `/signin` and click an account.
The frontend then sends `X-PPRC-User: <uid>` to the FastAPI backend (allowed only because `PPRC_ENVIRONMENT=development`).

| Account | UID | Role | Button test id |
| --- | --- | --- | --- |
| Club Administrator | admin | owner (club admin) | demo-signin-admin |
| Demo Player 1..16 | player1..player16 | player | demo-signin-player1 ... |
| New Visitor | visitor | not a club member | demo-signin-visitor |

API: `curl -H "X-PPRC-User: admin" $REACT_APP_BACKEND_URL/api/v1/clubs/82a25bc1-9def-58d4-bc37-4be4c1b8fd6d/events`
Club id: 82a25bc1-9def-58d4-bc37-4be4c1b8fd6d (slug `pprc`)
