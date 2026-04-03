import json
import time
from pathlib import Path

import pandas as pd
import requests

BASE_DIR = Path(__file__).resolve().parent.parent
EXCEL_PATH = BASE_DIR / "public" / "data" / "Efficiency Navigator Program - Data Support Group (2).xlsx"
OUTPUT_PATH = BASE_DIR / "public" / "data" / "cross_street_coords.json"

TARGET_SHEETS = [
    "OEI by Measure",
    "CDBG and ARPA by Measure",
    "Madison Capital 2024",
    "Madison Capital & EECBG 2025",
]

def normalize_text(value):
    text = str(value or "").strip()
    if text.lower() == "nan":
        return ""
    return " ".join(text.split())

# manual corrections for known problematic street names
def clean_street_name(street):
    street = normalize_text(street)

    corrections = {
        "Willage Green Lane E": "Village Green Lane E",
        "Manona Dr.": "Monona Dr.",
        "W. Fieldler Ln.": "W. Fiedler Ln.",
        "Wyldewood Dr. / Monterey Drive": "Wyldewood Dr. / Monterey Dr.",
    }

    for bad, good in corrections.items():
        street = street.replace(bad, good)

    return street

# tries to find the most likely header for cross streets
def resolve_cross_street_column(columns):
    for col in columns:
        if "cross street" in str(col).strip().lower():
            return col
    raise KeyError(f"Could not find Cross Street column. Available columns: {list(columns)}")

# parse excel workbook and extract relevant data
def collect_unique_cross_streets(excel_path):
    xls = pd.ExcelFile(excel_path)
    streets = set()

    for sheet_name in TARGET_SHEETS:
        if sheet_name not in xls.sheet_names:
            continue

        df = pd.read_excel(excel_path, sheet_name=sheet_name)
        cross_col = resolve_cross_street_column(df.columns)

        current_street = ""
        for raw_value in df[cross_col].tolist():
            street = normalize_text(raw_value)

            if street:
                current_street = street

            if current_street and current_street.lower() != "nan":
                streets.add(current_street)

    return sorted(streets)

# since street names in the excel are in a weird format
# this builds a list of query strings to try for geocoding a given street name
def build_queries(street):
    street = clean_street_name(street)

    queries = [f"{street}, Madison WI"]

    if "/" in street:
        a, b = [part.strip(" .") for part in street.split("/", 1)]
        queries.extend([
            f"{a} and {b}, Madison WI",
            f"{a} & {b}, Madison WI",
            f"intersection of {a} and {b}, Madison WI",
            f"{a}, {b}, Madison WI",
        ])

    return queries

# geocode a single street name using Nominatim API
def geocode_single_street(session, street):
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "format": "jsonv2",
        "limit": 1,
        "q": f"{street}, Madison WI",
    }

    response = session.get(url, params=params, timeout=30)
    response.raise_for_status()

    data = response.json()
    if not data:
        return None

    return {
        "lat": float(data[0]["lat"]),
        "lng": float(data[0]["lon"]),
    }

# geocode a street name, trying multiple query formats if needed
def geocode_street(session, street):
    street = clean_street_name(street)

    if "/" in street:
        parts = [part.strip(" .") for part in street.split("/", 1)]
        if len(parts) == 2:
            coord1 = geocode_single_street(session, parts[0])
            time.sleep(0.5)
            coord2 = geocode_single_street(session, parts[1])

            if coord1 and coord2:
                return {
                    "lat": (coord1["lat"] + coord2["lat"]) / 2,
                    "lng": (coord1["lng"] + coord2["lng"]) / 2,
                }

    return geocode_single_street(session, street)


def main():
    if not EXCEL_PATH.exists():
        raise FileNotFoundError(f"Excel file not found: {EXCEL_PATH}")

    streets = collect_unique_cross_streets(EXCEL_PATH)
    print(f"Found {len(streets)} unique cross streets")

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "Sustain-Dane cross street geocoder/1.0 (local script)"
        }
    )

    coords = {}
    failures = []

    for i, street in enumerate(streets, start=1):
        try:
            coord = geocode_street(session, street)
            if coord is not None:
                coords[street] = coord
                print(f"[{i}/{len(streets)}] OK   {street} -> {coord}")
            else:
                failures.append(street)
                print(f"[{i}/{len(streets)}] MISS {street}")
        except Exception as e:
            failures.append(street)
            print(f"[{i}/{len(streets)}] FAIL {street} -> {e}")

        time.sleep(1.1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(coords, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(coords)} coordinates to {OUTPUT_PATH}")

    if failures:
        print("\nFailed streets:")
        for street in failures:
            print(street)


if __name__ == "__main__":
    main()