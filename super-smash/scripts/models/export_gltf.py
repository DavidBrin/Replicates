"""
Blender headless: one fighter's c00 .blend -> a skinned .glb and a bone dump.

    .model-cache/tools/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --disable-autoexec <blend> --python-exit-code 1 \
        --python scripts/models/export_gltf.py -- \
        --fighter mario --glb .model-cache/glb/mario.raw.glb \
        --dump .model-cache/dumps/mario.json --meshes scripts/models/meshes.json \
        --hurt src/render3d/skeletons/hurtBones.json

Run by scripts/models/build.mjs for each fighter (Plan 4 Task 8). What it does:
1. Keeps exactly the meshes `scripts/models/meshes.json` lists under `keep` or
   `drawOnly` for this fighter (names without Blender's `.NNN` suffix) and
   deletes those under `drop`: the neutral face, eyes and body stay; alternate
   expressions, blinks, low-poly duplicates and sheathed-sword copies go. A mesh
   in no list, or in two, fails the export -- the lists are exhaustive, written
   from the real files, so a new upstream mesh is a decision, not a silent
   guess. Every mesh the fighter's `face` list names must be exported (Task 21b).
2. Rebuilds every kept material as Principled BSDF <- the material's c00
   colour texture (`*_col.png`, largest if several), keeping the texture's UV
   map; its alpha too, only when the source reads it (Task 21b: Donkey Kong's
   body reads, with its alpha ignored, the PNG whose alpha is his fur card's
   mask). A colour that layers an overlay image over a base image (the eyes:
   an iris on its own UV map, its alpha the mix factor) is flattened into one
   opaque texture on the base's UV map (`flatten_layers.py`, Task 21b).
   Materials that end up on the same image bytes, read the same way, become one.
3. Dumps every bone's bind matrix in SSBU model space and per-bone hurt
   capsules derived from the `keep` meshes' vertex weights (UNVERIFIED sizes;
   `drawOnly` meshes are never measured) -- the same numbers
   `skeleton_from_blend.py` reads without Blender, which `dump.test.ts`
   cross-checks. The dump also names each drawn mesh's materials and marks the
   face's meshes, for `verifyGlb`'s face checks.
4. Joins the kept meshes into one object, so the glb has one primitive per
   material (at most `MAX_PRIMITIVES` in glb.mjs) instead of one per part:
   Link's 13 kept parts are 8 draw calls (his two flattened eyes are two), not 44.
5. Exports armature + the joined mesh as GLB (skins on, animations and morphs off).

Prints the kept and dropped meshes. Fails loudly (exit 1, a message naming the
fighter) on: no or several armatures, a mesh missing from meshes.json (or in
two of its lists), a face mesh not exported, a kept material with no colour
texture, an unloadable texture, a layered colour that cannot be flattened, or
an exporter missing an option. Schema of the dump: src/render3d/pipeline/dump.ts.
"""

import hashlib
import json
import math
import os
import re
import sys

import bpy
import mathutils
import numpy as np

# flatten_layers.py sits beside this script (plain Python, also run by the tests).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import flatten_layers  # noqa: E402

DUMP_SCHEMA = 1
SUFFIX = re.compile(r"\.\d+$")
# Blender world (Z up) -> glTF / SSBU model space (Y up): (x, y, z) -> (x, z, -y).
Z_UP_TO_Y_UP = mathutils.Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
# Vertices weighted to these (and below them) are props, not body: no hurtbox.
NOT_BODY = re.compile(r"^(Have|Sword|Tail|Throw)", re.IGNORECASE)


def fail(fighter, why):
    print(f"export_gltf {fighter}: {why}", file=sys.stderr)
    sys.exit(1)


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {}
    for i in range(0, len(argv), 2):
        out[argv[i].lstrip("-")] = argv[i + 1]
    for k in ("fighter", "glb", "dump", "meshes", "hurt"):
        if k not in out:
            fail(out.get("fighter", "?"), f"missing --{k}")
    return out


