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
it never imports `bpy` and never evaluates anything stored in the file. It
refuses anything that is not a little-endian 64-bit file saved by Blender 2.80
or newer in the 2.8x layout (`Object.defbase`, `Mesh.mvert`), and it treats every
number in the file as hostile:
- every block must fit in the file, and the file must end with ENDB;
- every SDNA table must stay inside the DNA1 block, and every SDNA index must
  be in range;
- every struct the reader reads must have its fields add up to its length;
- every record count must fit its block, and every pointer it follows must lead
  to a block of the expected struct;
- linked lists and parent chains are walked with a visited set, so a cycle
  fails instead of looping;
- every number written must be finite (the JSON is written with
  `allow_nan=False`).

Anything else that goes wrong is caught in `main()` and reported on one line.
The output is written only after the whole file has been read. Run it with
`python3 -I -B` (isolated: no user site, no cwd on the path; no bytecode). Its
caller, `skeletons.mjs`, first checks each .blend against its pinned SHA-256.

The file format: a 12-byte header (`BLENDER-v` and three version digits), then
blocks (4-byte code, int32 size, uint64 old pointer, int32 SDNA index, int32
count, data), ending with ENDB. The DNA1 block describes every struct's fields,
so offsets are computed, not hard-coded. Bones carry `arm_mat` (bind matrix in
armature space). The armature object's `obmat` is the importer's +90 degree
turn about X; Z_UP_TO_Y_UP undoes it, giving SSBU model space (+Y up,
+Z forward), exactly as export_gltf.py does.

