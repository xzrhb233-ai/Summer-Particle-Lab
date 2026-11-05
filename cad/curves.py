"""Bounded declarative curves evaluated by the installed SMLib kernel.

The returned polyline is a display/export sampling of the native curve. Length is
integrated by SMLib; its sampled bounds are explicitly labelled approximate.
"""
import math
from importlib.metadata import version


def _number(value, name, lower=-100., upper=100.):
    if type(value) not in (int, float) or not math.isfinite(value) or not lower <= value <= upper:
        raise ValueError(f'Invalid curve {name}: expected {lower:g} to {upper:g}')
    return float(value)


def _vector(value, name='coordinates', limit=100.):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f'Invalid curve {name}: expected three coordinates')
    return [_number(x, name, -limit, limit) for x in value]


def _vectors(value, name, minimum=2, maximum=32):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ValueError(f'Curve {name} requires {minimum} to {maximum} points')
    points = [_vector(point, name) for point in value]
    if max(math.dist(point, points[0]) for point in points[1:]) < 1e-8:
        raise ValueError('Curve points must not all coincide')
    return points


def _fields(spec, required, optional=()):
    if set(spec) - set(required) - set(optional) or not set(required).issubset(spec):
        raise ValueError('Invalid curve fields')


def build_curve(u, spec):
    """Return a native curve and a canonical, validated recipe."""
    if not isinstance(spec, dict):
        raise ValueError('Curve specification must be an object')
    kind = spec.get('kind')
    samples = spec.get('samples', 64)
    if type(samples) is not int or not 8 <= samples <= 512:
        raise ValueError('Curve samples must be an integer from 8 to 512')
    normalized = {'kind': kind, 'samples': samples}
    if kind == 'line':
        _fields(spec, ('kind', 'points'), ('samples',))
        points = _vectors(spec['points'], 'points', 2, 2)
        curve = u.create_line_segment(*[tuple(point) for point in points])
        normalized['points'] = points
    elif kind in ('circle', 'arc'):
        required = ('kind', 'center', 'radius') + (('startAngle', 'endAngle') if kind == 'arc' else ())
        _fields(spec, required, ('samples', 'rotation'))
        center = _vector(spec['center'], 'center')
        radius = _number(spec['radius'], 'radius', .001, 12.)
        rotation = _vector(spec.get('rotation', [0, 0, 0]), 'rotation', 360.)
        normalized.update(center=center, radius=radius, rotation=rotation)
        if kind == 'circle':
            curve = u.create_circle(tuple(center), radius)
        else:
            start = _number(spec['startAngle'], 'start angle', -360., 360.)
            end = _number(spec['endAngle'], 'end angle', -360., 360.)
            if not 1e-5 <= end - start < 360.:
                raise ValueError('Arc must have a positive sweep below 360 degrees; use circle for a full ring')
            normalized.update(startAngle=start, endAngle=end)
            curve = u.create_arc(tuple(center), radius, start, end)
        for axis, angle in zip(((1., 0., 0.), (0., 1., 0.), (0., 0., 1.)), rotation):
            if angle:
                u.rotate(curve, tuple(center), axis, angle)
    elif kind in ('bezier', 'bspline'):
        _fields(spec, ('kind', 'controlPoints') + (('degree',) if kind == 'bspline' else ()), ('samples',))
        points = _vectors(spec['controlPoints'], 'controlPoints', 2, 9 if kind == 'bezier' else 32)
        degree = len(points) - 1 if kind == 'bezier' else spec['degree']
        if type(degree) is not int or not 1 <= degree < len(points) or degree > (8 if kind == 'bezier' else 5):
            raise ValueError('Invalid B-spline degree; expected 1–5 and fewer than the control points')
        internal_count = len(points) - degree - 1
        knots = [0.] + [(i + 1) / (internal_count + 1) for i in range(internal_count)] + [1.]
        multiplicities = [degree + 1] + [1] * internal_count + [degree + 1]
        curve = u.create_canonical_curve([tuple(point) for point in points], knots, multiplicities, degree=degree)
        normalized['controlPoints'] = points
        if kind == 'bspline':
            normalized['degree'] = degree
    else:
        raise ValueError('Unsupported curve kind; use line, circle, arc, bezier or bspline')
    return curve, normalized


def handle_curve(u, spec):
    curve, normalized = build_curve(u, spec)
    start, end = curve.parameter_range()
    if not all(math.isfinite(x) for x in (start, end)) or end <= start:
        raise ValueError('SMLib returned an invalid curve parameter range')
    samples = normalized['samples']
    points = [list(curve.evaluate(start + (end - start) * i / samples)) for i in range(samples + 1)]
    for point in points:
        _vector(point, 'evaluated coordinates', 100.000001)
    length = curve.length(1e-7)
    if not math.isfinite(length) or length < 1e-8:
        raise ValueError('Curve has zero or invalid length')
    lower = [min(point[k] for point in points) for k in range(3)]
    upper = [max(point[k] for point in points) for k in range(3)]
    return {'schema': 'summer-cad-curve/1', 'kernel': 'SMLib', 'version': version('usd-brep'),
            'spec': normalized, 'points': points, 'closed': bool(curve.is_closed(1e-7)),
            'length': length, 'parameterRange': [start, end],
            'bounds': {'lower': lower, 'upper': upper}, 'boundsApproximate': True}