def load_json(path):
    with open(path) as f:
        return json.load(f)


def flat(m):
    """Column-major list of a 4x4 mathutils matrix."""
    return [round(m[r][c], 6) for c in range(4) for r in range(4)]


def colour_image(material):
    if material.node_tree is None:
        return None, None
    best, best_node = None, None
    for node in material.node_tree.nodes:
        if node.type != "TEX_IMAGE" or node.image is None:
            continue
        if re.search(r"_(nor|prm|emi)\.png$", node.image.name.lower()):
            continue
        size = node.image.size[0] * node.image.size[1]
        if best is None or size > best.size[0] * best.size[1]:
            best, best_node = node.image, node
    return best, best_node


def own_path(fighter, image, material):
    """
    The file an unpacked image reads. The .blend is downloaded data: an image
    path it stores could point anywhere on this machine, and the texture ends up
    in a public glb. Only the fighter's own pinned files (beside the .blend) may
    be read; a packed image is the pinned .blend's own bytes (None here).
    """
    if image.packed_file is not None:
        return None
    own = os.path.realpath(os.path.dirname(bpy.data.filepath))
    path = os.path.realpath(bpy.path.abspath(image.filepath))
    if os.path.commonpath([own, path]) != own:
        fail(fighter, f"texture {image.filepath} for {material.name} is outside {own}")
    return path


def load_image(fighter, image, material):
    own_path(fighter, image, material)
    image.reload()
    if image.size[0] == 0:
        fail(fighter, f"texture {image.filepath} for {material.name} did not load (is it in .model-cache/src/{fighter}/?)")


def reads_alpha(material, image):
    """
    Whether the source material reads its colour texture's alpha: something
    feeds a Principled BSDF's Alpha, and the image's alpha is not ignored
    (Donkey Kong loads one PNG twice: `alpha_mode` NONE for his body, STRAIGHT
    for his fur card).
    """
    tree = material.node_tree
    linked = any(l.to_node.type == "BSDF_PRINCIPLED" and l.to_socket.name == "Alpha" for l in tree.links)
    return linked and image.alpha_mode != "NONE"


def image_key(fighter, image, material):
    """The bytes an image reads, not its name (Donkey Kong loads one file as two images)."""
    path = own_path(fighter, image, material)
    if path is None:
        return hashlib.sha256(bytes(image.packed_file.data)).hexdigest()
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def uv_map_of(tree, image_node):
    link = next((l for l in tree.links if l.to_node == image_node and l.to_socket.name == "Vector"), None)
    node = link.from_node if link is not None else None
    return node, (node.uv_map if node is not None and node.type == "UVMAP" else None)


