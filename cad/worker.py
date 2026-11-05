"""Isolated SMLib worker. JSON data in/out; never executes client scripts/paths."""
import json
import math
import sys
import tempfile
from pathlib import Path
from importlib.metadata import version


def vector(v, positive=False, limit=100):
    if not isinstance(v, list) or len(v) != 3 or any(type(x) not in (int, float) or not math.isfinite(x) or abs(x) > limit for x in v):
        raise ValueError('Invalid CAD coordinates')
    if positive and any(x < .01 or x > 12 for x in v):
        raise ValueError('CAD dimensions must be 0.01–12 m')
    return v


def build(u, recipe):
    if not isinstance(recipe, list) or not 1 <= len(recipe) <= 8:
        raise ValueError('CAD requires 1–8 primitives')
    solid = None
    for i, item in enumerate(recipe):
        if not isinstance(item, dict):
            raise ValueError('Invalid CAD primitive fields')
        shape, operation = item.get('shape'), item.get('operation')
        profile_shape = shape in ('extrude', 'revolve')
        fields = {'shape', 'center', 'rotation', 'operation'} | ({'profile', 'depth' if shape == 'extrude' else 'angle'} if profile_shape else {'size'})
        if set(item) != fields:
            raise ValueError('Invalid CAD primitive fields')
        c, r = vector(item['center']), vector(item['rotation'], limit=360)
        s = None if profile_shape else vector(item['size'], True)
        if operation not in (['base'] if i == 0 else ['union', 'difference', 'intersection']):
            raise ValueError('Invalid CAD operation')
        if profile_shape:
            from profiles import build_profile
            part = build_profile(u, item)
        elif shape == 'box':
            part = u.create_box(tuple(-x / 2 for x in s), *s)
        elif shape == 'sphere':
            if max(s) - min(s) > 1e-10:
                raise ValueError('Sphere diameters must match')
            part = u.create_sphere((0., 0., 0.), s[0] / 2)
        elif shape == 'cylinder':
            if abs(s[0] - s[2]) > 1e-10:
                raise ValueError('Y cylinder X/Z diameters must match')
            part = u.create_cylinder((0., 0., -s[1] / 2), s[0] / 2, s[1])
            u.rotate(part, (0., 0., 0.), (1., 0., 0.), -90.)
        else:
            raise ValueError('Unsupported CAD primitive')
        for axis, angle in zip([(1., 0., 0.), (0., 1., 0.), (0., 0., 1.)], r):
            if angle:
                u.rotate(part, (0., 0., 0.), axis, angle)
        u.translate(part, tuple(c))
        solid = part if solid is None else {'union': u.boolean_union, 'difference': u.boolean_difference, 'intersection': u.boolean_intersection}[operation](solid, part)
        if not u.is_manifold_solid(solid):
            raise ValueError('Result is not a closed solid; adjust overlap or dimensions')
    return solid


def triangles(u, solid, options=None):
    options = options or {}
    mesh = u.tessellate(solid, curve_angle_tolerance_deg=options.get('angleTolerance', 15.),
                       surface_angle_tolerance_deg=options.get('angleTolerance', 15.),
                       chord_height_tolerance=options.get('chordTolerance', 0.),
                       max_edge_length=options.get('targetSize', 0.)).to_mesh_arrays()
    points, faces = mesh['points'], mesh['faces']
    indices, k = [], 0
    while k < len(faces):
        if faces[k] != 3:
            raise ValueError('Kernel returned a non-triangle face')
        indices.extend(faces[k + 1:k + 4])
        k += 4
    if not points or len(points) > 50000 or len(indices) > 300000:
        raise ValueError('CAD preview exceeds mesh capacity')
    return points, indices


