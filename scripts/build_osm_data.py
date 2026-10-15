"""Build the Calgary-region road data the app loads from its own site.
Reads an OpenStreetMap extract (.osm.pbf or .osm) with pyosmium, so it doesn't depend on the shared Overpass servers.
Run by .github/workflows/osm-data.yml, which downloads Alberta from Geofabrik and cuts it to BBOX first.
Usage: python scripts/build_osm_data.py region.osm.pbf [out_dir]
Output: data/osm/index.json, data/osm/f/<tile>.json (auto-build features), data/osm/r/<tile>.json (roads with speed limits)."""
import json, math, os, sys, time

BBOX = (50.70, -114.50, 51.36, -113.70)   # S, W, N, E: Calgary, Airdrie, Cochrane, Okotoks, Chestermere
TILE = 0.05
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "osm")
LOT_TAGS = ("amenity", "name", "access", "parking", "hgv", "motorhome", "caravan", "bus", "coach", "parking:hgv",
            "motorcar", "motor_vehicle", "description", "operator", "note")
ROADS = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street",
         "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
FAST = {"motorway", "trunk", "motorway_link", "trunk_link"}

def tile_key(lat, lng): return f"{math.floor(lat / TILE)}_{math.floor(lng / TILE)}"
def inside(lat, lng): return BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lng <= BBOX[3]
def poly_area(g):
    if len(g) < 3: return 0
    la, lo0 = g[0]; k = math.cos(math.radians(la)); a = 0
    for i in range(len(g)):
        p, q = g[i], g[(i + 1) % len(g)]
        a += ((p[1] - lo0) * 111320 * k) * ((q[0] - la) * 110540) - ((q[1] - lo0) * 111320 * k) * ((p[0] - la) * 110540)
    return abs(a / 2)

class Collector:
    """Turns OSM nodes/ways into the compact items the app reads, binned into tiles."""
    def __init__(self): self.feats, self.roads, self.nf, self.nr = {}, {}, 0, 0
    def _add(self, store, keys, item):
        for k in keys: store.setdefault(k, []).append(item)
    def node(self, nid, lat, lng, t):
        if not inside(lat, lng): return
        hw, le = t.get("highway"), t.get("leisure")
        if hw in ("stop", "traffic_signals") or le == "playground":
            tags = {k: t[k] for k in ("highway", "stop", "leisure", "name") if k in t}
            self._add(self.feats, [tile_key(lat, lng)], {"type": "node", "id": nid, "lat": round(lat, 6), "lon": round(lng, 6), "tags": tags}); self.nf += 1
    def way(self, wid, g, t):
        if len(g) < 2 or not any(inside(*p) for p in g): return
        hw = t.get("highway")
        if hw in ROADS:
            item = {"id": wid, "h": hw, "g": [[round(a, 5), round(b, 5)] for a, b in g]}
            if "maxspeed" in t: item["m"] = t["maxspeed"]
            if "name" in t: item["n"] = t["name"]
            self._add(self.roads, sorted({tile_key(*p) for p in g}), item); self.nr += 1
        feat = None
        if t.get("amenity") == "parking":
            if poly_area(g) >= 6000:
                feat = {"type": "way", "id": wid, "tags": {k: t[k] for k in LOT_TAGS if k in t}, "geometry": [{"lat": round(a, 5), "lon": round(b, 5)} for a, b in g]}
        elif t.get("leisure") == "playground":
            c = [round(sum(p[0] for p in g) / len(g), 6), round(sum(p[1] for p in g) / len(g), 6)]
            tags = {"leisure": "playground", **({"name": t["name"]} if "name" in t else {})}
            self._add(self.feats, [tile_key(*c)], {"type": "node", "id": wid, "lat": c[0], "lon": c[1], "tags": tags}); self.nf += 1
        elif t.get("junction") in ("roundabout", "circular") or hw in FAST:
            tags = {k: t[k] for k in ("highway", "junction", "name") if k in t}
            feat = {"type": "way", "id": wid, "tags": tags, "geometry": [{"lat": round(a, 6), "lon": round(b, 6)} for a, b in g]}
        if feat:
            self._add(self.feats, sorted({tile_key(p["lat"], p["lon"]) for p in feat["geometry"]}), feat); self.nf += 1
    def write(self, out):
        for sub, store in (("f", self.feats), ("r", self.roads)):
            d = os.path.join(out, sub); os.makedirs(d, exist_ok=True)
            for f in os.listdir(d): os.remove(os.path.join(d, f))
            for k, items in store.items():
                with open(os.path.join(d, k + ".json"), "w") as fh: json.dump(items, fh, separators=(",", ":"))
        idx = {"bbox": list(BBOX), "tile": TILE, "generated": time.strftime("%Y-%m-%d"), "f": sorted(self.feats), "r": sorted(self.roads),
               "counts": {"featureTiles": len(self.feats), "roadTiles": len(self.roads), "features": self.nf, "roads": self.nr}}
        with open(os.path.join(out, "index.json"), "w") as fh: json.dump(idx, fh, separators=(",", ":"))
        print("done", idx["counts"], flush=True)
        return idx

def build(path, out=OUT):
    import osmium
    col = Collector()
    class H(osmium.SimpleHandler):
        def node(self, n):
            if n.tags: col.node(n.id, n.location.lat, n.location.lon, {t.k: t.v for t in n.tags})
        def way(self, w):
            t = {x.k: x.v for x in w.tags}
            if not (t.get("highway") or t.get("amenity") == "parking" or t.get("leisure") == "playground" or t.get("junction")): return
            try: g = [(n.lat, n.lon) for n in w.nodes]
            except osmium.InvalidLocationError: g = [(n.lat, n.lon) for n in w.nodes if n.location.valid()]
            col.way(w.id, g, t)
    H().apply_file(path, locations=True)
    return col.write(out)

if __name__ == "__main__":
    if len(sys.argv) < 2: sys.exit("usage: build_osm_data.py region.osm.pbf [out_dir]")
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else OUT)
