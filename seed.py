"""
Run once: python seed.py
Creates demo rescuer + office accounts so you have something to log in with immediately.
"""
from app import app, db, StaffUser
from werkzeug.security import generate_password_hash

RESCUERS = [
    # name, phone, lat, lon, is_government
    ("Kathmandu Metro Police Rescue", "9800000001", 27.7172, 85.3240, True),
    ("Nepal Army Disaster Unit",      "9800000002", 27.6950, 85.3000, True),
    ("Red Cross Patan Team",          "9800000003", 27.6588, 85.3247, False),
    ("Bhaktapur Fire & Rescue",       "9800000004", 27.6710, 85.4298, True),
    ("Kirtipur Volunteer Team",       "9800000005", 27.6774, 85.2831, False),
    ("Budhanilkantha Rescue Squad",   "9800000006", 27.7856, 85.3616, False),
    ("Thimi Community Rescue",        "9800000007", 27.6800, 85.3900, False),
    ("Nepal Police Central Rescue",   "9800000008", 27.7000, 85.3200, True),
]

OFFICES = [
    ("District Disaster Head Office", "9811111111"),
]

DEMO_PASSWORD = "test123"

with app.app_context():
    db.create_all()

    for name, phone, lat, lon, is_gov in RESCUERS:
        if not StaffUser.query.filter_by(phone=phone).first():
            db.session.add(StaffUser(
                name=name, phone=phone, role="rescuer",
                password_hash=generate_password_hash(DEMO_PASSWORD),
                lat=lat, lon=lon, status="available", is_government=is_gov,
            ))

    for name, phone in OFFICES:
        if not StaffUser.query.filter_by(phone=phone).first():
            db.session.add(StaffUser(
                name=name, phone=phone, role="office",
                password_hash=generate_password_hash(DEMO_PASSWORD),
            ))

    db.session.commit()
    print(f"Seeded {len(RESCUERS)} rescuer teams and {len(OFFICES)} office account(s).")
    print(f"All demo passwords: {DEMO_PASSWORD}")
    print("Rescuer phones:", [r[1] for r in RESCUERS])
    print("Office phones:", [o[1] for o in OFFICES])
