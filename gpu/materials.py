"""Same material constants and enthalpy conventions as src/materials.js."""
import numpy as np

PROPERTIES = np.array([
    [2900,840,1.7,1], [2700,1200,1.5,0], [1000,4180,.6,0],
    [.6,2010,.025,0], [917,2100,2.2,1], [7870,450,80,1],
    [1600,830,.27,0], [7850,450,50,1], [1100,1800,.13,1],
    [700,1400,.12,1], [7000,820,30,0], [1100,1800,.13,1],
], dtype=np.float64)
TEMPERATURES = [90,1250,18,130,-12,65,22,20,20,20,1650,20]


def enthalpy_at(material, temperature):
    if material == 4:
        return 2100 * temperature
    if material == 2:
        return 334000 + 4180 * temperature
    if material == 3:
        return 3008000 + 2010 * (temperature - 100)
    if material == 1:
        return 1240000 + 1200 * (temperature - 1000)
    if material == 10:
        return 939100 + 820 * (temperature - 1538)
    return PROPERTIES[material, 1] * temperature
