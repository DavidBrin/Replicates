// @vitest-environment node
/**
 * The .blend reader (`scripts/models/skeleton_from_blend.py`) against crafted
 * files (Plan 4 Task 6, fix round 1). A .blend is downloaded data, so a
 * malformed or hostile one must fail fast with one line naming the problem,
 * write nothing, and never loop.
 *
 * The files are synthetic: an invented three-bone armature (Trans → Hip → Head)
 * and one sixteen-vertex mesh in Blender's 2.8x block and SDNA layout. They hold
 * no byte of a real model. Each test changes one thing about that fixture.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const READER = join(process.cwd(), "scripts", "models", "skeleton_from_blend.py");
/** A run that takes longer than this was killed: the reader hung (a valid run takes well under a second). */
const KILL_MS = 3000;

const dir = mkdtempSync(join(tmpdir(), "sdna-reader-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const MESHES = join(dir, "meshes.json");
const HURT = join(dir, "hurt.json");
writeFileSync(MESHES, JSON.stringify({ test: { keep: ["body"], drop: [] } }));
writeFileSync(HURT, JSON.stringify({ default: { head: "Head", bones: ["Head", "Hip"] } }));

/** One thing to change about the fixture. */
interface Craft {
  /** The three version digits after `BLENDER-v`. */
  readonly version?: string;
  /** The 12-byte header, whole. */
  readonly header?: string;
  readonly endb?: boolean;
  /** Bone "Trans"'s and "Hip"'s parents: a bone name, or "dangling" for a pointer to nothing. */
  readonly transParent?: string;
  readonly hipParent?: string;
  /** The first vertex group's `next` points back at itself. */
  readonly groupLoop?: boolean;
  /** A value written into Head's bind matrix. */
  readonly headMatrixValue?: number;
  /** A value written into the first vertex's x coordinate. */
  readonly vertexX?: number;
  /** The Bone block's record count (the block holds 3). */
  readonly boneCount?: number;
  /** The Bone block's SDNA struct index. */
  readonly boneBlockSdna?: number;
  /** The SDNA type index of Bone's first field. */
  readonly boneFieldType?: number;
  /** The SDNA's NAME count. */
  readonly nameCount?: number;
  /** The mesh's `totvert` (its vertex blocks hold 16). */
  readonly totvert?: number;
  /** The first vertex's `totweight` (its weight block holds 1). */
  readonly totweight?: number;
  /** The mesh's `mvert` pointer, replaced by one to nothing. */
  readonly danglingMvert?: boolean;
  /** The block codes of the Bone block and the mesh's ME block. */
  readonly boneBlockCode?: string;
  readonly meshBlockCode?: string;
  /** The vertex group the first vertex is weighted to (the object has 2). */
  readonly defNr?: number;
  /** The bytes after the header: cut to this length. */
  readonly truncate?: number;
}

const TYPES: readonly (readonly [string, number])[] = [
  ["char", 1],
  ["short", 2],
  ["int", 4],
  ["float", 4],
  ["void", 0],
  ["ListBase", 16],
  ["ID", 72],
  ["Bone", 152],
  ["Object", 168],
  ["Mesh", 96],
  ["MVert", 16],
  ["MDeformVert", 16],
  ["MDeformWeight", 8],
  ["bDeformGroup", 80],
];
const STRUCTS: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
  ["ListBase", [["void", "*first"], ["void", "*last"]]],
  ["ID", [["char", "name[66]"], ["char", "pad[6]"]]],
  ["Bone", [["Bone", "*next"], ["Bone", "*prev"], ["Bone", "*parent"], ["char", "name[64]"], ["float", "arm_mat[4][4]"]]],
  ["Object", [["ID", "id"], ["float", "obmat[4][4]"], ["Object", "*parent"], ["void", "*data"], ["ListBase", "defbase"]]],
  ["Mesh", [["ID", "id"], ["MVert", "*mvert"], ["MDeformVert", "*dvert"], ["int", "totvert"], ["int", "totpoly"]]],
  ["MVert", [["float", "co[3]"], ["int", "flag"]]],
  ["MDeformVert", [["MDeformWeight", "*dw"], ["int", "totweight"], ["int", "flag"]]],
  ["MDeformWeight", [["int", "def_nr"], ["float", "weight"]]],
  ["bDeformGroup", [["bDeformGroup", "*next"], ["bDeformGroup", "*prev"], ["char", "name[64]"]]],
];
const structIndex = (name: string) => STRUCTS.findIndex(([n]) => n === name);
const sizeOf = (name: string) => TYPES.find(([n]) => n === name)![1];

function pad4(parts: Buffer[]): void {
  const len = parts.reduce((s, b) => s + b.length, 0);
  if (len % 4 !== 0) parts.push(Buffer.alloc(4 - (len % 4)));
}

function sdna(c: Craft): Buffer {
  const names = [...new Set(STRUCTS.flatMap(([, fields]) => fields.map(([, n]) => n)))];
  const i32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
    return b;
  };
  const i16 = (v: number) => {
    const b = Buffer.alloc(2);
    b.writeInt16LE(v);
    return b;
  };
  const strs = (list: readonly string[]) => Buffer.concat(list.map((s) => Buffer.from(`${s}\0`, "latin1")));
  const parts: Buffer[] = [Buffer.from("SDNANAME"), i32(c.nameCount ?? names.length), strs(names)];
  pad4(parts);
  parts.push(Buffer.from("TYPE"), i32(TYPES.length), strs(TYPES.map(([n]) => n)));
  pad4(parts);
  parts.push(Buffer.from("TLEN"), ...TYPES.map(([, len]) => i16(len)));
  pad4(parts);
  parts.push(Buffer.from("STRC"), i32(STRUCTS.length));
  for (const [name, fields] of STRUCTS) {
    parts.push(i16(TYPES.findIndex(([n]) => n === name)), i16(fields.length));
    fields.forEach(([type, field], k) => {
      const t = name === "Bone" && k === 0 && c.boneFieldType !== undefined ? c.boneFieldType : TYPES.findIndex(([n]) => n === type);
      parts.push(i16(t), i16(names.indexOf(field)));
    });
  }
  return Buffer.concat(parts);
}

