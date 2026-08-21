"""
DevRumble 2.0 - Disaster Response Backend
Roles:
  - citizen: has a real account now (Citizen table below) — name/phone/password,
    saved via POST /api/auth/citizen-signup. Reports still don't require login
    (a citizen can SOS without ever signing up), but signing up persists them.
  - rescuer: pre-seeded account ONLY (phone + password, from seed.py). No
    self-registration route exists on purpose — represents one rescue team.
  - office:  pre-seeded account ONLY (phone + password, from seed.py). Sees
    everything, can reassign.

Frontend is served directly from ./frontend (same origin as the API -> no CORS needed).
Runs on 0.0.0.0 so other devices on the same network can reach it via this
machine's LAN IP, not just localhost.
"""

import math
from datetime import datetime

from flask import Flask, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__, static_folder="frontend", static_url_path="")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///disaster.db"
app.config["SECRET_KEY"] = "hackathon-demo-secret-change-me"
db = SQLAlchemy(app)

# ---------------------------------------------------------------- MODELS

class StaffUser(db.Model):
    """A rescuer (=one rescue team) or a head-office user. Citizens are NOT in this table.
    IMPORTANT: there is no signup route for this table — the ONLY way a row
    exists here is via seed.py. Login only ever succeeds against seeded rows."""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(10), nullable=False)  # 'rescuer' | 'office'
    lat = db.Column(db.Float, nullable=True)          # rescuer only
    lon = db.Column(db.Float, nullable=True)          # rescuer only
    status = db.Column(db.String(10), default="available")  # 'available' | 'busy' (rescuer only)
    is_government = db.Column(db.Boolean, default=False)     # rescuer only

    def to_dict(self):
        return {
            "id": self.id, "name": self.name, "phone": self.phone, "role": self.role,
            "lat": self.lat, "lon": self.lon, "status": self.status,
            "is_government": self.is_government,
        }


class Citizen(db.Model):
    """A citizen who used the Sign Up form. Purely a record — citizens still
    never need to log in to send an SOS (create_report stays public), this
    just persists the account so it's real and checkable in the database."""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {"id": self.id, "name": self.name, "phone": self.phone, "created_at": self.created_at.isoformat()}


