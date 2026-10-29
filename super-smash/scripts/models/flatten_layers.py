"""
Flatten a layered colour into one texture (Plan 4 Task 21b).

The eye materials of five fighters (Mario, Donkey Kong, Link, Fox, Marth) layer
an overlay (the iris or pupil, on its own UV map) over a base (the eye white,
on the mesh's first UV map), with the overlay's alpha as the mix factor. glTF
has one base-colour texture per material, so `export_gltf.py` bakes the two
into one texture on the base's UV map: every texel of the result is
`mix(base, overlay, overlay alpha)` at the surface point that texel shows,
which is where the GPU would have sampled each layer.

Where a texel shows the surface comes from the mesh's own triangles: inside a
triangle the overlay's UV is the barycentric blend of its three overlay UVs,
exactly as a rasteriser interpolates them. Texels up to `MARGIN` past the
triangles get the nearest triangle's map extended, so filtering at an edge
reads iris and not bare white. Texels beyond keep the base alone.

The result is opaque (alpha 1): the source materials mix colour only and never
read alpha. Colours are mixed in linear light and filtered premultiplied, as
Blender's shader does, then written back sRGB-encoded like the inputs.

Plain Python, no Blender and no numpy, so the same code runs inside Blender's
export and under `python3 -I -B` in the tests (`flattenLayers.test.ts`).
"""

import math

# Texels past the triangles that still get the overlay (bilinear filtering reads one; mip levels a little more).
MARGIN = 2
# How far apart, in overlay texels, two triangles may map one base texel before that is a conflict.
CONFLICT_TEXELS = 0.5
_EPS = 1e-9


class FlattenError(Exception):
    """The layers cannot be flattened as asked; the message says why."""