/** A record of `struct`, filled by `fill(view, offsetOf)`. */
function record(struct: string, fill: (v: DataView, at: (field: string) => number) => void): Buffer {
  const buf = Buffer.alloc(sizeOf(struct));
  const fields = STRUCTS[structIndex(struct)][1];
  const at = (field: string) => {
    let o = 0;
    for (const [type, f] of fields) {
      const key = f.split("[")[0].replace("*", "");
      if (key === field) return o;
      const dims = [...f.matchAll(/\[(\d+)\]/g)].reduce((p, m) => p * Number(m[1]), 1);
      o += (f.startsWith("*") ? 8 : sizeOf(type)) * dims;
    }
    throw new Error(`no field ${field}`);
  };
  fill(new DataView(buf.buffer, buf.byteOffset, buf.byteLength), at);
  return buf;
}

const setName = (v: DataView, at: number, s: string) => Buffer.from(s, "latin1").forEach((ch, k) => v.setUint8(at + k, ch));
const setPtr = (v: DataView, at: number, p: number) => v.setBigUint64(at, BigInt(p), true);
const setMat = (v: DataView, at: number, m: readonly number[]) => m.forEach((x, k) => v.setFloat32(at + 4 * k, x, true));
/** The importer's +90° turn about X (column-major), which the reader's Z-up→Y-up turn undoes. */
const OBMAT = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
const at = (y: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, y, 0, 1];

const PTR = { bones: 0x1000, armOb: 0x2000, meshOb: 0x3000, arm: 0x4000, mesh: 0x5000, mvert: 0x6000, dvert: 0x7000, weight: 0x8000, groupHead: 0x9000, groupHip: 0x9100, nowhere: 0xdead0 };