Schema of the output: src/render3d/pipeline/dump.ts (`blender` is "sdna-reader 1").
"""

import json
import math
import re
import struct
import sys
import traceback

READER = "sdna-reader 1"
SUFFIX = re.compile(r"\.\d+$")
NOT_BODY = re.compile(r"^(Have|Sword|Tail|Throw)", re.IGNORECASE)
# (x, y, z) -> (x, z, -y), column-major
Z_UP_TO_Y_UP = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]
# The oldest file layout this reader knows: Blender 2.80.
MIN_VERSION = 280
# The block code each struct the reader picks blocks out by is stored under, and back.
STORED_AS = {"Bone": b"DATA", "Object": b"OB\0\0", "Mesh": b"ME\0\0", "Image": b"IM\0\0"}
HOLDS = {b"OB\0\0": "Object", b"ME\0\0": "Mesh", b"IM\0\0": "Image"}
USAGE = "usage: skeleton_from_blend.py <blend> --fighter <id> --code <code> --meshes <json> --hurt <json> --out <json>"


def fail(fighter, why):
    print(f"skeleton_from_blend {fighter}: {why}", file=sys.stderr)
    sys.exit(1)


def args(argv):
    rest = argv[1:]
    if len(rest) % 2 != 1:
        fail("?", USAGE)
    out = {"blend": rest[0]}
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


def finite(values):
    return all(math.isfinite(v) for v in values)


def code_name(code):
    return code.rstrip(b"\0").decode("latin1")


class Blend:
    """The blocks and the SDNA of one .blend, read-only and bounds-checked."""

    def __init__(self, fighter, data):
        self.fighter = fighter
        self.data = data
        if data[:9] != b"BLENDER-v":
            self.fail("not a 64-bit little-endian .blend")
        digits = data[9:12]
        if len(digits) != 3 or not digits.isdigit():
            self.fail(f"unreadable file version {digits!r}")
        version = int(digits)
        if version < MIN_VERSION:
            self.fail(f"saved by Blender {version // 100}.{version % 100:02d}; this reader needs {MIN_VERSION // 100}.{MIN_VERSION % 100:02d} or newer")
        self.blocks = []
        off = 12
        ended = False
        while off + 24 <= len(data):
            code = data[off:off + 4]
            size, = struct.unpack_from("<i", data, off + 4)
            old, = struct.unpack_from("<Q", data, off + 8)
            sdna, count = struct.unpack_from("<ii", data, off + 16)
            if size < 0 or off + 24 + size > len(data):
                self.fail(f"block at {off} runs past the end of the file")
            self.blocks.append((code, size, old, sdna, count, off + 24))
            off += 24 + size
            if code == b"ENDB":
                ended = True
                break
        if not ended:
            self.fail(f"no ENDB block after {len(self.blocks)} blocks: the file is truncated or not a .blend")
        self.by_old = {b[2]: b for b in self.blocks}
        self._sdna()
        for b in self.blocks:
            if not 0 <= b[3] < len(self.structs):
                self.fail(f"block {code_name(b[0])} at {b[5] - 24} has SDNA index {b[3]}, outside the {len(self.structs)} structs")
            # A block's code and its SDNA struct are stored apart, so each vouches for
            # the other: a changed code cannot hide a bone, object, mesh or image.
            held = self.structs[b[3]][0]
            if held in STORED_AS and b[0] != STORED_AS[held]:
                self.fail(f"block {code_name(b[0])} at {b[5] - 24} holds {held} records, which are stored as {code_name(STORED_AS[held])} blocks")
            if b[0] in HOLDS and held != HOLDS[b[0]]:
                self.fail(f"block {code_name(b[0])} at {b[5] - 24} holds {held} records, not {HOLDS[b[0]]}")

    def fail(self, why):
        fail(self.fighter, why)

    def _sdna(self):
        data = self.data
        dna = [b for b in self.blocks if b[0] == b"DNA1"]
        if len(dna) != 1:
            self.fail("no DNA1 block")
        p = dna[0][5]
        end = p + dna[0][1]

        def need(n, what):
            if n < 0 or p + n > end:
                self.fail(f"SDNA: {what} runs past the end of its block")

        def align(x):
            return (x + 3) & ~3

        def tag(name):
            nonlocal p
            need(4, f"the {name.decode()} tag")
            if data[p:p + 4] != name:
                self.fail(f"SDNA: expected {name!r}")
            p += 4

        def count(what):
            nonlocal p
            need(4, f"the {what} count")
            n, = struct.unpack_from("<i", data, p)
            p += 4
            if n < 0:
                self.fail(f"SDNA: {what} count {n} is negative")
            return n

        def strings(what):
            nonlocal p
            n = count(what)
            out = []
            for _ in range(n):
                e = data.find(b"\0", p, end)
                if e < 0:
                    self.fail(f"SDNA: the {what} table runs past the end of its block")
                out.append(data[p:e].decode("latin1"))
                p = e + 1
            return out

        tag(b"SDNA")
        tag(b"NAME")
        names = strings("NAME")
        p = align(p)
        tag(b"TYPE")
        types = strings("TYPE")
        p = align(p)
        tag(b"TLEN")
        need(2 * len(types), "the TLEN table")
        tlen = list(struct.unpack_from("<%dh" % len(types), data, p))
        p += 2 * len(types)
        p = align(p)
        tag(b"STRC")
        n = count("STRC")
        self.structs = []
        for s in range(n):
            need(4, "the STRC table")
            t, nf = struct.unpack_from("<hh", data, p)
            p += 4
            if not 0 <= t < len(types) or nf < 0:
                self.fail(f"SDNA: struct {s} has type index {t} and {nf} fields")
            need(4 * nf, "the STRC table")
            fields = []
            for k in range(nf):
                ft, fn = struct.unpack_from("<hh", data, p)
                p += 4
                if not 0 <= ft < len(types):
                    self.fail(f"SDNA: struct {types[t]} field {k} has type index {ft}, outside the {len(types)} types")
                if not 0 <= fn < len(names):
                    self.fail(f"SDNA: struct {types[t]} field {k} has name index {fn}, outside the {len(names)} names")
                fields.append((types[ft], names[fn]))
            self.structs.append((types[t], fields))
        self.types = types
        self.tlen = tlen
        self.sidx = {s[0]: i for i, s in enumerate(self.structs)}
        # `types.index`, which finds the first of a repeated name, as a lookup.
        self.tidx = {}
        for i, name in enumerate(types):
            self.tidx.setdefault(name, i)

    def size_of(self, struct_name):
        if struct_name not in self.tidx:
            self.fail(f"SDNA has no type {struct_name}")
        return self.tlen[self.tidx[struct_name]]

    def layout(self, struct_name, need):
        """
        Offsets of the fields the reader reads. `need` maps each field to the
        bytes read from it. Each field must exist and hold that many bytes, and
        the struct's fields must add up to its length, so no read leaves its
        record.
        """
        if struct_name not in self.sidx:
            self.fail(f"SDNA has no struct {struct_name}: not the 2.8x layout this reader reads")
        out = {}
        sizes = {}
        o = 0
        for t, f in self.structs[self.sidx[struct_name]][1]:
            key = f.split("[")[0].lstrip("*").replace("(*", "").replace(")()", "")
            size = 8 if (f.startswith("*") or f.startswith("(*")) else self.size_of(t)
            for d in re.findall(r"\[(\d+)\]", f):
                size *= int(d)
            if size < 0:
                self.fail(f"SDNA: struct {struct_name} field {f} has a negative size")
            out[key] = o
            sizes[key] = size
            o += size
        if o != self.size_of(struct_name):
            self.fail(f"SDNA: struct {struct_name}'s fields add up to {o} bytes, but TLEN says {self.size_of(struct_name)}")
        for key, n in need.items():
            if key not in out:
                self.fail(f"SDNA: struct {struct_name} has no field {key}: not the 2.8x layout this reader reads")
            if sizes[key] < n:
                self.fail(f"SDNA: field {struct_name}.{key} holds {sizes[key]} bytes, the reader reads {n}")
        return out

    def records(self, b, struct_name, count, what):
        """Check that block `b` holds `count` records of `struct_name`."""
        held = self.structs[b[3]][0]
        if held != struct_name:
            self.fail(f"{what}: its block holds {held} records, not {struct_name}")
        if count < 0 or count * self.size_of(struct_name) > b[1]:
            self.fail(f"{what}: {count} {struct_name} records do not fit its {b[1]}-byte block")

    def follow(self, ptr, field, struct_name, count, what):
        """The block a non-null pointer `field` leads to, checked to hold `count` records of `struct_name`."""
        b = self.by_old.get(ptr)
        if b is None:
            self.fail(f"{what}: its {field} pointer leads to no block")
        self.records(b, struct_name, count, what)
        return b

    def read(self, base, offset, fmt):
        return struct.unpack_from(fmt, self.data, base + offset)

    def cstr(self, base, offset, n):
        o = base + offset
        return self.data[o:o + n].split(b"\0")[0].decode("latin1")


def read_config(a, fighter):
    """meshes.json and hurtBones.json: the repo's own files, not downloaded data."""
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
    return mesh_rules, hurt_bones


