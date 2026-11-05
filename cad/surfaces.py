"""Data-only open reference surfaces evaluated by the native SMLib kernel.

usd-brep 1.0.1 exposes a fixed bicubic control-net constructor, not arbitrary
surface degrees or knot vectors. A 4 x 4 control net is a bicubic Bezier patch;
larger nets are bicubic B-splines. Bilinear patches use the dedicated corner API.
The triangles and their summed area are approximations of that native surface.
"""
import math
from importlib.metadata import version


def _vector(point, label='control point', limit=100.):
    if not isinstance(point, (list, tuple)) or len(point) != 3 or any(
            type(x) not in (int, float) or not math.isfinite(x) or abs(x) > limit for x in point):
        raise ValueError('Invalid surface ' + label + ': expected three finite coordinates within bounds')
    return [float(x) for x in point]


def _cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def _dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def _sub(a, b):
    return [x-y for x, y in zip(a, b)]


def validate_spec(spec):
    if not isinstance(spec, dict) or set(spec) - {'kind', 'controlPoints', 'segmentsU', 'segmentsV'}:
        raise ValueError('Invalid surface fields')
    kind = spec.get('kind')
    if kind not in ('bilinear', 'bezier', 'bspline'):
        raise ValueError('Unsupported surface kind; use bilinear, bezier or bspline')
    grid = spec.get('controlPoints')
    minimum, maximum = (2, 2) if kind == 'bilinear' else ((4, 4) if kind == 'bezier' else (4, 8))
    if not isinstance(grid, list) or not minimum <= len(grid) <= maximum or not isinstance(grid[0], list):
        raise ValueError(f'{kind} surface requires {minimum} to {maximum} control points in each direction')
    columns = len(grid[0])
    if not minimum <= columns <= maximum or any(not isinstance(row, list) or len(row) != columns for row in grid):
        raise ValueError('Surface control points must form a rectangular grid with valid dimensions')
    points = [[_vector(point) for point in row] for row in grid]
    canonical = {'kind': kind, 'controlPoints': points}
    for field in ('segmentsU', 'segmentsV'):
        value = spec.get(field, 16)
        if type(value) is not int or not 4 <= value <= 64:
            raise ValueError('Surface ' + field + ' must be an integer from 4 to 64')
        canonical[field] = value
    return canonical


def build_surface(u, spec):
    canonical = validate_spec(spec)
    grid = canonical['controlPoints']
    if canonical['kind'] == 'bilinear':
        surface = u.create_surface_from_corner_points(tuple(grid[0][0]), tuple(grid[1][0]), tuple(grid[0][1]), tuple(grid[1][1]))
    else:
        surface = u.create_surface_from_points([tuple(p) for row in grid for p in row], len(grid), len(grid[0]))
    return surface, canonical


def handle_surface(u, spec):
    surface, canonical = build_surface(u, spec)
    umin, umax = surface.u_domain()
    vmin, vmax = surface.v_domain()
    if not all(math.isfinite(x) for x in (umin, umax, vmin, vmax)) or umax <= umin or vmax <= vmin:
        raise ValueError('SMLib returned an invalid surface parameter domain')
    count_u, count_v = canonical['segmentsU'], canonical['segmentsV']
    controls = [point for row in canonical['controlPoints'] for point in row]
    extent_squared = sum((max(p[k] for p in controls)-min(p[k] for p in controls))**2 for k in range(3))
    # The native derivative API regularizes exactly singular boundary tangents
    # to a small epsilon. Use the control-net scale to catch that epsilon too.
    derivative_floor = max(1e-14, extent_squared*1e-10)
    nodes, normals = [], []
    for i in range(count_u + 1):
        uu = umin + (umax - umin)*i/count_u
        for j in range(count_v + 1):
            vv = vmin + (vmax - vmin)*j/count_v
            # Both coordinates and normals come from SMLib. Checking its native
            # derivatives rejects collapsed/singular patches before meshing.
            point, du, dv = surface.derivatives(uu, vv)
            point = _vector(point, 'evaluated coordinates', 100.000001)
            derivative_cross = _cross(du, dv)
            measure = math.hypot(*derivative_cross)
            if not math.isfinite(measure) or measure < derivative_floor:
                raise ValueError('Surface is degenerate or singular; separate its control rows and columns')
            normal = _vector(surface.normal(uu, vv), 'normal', 1.000001)
            norm = math.hypot(*normal)
            if norm < 1e-10 or _dot(normal, derivative_cross) <= 0:
                raise ValueError('SMLib surface normal is invalid or inconsistent with its parameter orientation')
            nodes.append(point)
            normals.append([x/norm for x in normal])
    elements = []
    areas = []
    for i in range(count_u):
        for j in range(count_v):
            a = i*(count_v + 1)+j
            b, c, d = a + count_v + 1, a + count_v + 2, a + 1
            for triangle in ((a, b, c), (a, c, d)):
                p, q, r = [nodes[k] for k in triangle]
                cross = _cross(_sub(q, p), _sub(r, p))
                area = math.hypot(*cross)/2
                mean_normal = [sum(normals[k][axis] for k in triangle) for axis in range(3)]
                if not math.isfinite(area) or area < 1e-14 or _dot(cross, mean_normal) <= area*1e-8:
                    raise ValueError('Surface sampling has collapsed or inverted triangles; adjust control points or increase segments')
                elements.append(list(triangle))
                areas.append(area)
    degree = 1 if canonical['kind'] == 'bilinear' else 3
    return {'schema': 'summer-cad-surface/1', 'kernel': 'SMLib', 'version': version('usd-brep'),
            'spec': canonical, 'degreeU': degree, 'degreeV': degree,
            'nodes': nodes, 'elements': elements, 'normals': normals,
            'area': math.fsum(areas), 'areaApproximate': True, 'closed': False,
            'bounds': {'lower': [min(p[k] for p in nodes) for k in range(3)],
                       'upper': [max(p[k] for p in nodes) for k in range(3)]},
            'boundsApproximate': True,
            'parameterRange': {'u': [umin, umax], 'v': [vmin, vmax]}}