function blend(c: Craft = {}): Buffer {
  const blocks: Buffer[] = [];
  const block = (code: string, old: number, struct: string, count: number, data: Buffer, sdnaIndex = structIndex(struct)) => {
    const h = Buffer.alloc(24);
    h.write(code.padEnd(4, "\0"), 0, "latin1");
    h.writeInt32LE(data.length, 4);
    h.writeBigUint64LE(BigInt(old), 8);
    h.writeInt32LE(sdnaIndex, 16);
    h.writeInt32LE(count, 20);
    blocks.push(h, data);
  };
  const bonePtr = (name: string | undefined, fallback: number | null) =>
    name === undefined ? fallback : name === "dangling" ? PTR.nowhere : PTR.bones + ["Trans", "Hip", "Head"].indexOf(name) * sizeOf("Bone");

  block("OB", PTR.armOb, "Object", 1, record("Object", (v, f) => {
    setName(v, f("id"), "OBArmature");
    setMat(v, f("obmat"), OBMAT);
    setPtr(v, f("data"), PTR.arm);
  }));
  block("AR", PTR.arm, "ListBase", 1, Buffer.alloc(16));
  block("OB", PTR.meshOb, "Object", 1, record("Object", (v, f) => {
    setName(v, f("id"), "OBbody");
    setMat(v, f("obmat"), OBMAT);
    setPtr(v, f("parent"), PTR.armOb);
    setPtr(v, f("data"), PTR.mesh);
    setPtr(v, f("defbase"), PTR.groupHead);
  }));
  block(c.meshBlockCode ?? "ME", PTR.mesh, "Mesh", 1, record("Mesh", (v, f) => {
    setName(v, f("id"), "MEbody");
    setPtr(v, f("mvert"), c.danglingMvert ? PTR.nowhere : PTR.mvert);
    setPtr(v, f("dvert"), PTR.dvert);
    v.setInt32(f("totvert"), c.totvert ?? 16, true);
  }));
  // Sixteen vertices: a box around Head (weighted to it) and one around Hip.
  const verts = Array.from({ length: 16 }, (_, i) => {
    const y = i < 8 ? 10 : 5;
    return [i & 1 ? 1 : -1, y + (i & 2 ? 2 : 0), i & 4 ? 1 : -1];
  });
  block("DATA", PTR.mvert, "MVert", 16, Buffer.concat(verts.map((co, i) => record("MVert", (v, f) => {
    setMat(v, f("co"), co);
    if (i === 0 && c.vertexX !== undefined) v.setFloat32(f("co"), c.vertexX, true);
  }))));
  block("DATA", PTR.dvert, "MDeformVert", 16, Buffer.concat(verts.map((_, i) => record("MDeformVert", (v, f) => {
    setPtr(v, f("dw"), PTR.weight + 0x10 * i);
    v.setInt32(f("totweight"), i === 0 && c.totweight !== undefined ? c.totweight : 1, true);
  }))));
  verts.forEach((_, i) => block("DATA", PTR.weight + 0x10 * i, "MDeformWeight", 1, record("MDeformWeight", (v, f) => {
    v.setInt32(f("def_nr"), i === 0 && c.defNr !== undefined ? c.defNr : i < 8 ? 0 : 1, true);
    v.setFloat32(f("weight"), 1, true);
  })));
  block("DATA", PTR.groupHead, "bDeformGroup", 1, record("bDeformGroup", (v, f) => {
    setPtr(v, f("next"), c.groupLoop ? PTR.groupHead : PTR.groupHip);
    setName(v, f("name"), "Head");
  }));
  block("DATA", PTR.groupHip, "bDeformGroup", 1, record("bDeformGroup", (v, f) => setName(v, f("name"), "Hip")));
  const bones = [
    ["Trans", bonePtr(c.transParent, null), 0],
    ["Hip", bonePtr(c.hipParent, PTR.bones), 5],
    ["Head", PTR.bones + sizeOf("Bone"), 10],
  ] as const;
  block(
    c.boneBlockCode ?? "DATA",
    PTR.bones,
    "Bone",
    c.boneCount ?? 3,
    Buffer.concat(bones.map(([name, parent, y]) => record("Bone", (v, f) => {
      setName(v, f("name"), name);
      if (parent !== null) setPtr(v, f("parent"), parent);
      setMat(v, f("arm_mat"), at(y));
      if (name === "Head" && c.headMatrixValue !== undefined) v.setFloat32(f("arm_mat"), c.headMatrixValue, true);
    }))),
    c.boneBlockSdna,
  );
  block("DNA1", 0, "ListBase", 1, sdna(c), 0);
  if (c.endb ?? true) block("ENDB", 0, "ListBase", 0, Buffer.alloc(0), 0);
  const body = Buffer.concat(blocks);
  const header = Buffer.from(c.header ?? `BLENDER-v${c.version ?? "283"}`, "latin1");
  return Buffer.concat([header, c.truncate === undefined ? body : body.subarray(0, c.truncate)]);
}

let runs = 0;
function read(c: Craft = {}) {
  const name = `craft-${++runs}`;
  const file = join(dir, `${name}.blend`);
  const out = join(dir, `${name}.json`);
  writeFileSync(file, blend(c));
  const r = spawnSync("python3", ["-I", "-B", READER, file, "--fighter", "test", "--code", "test", "--meshes", MESHES, "--hurt", HURT, "--out", out], {
    encoding: "utf8",
    timeout: KILL_MS,
  });
  return { status: r.status, signal: r.signal, stderr: r.stderr, stdout: r.stdout, wrote: existsSync(out), out };
}

/** Refused: exit 1, one line naming the problem, no traceback, nothing written, and quickly. */
function refused(c: Craft, why: RegExp): void {
  const r = read(c);
  expect(r.signal, "killed: the reader hung").toBeNull();
  expect(r.stderr).not.toMatch(/Traceback/);
  expect(r.stderr.trim().split("\n"), r.stderr).toHaveLength(1);
  expect(r.stderr).toMatch(/^skeleton_from_blend test: /);
  expect(r.stderr).toMatch(why);
  expect(r.status).toBe(1);
  expect(r.wrote, "a refused file must leave no output").toBe(false);
}

