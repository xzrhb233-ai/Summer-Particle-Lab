"""Constrained Tet4 meshes of closed SMLib tessellations (never a bounding-box fill)."""
import math
from collections import defaultdict, deque
from importlib.metadata import version

import numpy as np

MAX_NODES = 5000
MAX_ELEMENTS = 24000


def _closed_surface(vertices, indices):
    """Weld per-face CAD seam vertices and orient each closed surface component."""
    if not isinstance(vertices, (list, tuple)) or not 4 <= len(vertices) <= 50000:
        raise ValueError('Volume mesh requires 4–50000 surface vertices')
    points = np.asarray(vertices, dtype=float)
    if points.shape != (len(vertices), 3) or not np.isfinite(points).all():
        raise ValueError('Invalid volume mesh surface coordinates')
    if not isinstance(indices, (list, tuple)) or len(indices) % 3 or not 12 <= len(indices) <= 300000:
        raise ValueError('Invalid triangular mesh connectivity')
    if any(type(i) is not int or not 0 <= i < len(points) for i in indices):
        raise ValueError('Invalid triangle vertex index')
    extent = float(np.linalg.norm(np.ptp(points, axis=0)))
    tolerance = max(extent * 1e-9, 1e-11)
    welded, remap, buckets = [], [], defaultdict(list)
    for point in points:
        key = tuple(math.floor(float(x) / tolerance) for x in point)
        found = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for candidate in buckets[(key[0] + dx, key[1] + dy, key[2] + dz)]:
                        if np.max(np.abs(point - welded[candidate])) <= tolerance:
                            found = candidate
                            break
                    if found is not None:
                        break
                if found is not None:
                    break
            if found is not None:
                break
        if found is None:
            found = len(welded)
            welded.append(point)
            buckets[key].append(found)
        remap.append(found)
    if len(welded) > MAX_NODES:
        raise ValueError('CAD surface exceeds 5000 FEM nodes; use a coarser surface tolerance')
    points = np.asarray(welded)
    faces, unique = [], set()
    for offset in range(0, len(indices), 3):
        face = [remap[i] for i in indices[offset:offset + 3]]
        if len(set(face)) != 3:
            continue  # native sphere pole/seam degeneracies vanish under welding
        key = tuple(sorted(face))
        if key in unique:
            raise ValueError('CAD surface contains duplicate triangles')
        unique.add(key)
        a, b, c = points[face]
        if np.linalg.norm(np.cross(b - a, c - a)) <= tolerance ** 2:
            raise ValueError('CAD surface has a degenerate triangle')
        faces.append(face)
    edges = defaultdict(list)
    for index, (a, b, c) in enumerate(faces):
        for i, j in ((a, b), (b, c), (c, a)):
            edges[tuple(sorted((i, j)))].append((index, 1 if i < j else -1))
    if not faces or any(len(edge) != 2 for edge in edges.values()):
        raise ValueError('Volume mesh requires a closed, manifold surface without open edges')
    adjacent = defaultdict(list)
    for (i, si), (j, sj) in edges.values():
        adjacent[i].append((j, -si * sj))
        adjacent[j].append((i, -si * sj))
    signs, components = {}, []
    for first in range(len(faces)):
        if first in signs:
            continue
        signs[first] = 1
        queue, component = deque([first]), []
        while queue:
            index = queue.popleft()
            component.append(index)
            for other, multiplier in adjacent[index]:
                target = signs[index] * multiplier
                if other in signs and signs[other] != target:
                    raise ValueError('CAD surface is not consistently orientable')
                if other not in signs:
                    signs[other] = target
                    queue.append(other)
        components.append(component)
    for i, sign in signs.items():
        if sign < 0:
            faces[i][1], faces[i][2] = faces[i][2], faces[i][1]
    faces = np.asarray(faces, dtype=int)
    for component in components:
        triangles = points[faces[component]]
        origin = triangles[0, 0]
        shifted = triangles - origin
        signed_volume = np.einsum('ij,ij->i', shifted[:, 0], np.cross(shifted[:, 1], shifted[:, 2])).sum() / 6
        if abs(signed_volume) < extent ** 3 * 1e-14:
            raise ValueError('CAD surface encloses zero volume')
        if signed_volume < 0:
            faces[component] = faces[component][:, [0, 2, 1]]
    return points, faces, components, extent