def mesh_capacity_preflight(solid, volume, options):
    """Reject obviously oversized discretizations before native allocation.

    These estimates are lower bounds for an ideal mesh at the requested scale,
    not promises of the resulting element count. The final mesher still checks
    actual capacities because feature preservation/quality can add elements.
    """
    target = options['targetSize']
    if options['kind'] == 'volume':
        target_volume = target ** 3 / (6 * math.sqrt(2))
        # Same conservative budget as mesh_volume; leave room for boundary
        # conformity and quality refinement instead of allocating millions first.
        if volume / target_volume > 24000 * .75:
            raise ValueError('FEM mesh preflight exceeds 24000 Tet4 element capacity; increase targetSize')
    area = solid.area(1e-5)
    if not math.isfinite(area) or area <= 0:
        raise ValueError('Cannot estimate CAD surface mesh capacity from its area')
    # An equilateral triangle has the largest area for a given maximum edge.
    # A closed triangular surface has roughly two faces per welded vertex.
    # Keep 10% slack for curved-to-planar area approximation and topology.
    minimum_triangles = area / (math.sqrt(3) * target ** 2 / 4)
    triangle_budget = 10000 if options['kind'] == 'volume' else 100000
    if minimum_triangles > triangle_budget * 1.1:
        capacity = '5000 FEM boundary nodes' if options['kind'] == 'volume' else '100000 surface triangles'
        raise ValueError('CAD mesh preflight exceeds ' + capacity + '; increase targetSize')


def handle(data):
    import usd_brep as u
    if data == {'action': 'health'}:
        return {'kernel': 'SMLib', 'version': version('usd-brep'), 'ready': True}
    if isinstance(data, dict) and set(data) == {'action', 'spec'} and data['action'] == 'curve':
        from curves import handle_curve
        return handle_curve(u, data['spec'])
    if isinstance(data, dict) and set(data) == {'action', 'spec'} and data['action'] == 'surface':
        from surfaces import handle_surface
        return handle_surface(u, data['spec'])
    is_mesh = isinstance(data, dict) and data.get('action') == 'mesh' and set(data) == {'action', 'recipe', 'options'}
    if not is_mesh and (not isinstance(data, dict) or set(data) != {'action', 'recipe'} or data['action'] not in ('build', 'export')):
        raise ValueError('Invalid CAD request')
    options = {}
    if is_mesh:
        raw = data['options']
        if not isinstance(raw, dict) or set(raw) - {'kind', 'targetSize', 'angleTolerance', 'chordTolerance'} or raw.get('kind') not in ('surface', 'volume'):
            raise ValueError('Invalid mesh options')
        options = {'kind': raw['kind'], 'targetSize': raw.get('targetSize', .15), 'angleTolerance': raw.get('angleTolerance', 15.), 'chordTolerance': raw.get('chordTolerance', .002)}
        for key, low, high in [('targetSize', .005, 12.), ('angleTolerance', 3., 45.), ('chordTolerance', .00001, .1)]:
            value = options[key]
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError('Mesh option out of bounds: ' + key)
    solid = build(u, data['recipe'])
    volume = u.compute_volume(solid, 1e-6)
    if not math.isfinite(volume) or volume <= 1e-10:
        raise ValueError('CAD operation produced an empty or zero-volume solid')
    if data['action'] == 'export':
        with tempfile.TemporaryDirectory(prefix='summer-cad-') as directory:
            path = Path(directory) / 'model.usda'
            u.usd.export_brep(solid, str(path))
            return {'usda': path.read_text(encoding='utf-8')}
    if is_mesh:
        mesh_capacity_preflight(solid, volume, options)
    points, indices = triangles(u, solid, options)
    # Exact coordinate mapping uses the kernel bounds (including its tolerance).
    lower, upper = u.brep_bounding_box(solid, tight=True)
    cad = {'schema': 'summer-cad/1', 'kernel': 'SMLib', 'version': version('usd-brep'),
            'recipe': data['recipe'], 'lower': lower, 'upper': upper, 'volume': volume,
            'vertices': points, 'indices': indices, 'closed': True}
    if is_mesh:
        if options['kind'] == 'volume':
            from meshing import mesh_volume
            result = mesh_volume(points, indices, {'targetSize': options['targetSize']}, exact_volume=volume, recipe=data['recipe'])
            result['source'] = {'recipe': data['recipe'], 'lower': lower, 'upper': upper}
        else:
            faces = [indices[i:i+3] for i in range(0, len(indices), 3)]
            result = {'schema': 'summer-cad-mesh/1', 'kind': 'surface', 'generator': 'SMLib tessellator', 'nodes': points,
                      'elements': faces, 'surface': faces, 'exactVolume': volume}
        result['options'] = options
        result['cad'] = cad
        return result
    return cad


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(64001)
        if len(raw) > 64000:
            raise ValueError('CAD request too large')
        result = {'ok': True, 'result': handle(json.loads(raw))}
    except Exception as error:
        result = {'ok': False, 'error': str(error)[:600]}
    print('SUMMER_CAD_RESULT=' + json.dumps(result, ensure_ascii=True, allow_nan=False))