describe("the .blend reader on a crafted file", () => {
  it("reads the valid fixture (so every refusal below is the change, not the fixture)", () => {
    const r = read();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const dump = JSON.parse(readFileSync(r.out, "utf8"));
    expect(dump.bones.map((b: { name: string; parent: string | null }) => [b.name, b.parent])).toEqual([
      ["Trans", null],
      ["Hip", "Trans"],
      ["Head", "Hip"],
    ]);
    expect(dump.meshes).toEqual([{ name: "body", kept: true, verts: 16, polys: 0 }]);
    expect(dump.hurt.map((h: { bone: string }) => h.bone)).toEqual(["Head", "Hip"]);
    expect(r.stdout).toMatch(/^skeleton_from_blend test: 3 bones, 1\/1 meshes kept, 2 hurt capsules/);
  });

  describe("never loops on a cycle in the file's pointers", () => {
    it("a vertex-group list whose next points back at itself", () => {
      refused({ groupLoop: true }, /object body: its vertex-group list loops/);
    });

    it("a bone that is its own parent", () => {
      refused({ hipParent: "Hip" }, /bone parent cycle through Hip/);
    });

    it("two bones that are each other's parent", () => {
      refused({ transParent: "Hip" }, /bone parent cycle through (Trans|Hip)/);
    });
  });

  describe("refuses a malformed file by name", () => {
    it("a file that is not 64-bit little-endian, or is empty", () => {
      refused({ header: "BLENDER_v283" }, /not a 64-bit little-endian \.blend/);
      refused({ header: "BLENDER-V283" }, /not a 64-bit little-endian \.blend/);
      refused({ header: "", truncate: 0 }, /not a 64-bit little-endian \.blend/);
    });

    it("a file older than Blender 2.80, or with no readable version", () => {
      refused({ version: "279" }, /saved by Blender 2\.79; this reader needs 2\.80 or newer/);
      refused({ version: "2x3" }, /unreadable file version/);
    });

    it("a file with no ENDB block (truncated after a whole block)", () => {
      refused({ endb: false }, /no ENDB block/);
    });

    it("a block that runs past the end of the file", () => {
      refused({ truncate: 100 }, /runs past the end of the file/);
    });

    it("an SDNA table that runs past its block, or names a type it does not have", () => {
      refused({ nameCount: 0x7fffffff }, /SDNA: .*runs past the end of its block/);
      refused({ boneFieldType: 999 }, /SDNA: struct Bone field 0 has type index 999/);
      refused({ boneFieldType: -1 }, /SDNA: struct Bone field 0 has type index -1/);
    });

    it("a block whose SDNA index is out of range", () => {
      refused({ boneBlockSdna: 99 }, /block DATA at \d+ has SDNA index 99/);
      refused({ boneBlockSdna: -1 }, /block DATA at \d+ has SDNA index -1/);
    });

    it("a record count that does not fit its block", () => {
      refused({ boneCount: 4 }, /4 Bone records do not fit its 456-byte block/);
      refused({ boneCount: -1 }, /-1 Bone records/);
      refused({ totvert: 17 }, /mesh body: 17 MVert records do not fit its 256-byte block/);
      refused({ totvert: 0x7fffffff }, /mesh body: 2147483647 MVert records do not fit/);
      refused({ totweight: 2 }, /mesh body vertex 0: 2 MDeformWeight records do not fit its 8-byte block/);
    });

    it("a block whose code and SDNA struct disagree, so a changed code cannot hide a bone block or a mesh", () => {
      refused({ boneBlockCode: "DATB" }, /block DATB at \d+ holds Bone records, which are stored as DATA blocks/);
      refused({ meshBlockCode: "MF" }, /block MF at \d+ holds Mesh records, which are stored as ME blocks/);
    });

    it("a vertex weighted to a vertex group the object does not have", () => {
      refused({ defNr: 2 }, /mesh body vertex 0 is weighted to vertex group 2, but the object has 2/);
      refused({ defNr: -1 }, /mesh body vertex 0 is weighted to vertex group -1/);
    });

    it("a pointer that leads nowhere", () => {
      refused({ hipParent: "dangling" }, /bone Hip: its parent pointer leads to no bone/);
      refused({ danglingMvert: true }, /mesh body: its mvert pointer leads to no block/);
    });

    it("a bind matrix or a vertex that is not a finite number, instead of writing NaN", () => {
      refused({ headMatrixValue: Number.NaN }, /bone Head: its bind matrix is not finite/);
      refused({ headMatrixValue: Number.POSITIVE_INFINITY }, /bone Head: its bind matrix is not finite/);
      refused({ vertexX: Number.NaN }, /mesh body vertex 0 is not finite/);
    });
  });
});