def _inside_shell(point, triangles):
    """Solid-angle winding handles nonconvex shells without a ray-edge ambiguity."""
    a, b, c = (triangles[:, i] - point for i in range(3))
    la, lb, lc = (np.linalg.norm(v, axis=1) for v in (a, b, c))
    numerator = np.einsum('ij,ij->i', a, np.cross(b, c))
    denominator = la * lb * lc + np.einsum('ij,ij->i', a, b) * lc + np.einsum('ij,ij->i', b, c) * la + np.einsum('ij,ij->i', c, a) * lb
    return abs(float(np.arctan2(numerator, denominator).sum())) > math.pi


def _cavity_seeds(points, faces, components, extent):
    shells = [points[faces[component]] for component in components]
    holes, surface_volume = [], 0.
    for i, triangles in enumerate(shells):
        cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
        magnitudes = np.linalg.norm(cross, axis=1)
        face_index = int(np.argmax(magnitudes))
        center = triangles[face_index].mean(axis=0)
        depth = sum(_inside_shell(center, other) for j, other in enumerate(shells) if i != j)
        shifted = triangles - triangles[0, 0]
        shell_volume = float(np.einsum('ij,ij->i', shifted[:, 0], np.cross(shifted[:, 1], shifted[:, 2])).sum() / 6)
        surface_volume += (-1 if depth % 2 else 1) * shell_volume
        if depth % 2:
            normal = cross[face_index] / magnitudes[face_index]
            # Move just inside an inner shell, not to its potentially exterior centroid.
            seed = center - normal * max(extent * 1e-7, 1e-10)
            if not _inside_shell(seed, triangles):
                raise ValueError('Unable to locate an enclosed CAD cavity reliably')
            holes.append(seed.tolist())
    return holes, surface_volume


def _element_data(nodes, elements, extent):
    triangles_by_face = {}
    tets = np.asarray(elements, dtype=int)
    points = np.asarray(nodes, dtype=float)
    x = points[tets]
    determinants = np.einsum('ij,ij->i', x[:, 1] - x[:, 0], np.cross(x[:, 2] - x[:, 0], x[:, 3] - x[:, 0]))
    negative = determinants < 0
    tets[negative] = tets[negative][:, [1, 0, 2, 3]]
    volumes = np.abs(determinants) / 6
    if not np.isfinite(volumes).all() or (volumes <= max(extent ** 3 * 1e-14, 1e-18)).any():
        raise ValueError('Tetrahedralization produced a zero-volume or degenerate element')
    x = points[tets]
    edge_sum = np.zeros(len(tets))
    for i in range(4):
        for j in range(i + 1, 4):
            edge_sum += np.sum((x[:, i] - x[:, j]) ** 2, axis=1)
    mean_ratios = 12 * (3 * volumes) ** (2 / 3) / edge_sum
    max_areas = np.zeros(len(tets))
    for local_face in ((1, 2, 3), (0, 3, 2), (0, 1, 3), (0, 2, 1)):
        a, b, c = (x[:, i] for i in local_face)
        max_areas = np.maximum(max_areas, np.linalg.norm(np.cross(b - a, c - a), axis=1) / 2)
        for face in tets[:, local_face].tolist():
            key = tuple(sorted(face))
            if key in triangles_by_face:
                previous, count = triangles_by_face[key]
                if count >= 2:
                    raise ValueError('Generated tetrahedra have a non-manifold internal face')
                triangles_by_face[key] = (previous, count + 1)
            else:
                triangles_by_face[key] = (face, 1)
    if float(mean_ratios.min()) < 1e-4:
        raise ValueError('Generated mesh contains unusable sliver elements; adjust mesh size or CAD features')
    surface = [face for face, count in triangles_by_face.values() if count == 1]
    return tets.tolist(), surface, volumes, {
        'minMeanRatio': float(mean_ratios.min()),
        'meanMeanRatio': float(mean_ratios.mean()),
        'minAltitude': float((3 * volumes / max_areas).min()),
        'minElementVolume': float(volumes.min()),
        'maxElementVolume': float(volumes.max()),
        'negativeElements': 0,
        'degenerateElements': 0,
    }


