# Suraksha — Disaster Response Backend (DevRumble 2.0)

## Setup (5 minutes)

```bash
cd disaster-app
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python seed.py                  # creates disaster.db + demo rescuer/office accounts
python app.py                   # runs on http://localhost:5000
```

Open **http://localhost:5000** — there's a built-in test page (role select → Citizen / Rescuer / Head Office)
so you can try the whole flow before the real frontend is ready.

## Demo logins (from seed.py)
All passwords: `test123`
- Rescuer phones: 9800000001 through 9800000008
- Office phone: 9811111111
- Citizen: no login — just enter name/phone on the form, they're sent with the report only.

## Test flow
1. Open http://localhost:5000 → "Citizen" → allow location → hit the red SOS button.
2. Open a second browser tab → "Rescuer" → log in as 9800000001 → you should see the report you just sent.
3. Open a third tab → "Head Office" → log in as 9811111111 → see the report + reassign it to another team.

## Editing in VS Code
Yes, totally fine — this is just a normal Flask project, nothing special needed:
- Install the **Python** extension (for linting/debugging) — that's really the only one you need.
- Optional: **SQLite Viewer** extension if you want to browse `disaster.db` visually.
- Run/debug with F5 using the built-in Python debugger, or just `python app.py` in the VS Code terminal — either works, Flask's debug mode auto-reloads on save either way.
- If your friend runs the frontend separately from a different port (e.g. via VS Code Live Server), you'll need `flask-cors` — for now this project serves the frontend from Flask itself (same origin), so CORS isn't needed at all. Recommend keeping it that way to save time.

## API reference

| Method | Endpoint | Auth | Body |
|---|---|---|---|
| POST | /api/auth/login | none | `{role: "rescuer"|"office", phone, password}` |
| POST | /api/auth/logout | session | — |
| GET  | /api/me | session | — |
| POST | /api/report | **none (public)** | `{citizen_name?, citizen_phone?, hazard_type, severity, lat, lon, note?}` |
| GET  | /api/reports | rescuer/office | `?status=` optional filter |
| PATCH | /api/reports/:id/status | rescuer (own)/office | `{status}` |
| PATCH | /api/reports/:id/reassign | office only | `{staff_id}` |
| GET  | /api/alerts/nearby | **none (public)** | `?lat=&lon=&radius=` |
| GET  | /api/safety-tips | none | `?hazard_type=` |
| GET  | /api/teams | none | — |

No external APIs used anywhere — GPS is the browser's native Geolocation API, matching is plain Haversine math.