class Report(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    citizen_name = db.Column(db.String(100), nullable=True)
    citizen_phone = db.Column(db.String(20), nullable=True)
    hazard_type = db.Column(db.String(30), nullable=False)   # earthquake | flood | landslide | fire | other
    severity = db.Column(db.String(10), nullable=False)      # low | medium | high
    lat = db.Column(db.Float, nullable=False)
    lon = db.Column(db.Float, nullable=False)
    note = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(15), default="active")      # active | dispatched | accepted | en_route | rescued | resolved
    assigned_staff_id = db.Column(db.Integer, db.ForeignKey("staff_user.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        staff = StaffUser.query.get(self.assigned_staff_id) if self.assigned_staff_id else None
        return {
            "id": self.id, "citizen_name": self.citizen_name, "citizen_phone": self.citizen_phone,
            "hazard_type": self.hazard_type, "severity": self.severity,
            "lat": self.lat, "lon": self.lon, "note": self.note, "status": self.status,
            "assigned_staff": staff.to_dict() if staff else None,
            "created_at": self.created_at.isoformat(),
        }


# ---------------------------------------------------------------- HELPERS

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def nearest_available_rescuer(lat, lon):
    rescuers = StaffUser.query.filter_by(role="rescuer", status="available").all()
    if not rescuers:
        return None
    return min(rescuers, key=lambda r: haversine_km(lat, lon, r.lat, r.lon))


def current_staff():
    """Returns the logged-in StaffUser, or None."""
    sid = session.get("staff_id")
    return StaffUser.query.get(sid) if sid else None


def require_role(*roles):
    staff = current_staff()
    if not staff or staff.role not in roles:
        return None
    return staff


SAFETY_TIPS = {
    "earthquake": [
        "Drop, Cover, and Hold On — get under sturdy furniture.",
        "Stay away from windows, mirrors, and heavy furniture.",
        "If outdoors, move to open ground away from buildings and power lines.",
        "After shaking stops, check for gas leaks before using electrical switches.",
    ],
    "flood": [
        "Move immediately to higher ground.",
        "Avoid walking or driving through moving water.",
        "Stay off bridges over fast-moving water.",
        "Disconnect electrical appliances if safe to do so.",
    ],
    "landslide": [
        "Move away from the path of a landslide as quickly as possible.",
        "Watch for cracking trees, unusual sounds, or tilting utility poles.",
        "Avoid river valleys and low-lying areas during heavy rain.",
        "Report new cracks in the ground or on structures immediately.",
    ],
    "fire": [
        "Get low and go — smoke rises, cleaner air is near the floor.",
        "Feel doors before opening; do not open if hot.",
        "Never use elevators during a fire.",
        "Once out, stay out and call for help.",
    ],
    "other": [
        "Stay calm and move away from immediate danger.",
        "Keep your phone charged and location services on.",
        "Follow instructions from local authorities.",
    ],
}


# ---------------------------------------------------------------- AUTH

@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(force=True)
    role = data.get("role")
    phone = data.get("phone", "").strip()
    password = data.get("password", "")

    if role not in ("rescuer", "office"):
        return jsonify({"error": "role must be 'rescuer' or 'office' (citizens don't log in)"}), 400

    staff = StaffUser.query.filter_by(phone=phone, role=role).first()
    if not staff or not check_password_hash(staff.password_hash, password):
        return jsonify({"error": "invalid phone or password"}), 401

    session["staff_id"] = staff.id
    return jsonify(staff.to_dict())


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/citizen-signup", methods=["POST"])
def citizen_signup():
    """PUBLIC — saves a real Citizen row (name/phone/password). Citizens still
    never need to log in to send an SOS; this just persists the account."""
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    phone = (data.get("phone") or "").strip()
    password = data.get("password") or ""

    if not name or not phone or not password:
        return jsonify({"error": "name, phone and password are all required"}), 400

    if Citizen.query.filter_by(phone=phone).first():
        return jsonify({"error": "an account with this phone number already exists"}), 409

    citizen = Citizen(name=name, phone=phone, password_hash=generate_password_hash(password))
    db.session.add(citizen)
    db.session.commit()
    return jsonify(citizen.to_dict()), 201


@app.route("/api/citizens")
def list_citizens():
    """office-only — lets you verify signups actually landed in the database
    from the app itself, without opening a SQLite client."""
    staff = require_role("office")
    if not staff:
        return jsonify({"error": "office login required"}), 403
    citizens = Citizen.query.order_by(Citizen.created_at.desc()).all()
    return jsonify([c.to_dict() for c in citizens])


@app.route("/api/me")
def me():
    staff = current_staff()
    if not staff:
        return jsonify({"error": "not logged in"}), 401
    return jsonify(staff.to_dict())


@app.route("/api/me/status", methods=["PATCH"])
def update_my_status():
    """Lets a logged-in rescuer flip their own AVAILABLE / BUSY toggle in the UI."""
    staff = require_role("rescuer")
    if not staff:
        return jsonify({"error": "rescuer login required"}), 403

    new_status = request.get_json(force=True).get("status")
    if new_status not in ("available", "busy"):
        return jsonify({"error": "status must be 'available' or 'busy'"}), 400

    staff.status = new_status
    db.session.commit()
    return jsonify(staff.to_dict())


# ---------------------------------------------------------------- REPORTS

@app.route("/api/report", methods=["POST"])
def create_report():
    """PUBLIC — citizens call this directly, no login required."""
    data = request.get_json(force=True)
    for field in ("hazard_type", "severity", "lat", "lon"):
        if field not in data:
            return jsonify({"error": f"missing field: {field}"}), 400

    report = Report(
        citizen_name=data.get("citizen_name"),
        citizen_phone=data.get("citizen_phone"),
        hazard_type=data["hazard_type"],
        severity=data["severity"],
        lat=float(data["lat"]),
        lon=float(data["lon"]),
        note=data.get("note"),
    )

    rescuer = nearest_available_rescuer(report.lat, report.lon)
    if rescuer:
        report.assigned_staff_id = rescuer.id
        report.status = "dispatched"
        rescuer.status = "busy"

    db.session.add(report)
    db.session.commit()
    return jsonify(report.to_dict()), 201


@app.route("/api/reports")
def list_reports():
    staff = current_staff()
    if not staff:
        return jsonify({"error": "login required"}), 401

    query = Report.query
    if staff.role == "rescuer":
        query = query.filter_by(assigned_staff_id=staff.id)
    # office sees everything

    status_filter = request.args.get("status")
    if status_filter:
        query = query.filter_by(status=status_filter)

    reports = query.order_by(Report.created_at.desc()).all()
    return jsonify([r.to_dict() for r in reports])


@app.route("/api/reports/<int:report_id>/status", methods=["PATCH"])
def update_status(report_id):
    staff = current_staff()
    if not staff:
        return jsonify({"error": "login required"}), 401

    report = Report.query.get_or_404(report_id)
    if staff.role == "rescuer" and report.assigned_staff_id != staff.id:
        return jsonify({"error": "not your assigned report"}), 403

    # Widened to match the frontend's rescuer action buttons (ACCEPTED / EN ROUTE / RESCUED)
    # in addition to the original backend states.
    VALID_STATUSES = ("active", "dispatched", "accepted", "en_route", "rescued", "resolved")
    new_status = request.get_json(force=True).get("status")
    if new_status not in VALID_STATUSES:
        return jsonify({"error": f"invalid status, must be one of {VALID_STATUSES}"}), 400

    report.status = new_status
    if new_status in ("resolved", "rescued") and report.assigned_staff_id:
        assigned = StaffUser.query.get(report.assigned_staff_id)
        if assigned:
            assigned.status = "available"

    db.session.commit()
    return jsonify(report.to_dict())


@app.route("/api/reports/<int:report_id>/reassign", methods=["PATCH"])
def reassign(report_id):
    staff = require_role("office")
    if not staff:
        return jsonify({"error": "office login required"}), 403

    report = Report.query.get_or_404(report_id)
    new_staff_id = request.get_json(force=True).get("staff_id")
    new_staff = StaffUser.query.get(new_staff_id)
    if not new_staff or new_staff.role != "rescuer":
        return jsonify({"error": "invalid staff_id"}), 400

    if report.assigned_staff_id:
        old = StaffUser.query.get(report.assigned_staff_id)
        if old:
            old.status = "available"

    report.assigned_staff_id = new_staff.id
    new_staff.status = "busy"
    report.status = "dispatched"
    db.session.commit()
    return jsonify(report.to_dict())


# ---------------------------------------------------------------- ALERTS / TIPS / TEAMS

@app.route("/api/alerts/nearby")
def alerts_nearby():
    """PUBLIC — citizen app polls this with live GPS to get proximity warnings."""
    lat = float(request.args.get("lat"))
    lon = float(request.args.get("lon"))
    radius = float(request.args.get("radius", 2))

    active = Report.query.filter(Report.severity == "high",
                                  Report.status.in_(["active", "dispatched", "accepted", "en_route"])).all()
    close = [r for r in active if haversine_km(lat, lon, r.lat, r.lon) <= radius]
    return jsonify([r.to_dict() for r in close])


@app.route("/api/safety-tips")
def safety_tips():
    hazard = request.args.get("hazard_type", "other")
    return jsonify({"hazard_type": hazard, "tips": SAFETY_TIPS.get(hazard, SAFETY_TIPS["other"])})


@app.route("/api/teams")
def teams():
    """PUBLIC read — office/rescuer views need it, and it's harmless info (no personal data beyond team name)."""
    rescuers = StaffUser.query.filter_by(role="rescuer").all()
    return jsonify([r.to_dict() for r in rescuers])


# ---------------------------------------------------------------- FRONTEND (real UI, served as static files)

@app.route("/")
def index():
    # frontend/index.html — citizen.html, rescuer.html, office.html, emergency.html, styles.css,
    # script.js are all served automatically from the same folder since static_url_path="".
    return app.send_static_file("index.html")


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    # host="0.0.0.0" makes this reachable from other devices on the same
    # network via this machine's LAN IP (e.g. http://192.168.x.x:5000),
    # not just from localhost on this machine.
    app.run(host="0.0.0.0", debug=True, port=5000)