def mesh_volume(vertices, indices, options=None, *, exact_volume=None, recipe=None):
    """Generate a quality Tet4 mesh respecting the supplied closed triangular PLC.

    targetSize is an edge-length scale in metres: the refinement volume target
    equals that of an equilateral tetrahedron of that edge length. TetGen's final
    quality optimization can enlarge individual elements beyond that target.
    This is not a guarantee on every edge length or element volume.
    """
    from meshpy.tet import MeshInfo, Options, build
    options = {} if options is None else options
    if not isinstance(options, dict) or set(options) - {'targetSize'}:
        raise ValueError('Unsupported volume mesh options; only targetSize is configurable')
    points, faces, components, extent = _closed_surface(vertices, indices)
    target_size = options.get('targetSize', float(np.ptp(points, axis=0).max()) / 8)
    if type(target_size) not in (int, float) or not math.isfinite(target_size) or not .005 <= target_size <= 12:
        raise ValueError('FEM targetSize must be 0.005–12 m')
    max_volume = float(target_size) ** 3 / (6 * math.sqrt(2))
    holes, surface_volume = _cavity_seeds(points, faces, components, extent)
    if surface_volume <= 0:
        raise ValueError('CAD surface has no positive material volume')
    if surface_volume / max_volume > MAX_ELEMENTS * .75:
        raise ValueError('Requested mesh size exceeds 24000 Tet4 elements; increase targetSize')
    info = MeshInfo()
    info.set_points(points.tolist())
    info.set_facets(faces.tolist())
    if holes:
        info.set_holes(holes)
    # A hard Steiner-point budget supplements the enclosing worker's timeout.
    settings = Options('pq2Q', steinerleft=MAX_NODES - len(points))
    output = build(info, settings, max_volume=max_volume)
    nodes = [list(point) for point in output.points]
    elements = [list(element) for element in output.elements]
    if not elements:
        raise ValueError('TetGen could not form a volume mesh')
    if len(nodes) > MAX_NODES or len(elements) > MAX_ELEMENTS:
        raise ValueError('Generated mesh exceeds 5000 nodes / 24000 elements; increase targetSize')
    # TetGen may keep unused input points at a removed void; compact these out.
    used = sorted(set(i for element in elements for i in element))
    if len(used) != len(nodes):
        mapping = {old: new for new, old in enumerate(used)}
        nodes = [nodes[i] for i in used]
        elements = [[mapping[i] for i in element] for element in elements]
    elements, surface, volumes, quality = _element_data(nodes, elements, extent)
    volume = float(volumes.sum())
    if abs(volume - surface_volume) > max(surface_volume * 1e-7, 1e-12):
        raise ValueError('Generated volume does not match the closed CAD surface; cavities were not preserved')
    if len(nodes) >= MAX_NODES and quality['maxElementVolume'] > max_volume * 1.5:
        raise ValueError('Node capacity prevented the requested mesh resolution; increase targetSize')
    quality['targetElementVolume'] = max_volume
    if exact_volume is not None and (not math.isfinite(exact_volume) or exact_volume <= 0):
        raise ValueError('Invalid exact CAD volume')
    relative_error = abs(volume - exact_volume) / exact_volume if exact_volume else None
    if relative_error is not None and relative_error > .1:
        raise ValueError('Triangulated volume differs from SMLib by over 10%; refine the surface tolerance')
    return {
        'schema': 'summer-cad-mesh/1', 'kind': 'volume', 'generator': 'TetGen via MeshPy',
        'generatorVersion': version('meshpy'), 'coordinates': 'cad',
        'nodes': nodes, 'elements': elements, 'surface': surface,
        'volume': volume, 'exactVolume': exact_volume, 'volumeRelativeError': relative_error,
        'surfaceVolume': surface_volume, 'cavityCount': len(holes),
        'options': {'targetSize': target_size}, 'quality': quality,
        'source': {'recipe': recipe},
    }
