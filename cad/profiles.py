"""Validated closed polygon profiles for native capped SMLib sweeps.

Extrusion uses an XY profile with Z in [-depth/2, depth/2]. Revolution uses
profile coordinates (radius, y), about +Y from +X toward -Z. A profile contains
one simple polygon, with implicit closing; holes are separate CSG features.
"""
import math


def _cross(a, b, c):
    return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])


def _on_segment(a, b, p, point_epsilon, cross_epsilon):
    return abs(_cross(a, b, p)) <= cross_epsilon and all(
        min(a[k], b[k])-point_epsilon <= p[k] <= max(a[k], b[k])+point_epsilon for k in range(2))


def _intersects(a, b, c, d, point_epsilon, cross_epsilon):
    ab_c, ab_d, cd_a, cd_b = _cross(a, b, c), _cross(a, b, d), _cross(c, d, a), _cross(c, d, b)
    if ((ab_c > cross_epsilon and ab_d < -cross_epsilon) or (ab_c < -cross_epsilon and ab_d > cross_epsilon)) and (
            (cd_a > cross_epsilon and cd_b < -cross_epsilon) or (cd_a < -cross_epsilon and cd_b > cross_epsilon)):
        return True
    return any((_on_segment(a, b, c, point_epsilon, cross_epsilon),
                _on_segment(a, b, d, point_epsilon, cross_epsilon),
                _on_segment(c, d, a, point_epsilon, cross_epsilon),
                _on_segment(c, d, b, point_epsilon, cross_epsilon)))


def validate_profile(profile, *, radial=False):
    if not isinstance(profile, list) or not 3 <= len(profile) <= 32:
        raise ValueError('Closed profile requires 3–32 polygon vertices')
    if any(not isinstance(point, list) or len(point) != 2 or any(
            type(x) not in (int, float) or not math.isfinite(x) or abs(x) > 6 for x in point) for point in profile):
        raise ValueError('Profile coordinates must be finite pairs within ±6 m')
    points = [[float(x) for x in point] for point in profile]
    if radial and any(point[0] < 0 for point in points):
        raise ValueError('Revolution radius coordinates must be nonnegative; profiles cannot cross the axis')
    spans = [max(point[k] for point in points)-min(point[k] for point in points) for k in range(2)]
    if any(span < .01-1e-12 or span > 12+1e-12 for span in spans):
        raise ValueError('Profile spans must be 0.01–12 m in both directions')
    scale = max(1., *spans)
    point_epsilon, cross_epsilon = 1e-10*scale, 1e-10*scale*scale
    count = len(points)
    for i, point in enumerate(points):
        if any(math.dist(point, earlier) <= point_epsilon for earlier in points[:i]):
            raise ValueError('Profile vertices cannot repeat; closing the polygon is implicit')
        a, c = points[(i-1) % count], points[(i+1) % count]
        if abs(_cross(a, point, c)) <= cross_epsilon and sum((a[k]-point[k])*(c[k]-point[k]) for k in range(2)) > point_epsilon**2:
            raise ValueError('Adjacent profile edges cannot overlap or backtrack')
        for j in range(i+1, count):
            if j == i+1 or (i == 0 and j == count-1):
                continue
            if _intersects(point, points[(i+1) % count], points[j], points[(j+1) % count], point_epsilon, cross_epsilon):
                raise ValueError('Profile edges cannot intersect or touch except at adjacent endpoints')
    twice_area = sum(points[i][0]*points[(i+1) % count][1]-points[(i+1) % count][0]*points[i][1] for i in range(count))
    if abs(twice_area) <= cross_epsilon:
        raise ValueError('Profile must enclose a nonzero area')
    return points, twice_area


def build_profile(u, item):
    """Return a native manifold candidate, before common placement transforms."""
    shape = item.get('shape')
    field = 'depth' if shape == 'extrude' else 'angle'
    if shape not in ('extrude', 'revolve') or set(item) != {'shape', 'operation', 'center', 'rotation', 'profile', field}:
        raise ValueError('Invalid extrude/revolve feature fields')
    value = item[field]
    low, high = (.01, 12.) if shape == 'extrude' else (1., 360.)
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'Profile {field} must be {low:g}–{high:g}')
    profile, area = validate_profile(item['profile'], radial=shape == 'revolve')
    # Keep the persisted recipe untouched; native edge orientation is canonical.
    if area < 0:
        profile.reverse()
    z = -value/2 if shape == 'extrude' else 0.
    vertices = [(x, y, z) for x, y in profile]
    curves = [u.create_line_segment(vertices[i], vertices[(i+1) % len(vertices)]) for i in range(len(vertices))]
    if shape == 'extrude':
        return u.linear_sweep(curves, (0., 0., 1.), value, cap_ends=True)
    return u.rotational_sweep(curves, (0., 0., 0.), (0., 1., 0.), value, cap_ends=True)
