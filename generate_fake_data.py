"""Generate fake sensor readings for the Group 4D dashboard.

Output: data/readings.json and data/readings.csv

Format matches the team's agreed reading (null = missing value, never 0).

Run: python generate_fake_data.py
"""

import csv
import json
import math
import os
import random
from datetime import datetime, timedelta, timezone

random.seed(42)  # same data every run, so everyone sees the same thing

DAYS = 7
STEP_MIN = 10
DEVICE_ID = "node-01"
FIELDS = [
    "device_id", "seq", "ts_utc",
    "air_temp_c", "humidity_pct", "pressure_hpa", "light_lux",
    "soil_moist_10cm_pct", "soil_moist_30cm_pct", "soil_temp_c",
    "rain_mm_10min", "batt_v", "rssi_dbm", "fw",
]

now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
now -= timedelta(minutes=now.minute % STEP_MIN)
start = now - timedelta(days=DAYS)
rows = []
seq = 1000
soil10, soil30 = 33.0, 40.0
batt = 4.05
t = start

# Rain storms: (day offset, hour, duration in steps, tips per step)
storms = [(1, 15, 9, 3), (3, 17, 6, 2), (5, 14, 12, 4)]
storm_steps = set()
for d, h, dur, tips in storms:
    s = start + timedelta(days=d, hours=h)
    for k in range(dur):
        storm_steps.add((s + timedelta(minutes=STEP_MIN * k), tips))
storm_map = {ts: tips for ts, tips in storm_steps}

# A 3-hour gap where the node was "offline" on day 4 (no rows at all)
gap_start = start + timedelta(days=4, hours=2)
gap_end = gap_start + timedelta(hours=3)

while t <= now:
    local = t + timedelta(hours=3)  # East Africa Time (UTC+3)
    hour = local.hour + local.minute / 60  # local hour of the day, 0 to 24

    if gap_start <= t < gap_end:
        seq += 1  # sequence still advances, so the gap is detectable
        t += timedelta(minutes=STEP_MIN)
        continue

    # Air temperature: coolest ~03:30, warmest ~15:30 local time (about 17-30 C)
    air_t = 23.5 + 6.5 * math.sin((hour - 9.5) / 24 * 2 * math.pi) + random.gauss(0, 0.3)
    rain_tips = storm_map.get(t, 0)
    rain_mm = round(rain_tips * 0.2, 2)
    if rain_tips:
        air_t -= 3
    humidity = 72 - 2.2 * (air_t - 23.5) + (12 if rain_tips else 0) + random.gauss(0, 1.5)
    humidity = max(35, min(98, humidity))
    pressure = 1012 + 1.6 * math.sin((hour - 4) / 12 * 2 * math.pi) + random.gauss(0, 0.15)

    # Light: daylight bell between 06:30 and 18:30, dimmer when raining
    if 6.5 <= hour <= 18.5:
        lux = 90000 * math.sin((hour - 6.5) / 12 * math.pi) ** 1.5
        lux *= 0.25 if rain_tips else random.uniform(0.7, 1.0)
    else:
        lux = random.uniform(0, 3)

    # Soil moisture: rises with rain, slowly dries otherwise
    soil10 += rain_tips * 1.3 - 0.05 - max(0, air_t - 25) * 0.004
    soil30 += rain_tips * 0.6 - 0.02
    soil10 = max(12, min(62, soil10))
    soil30 = max(18, min(58, soil30))
    soil_t = 22 + 2.5 * math.sin((hour - 11) / 24 * 2 * math.pi) + random.gauss(0, 0.1)

    # Battery: sawtooth, charges by day, drains by night
    batt += 0.0009 if 7 <= hour <= 17 else -0.0006
    batt = max(3.55, min(4.15, batt))
    rssi = int(random.gauss(-87, 3))

    row = {
        "device_id": DEVICE_ID, "seq": seq, "ts_utc": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "air_temp_c": round(air_t, 1), "humidity_pct": round(humidity, 1),
        "pressure_hpa": round(pressure, 1), "light_lux": round(lux),
        "soil_moist_10cm_pct": round(soil10, 1), "soil_moist_30cm_pct": round(soil30, 1),
        "soil_temp_c": round(soil_t, 1), "rain_mm_10min": rain_mm,
        "batt_v": round(batt, 2), "rssi_dbm": rssi, "fw": "1.0.3",
    }
    rows.append(row)
    seq += 1
    t += timedelta(minutes=STEP_MIN)

    # Sprinkle a few missing values (null, not 0) so the dashboard handles them
for idx in random.sample(range(len(rows)), 12):
    key = random.choice(["pressure_hpa", "soil_moist_30cm_pct", "light_lux"])
    rows[idx][key] = None

os.makedirs("data", exist_ok=True)
with open("data/readings.json", "w") as f:
    json.dump(rows, f)

with open("data/readings.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=FIELDS)
    w.writeheader()
    w.writerows(rows)

print(f"Wrote {len(rows)} readings ({rows[0]['ts_utc']} to {rows[-1]['ts_utc']})")