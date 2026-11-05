"""GPU Barnes-Hut octree. Exact softened interactions in occupied leaf buckets.

Fixed six-level tree covers [-256,256)^3; leaves share the PBF CSR bins.
No neighbor truncation, per-particle stacks, or CPU particle readback.
"""
import taichi as ti

DEPTH = 6
LEAF = (8**DEPTH-1)//7
NODES = (8**(DEPTH+1)-1)//7
LEAVES = 8**DEPTH


@ti.data_oriented
class Gravity:
    def __init__(self, capacity):
        self.moment = ti.Vector.field(4, ti.f32, shape=NODES)
        self.code = ti.field(ti.i32, shape=capacity)
        self.acceleration = ti.Vector.field(3, ti.f32, shape=capacity)
        self.net = ti.Vector.field(5, ti.f64, shape=())

    @ti.kernel
    def deposit(self, n: ti.i32, x: ti.template(), mass: ti.template()):
        for k in range(LEAVES):
            self.moment[LEAF+k] = ti.Vector.zero(ti.f32, 4)
        for i in range(n):
            c = ti.cast(ti.min(63, ti.max(0, ti.floor((x[i]+256)/8))), ti.i32)
            code = 0
            for bit in range(DEPTH):
                code |= ((c[0] >> bit) & 1) << (3*bit)
                code |= ((c[1] >> bit) & 1) << (3*bit+1)
                code |= ((c[2] >> bit) & 1) << (3*bit+2)
            self.code[i] = code
            self.moment[LEAF+code] += ti.Vector([mass[i]*x[i][0], mass[i]*x[i][1], mass[i]*x[i][2], mass[i]])

    @ti.kernel
    def reduce(self, level: ti.i32):
        size = 1 << (3*level)
        for code in range(size):
            value = ti.Vector.zero(ti.f32, 4)
            for child in range(8):
                value += self.moment[(size*8-1)//7+code*8+child]
            self.moment[(size-1)//7+code] = value

    @ti.kernel
    def evaluate(self, n: ti.i32, x: ti.template(), mass: ti.template(), pinned: ti.template(),
                 counts: ti.template(), prefix: ti.template(), ids: ti.template(), grid_n: ti.i32, softening2: ti.f32):
        self.net[None] = ti.Vector.zero(ti.f64, 5)
        for i in range(n):
            a = ti.Vector.zero(ti.f32, 3)
            level, code = 0, 0
            while level >= 0:
                size = 1 << (3*level)
                m = self.moment[(size-1)//7+code]
                descend = False
                if m[3] > 0:
                    d = ti.Vector([m[0],m[1],m[2]])/m[3]-x[i]
                    width = 512.0/(1 << level)
                    contains = (self.code[i] >> (3*(DEPTH-level))) == code
                    if not contains and width*width < .49*d.norm_sqr():
                        a += 2.0*m[3]*d/(d.norm_sqr()+softening2)**1.5
                    elif level < DEPTH:
                        descend = True
                    else:
                        c = ti.Vector.zero(ti.i32,3)
                        for bit in range(DEPTH):
                            for axis in ti.static(range(3)):
                                c[axis] |= ((code >> (3*bit+axis)) & 1) << bit
                        c += 1  # PBF grid has one padding cell on each side.
                        cell = (c[2]*grid_n+c[1])*grid_n+c[0]
                        for slot in range(prefix[cell]-counts[cell],prefix[cell]):
                            j=ids[slot]
                            if j!=i:
                                r=x[j]-x[i]
                                a += 2.0*mass[j]*r/(r.norm_sqr()+softening2)**1.5
                if descend:
                    code *= 8
                    level += 1
                else:
                    while level > 0 and code % 8 == 7:
                        code //= 8
                        level -= 1
                    if level == 0:
                        level = -1
                    else:
                        code += 1
            self.acceleration[i]=a
            if not pinned[i]:
                self.net[None] += ti.cast(ti.Vector([mass[i]*a[0],mass[i]*a[1],mass[i]*a[2],mass[i],0.0]),ti.f64)
            else:
                self.net[None][4] += 1

    def build(self, solver):
        solver.clear_neighbors();solver.build_neighbors(solver.count)
        self.deposit(solver.count,solver.x,solver.mass)
        for level in range(DEPTH-1,-1,-1):
            self.reduce(level)
        from solver import N
        self.evaluate(solver.count,solver.x,solver.mass,solver.pinned,solver.counts,solver.prefix,solver.sorted_ids,N,solver.settings["gravitySoftening"]**2)