def layered_colour(fighter, material):
    """
    (base image node, overlay image node) when the material's Base Color is
    `mix(base colour, overlay colour, overlay alpha)` (an RGBA Mix node, blend
    MIX) -- the eyes of Mario, Donkey Kong, Link, Fox and Marth -- else None. A
    Mix that feeds Base Color in any other way fails: it would lose a layer.
    """
    tree = material.node_tree
    if tree is None:
        return None
    for bsdf in [n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"]:
        link = next((l for l in tree.links if l.to_node == bsdf and l.to_socket.name == "Base Color"), None)
        if link is None or link.from_node.type != "MIX":
            continue
        mix = link.from_node
        src = {}
        for sock in mix.inputs:
            if sock.enabled and sock.is_linked:
                src[sock.identifier] = (sock.links[0].from_node, sock.links[0].from_socket.name)
        a, b, f = src.get("A_Color"), src.get("B_Color"), src.get("Factor_Float")
        ok = (
            mix.data_type == "RGBA" and mix.blend_type == "MIX" and a and b and f
            and a[0].type == "TEX_IMAGE" and a[1] == "Color" and b[0].type == "TEX_IMAGE" and b[1] == "Color"
            and f[0] == b[0] and f[1] == "Alpha" and a[0].image is not None and b[0].image is not None
        )
        if not ok:
            fail(fighter, f"material {material.name} mixes its Base Color in a way the export cannot flatten into one texture")
        return a[0], b[0]
    return None


def flatten_material(fighter, material, base_node, overlay_node, meshes):
    """
    Bake `material`'s two layers into one opaque image on the base's UV map,
    from the triangles of every exported mesh drawn with it (flatten_layers.py).
    Returns the new image, packed so the glTF exporter embeds it.
    """
    tree = material.node_tree
    _, base_uv = uv_map_of(tree, base_node)
    _, over_uv = uv_map_of(tree, overlay_node)
    if base_uv is None or over_uv is None:
        fail(fighter, f"material {material.name}: each layer must name its UV map")
    layers = []
    for node in (base_node, overlay_node):
        load_image(fighter, node.image, material)
        w, h = node.image.size
        layers.append(flatten_layers.Layer(w, h, list(node.image.pixels[:]), node.extension))
    triangles = []
    for obj in meshes:
        slots = [i for i, slot in enumerate(obj.material_slots) if slot.material == material]
        if not slots:
            continue
        me = obj.data
        if base_uv not in me.uv_layers or over_uv not in me.uv_layers:
            fail(fighter, f"mesh {obj.name} has no UV map {base_uv} or {over_uv} for {material.name}")
        uv_a, uv_b = me.uv_layers[base_uv].data, me.uv_layers[over_uv].data
        me.calc_loop_triangles()
        for t in me.loop_triangles:
            if t.material_index in slots:
                triangles.append(([tuple(uv_a[l].uv) for l in t.loops], [tuple(uv_b[l].uv) for l in t.loops]))
    if not triangles:
        fail(fighter, f"material {material.name} layers two images but no exported triangle uses it")
    try:
        pixels, (w, h) = flatten_layers.flatten(layers[0], layers[1], triangles)
    except flatten_layers.FlattenError as e:
        fail(fighter, f"material {material.name}: {e}")
    image = bpy.data.images.new(f"{base_node.image.name}+{overlay_node.image.name}", w, h, alpha=True)
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def rebuild_material(fighter, material, meshes):
    """
    Rebuild `material` as Principled BSDF <- one colour image, on that image's
    UV map, its alpha linked only when the source reads it. Returns (image
    name, merge key, layers, alpha): layers is the (base, overlay) image names a
    layered colour was flattened from, else None; alpha whether it reads alpha.
    Two materials with one key become one: the same bytes, read the same way.
    """
    layered = layered_colour(fighter, material)
    if layered is not None:
        image_node = layered[0]
        image = flatten_material(fighter, material, layered[0], layered[1], meshes)
        layers = (layered[0].image.name, layered[1].image.name)
        image_node.image = image
        alpha = False
    else:
        image, image_node = colour_image(material)
        if image is None:
            fail(fighter, f"material {material.name} has no colour texture")
        load_image(fighter, image, material)
        layers = None
        alpha = reads_alpha(material, image)
    tree = material.node_tree
    uv_node, uv_name = uv_map_of(tree, image_node)
    for node in list(tree.nodes):
        if node not in (image_node, uv_node):
            tree.nodes.remove(node)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(image_node.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha:
        tree.links.new(image_node.outputs["Alpha"], bsdf.inputs["Alpha"])
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    if uv_name is not None:
        uv = tree.nodes.new("ShaderNodeUVMap")
        uv.uv_map = uv_name
        tree.links.new(uv.outputs["UV"], image_node.inputs["Vector"])
    return image.name, f"{image_key(fighter, image, material)}:{'alpha' if alpha else 'opaque'}", layers, alpha


def sampled_max_alpha(obj, material, alpha_of):
    """
    The highest alpha of `material`'s colour image among the texels `obj`'s own
    triangles drawn with it sample, from its UVs (1 when the material reads no
    alpha): what decides whether a MASK cut leaves anything of that face mesh
    (verifyGlb's face checks). A texel counts when its centre lies in a
    triangle, and each triangle counts its centroid's texel, so a sliver still
    samples one. `alpha_of` caches each image's alpha plane.
    """
    tree = material.node_tree
    if not any(l.to_node.type == "BSDF_PRINCIPLED" and l.to_socket.name == "Alpha" for l in tree.links):
        return 1.0
    image_node = next(n for n in tree.nodes if n.type == "TEX_IMAGE")
    image = image_node.image
    if image.name not in alpha_of:
        w, h = image.size
        px = np.empty(w * h * 4, dtype=np.float32)
        image.pixels.foreach_get(px)
        alpha_of[image.name] = px.reshape(h, w, 4)[..., 3]
    alpha = alpha_of[image.name]
    h, w = alpha.shape
    _, uv_name = uv_map_of(tree, image_node)
    uv = (obj.data.uv_layers[uv_name] if uv_name else obj.data.uv_layers.active).data
    slots = {i for i, slot in enumerate(obj.material_slots) if slot.material == material}
    obj.data.calc_loop_triangles()
    best = 0.0
    for t in obj.data.loop_triangles:
        if t.material_index not in slots:
            continue
        p = np.array([uv[l].uv[:] for l in t.loops], dtype=np.float64) * (w, h)
        p -= np.floor(p.min(0) / (w, h)) * (w, h)  # REPEAT: into the first tile
        c = p.mean(0)
        best = max(best, float(alpha[int(c[1]) % h, int(c[0]) % w]))
        x0, y0 = np.floor(p.min(0)).astype(int)
        x1, y1 = np.ceil(p.max(0)).astype(int)
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        a, b, cc = p
        den = (b[1] - cc[1]) * (a[0] - cc[0]) + (cc[0] - b[0]) * (a[1] - cc[1])
        if abs(den) > 1e-12:
            l1 = ((b[1] - cc[1]) * (xs - cc[0]) + (cc[0] - b[0]) * (ys - cc[1])) / den
            l2 = ((cc[1] - a[1]) * (xs - cc[0]) + (a[0] - cc[0]) * (ys - cc[1])) / den
            inside = (l1 >= 0) & (l2 >= 0) & (1 - l1 - l2 >= 0)
            if inside.any():
                best = max(best, float(alpha[np.floor(ys[inside]).astype(int) % h, np.floor(xs[inside]).astype(int) % w].max()))
        if best >= 1.0:
            break
    return round(min(best, 1.0), 4)


def inverse_rigid(m):
    """
    The reader's inverse (`inv_rigid` in skeleton_from_blend.py): the transposed
    rotation, not `m.inverted()`. The .blend stores a little scale in some bind
    frames (Blender 2.83's bone-roll precision on bones pointing almost opposite
    their parent's Y: Mario's LegL/KneeL X axes are 3.3e-4 short), where a full
    inverse moves a knee capsule's ends by 2.3e-3; the committed capsules are
    the reader's, so the dump uses the same maths.
    """
    rot = m.to_3x3().transposed()
    out = rot.to_4x4()
    out.translation = -(rot @ m.translation)
    return out


def hurt_capsules(fighter, armature, meshes, bone_model, hurt_bones):
    """Per hurt bone: a capsule along its local +X from the kept meshes' vertices."""
    bones = armature.data.bones
    owner = {}
    for b in bones:
        chain, at = [], b
        while at is not None:
            chain.append(at.name)
            at = at.parent
        if any(NOT_BODY.match(n) for n in chain):
            owner[b.name] = None
        else:
            owner[b.name] = next((n for n in chain if n in hurt_bones), None)
    points = {name: [] for name in hurt_bones}
    inverse = {name: inverse_rigid(bone_model[name]) for name in hurt_bones if name in bone_model}
    for obj in meshes:
        to_model = Z_UP_TO_Y_UP @ obj.matrix_world
        groups = obj.vertex_groups
        for v in obj.data.vertices:
            if not v.groups:
                continue
            g = max(v.groups, key=lambda e: e.weight)
            target = owner.get(groups[g.group].name)
            if target is None or target not in inverse:
                continue
            points[target].append(inverse[target] @ (to_model @ v.co))
    out = []
    for name in hurt_bones:
        pts = points[name]
        if len(pts) < 8:
            fail(fighter, f"hurt bone {name} owns only {len(pts)} kept vertices")
        xs = sorted(p.x for p in pts)
        rs = sorted(math.hypot(p.y, p.z) for p in pts)
        pick = lambda arr, q: arr[min(len(arr) - 1, int(q * len(arr)))]
        # A capsule whose rounded ends reach the 5th and 95th percentile along
        # the bone and whose radius covers three quarters of the vertices
        # around it; a part shorter than its own width is a sphere at its middle.
        r = pick(rs, 0.75)
        lo, hi = pick(xs, 0.05), pick(xs, 0.95)
        x1, x2 = lo + r, hi - r
        if x1 > x2:
            x1 = x2 = (lo + hi) / 2
        out.append({"bone": name, "x1": round(x1, 5), "x2": round(x2, 5), "r": round(r, 5)})
    return out


def main():
    a = args()
    fighter = a["fighter"]
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if len(armatures) != 1:
        fail(fighter, f"expected one armature, found {len(armatures)}")
    armature = armatures[0]

    rules = load_json(a["meshes"]).get(fighter)
    if rules is None:
        fail(fighter, f"no entry in {a['meshes']}")
    hurt_table = load_json(a["hurt"])
    hurt_bones = hurt_table.get(fighter, hurt_table["default"])["bones"]
    # keep: exported and measured into the hurt capsules; drawOnly: exported, never
    # measured (Task 21b); drop: not exported. Each mesh is decided once.
    lists = ("keep", "drawOnly", "drop")
    for i, first in enumerate(lists):
        for second in lists[i + 1:]:
            both = sorted(set(rules.get(first, [])) & set(rules.get(second, [])))
            if both:
                fail(fighter, f"mesh {both[0]} is listed twice in scripts/models/meshes.json ({first} and {second})")
    drawn_names = set(rules["keep"]) | set(rules.get("drawOnly", []))
    face_names = set(rules.get("face", []))
    if not face_names:
        fail(fighter, "meshes.json names no face meshes for it (`face`) -- a fighter must not export without its face")
    for name in sorted(face_names - drawn_names):
        fail(fighter, f"face mesh {name} is not under keep or drawOnly in scripts/models/meshes.json")
    listed = drawn_names | set(rules["drop"])
    meshes, measured, mesh_report = [], [], []
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        base = SUFFIX.sub("", obj.name)
        if base not in listed:
            fail(fighter, f"mesh {obj.name} is in neither keep, drawOnly nor drop of scripts/models/meshes.json")
        drawn = obj.parent == armature and base in drawn_names
        report = {"name": obj.name, "kept": drawn and base in rules["keep"], "verts": len(obj.data.vertices), "polys": len(obj.data.polygons)}
        if drawn and not report["kept"]:
            report = {"name": obj.name, "kept": False, "drawOnly": True, "verts": report["verts"], "polys": report["polys"]}
        if drawn and base in face_names:
            report["face"] = True
        mesh_report.append(report)
        if drawn:
            meshes.append(obj)
            if report["kept"]:
                measured.append(obj)
        else:
            bpy.data.objects.remove(obj, do_unlink=True)
    if not meshes:
        fail(fighter, "kept no mesh")
    for name in sorted(face_names - {SUFFIX.sub("", o.name) for o in meshes}):
        fail(fighter, f"face mesh {name} is not exported: it is not in the .blend, or not parented to the armature")
    print(f"export_gltf {fighter}: kept " + ", ".join(sorted(m["name"] for m in mesh_report if m["kept"])))
    print(f"export_gltf {fighter}: drawn only " + ", ".join(sorted(m["name"] for m in mesh_report if m.get("drawOnly"))))
    print(f"export_gltf {fighter}: dropped " + ", ".join(sorted(m["name"] for m in mesh_report if not m["kept"] and not m.get("drawOnly"))))

    # A kept part can sit in a collection the file excludes from the view layer
    # (Donkey Kong's bodyL/bodyR and a GamemodelShape in "Expressions", Link's
    # sword and shield). Blender never evaluates such an object, so its
    # matrix_world is the identity, not the transform the file stores (the
    # armature's turn, the sword's offset), and it can be neither selected,
    # joined nor exported. Keeping follows meshes.json, as the reader's does, not
    # the file's layers: link each such part into the scene's own collection and
    # evaluate, which gives exactly the stored obmat the reader uses.
    view_layer = bpy.context.view_layer
    for obj in [armature] + meshes:
        if view_layer.objects.get(obj.name) is None:
            bpy.context.scene.collection.objects.link(obj)
    view_layer.update()

    materials = []
    key_of = {}
    by_key = {}
    report_of = {r["name"]: r for r in mesh_report}
    for obj in meshes:
        drawn_with = []
        for slot in obj.material_slots:
            if slot.material is None:
                continue
            if slot.material.name not in key_of:
                image, key, layers, alpha = rebuild_material(fighter, slot.material, meshes)
                entry = {"name": slot.material.name, "image": image, "alpha": alpha}
                if layers is not None:
                    entry["layers"] = list(layers)
                materials.append(entry)
                key_of[slot.material.name] = key
                by_key.setdefault(key, slot.material)
            # One material per image read one way: two parts painted from the same bytes draw together.
            slot.material = by_key[key_of[slot.material.name]]
            if slot.material.name not in drawn_with:
                drawn_with.append(slot.material.name)
        # The glb materials this part draws with, for verifyGlb's face checks.
        report_of[obj.name]["materials"] = drawn_with

    # Each face mesh's own sampled alpha, per material it draws with (verifyGlb: a MASK cut must leave some of it).
    alpha_of = {}
    for obj in meshes:
        report = report_of[obj.name]
        if report.get("face"):
            report["maxAlpha"] = {name: sampled_max_alpha(obj, bpy.data.materials[name], alpha_of) for name in report["materials"]}

    bone_model = {}
    bones = []
    for b in armature.data.bones:
        m = Z_UP_TO_Y_UP @ armature.matrix_world @ b.matrix_local
        bone_model[b.name] = m
        bones.append({"name": b.name, "parent": b.parent.name if b.parent else None, "world": flat(m)})

    dump = {
        "schema": DUMP_SCHEMA,
        "fighter": fighter,
        "code": a.get("code", fighter),
        "blender": bpy.app.version_string,
        "blend": bpy.path.basename(bpy.data.filepath),
        "space": "ssbu-model",
        "bones": bones,
        "meshes": mesh_report,
        "materials": materials,
        "hurt": hurt_capsules(fighter, armature, measured, bone_model, hurt_bones),
    }
    with open(a["dump"], "w") as f:
        json.dump(dump, f, indent=1)

    # Join after the dump: the capsules read each part's own transform, and
    # joining keeps vertex groups by name, so skinning is unchanged.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = armature
    options = dict(
        filepath=a["glb"],
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
    )
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    missing = [k for k in options if k not in known]
    if missing:
        fail(fighter, f"this Blender's glTF exporter lacks options {missing}")
    bpy.ops.export_scene.gltf(**options)
    print(f"export_gltf {fighter}: {len(meshes)} meshes joined, {len(by_key)} materials, {len(bones)} bones, {len(dump['hurt'])} hurt capsules")


main()
