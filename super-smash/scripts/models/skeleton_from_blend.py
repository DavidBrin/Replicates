"""
Read a fighter's bones, meshes and vertex weights straight out of its .blend —
no Blender — and write the bone dump the committed skeleton is trimmed from.

    python3 -I -B scripts/models/skeleton_from_blend.py <blend> --fighter mario --code mario \
        --meshes scripts/models/meshes.json --hurt src/render3d/skeletons/hurtBones.json --out .model-cache/dumps/mario.sdna.json

Plan 4. Blender is needed only to export the glbs; the numbers the sim reads
(bone names, bind matrices, hurt capsules) come from this reader, so the build
and every test run without Blender (Plan 4 Task 6), and Task 8's Blender dump is
cross-checked against this one (`dump.test.ts`).

A .blend is downloaded data. This script only parses its bytes with `struct`:
it never imports `bpy`, never evaluates anything stored in the file, and refuses
anything that is not a little-endian 64-bit Blender 2.8x+ file. Run it with
`python3 -I -B` (isolated: no user site, no cwd on the path; no bytecode).

The file format: a 12-byte header, then blocks (4-byte code, int32 size,
uint64 old pointer, int32 SDNA index, int32 count, data), ending with ENDB; the
DNA1 block describes every struct's fields, so offsets are computed, not
hard-coded. Bones carry `arm_mat` (bind matrix in armature space); the armature
object's `obmat` is the importer's +90 degree turn about X; Z_UP_TO_Y_UP undoes
it, giving SSBU model space (+Y up, +Z forward), exactly as export_gltf.py does.

Schema of the output: src/render3d/pipeline/dump.ts (`blender` is "sdna-reader 1").
"""

import json
import math
import re
import struct
import sys

READER = "sdna-reader 1"
SUFFIX = re.compile(r"\.\d+$")
NOT_BODY = re.compile(r"^(Have|Sword|Tail|Throw)", re.IGNORECASE)
# (x, y, z) -> (x, z, -y), column-major
Z_UP_TO_Y_UP = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]


def fail(fighter, why):
    print(f"skeleton_from_blend {fighter}: {why}", file=sys.stderr)
    sys.exit(1)


def args(argv):
    out = {}
    rest = argv[1:]
    out["blend"] = rest[0]
    for i in range(1, len(rest), 2):
        out[rest[i].lstrip("-")] = rest[i + 1]
    for k in ("fighter", "code", "meshes", "hurt", "out"):
        if k not in out:
            fail(out.get("fighter", "?"), f"missing --{k}")
    return out


def mm(a, b):
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return out


def xf(m, v):
    return [m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] for r in range(3)]


def inv_rigid(m):
    o = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1]
    for r in range(3):
        o[12 + r] = -(o[r] * m[12] + o[4 + r] * m[13] + o[8 + r] * m[14])
    return o


class Blend:
    """The blocks and the SDNA of one .blend, read-only."""

    def __init__(self, fighter, data):
        self.fighter = fighter
        self.data = data
        if data[:7] != b"BLENDER" or data[7:8] != b"-" or data[8:9] != b"v":
            fail(fighter, "not a 64-bit little-endian .blend")
        self.blocks = []
        off = 12
        while off + 24 <= len(data):
            code = data[off:off + 4]
            size, = struct.unpack_from("<i", data, off + 4)
            old, = struct.unpack_from("<Q", data, off + 8)
            sdna, count = struct.unpack_from("<ii", data, off + 16)
            if size < 0 or off + 24 + size > len(data):
                fail(fighter, f"block at {off} runs past the end of the file")
            self.blocks.append((code, size, old, sdna, count, off + 24))
            off += 24 + size
            if code == b"ENDB":
                break
        self.by_old = {b[2]: b for b in self.blocks}
        self._sdna()

    def _sdna(self):
        data = self.data
        dna = [b for b in self.blocks if b[0] == b"DNA1"]
        if len(dna) != 1:
            fail(self.fighter, "no DNA1 block")
        p = dna[0][5]

        def align(x):
            return (x + 3) & ~3

        def tag(name):
            nonlocal p
            if data[p:p + 4] != name:
                fail(self.fighter, f"SDNA: expected {name!r}")
            p += 4

        def strings():
            nonlocal p
            n, = struct.unpack_from("<i", data, p)
            p += 4
            out = []
            for _ in range(n):
                e = data.index(b"\0", p)
                out.append(data[p:e].decode("latin1"))
                p = e + 1
            return out

        tag(b"SDNA")
        tag(b"NAME")
        names = strings()
        p = align(p)
        tag(b"TYPE")
        types = strings()
        p = align(p)
        tag(b"TLEN")
        tlen = list(struct.unpack_from("<%dh" % len(types), data, p))
        p += 2 * len(types)
        p = align(p)
        tag(b"STRC")
        n, = struct.unpack_from("<i", data, p)
        p += 4
        self.structs = []
        for _ in range(n):
            t, nf = struct.unpack_from("<hh", data, p)
            p += 4
            fields = []
            for _ in range(nf):
                ft, fn = struct.unpack_from("<hh", data, p)
                p += 4
                fields.append((types[ft], names[fn]))
            self.structs.append((types[t], fields))
        self.types = types
        self.tlen = tlen
        self.sidx = {s[0]: i for i, s in enumerate(self.structs)}

    def size_of(self, struct_name):
        return self.tlen[self.types.index(struct_name)]

    def layout(self, struct_name):
        out = {}
        o = 0
        for t, f in self.structs[self.sidx[struct_name]][1]:
            key = f.split("[")[0].lstrip("*").replace("(*", "").replace(")()", "")
            size = 8 if (f.startswith("*") or f.startswith("(*")) else self.tlen[self.types.index(t)]
            for d in re.findall(r"\[(\d+)\]", f):
                size *= int(d)
            out[key] = o
            o += size
        return out

    def read(self, base, offset, fmt):
        return struct.unpack_from(fmt, self.data, base + offset)

    def cstr(self, base, offset, n):
        o = base + offset
        return self.data[o:o + n].split(b"\0")[0].decode("latin1")