class Layer:
    """One texture of the layered colour: RGBA floats, rows bottom-up (Blender's `Image.pixels`), sRGB-encoded."""

    def __init__(self, width, height, pixels, extension="REPEAT"):
        if width < 1 or height < 1 or len(pixels) != width * height * 4:
            raise FlattenError(f"a {width}x{height} layer needs {max(0, width * height * 4)} values, has {len(pixels)}")
        self.width, self.height, self.extension = width, height, extension
        self.pixels = pixels


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    c = min(1.0, max(0.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _linear(layer, premultiply):
    """Per texel (r, g, b, a) in linear light: premultiplied by alpha for the overlay, alpha 1 for the base (never read)."""
    p = layer.pixels
    out = []
    for i in range(0, len(p), 4):
        a = p[i + 3] if premultiply else 1.0
        out.append((srgb_to_linear(p[i]) * a, srgb_to_linear(p[i + 1]) * a, srgb_to_linear(p[i + 2]) * a, a))
    return out


def _wrap(i, n, extension):
    if extension == "REPEAT":
        return i % n
    if extension == "CLIP" and (i < 0 or i >= n):
        return None
    return min(n - 1, max(0, i))


def _sample(texels, layer, u, v):
    """Bilinear, texel centres at (i + 0.5) / width, as Blender's Linear interpolation; premultiplied."""
    x = u * layer.width - 0.5
    y = v * layer.height - 0.5
    x0, y0 = math.floor(x), math.floor(y)
    fx, fy = x - x0, y - y0
    acc = [0.0, 0.0, 0.0, 0.0]
    for dx, dy, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        if w == 0:
            continue
        xi = _wrap(x0 + dx, layer.width, layer.extension)
        yi = _wrap(y0 + dy, layer.height, layer.extension)
        if xi is None or yi is None:
            continue
        t = texels[yi * layer.width + xi]
        for k in range(4):
            acc[k] += w * t[k]
    return acc


def _barycentric(p, a, b, c):
    den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    l1 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / den
    l2 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / den
    return l1, l2, 1 - l1 - l2


def flatten(base, overlay, triangles):
    """
    `base` and `overlay` are `Layer`s; `triangles` lists, for each triangle the
    layered material is drawn on, its three base UVs and its three overlay UVs.
    Returns (pixels, (width, height)): the flattened RGBA, rows bottom-up,
    sRGB-encoded, alpha 1, as large as the larger layer in each direction.
    Raises FlattenError for a triangle whose base UVs cross a repeat boundary,
    or for a texel two triangles map to different overlay places (mirrored
    halves sharing one base texture cannot be flattened into it).
    """
    width, height = max(base.width, overlay.width), max(base.height, overlay.height)
    tol = CONFLICT_TEXELS / max(overlay.width, overlay.height)
    owner = [None] * (width * height)  # per texel: (overlay u, overlay v, triangle index)
    tris = []
    for ti, (buv, ouv) in enumerate(triangles):
        # The base texture repeats: move the triangle into the first tile (Link's left eye white sits at u - 1).
        su, sv = math.floor(min(u for u, _ in buv) + _EPS), math.floor(min(v for _, v in buv) + _EPS)
        a, b, c = [(u - su, v - sv) for u, v in buv]
        if max(a[0], b[0], c[0]) > 1 + _EPS or max(a[1], b[1], c[1]) > 1 + _EPS:
            raise FlattenError("a triangle crosses a texture repeat boundary in the base layer's UVs")
        if abs((b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])) < 1e-14:
            continue
        tris.append(((a, b, c), ouv))
        x0 = max(0, math.floor(min(a[0], b[0], c[0]) * width - 0.5))
        x1 = min(width - 1, math.ceil(max(a[0], b[0], c[0]) * width - 0.5))
        y0 = max(0, math.floor(min(a[1], b[1], c[1]) * height - 0.5))
        y1 = min(height - 1, math.ceil(max(a[1], b[1], c[1]) * height - 0.5))
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                l1, l2, l3 = _barycentric(((x + 0.5) / width, (y + 0.5) / height), a, b, c)
                if min(l1, l2, l3) < -1e-7:
                    continue
                ou = l1 * ouv[0][0] + l2 * ouv[1][0] + l3 * ouv[2][0]
                ov = l1 * ouv[0][1] + l2 * ouv[1][1] + l3 * ouv[2][1]
                k = y * width + x
                prev = owner[k]
                if prev is not None and max(abs(prev[0] - ou), abs(prev[1] - ov)) > tol:
                    raise FlattenError(f"texel {x},{y} of the base layer maps to two places in the overlay ({prev[0]:.4f},{prev[1]:.4f} and {ou:.4f},{ov:.4f})")
                if prev is None:
                    owner[k] = (ou, ov, len(tris) - 1)
    # Extend each edge texel's triangle map MARGIN rings outwards, for filtering.
    for _ in range(MARGIN):
        grown = list(owner)
        for y in range(height):
            for x in range(width):
                if owner[y * width + x] is not None:
                    continue
                near = next(
                    (owner[ny * width + nx] for ny in (y - 1, y, y + 1) for nx in (x - 1, x, x + 1)
                     if 0 <= nx < width and 0 <= ny < height and owner[ny * width + nx] is not None),
                    None,
                )
                if near is None:
                    continue
                (a, b, c), ouv = tris[near[2]]
                l1, l2, l3 = _barycentric(((x + 0.5) / width, (y + 0.5) / height), a, b, c)
                grown[y * width + x] = (l1 * ouv[0][0] + l2 * ouv[1][0] + l3 * ouv[2][0], l1 * ouv[0][1] + l2 * ouv[1][1] + l3 * ouv[2][1], near[2])
        owner = grown

    base_texels = _linear(base, premultiply=False)
    over_texels = _linear(overlay, premultiply=True)
    out = []
    for y in range(height):
        for x in range(width):
            u, v = (x + 0.5) / width, (y + 0.5) / height
            col = _sample(base_texels, base, u, v)[:3]
            o = owner[y * width + x]
            if o is not None:
                pr, pg, pb, pa = _sample(over_texels, overlay, o[0], o[1])
                pa = min(1.0, max(0.0, pa))
                col = [col[0] * (1 - pa) + pr, col[1] * (1 - pa) + pg, col[2] * (1 - pa) + pb]
            out.extend((linear_to_srgb(col[0]), linear_to_srgb(col[1]), linear_to_srgb(col[2]), 1.0))
    return out, (width, height)
