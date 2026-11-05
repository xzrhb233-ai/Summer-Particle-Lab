"""Matches src/three/phase-change.js; thermal constants come from material 11."""
import math

DEFAULTS = dict(enabled=False, meltingPoint=120.0, latentHeat=120000.0)


def parameters(value=None):
    if value is None:
        value = {}
    if not isinstance(value, dict) or set(value)-set(DEFAULTS):
        return None
    p = {**DEFAULTS, **value}
    if not isinstance(p['enabled'], bool):
        return None
    for key, lo, hi in [('meltingPoint', -100, 2000), ('latentHeat', 1000, 2000000)]:
        v = p[key]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
            return None
    return [float(p['enabled']), p['meltingPoint'], p['latentHeat']]


def enthalpy_at(temperature, p, cp=1800):
    return cp*temperature+(p[2] if p[0] and temperature > p[1] else 0)