def main():
    a = args(sys.argv)
    fighter = a["fighter"]
    with open(a["blend"], "rb") as f:
        blend = Blend(fighter, f.read())
    with open(a["meshes"]) as f:
        mesh_rules = json.load(f).get(fighter)
    if mesh_rules is None:
        fail(fighter, f"no entry in {a['meshes']}")
    with open(a["hurt"]) as f:
        hurt_table = json.load(f)
    hurt_entry = hurt_table.get(fighter, hurt_table["default"])
    hurt_bones = hurt_entry["bones"]
    if hurt_entry["head"] not in hurt_bones:
        fail(fighter, f"head bone {hurt_entry['head']} is not one of its hurt bones")

    bone_l = blend.layout("Bone")
    obj_l = blend.layout("Object")
    id_l = blend.layout("ID")
    mesh_l = blend.layout("Mesh")
    mvert_l = blend.layout("MVert")
    dvert_l = blend.layout("MDeformVert")
    dw_l = blend.layout("MDeformWeight")
    dg_l = blend.layout("bDeformGroup")
    T = blend.size_of

    # Bones: name, parent, bind matrix (armature space).
    raw_bones = []
    for b in blend.blocks:
        if b[0] != b"DATA" or blend.structs[b[3]][0] != "Bone":
            continue
        for i in range(b[4]):
            base = b[5] + i * T("Bone")
            raw_bones.append({
                "name": blend.cstr(base, bone_l["name"], 64),
                "ptr": b[2] + i * T("Bone"),
                "parent_ptr": blend.read(base, bone_l["parent"], "<Q")[0],
                "arm": list(blend.read(base, bone_l["arm_mat"], "<16f")),
            })
    name_of = {b["ptr"]: b["name"] for b in raw_bones}

    # Objects: the armature, and meshes with their vertex groups.
    objects = {}
    for b in blend.blocks:
        if b[0][:2] != b"OB":
            continue
        base = b[5]
        name = blend.cstr(base, obj_l["id"] + id_l["name"], 66)[2:]
        groups = []
        p = blend.read(base, obj_l["defbase"], "<Q")[0]
        while p:
            gb = blend.by_old.get(p)
            if gb is None:
                fail(fighter, f"object {name}: dangling vertex-group pointer")
            groups.append(blend.cstr(gb[5], dg_l["name"], 64))
            p = blend.read(gb[5], dg_l["next"], "<Q")[0]
        objects[b[2]] = {
            "name": name,
            "obmat": list(blend.read(base, obj_l["obmat"], "<16f")),
            "parent": blend.read(base, obj_l["parent"], "<Q")[0],
            "data": blend.read(base, obj_l["data"], "<Q")[0],
            "groups": groups,
        }
    armatures = [(k, o) for k, o in objects.items() if blend.by_old.get(o["data"]) and blend.by_old[o["data"]][0][:2] == b"AR"]
    if len(armatures) != 1:
        fail(fighter, f"expected one armature, found {len(armatures)}")
    arm_ptr, arm = armatures[0]

    world = {}
    bones = []
    for b in raw_bones:
        w = mm(Z_UP_TO_Y_UP, mm(arm["obmat"], b["arm"]))
        world[b["name"]] = w
        bones.append({"name": b["name"], "parent": name_of.get(b["parent_ptr"]), "world": [round(v, 6) for v in w]})
    parent_of = {b["name"]: b["parent"] for b in bones}
    missing = [h for h in hurt_bones if h not in world]
    if missing:
        fail(fighter, f"hurt bones {missing} are not in the skeleton; fix src/render3d/skeletons/hurtBones.json")

    # Which hurt capsule each bone's vertices belong to.
    owner = {}
    for n in parent_of:
        chain, at = [], n
        while at is not None:
            chain.append(at)
            at = parent_of[at]
        owner[n] = None if any(NOT_BODY.match(c) for c in chain) else next((c for c in chain if c in hurt_bones), None)

    listed = set(mesh_rules["keep"]) | set(mesh_rules["drop"])
    meshes = []
    points = {h: [] for h in hurt_bones}
    inverse = {h: inv_rigid(world[h]) for h in hurt_bones}
    for o in objects.values():
        mb = blend.by_old.get(o["data"])
        if mb is None or mb[0][:2] != b"ME":
            continue
        base_name = SUFFIX.sub("", o["name"])
        if base_name not in listed:
            fail(fighter, f"mesh {o['name']} is in neither keep nor drop of scripts/models/meshes.json")
        kept = o["parent"] == arm_ptr and base_name in mesh_rules["keep"]
        totvert = blend.read(mb[5], mesh_l["totvert"], "<i")[0]
        totpoly = blend.read(mb[5], mesh_l["totpoly"], "<i")[0]
        meshes.append({"name": o["name"], "kept": kept, "verts": totvert, "polys": totpoly})
        if not kept:
            continue
        vb = blend.by_old.get(blend.read(mb[5], mesh_l["mvert"], "<Q")[0])
        db = blend.by_old.get(blend.read(mb[5], mesh_l["dvert"], "<Q")[0])
        if vb is None or db is None:
            continue
        to_model = mm(Z_UP_TO_Y_UP, o["obmat"])
        for i in range(totvert):
            dbase = db[5] + i * T("MDeformVert")
            dw = blend.read(dbase, dvert_l["dw"], "<Q")[0]
            n = blend.read(dbase, dvert_l["totweight"], "<i")[0]
            if not dw or n <= 0:
                continue
            wb = blend.by_old.get(dw)
            if wb is None:
                continue
            best = max(
                ((blend.read(wb[5] + k * T("MDeformWeight"), dw_l["def_nr"], "<i")[0],
                  blend.read(wb[5] + k * T("MDeformWeight"), dw_l["weight"], "<f")[0]) for k in range(n)),
                key=lambda e: e[1],
            )
            if best[0] < 0 or best[0] >= len(o["groups"]):
                continue
            target = owner.get(o["groups"][best[0]])
            if target is None:
                continue
            co = struct.unpack_from("<3f", blend.data, vb[5] + i * T("MVert") + mvert_l["co"])
            points[target].append(xf(inverse[target], xf(to_model, co)))

    hurt = []
    for h in hurt_bones:
        pts = points[h]
        if len(pts) < 8:
            fail(fighter, f"hurt bone {h} owns only {len(pts)} kept vertices")
        xs = sorted(q[0] for q in pts)
        rs = sorted(math.hypot(q[1], q[2]) for q in pts)

        def pick(arr, q):
            return arr[min(len(arr) - 1, int(q * len(arr)))]

        # A capsule whose rounded ends reach the 5th and 95th percentile along
        # the bone and whose radius covers three quarters of the vertices
        # around it; a part shorter than its own width is a sphere at its middle.
        r = pick(rs, 0.75)
        lo, hi = pick(xs, 0.05), pick(xs, 0.95)
        x1, x2 = lo + r, hi - r
        if x1 > x2:
            x1 = x2 = (lo + hi) / 2
        hurt.append({"bone": h, "x1": round(x1, 5), "x2": round(x2, 5), "r": round(r, 5)})

    images = sorted({blend.cstr(b[5], blend.layout("Image")["id"] + id_l["name"], 66)[2:] for b in blend.blocks if b[0][:2] == b"IM"})
    dump = {
        "schema": 1,
        "fighter": fighter,
        "code": a["code"],
        "blender": READER,
        "blend": a["blend"].replace("\\", "/").split("/")[-1],
        "space": "ssbu-model",
        "bones": bones,
        "meshes": meshes,
        "materials": [{"name": i, "image": i} for i in images],
        "hurt": hurt,
    }
    with open(a["out"], "w") as f:
        json.dump(dump, f, indent=1)
    kept = [m["name"] for m in meshes if m["kept"]]
    print(f"skeleton_from_blend {fighter}: {len(bones)} bones, {len(kept)}/{len(meshes)} meshes kept, {len(hurt)} hurt capsules")
    print("  kept: " + ", ".join(sorted(kept)))
    print("  dropped: " + ", ".join(sorted(m["name"] for m in meshes if not m["kept"])))


main()
