"""GPU-resident APIC-grid attachments and rigid contact.

Independent row preparation runs in parallel. The small, coupled constraint
system uses ordered Gauss-Seidel on device, matching the CPU reference rather
than racing overlapping stencils or treating shared rigid bodies independently.
Only rigid impulses/poses (and fluid boundary samples, when present) cross IPC.
"""
import numpy as np
import taichi as ti
from solver import N

L = .025
MAX_POINTS = 16384
MAX_BODIES = 64


@ti.data_oriented
class RegionConstraints:
    def __init__(self, project):
        self.project = project
        self.s = project.s
        self.body = ti.field(ti.f32, shape=(MAX_BODIES, 28))
        self.binding = ti.field(ti.i32, shape=MAX_POINTS)
        self.pid = ti.field(ti.i32, shape=MAX_POINTS)
        self.region = ti.field(ti.i32, shape=MAX_POINTS)
        self.local = ti.Vector.field(3, ti.f32, shape=MAX_POINTS)
        # body index, mode, member count, stiffness, damping
        self.parameters = ti.field(ti.f32, shape=(64, 5))
        self.frame_rotation = ti.Matrix.field(3, 3, ti.f32, shape=64)
        self.axes = ti.Matrix.field(3, 3, ti.f32, shape=64)
        self.base = ti.Vector.field(3, ti.i32, shape=MAX_POINTS)
        self.weights = ti.Matrix.field(3, 3, ti.f32, shape=MAX_POINTS)
        self.error = ti.Vector.field(3, ti.f32, shape=MAX_POINTS)
        self.arm = ti.Vector.field(3, ti.f32, shape=MAX_POINTS)
        self.effective = ti.Vector.field(3, ti.f32, shape=MAX_POINTS)
        self.inv_grid = ti.field(ti.f32, shape=MAX_POINTS)
        self.lambdas = ti.Vector.field(3, ti.f32, shape=MAX_POINTS)
        self.active = ti.field(ti.i32, shape=MAX_POINTS)
        self.reaction = ti.Vector.field(3, ti.f32, shape=(MAX_BODIES, 4))
        # region force impulse, torque impulse, step work, body work,
        # positive hard-constraint work, cumulative net work
        self.stats = ti.field(ti.f64, shape=(64, 10))
        self.conflict = ti.field(ti.i32, shape=())
        self.mask = ti.Vector.field(2, ti.u32, shape=(N, N, N))
        self.contact_nodes = ti.Vector.field(3, ti.i32, shape=N**3)
        self.contact_count = ti.field(ti.i32, shape=())
        self.before_fluid = ti.Vector.field(3, ti.f32, shape=MAX_POINTS)
        self.fluid_ids = ti.field(ti.i32, shape=MAX_POINTS)
        self.fluid_size = ti.field(ti.i32, shape=())
        self.count = 0
        self.definitions = []
        self.members = []
        self.fluid_count = 0

    def initialize(self, result, seed):
        self.definitions = result['attachments']
        self.members = []
        rows = []
        parameters = np.zeros((64, 5), np.float32)
        rotations = np.zeros((64, 3, 3), np.float32)
        binding = np.full(MAX_POINTS, -1, np.int32)
        for k, definition in enumerate(self.definitions):
            ids = np.flatnonzero(seed[:, 13].astype(np.int32) == k)
            local = seed[ids, 14:17].copy()
            self.members.append((ids, local))
            rows.extend((int(i), k, *p) for i, p in zip(ids, local))
            binding[ids] = k
            parameters[k] = [definition['bodyIndex'], ['bind','elastic','slide'].index(definition['mode']), len(ids), definition['stiffness'], definition['damping']]
            rotations[k] = np.array(definition['rotation'], np.float32).reshape(3, 3)
        self.count = len(rows)
        self.active.fill(1)
        self.binding.from_numpy(binding)
        self.parameters.from_numpy(parameters)
        self.frame_rotation.from_numpy(rotations)
        self.load_members(np.array(rows, np.float32).reshape(-1, 5))
        self.stats.fill(0)
        self.load_bodies(np.array(result['rigidState'], np.float32).reshape(-1))
        ids = np.flatnonzero((seed[:, 12] == 2) | (seed[:, 17] > .5)).astype(np.int32)
        self.fluid_count = len(ids)
        padded = np.zeros(MAX_POINTS, np.int32); padded[:len(ids)] = ids
        self.fluid_ids.from_numpy(padded)
        self.fluid_size[None] = len(ids)

    @ti.kernel
    def update_phases(self,n:ti.i32,rows:ti.i32):
        for row in range(rows):
            i=self.pid[row]
            if self.active[row] and not self.s.is_solid(i):
                self.active[row]=0;self.binding[i]=-1
        self.fluid_size[None]=0
        for i in range(n):
            if not self.s.is_solid(i):
                slot=ti.atomic_add(self.fluid_size[None],1)
                self.fluid_ids[slot]=i

    @ti.kernel
    def load_members(self, rows: ti.types.ndarray(dtype=ti.f32, ndim=2)):
        for k in range(rows.shape[0]):
            self.pid[k] = ti.cast(rows[k, 0], ti.i32)
            self.region[k] = ti.cast(rows[k, 1], ti.i32)
            self.local[k] = ti.Vector([rows[k, a+2] for a in ti.static(range(3))])

    @ti.kernel
    def load_bodies(self, rows: ti.types.ndarray(dtype=ti.f32, ndim=1)):
        for k in range(rows.shape[0]):
            self.body[k//28, k%28] = rows[k]

    @ti.func
    def vector(self, b, offset):
        return ti.Vector([self.body[b, offset+a] for a in ti.static(range(3))])

    @ti.func
    def quaternion(self, b):
        return ti.Vector([self.body[b, 4+a] for a in ti.static(range(4))])

    @ti.func
    def inverse_inertia(self, b):
        return ti.Matrix([[self.body[b, 18+a*3+c] for c in ti.static(range(3))] for a in ti.static(range(3))])

    @ti.func
    def body_velocity(self, b, arm):
        return self.vector(b, 11) + self.vector(b, 14).cross(arm)

    @ti.func
    def apply_body(self, b, impulse, torque, contact):
        if self.body[b, 17] > 0:
            v = self.vector(b, 11) + impulse*self.body[b, 17]
            w = self.vector(b, 14) + self.inverse_inertia(b)@torque
            for a in ti.static(range(3)):
                self.body[b, 11+a] = v[a]
                self.body[b, 14+a] = w[a]
        self.reaction[b, 0] += impulse
        self.reaction[b, 1] += torque
        if contact:
            self.reaction[b, 2] += impulse
            self.reaction[b, 3] += torque

    @ti.kernel
    def begin(self, reset_interval: ti.i32):
        for b, k in self.reaction:
            self.reaction[b, k] = ti.Vector.zero(ti.f32, 3)
        for r, k in self.stats:
            if reset_interval and k < 9:
                self.stats[r, k] = 0
        self.conflict[None] = 0

    @ti.kernel
    def prepare(self, count: ti.i32, regions: ti.i32):
        for r in range(regions):
            b = ti.cast(self.parameters[r, 0], ti.i32)
            for a in ti.static(range(3)):
                axis = self.project.rotate(self.quaternion(b), self.frame_rotation[r][:, a])
                for k in ti.static(range(3)):
                    self.axes[r][k, a] = axis[k]
        for row in range(count):
            if not self.active[row]:continue
            i, r = self.pid[row], self.region[row]
            b = ti.cast(self.parameters[r, 0], ti.i32)
            p = self.s.x[i]*L
            arm = p-self.vector(b, 1)
            self.arm[row] = arm
            self.error[row] = arm-self.project.rotate(self.quaternion(b), self.local[row])
            base = ti.cast(ti.floor((self.s.x[i]-self.s.mpm_origin[None])/self.s.mpm_h[None]-.5), ti.i32)
            fx = (self.s.x[i]-self.s.mpm_origin[None])/self.s.mpm_h[None]-base
            w = self.s.weights(fx)
            self.base[row], self.weights[row] = base, w
            inv_grid = 0.
            for x, y, z in ti.ndrange(3, 3, 3):
                I = base + ti.Vector([x, y, z])
                weight = w[x, 0]*w[y, 1]*w[z, 2]
                if weight > 1e-12:
                    mass=self.s.gmass[I];fixed=self.s.fixed[I]
                    if self.project.multi.enabled[None]:
                        part=self.s.lab.part[i]-1
                        mass=self.project.pairs.mass[part,I[0],I[1],I[2]]
                        fixed=self.project.multi.fixed[part,I[0],I[1],I[2]]
                    if fixed:
                        self.conflict[None] = 1
                    if mass > 1e-12:
                        inv_grid += weight*weight/mass
            self.inv_grid[row] = inv_grid
            for a in ti.static(range(3)):
                axis = self.axes[r][:, a]
                cross = arm.cross(axis)
                self.effective[row][a] = inv_grid+self.body[b, 17]+cross.dot(self.inverse_inertia(b)@cross)
            self.lambdas[row] = ti.Vector.zero(ti.f32, 3)

    @ti.kernel
    def solve(self, count: ti.i32, iterations: ti.i32, dt: ti.f32, spacing: ti.f32):
        # Ordered updates are essential: different regions share grid stencils
        # and may share a free rigid body. Never atomically apply a stale solve.
        ti.loop_config(serialize=True)
        for iteration in range(iterations):
            for row in range(count):
                if self.conflict[None] == 0 and self.active[row]:
                    r = self.region[row]
                    b = ti.cast(self.parameters[r, 0], ti.i32)
                    mode = ti.cast(self.parameters[r, 1], ti.i32)
                    k = self.parameters[r, 3]/self.parameters[r, 2]
                    c = self.parameters[r, 4]/self.parameters[r, 2]
                    gamma = 0.
                    if mode == 1:
                        gamma = 1/(dt*(c+dt*k))
                    # Gather/scatter once per material point. The three axes
                    # update the interpolated velocity by W_grid * J locally;
                    # this is the same ordered solve, with fewer device loads.
                    v = ti.Vector.zero(ti.f32, 3)
                    w, base = self.weights[row], self.base[row]
                    for x, y, z in ti.static(ti.ndrange(3, 3, 3)):
                        I = base+ti.Vector([x, y, z])
                        weight = w[x, 0]*w[y, 1]*w[z, 2]
                        gv=self.s.gv[I]
                        if self.project.pairs.enabled[None]:
                            part=self.s.lab.part[self.pid[row]]-1
                            gv+=self.project.pairs.delta[part,I[0],I[1],I[2]]
                        v += weight*gv*L
                    linear, angular = self.vector(b, 11), self.vector(b, 14)
                    inv_inertia, inv_mass = self.inverse_inertia(b), self.body[b, 17]
                    arm, error_vector = self.arm[row], self.error[row]
                    inv_grid, effective = self.inv_grid[row], self.effective[row]
                    total_J, total_torque = ti.Vector.zero(ti.f32, 3), ti.Vector.zero(ti.f32, 3)
                    lambdas = self.lambdas[row]
                    net_work, rigid_work, positive_work = 0., 0., 0.
                    for a in range(3):
                        if mode != 2 or a < 2:
                            axis = self.axes[r][:, a]
                            vb = linear+angular.cross(arm)
                            relative = (v-vb).dot(axis)
                            error = error_vector.dot(axis)
                            bias = ti.min(spacing*.1/dt, ti.max(-spacing*.1/dt, .15*error/dt))
                            if mode == 1:
                                bias = k*error/(c+dt*k)
                            impulse = -(relative+bias+gamma*lambdas[a])/(effective[a]+gamma)
                            lambdas[a] += impulse
                            J = axis*impulse
                            work = impulse*relative+.5*impulse*impulse*effective[a]
                            rigid_work += -J.dot(vb)+.5*impulse*impulse*(effective[a]-inv_grid)
                            torque = -arm.cross(J)
                            total_J += J; total_torque += torque
                            v += inv_grid*J
                            linear -= inv_mass*J; angular += inv_inertia@torque
                            net_work += work
                            if mode != 1:
                                positive_work += ti.max(0., work)
                    for x, y, z in ti.static(ti.ndrange(3, 3, 3)):
                        I = base+ti.Vector([x, y, z])
                        weight = w[x, 0]*w[y, 1]*w[z, 2]
                        if weight > 1e-12:
                            if self.project.multi.enabled[None]:
                                part=self.s.lab.part[self.pid[row]]-1;mass=self.project.pairs.mass[part,I[0],I[1],I[2]]
                                if mass>1e-12:self.project.pairs.delta[part,I[0],I[1],I[2]]+=weight*total_J/(mass*L)
                            elif self.s.gmass[I]>1e-12:self.s.gv[I]+=weight*total_J/(self.s.gmass[I]*L)
                    self.lambdas[row] = lambdas
                    for a in ti.static(range(3)):
                        self.body[b, 11+a] = linear[a]
                        self.body[b, 14+a] = angular[a]
                        self.stats[r, a] -= ti.cast(total_J[a], ti.f64)
                        self.stats[r, a+3] += ti.cast(total_torque[a], ti.f64)
                    self.reaction[b, 0] -= total_J
                    self.reaction[b, 1] += total_torque
                    self.stats[r, 6] += ti.cast(net_work, ti.f64)
                    self.stats[r, 7] += ti.cast(rigid_work, ti.f64)
                    self.stats[r, 8] += ti.cast(positive_work, ti.f64)
                    self.stats[r, 9] += ti.cast(net_work, ti.f64)

    @ti.func
    def ignores(self, i, b):
        ignore = False
        r = self.binding[i]
        if r >= 0:
            ignore = ti.cast(self.parameters[r, 0], ti.i32) == b
        return ignore

    @ti.kernel
    def mark_contacts(self, n: ti.i32, bodies: ti.i32, band: ti.f32):
        for I in ti.grouped(self.mask):
            self.mask[I] = ti.Vector([ti.u32(0), ti.u32(0)])
        for i in range(n):
            if self.s.is_solid(i) and not self.s.pinned[i]:
                point = self.s.x[i]*L
                for b in range(bodies):
                    if not self.ignores(i, b):
                        center, half = self.vector(b, 1), self.vector(b, 8)
                        if (point-center).norm_sqr() <= (half.norm()+band)**2:
                            distance, normal = self.project.surface(point, ti.cast(self.body[b, 0], ti.i32), center, self.quaternion(b), half)
                            if distance <= band:
                                base = ti.cast(ti.floor((self.s.x[i]-self.s.mpm_origin[None])/self.s.mpm_h[None]-.5), ti.i32)
                                for x, y, z in ti.ndrange(3, 3, 3):
                                    I = base+ti.Vector([x, y, z])
                                    ti.atomic_or(self.mask[I][b//32], ti.u32(1) << (b%32))
        self.contact_count[None] = 0
        for I in ti.grouped(self.mask):
            if (self.mask[I][0] != 0 or self.mask[I][1] != 0) and self.s.gmass[I] > 1e-12 and not self.s.fixed[I]:
                k = ti.atomic_add(self.contact_count[None], 1)
                self.contact_nodes[k] = I

    @ti.kernel
    def contact(self, bodies: ti.i32, friction: ti.f32):
        ti.loop_config(serialize=True)
        for b in range(bodies):
            for node in range(self.contact_count[None]):
                I = self.contact_nodes[node]
                if (self.mask[I][b//32] & (ti.u32(1) << (b%32))) != 0:
                    point = (self.s.mpm_origin[None]+ti.cast(I, ti.f32)*self.s.mpm_h[None])*L
                    distance, normal = self.project.surface(point, ti.cast(self.body[b, 0], ti.i32), self.vector(b, 1), self.quaternion(b), self.vector(b, 8))
                    if distance <= self.s.mpm_h[None]*L*.25:
                        v = self.s.gv[I]*L
                        arm = point-self.vector(b, 1)
                        relative = v-self.body_velocity(b, arm)
                        vn = relative.dot(normal)
                        if vn < 0:
                            cross = arm.cross(normal)
                            W = 1/self.s.gmass[I]+self.body[b, 17]+cross.dot(self.inverse_inertia(b)@cross)
                            jn = -(1+self.body[b, 27])*vn/W
                            impulse = normal*jn
                            v += impulse/self.s.gmass[I]
                            self.apply_body(b, -impulse, -arm.cross(impulse), True)
                            slip = v-self.body_velocity(b, arm)
                            slip -= normal*slip.dot(normal)
                            speed = slip.norm()
                            if speed > 1e-12 and friction > 0:
                                tangent = slip/speed
                                cross = arm.cross(tangent)
                                Wt = 1/self.s.gmass[I]+self.body[b, 17]+cross.dot(self.inverse_inertia(b)@cross)
                                impulse = -tangent*ti.min(friction*jn, speed/Wt)
                                v += impulse/self.s.gmass[I]
                                self.apply_body(b, -impulse, -arm.cross(impulse), True)
                            self.s.gv[I] = v/L

    @ti.kernel
    def save_fluid_start(self, n: ti.i32):
        for i in range(n):
            self.before_fluid[i] = self.s.x[i]

    @ti.kernel
    def fluid_velocity(self, n: ti.i32, dt: ti.f32):
        for i in range(n):
            if self.s.is_solid(i):
                self.s.v[i] += (self.s.x[i]-self.before_fluid[i])/dt
            else:
                self.s.v[i] = (self.s.x[i]-self.s.old[i])/dt

    @ti.kernel
    def export_advance(self, bodies: ti.i32, fluids: ti.i32, out: ti.types.ndarray(dtype=ti.f32, ndim=1)):
        for b in range(bodies):
            for k, a in ti.static(ti.ndrange(4, 3)):
                out[b*12+k*3+a] = self.reaction[b, k][a]
        for row in range(fluids):
            i = self.fluid_ids[row]
            offset = bodies*12+row*8
            out[offset] = i
            out[offset+1] = self.s.material[i]+16*self.s.melted[i]
            for a in ti.static(range(3)):
                out[offset+2+a] = self.s.x[i][a]
                out[offset+5+a] = self.s.v[i][a]

    @ti.kernel
    def import_advance(self, bodies: ti.i32, fluids: ti.i32, values: ti.types.ndarray(dtype=ti.f32, ndim=1)):
        for k in range(bodies*28):
            self.body[k//28, k%28] = values[k]
        for row in range(fluids):
            i = self.fluid_ids[row];offset = bodies*28+row*6
            for a in ti.static(range(3)):
                self.s.x[i][a] = values[offset+a]
                self.s.v[i][a] = values[offset+3+a]

    @ti.kernel
    def cleanup(self, n: ti.i32, bodies: ti.i32, radius: ti.f32, mechanical: ti.i32):
        for i in range(n):
            if self.s.pinned[i]:
                self.s.x[i] = self.s.anchor[i]
                self.s.v[i] = ti.Vector.zero(ti.f32, 3)
            elif mechanical or self.project.pairs.enabled[None]:
                for b in range(bodies):
                    if not self.ignores(i, b) and self.project.pairs.params[b,self.s.lab.part[i]-1,0]>.5:
                        point = self.s.x[i]*L
                        center, half = self.vector(b, 1), self.vector(b, 8)
                        if (point-center).norm_sqr() <= (half.norm()+radius)**2:
                            distance, normal = self.project.surface(point, ti.cast(self.body[b, 0], ti.i32), center, self.quaternion(b), half)
                            depth = ti.max(0., radius-distance)
                            ti.atomic_max(self.project.penetration[None], depth)
                            if self.project.pairs.enabled[None]:ti.atomic_max(self.project.pairs.stats[b,self.s.lab.part[i]-1,12],ti.cast(depth,ti.f64))
                            self.s.x[i] += normal*ti.min(depth, self.s.mpm_h[None]*L*.25)/L

    def results(self, data, bodies, duration):
        stats = self.stats.to_numpy()
        binding = self.binding.to_numpy()
        results = []
        for k, definition in enumerate(self.definitions):
            body = bodies[definition['bodyIndex']]
            ids, local = self.members[k]
            initial_count=len(ids)
            retained=binding[ids]==k
            all_ids=ids
            ids,local=ids[retained],local[retained]
            q = np.array(body['rotation'], float)
            xyz, w = q[:3], q[3]
            def rotate(v):
                return v+2*np.cross(xyz, np.cross(xyz, v)+w*v)
            center = np.array(body['position'])
            target = center+rotate(local.astype(float))
            delta = data[ids, :3].astype(float)-target
            axis = rotate(np.array(definition['rotation']).reshape(3, 3)[:, 2])
            if definition['mode'] == 'slide':
                delta -= (delta@axis)[:, None]*axis
            result = dict(id=definition['id'], name=definition['name'], type='region', mode=definition['mode'],
                a=(center+rotate(np.array(definition['frame']['position']))).tolist(), b=data[ids if len(ids) else all_ids, :3].mean(axis=0).tolist(),
                axis=axis.tolist(), count=len(ids), initialCount=initial_count, releasedCount=initial_count-len(ids),
                state='active' if len(ids)==initial_count else 'partial' if len(ids) else 'released',
                error=float(np.linalg.norm(delta, axis=1).max()) if len(ids) else 0.,
                force=(stats[k, :3]/duration if duration else np.zeros(3)).tolist(),
                torque=(stats[k, 3:6]/duration if duration else np.zeros(3)).tolist(),
                power=float(stats[k, 6]/duration) if duration else 0,
                bodyPower=float(stats[k, 7]/duration) if duration else 0,
                positiveWork=float(stats[k, 8]), work=float(stats[k, 9]),
                elasticEnergy=float(.5*definition['stiffness']*np.sum(delta*delta)/initial_count) if definition['mode']=='elastic' else 0)
            results.append(result)
        return results