def read_blend(a, fighter, data, mesh_rules, hurt_bones):
    blend = Blend(fighter, data)
    T = blend.size_of
    bone_l = blend.layout("Bone", {"name": 64, "parent": 8, "arm_mat": 64})
    id_l = blend.layout("ID", {"name": 66})
    obj_l = blend.layout("Object", {"id": T("ID"), "defbase": 8, "obmat": 64, "parent": 8, "data": 8})
    mesh_l = blend.layout("Mesh", {"totvert": 4, "totpoly": 4, "mvert": 8, "dvert": 8})
    mvert_l = blend.layout("MVert", {"co": 12})
    dvert_l = blend.layout("MDeformVert", {"dw": 8, "totweight": 4})
    dw_l = blend.layout("MDeformWeight", {"def_nr": 4, "weight": 4})
    dg_l = blend.layout("bDeformGroup", {"name": 64, "next": 8})

    # Bones: name, parent, bind matrix (armature space).
    raw_bones = []
    for b in blend.blocks:
        if b[0] != b"DATA" or blend.structs[b[3]][0] != "Bone":
            continue
        blend.records(b, "Bone", b[4], f"block DATA at {b[5] - 24}")
        for i in range(b[4]):
            base = b[5] + i * T("Bone")
            raw_bones.append({
                "name": blend.cstr(base, bone_l["name"], 64),
                "ptr": b[2] + i * T("Bone"),
                "parent_ptr": blend.read(base, bone_l["parent"], "<Q")[0],
                "arm": list(blend.read(base, bone_l["arm_mat"], "<16f")),
            })
    name_of = {b["ptr"]: b["name"] for b in raw_bones}
    seen = set()
    for b in raw_bones:
        if b["name"] in seen:
            fail(fighter, f"two bones are called {b['name']}")
        seen.add(b["name"])
    for b in raw_bones:
        if b["parent_ptr"] and b["parent_ptr"] not in name_of:
            fail(fighter, f"bone {b['name']}: its parent pointer leads to no bone")

    # Objects: the armature, and meshes with their vertex groups.
    objects = {}
    for b in blend.blocks:
        if b[0][:2] != b"OB":
            continue
        blend.records(b, "Object", 1, f"block OB at {b[5] - 24}")
        base = b[5]
        name = blend.cstr(base, obj_l["id"] + id_l["name"], 66)[2:]
        groups = []
        visited = set()
        p = blend.read(base, obj_l["defbase"], "<Q")[0]
        while p:
            if p in visited:
                fail(fighter, f"object {name}: its vertex-group list loops")
            visited.add(p)
            gb = blend.by_old.get(p)
            if gb is None:
                fail(fighter, f"object {name}: dangling vertex-group pointer")
            blend.records(gb, "bDeformGroup", 1, f"object {name}'s vertex group")
            groups.append(blend.cstr(gb[5], dg_l["name"], 64))
            p = blend.read(gb[5], dg_l["next"], "<Q")[0]
        objects[b[2]] = {
            "name": name,
            "obmat": list(blend.read(base, obj_l["obmat"], "<16f")),
            "parent": blend.read(base, obj_l["parent"], "<Q")[0],
            "data": blend.read(base, obj_l["data"], "<Q")[0],
            "groups": groups,
        }
    for o in objects.values():
        if o["data"] and o["data"] not in blend.by_old:
            fail(fighter, f"object {o['name']}: its data pointer leads to no block")
        if o["parent"] and o["parent"] not in objects:
            fail(fighter, f"object {o['name']}: its parent pointer leads to no object")
    armatures = [(k, o) for k, o in objects.items() if blend.by_old.get(o["data"]) and blend.by_old[o["data"]][0][:2] == b"AR"]
    if len(armatures) != 1:
        fail(fighter, f"expected one armature, found {len(armatures)}")
    arm_ptr, arm = armatures[0]
    if not finite(arm["obmat"]):
        fail(fighter, f"object {arm['name']}: its matrix is not finite")

    world = {}
    bones = []
    for b in raw_bones:
        w = mm(Z_UP_TO_Y_UP, mm(arm["obmat"], b["arm"]))
        if not finite(w):
            fail(fighter, f"bone {b['name']}: its bind matrix is not finite")
        world[b["name"]] = w
        bones.append({"name": b["name"], "parent": name_of.get(b["parent_ptr"]), "world": [round(v, 6) for v in w]})
    parent_of = {b["name"]: b["parent"] for b in bones}
    for n in parent_of:
        visited, at = set(), n
        while at is not None:
            if at in visited:
                fail(fighter, f"bone parent cycle through {at}")
            visited.add(at)
            at = parent_of[at]
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
        what = f"mesh {o['name']}"
        blend.records(mb, "Mesh", 1, what)
        kept = o["parent"] == arm_ptr and base_name in mesh_rules["keep"]
        totvert = blend.read(mb[5], mesh_l["totvert"], "<i")[0]
        totpoly = blend.read(mb[5], mesh_l["totpoly"], "<i")[0]
        meshes.append({"name": o["name"], "kept": kept, "verts": totvert, "polys": totpoly})
        if not kept:
            continue
        mvert = blend.read(mb[5], mesh_l["mvert"], "<Q")[0]
        dvert = blend.read(mb[5], mesh_l["dvert"], "<Q")[0]
        if not mvert or not dvert:
            continue
        vb = blend.follow(mvert, "mvert", "MVert", totvert, what)
        db = blend.follow(dvert, "dvert", "MDeformVert", totvert, what)
        to_model = mm(Z_UP_TO_Y_UP, o["obmat"])
        if not finite(to_model):
            fail(fighter, f"object {o['name']}: its matrix is not finite")
        for i in range(totvert):
            dbase = db[5] + i * T("MDeformVert")
            dw = blend.read(dbase, dvert_l["dw"], "<Q")[0]
            n = blend.read(dbase, dvert_l["totweight"], "<i")[0]
            if not dw or n <= 0:
                continue
            wb = blend.follow(dw, "weight", "MDeformWeight", n, f"{what} vertex {i}")
            weights = [(blend.read(wb[5] + k * T("MDeformWeight"), dw_l["def_nr"], "<i")[0],
                        blend.read(wb[5] + k * T("MDeformWeight"), dw_l["weight"], "<f")[0]) for k in range(n)]
            if not finite(w for _, w in weights):
                fail(fighter, f"{what} vertex {i} has a weight that is not finite")
            stray = next((g for g, _ in weights if not 0 <= g < len(o["groups"])), None)
            if stray is not None:
                fail(fighter, f"{what} vertex {i} is weighted to vertex group {stray}, but the object has {len(o['groups'])}")
            best = max(weights, key=lambda e: e[1])
            target = owner.get(o["groups"][best[0]])
            if target is None:
                continue
            co = struct.unpack_from("<3f", blend.data, vb[5] + i * T("MVert") + mvert_l["co"])
            if not finite(co):
                fail(fighter, f"{what} vertex {i} is not finite")
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
        if not finite((x1, x2, r)):
            fail(fighter, f"hurt capsule on {h} is not finite")
        hurt.append({"bone": h, "x1": round(x1, 5), "x2": round(x2, 5), "r": round(r, 5)})

    images = []
    image_blocks = [b for b in blend.blocks if b[0][:2] == b"IM"]
    if image_blocks:
        image_l = blend.layout("Image", {"id": T("ID")})
        for b in image_blocks:
            blend.records(b, "Image", 1, f"block IM at {b[5] - 24}")
        images = sorted({blend.cstr(b[5], image_l["id"] + id_l["name"], 66)[2:] for b in image_blocks})
    return {
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


def main():
    a = args(sys.argv)
    fighter = a["fighter"]
    mesh_rules, hurt_bones = read_config(a, fighter)
    try:
        with open(a["blend"], "rb") as f:
            data = f.read()
    except OSError as e:
        fail(fighter, f"cannot read {a['blend']}: {e.strerror}")
    try:
        dump = read_blend(a, fighter, data, mesh_rules, hurt_bones)
        text = json.dumps(dump, indent=1, allow_nan=False)
    except Exception as e:  # the backstop: every problem foreseen above has already failed by name
        line = traceback.extract_tb(e.__traceback__)[-1].lineno
        fail(fighter, f"malformed .blend ({type(e).__name__} at line {line}: {e})")
    try:
        with open(a["out"], "w") as f:
            f.write(text)
    except OSError as e:
        fail(fighter, f"cannot write {a['out']}: {e.strerror}")
    meshes = dump["meshes"]
    kept = [m["name"] for m in meshes if m["kept"]]
    print(f"skeleton_from_blend {fighter}: {len(dump['bones'])} bones, {len(kept)}/{len(meshes)} meshes kept, {len(dump['hurt'])} hurt capsules")
    print("  kept: " + ", ".join(sorted(kept)))
    print("  dropped: " + ", ".join(sorted(m["name"] for m in meshes if not m["kept"])))


main()
