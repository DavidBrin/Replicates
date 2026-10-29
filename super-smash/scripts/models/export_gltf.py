"""
Blender headless: one fighter's c00 .blend -> a skinned .glb and a bone dump.

    .model-cache/tools/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --disable-autoexec <blend> --python-exit-code 1 \
        --python scripts/models/export_gltf.py -- \
        --fighter mario --glb .model-cache/glb/mario.raw.glb \
        --dump .model-cache/dumps/mario.json --meshes scripts/models/meshes.json \
        --hurt src/render3d/skeletons/hurtBones.json

Run by scripts/models/build.mjs for each fighter (Plan 4 Task 8). What it does:
1. Keeps exactly the meshes `scripts/models/meshes.json` lists under `keep`
   for this fighter (names without Blender's `.NNN` suffix) and deletes those
   under `drop`: the neutral face, eyes and body stay; alternate expressions,
   blinks, low-poly duplicates and sheathed-sword copies go. A mesh in neither
   list fails the export -- the lists are exhaustive, written from the real
   files, so a new upstream mesh is a decision, not a silent guess.
2. Rebuilds every kept material as Principled BSDF <- the material's c00
   colour texture (`*_col.png`, largest if several), colour and alpha, keeping
   the texture's UV map; materials that end up on the same texture become one.
3. Dumps every bone's bind matrix in SSBU model space and per-bone hurt
   capsules derived from the kept meshes' vertex weights (UNVERIFIED sizes) --
   the same numbers `skeleton_from_blend.py` reads without Blender, which
   `dump.test.ts` cross-checks.
4. Joins the kept meshes into one object, so the glb has one primitive per
   texture (at most `MAX_PRIMITIVES` in glb.mjs) instead of one per part:
   Link's 13 kept parts are 8 draw calls, not 44.
5. Exports armature + the joined mesh as GLB (skins on, animations and morphs off).

Prints the kept and dropped meshes. Fails loudly (exit 1, a message naming the
fighter) on: no or several armatures, a mesh missing from meshes.json, a kept
material with no colour texture, an unloadable texture, or an exporter missing
an option. Schema of the dump: src/render3d/pipeline/dump.ts.
"""

import json
import math
import re
import sys

import bpy
import mathutils

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


def rebuild_material(fighter, material):
    image, image_node = colour_image(material)
    if image is None:
        fail(fighter, f"material {material.name} has no colour texture")
    image.reload()
    if image.size[0] == 0:
        fail(fighter, f"texture {image.filepath} for {material.name} did not load (is it in .model-cache/src/{fighter}/?)")
    tree = material.node_tree
    uv_link = next((l for l in tree.links if l.to_node == image_node and l.to_socket.name == "Vector"), None)
    uv_node = uv_link.from_node if uv_link is not None else None
    uv_name = uv_node.uv_map if uv_node is not None and uv_node.type == "UVMAP" else None
    for node in list(tree.nodes):
        if node not in (image_node, uv_node):
            tree.nodes.remove(node)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(image_node.outputs["Color"], bsdf.inputs["Base Color"])
    tree.links.new(image_node.outputs["Alpha"], bsdf.inputs["Alpha"])
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    if uv_name is not None:
        uv = tree.nodes.new("ShaderNodeUVMap")
        uv.uv_map = uv_name
        tree.links.new(uv.outputs["UV"], image_node.inputs["Vector"])
    return image.name


def inverse_rigid(m):
    """
    The reader's inverse (`inv_rigid` in skeleton_from_blend.py): the transposed
    rotation, not `m.inverted()`. SSBU authors a little scale into some bind
    frames (Mario's LegL/KneeL X axes are 3.3e-4 short), where a full inverse
    moves a knee capsule's ends by 2.3e-3; the committed capsules are the
    reader's, so the dump uses the same maths.
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
    listed = set(rules["keep"]) | set(rules["drop"])
    meshes, mesh_report = [], []
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        base = SUFFIX.sub("", obj.name)
        if base not in listed:
            fail(fighter, f"mesh {obj.name} is in neither keep nor drop of scripts/models/meshes.json")
        kept = obj.parent == armature and base in rules["keep"]
        mesh_report.append({"name": obj.name, "kept": kept, "verts": len(obj.data.vertices), "polys": len(obj.data.polygons)})
        if kept:
            meshes.append(obj)
        else:
            bpy.data.objects.remove(obj, do_unlink=True)
    if not meshes:
        fail(fighter, "kept no mesh")
    print(f"export_gltf {fighter}: kept " + ", ".join(sorted(m["name"] for m in mesh_report if m["kept"])))
    print(f"export_gltf {fighter}: dropped " + ", ".join(sorted(m["name"] for m in mesh_report if not m["kept"])))

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
    by_image = {}
    for obj in meshes:
        for slot in obj.material_slots:
            if slot.material is None:
                continue
            if slot.material.name not in {m["name"] for m in materials}:
                image = rebuild_material(fighter, slot.material)
                materials.append({"name": slot.material.name, "image": image})
                by_image.setdefault(image, slot.material)
            # One material per texture: two parts painted from one image draw together.
            slot.material = by_image[next(m["image"] for m in materials if m["name"] == slot.material.name)]

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
        "hurt": hurt_capsules(fighter, armature, meshes, bone_model, hurt_bones),
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
    print(f"export_gltf {fighter}: {len(meshes)} meshes joined, {len(by_image)} textures, {len(bones)} bones, {len(dump['hurt'])} hurt capsules")


main()
