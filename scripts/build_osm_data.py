"""Download OpenStreetMap road features for the Calgary region and save them as small tiles the app loads from its own site.
Run by .github/workflows/osm-data.yml (weekly and on demand). Standard library only.
Output: data/osm/index.json, data/osm/f/<tile>.json (auto-build features), data/osm/r/<tile>.json (roads with speed limits)."""
import json, math, os, sys, time, urllib.request, urllib.parse

BBOX = (50.70, -114.50, 51.36, -113.70)   # S, W, N, E: Calgary, Airdrie, Cochrane, Okotoks, Chestermere
TILE = 0.05
CHUNKS = (4, 4)
SERVERS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
           "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "osm")
LOT_TAGS = ("amenity", "name", "access", "parking", "hgv", "motorhome", "caravan", "bus", "coach", "parking:hgv",
            "motorcar", "motor_vehicle", "description", "operator", "note")
ROAD_RE = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"

def overpass(q, fetch=None):
    if fetch: return fetch(q)
    last = None
    for attempt in range(3):
        for ep in SERVERS:
            try:
                req = urllib.request.Request(ep, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "drive-coach-data-build (github.com/Alcatraz2015/drive-coach)"})
                with urllib.request.urlopen(req, timeout=300) as r:
                    j = json.load(r)
                if j.get("remark") and "error" in j["remark"].lower() and not j.get("elements"):
                    raise RuntimeError(j["remark"])
                print(f"  ok from {ep}: {len(j.get('elements', []))} elements", flush=True)
                return j.get("elements", [])
            except Exception as e:
                last = e; print(f"  {ep} failed: {e}", flush=True); time.sleep(10)
        time.sleep(60)
    raise RuntimeError(f"all Overpass servers failed: {last}")

def tile_key(lat, lng): return f"{math.floor(lat / TILE)}_{math.floor(lng / TILE)}"
def poly_area(g):
    if len(g) < 3: return 0
    la, lo0 = g[0]; k = math.cos(math.radians(la)); a = 0
    for i in range(len(g)):
        p, q = g[i], g[(i + 1) % len(g)]
        a += ((p[1] - lo0) * 111320 * k) * ((q[0] - la) * 110540) - ((q[1] - lo0) * 111320 * k) * ((p[0] - la) * 110540)
    return abs(a / 2)
def geom(e, nd): return [[round(p["lat"], nd), round(p["lon"], nd)] for p in e.get("geometry", [])]

def chunks():
    s, w, n, e = BBOX; dy = (n - s) / CHUNKS[0]; dx = (e - w) / CHUNKS[1]
    for i in range(CHUNKS[0]):
        for j in range(CHUNKS[1]):
            yield (round(s + i * dy, 4), round(w + j * dx, 4), round(s + (i + 1) * dy, 4), round(w + (j + 1) * dx, 4))

def build(fetch=None, out=OUT):
    feats, roads, seen_f, seen_r = {}, {}, set(), set()
    def add(store, keys, item):
        for k in keys: store.setdefault(k, []).append(item)
    for b in chunks():
        bb = ",".join(map(str, b)); print("chunk", bb, flush=True)
        els = overpass(f"""[out:json][timeout:240][bbox:{bb}];(way["amenity"="parking"];node["highway"="stop"];node["highway"="traffic_signals"];
            way["junction"~"^(roundabout|circular)$"];node["leisure"="playground"];way["leisure"="playground"];
            way["highway"~"^(motorway|trunk|motorway_link|trunk_link)$"];);out geom;""", fetch)
        for e in els:
            uid = (e["type"], e["id"])
            if uid in seen_f: continue
            seen_f.add(uid); t = e.get("tags", {})
            if e["type"] == "node":
                tags = {k: t[k] for k in ("highway", "stop", "leisure", "name") if k in t}
                add(feats, [tile_key(e["lat"], e["lon"])], {"type": "node", "id": e["id"], "lat": round(e["lat"], 6), "lon": round(e["lon"], 6), "tags": tags}); continue
            g = geom(e, 6)
            if not g: continue
            if t.get("amenity") == "parking":
                if poly_area(g) < 6000: continue
                tags = {k: t[k] for k in LOT_TAGS if k in t}; g = geom(e, 5)
            elif t.get("leisure") == "playground":   # a point is enough
                c = [round(sum(p[0] for p in g) / len(g), 6), round(sum(p[1] for p in g) / len(g), 6)]
                add(feats, [tile_key(*c)], {"type": "node", "id": e["id"], "lat": c[0], "lon": c[1], "tags": {"leisure": "playground", **({"name": t["name"]} if "name" in t else {})}}); continue
            else:
                tags = {k: t[k] for k in ("highway", "junction", "name") if k in t}
            item = {"type": "way", "id": e["id"], "tags": tags, "geometry": [{"lat": p[0], "lon": p[1]} for p in g]}
            add(feats, sorted({tile_key(*p) for p in g}), item)
        time.sleep(5)
        els = overpass(f"""[out:json][timeout:240][bbox:{bb}];way["highway"~"{ROAD_RE}"];out tags geom;""", fetch)
        for e in els:
            if e["id"] in seen_r: continue
            seen_r.add(e["id"]); t = e.get("tags", {}); g = geom(e, 5)
            if len(g) < 2: continue
            item = {"id": e["id"], "h": t.get("highway"), "g": g}
            if "maxspeed" in t: item["m"] = t["maxspeed"]
            if "name" in t: item["n"] = t["name"]
            add(roads, sorted({tile_key(*p) for p in g}), item)
        time.sleep(5)
    for sub, store in (("f", feats), ("r", roads)):
        d = os.path.join(out, sub); os.makedirs(d, exist_ok=True)
        for f in os.listdir(d): os.remove(os.path.join(d, f))
        for k, items in store.items():
            with open(os.path.join(d, k + ".json"), "w") as fh: json.dump(items, fh, separators=(",", ":"))
    idx = {"bbox": list(BBOX), "tile": TILE, "generated": time.strftime("%Y-%m-%d"), "f": sorted(feats), "r": sorted(roads),
           "counts": {"featureTiles": len(feats), "roadTiles": len(roads), "features": len(seen_f), "roads": len(seen_r)}}
    with open(os.path.join(out, "index.json"), "w") as fh: json.dump(idx, fh, separators=(",", ":"))
    print("done", idx["counts"])
    return idx

if __name__ == "__main__":
    build()
