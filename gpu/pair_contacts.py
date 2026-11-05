"""Per-part APIC fields and contact ledgers, including multi-material grids."""
import numpy as np
import taichi as ti
from solver import N
L=.025

@ti.data_oriented
class PairContacts:
    def __init__(self,project):
        self.project,self.s=project,project.s
        self.enabled=ti.field(ti.i32,shape=())
        # mechanics, thermal, friction, interface conductance
        self.params=ti.field(ti.f64,shape=(64,16,4))
        # Accumulating many float32 contributions in float64 greatly reduces
        # scheduling-order noise before G2P. Particle state remains float32.
        self.mass=ti.field(ti.f64,shape=(16,N,N,N))
        self.delta=ti.Vector.field(3,ti.f64,shape=(16,N,N,N))
        self.mask=ti.Vector.field(2,ti.u32,shape=(16,N,N,N))
        self.nodes=ti.Vector.field(4,ti.i32,shape=16384*27)
        self.count=ti.field(ti.i32,shape=())
        self.stats=ti.field(ti.f64,shape=(64,16,16))
        self.material_params=ti.field(ti.f64,shape=(16,16,6))
        self.material_stats=ti.field(ti.f64,shape=(16,16,16))
        self.definitions=[]
    def initialize(self,model,profiles):
        self.definitions=model['contactPairs']
        self.enabled[None]=int(bool(self.definitions))
        params=np.zeros((64,16,4),np.float64)
        for b,row in enumerate(profiles):
            for p,c in enumerate(row):
                params[b,p]=[int(c['mechanical']),int(c['thermal']),c['friction'],c['contactConductance']]
        self.params.from_numpy(params);self.stats.fill(0)
        self.body_ids=[b['id'] for b in model['bodies']]
        self.part_ids=[p['id'] for p in model['coupling']['parts']]
        materials=np.zeros((16,16,6),np.float64)
        c=model['coupling']
        for a,aid in enumerate(self.part_ids):
            for b,bid in enumerate(self.part_ids):
                definition=next((p for p in self.definitions if {p['a'],p['b']}=={aid,bid}),None)
                profile=definition or c
                materials[a,b]=[profile['mechanical'],profile['thermal'],profile['friction'],profile['contactConductance'],int(definition is not None),
                                int(c['parts'][a]['method']=='mpm' and c['parts'][b]['method']=='mpm')]
        self.material_params.from_numpy(materials);self.material_stats.fill(0)
        self.enabled[None]=int(bool(self.definitions) or len(self.part_ids)>1)
        # Only explicit overrides can keep interface heat enabled independently
        # of the global thermal switch. Inherited defaults are not overrides.
        self.thermal_active=any(c['thermal'] for c in self.definitions)

    @ti.kernel
    def begin(self):
        for b,p,k in self.stats:
            if k!=14:self.stats[b,p,k]=0.
        for a,b,k in self.material_stats:
            if k!=14:self.material_stats[a,b,k]=0.

    @ti.kernel
    def prepare(self,n:ti.i32,bodies:ti.i32,band:ti.f32):
        for I in ti.grouped(self.mass):
            if not self.project.multi.enabled[None]:
                self.mass[I]=0.;self.delta[I]=ti.Vector.zero(ti.f32,3)
            self.mask[I]=ti.Vector([ti.u32(0),ti.u32(0)])
        for i in range(n):
            if self.s.is_solid(i):
                part=self.s.lab.part[i]-1
                base=ti.cast(ti.floor((self.s.x[i]-self.s.mpm_origin[None])/self.s.mpm_h[None]-.5),ti.i32)
                fx=(self.s.x[i]-self.s.mpm_origin[None])/self.s.mpm_h[None]-base
                w=self.s.weights(fx);bits=ti.Vector([ti.u32(0),ti.u32(0)])
                if not self.s.pinned[i]:
                    point=self.s.x[i]*L;r=self.project.regions
                    for b in range(bodies):
                        if self.params[b,part,0]>.5 and not r.ignores(i,b):
                            center,half=r.vector(b,1),r.vector(b,8)
                            if (point-center).norm_sqr()<=(half.norm()+band)**2:
                                distance,normal=self.project.surface(point,ti.cast(r.body[b,0],ti.i32),center,r.quaternion(b),half)
                                if distance<=band:bits[b//32]|=ti.u32(1)<<(b%32)
                for x,y,z in ti.ndrange(3,3,3):
                    I=base+ti.Vector([x,y,z]);key=ti.Vector([part,I[0],I[1],I[2]])
                    if not self.project.multi.enabled[None]:self.mass[key]+=w[x,0]*w[y,1]*w[z,2]*self.s.mass[i]
                    ti.atomic_or(self.mask[key][0],bits[0]);ti.atomic_or(self.mask[key][1],bits[1])
        self.count[None]=0
        for key in ti.grouped(self.mask):
            I=ti.Vector([key[1],key[2],key[3]])
            fixed=self.s.fixed[I]
            if self.project.multi.enabled[None]:fixed=self.project.multi.fixed[key]
            if (self.mask[key][0]!=0 or self.mask[key][1]!=0) and self.mass[key]>1e-10 and not fixed:
                slot=ti.atomic_add(self.count[None],1);self.nodes[slot]=key

    @ti.kernel
    def contact(self,bodies:ti.i32):
        r=self.project.regions
        ti.loop_config(serialize=True)
        for b in range(bodies):
            for k in range(self.count[None]):
                key=self.nodes[k];part=key[0];I=ti.Vector([key[1],key[2],key[3]])
                if (self.mask[key][b//32]&(ti.u32(1)<<(b%32)))!=0:
                    point=(self.s.mpm_origin[None]+ti.cast(I,ti.f32)*self.s.mpm_h[None])*L
                    distance,normal=self.project.surface(point,ti.cast(r.body[b,0],ti.i32),r.vector(b,1),r.quaternion(b),r.vector(b,8))
                    if distance<=self.s.mpm_h[None]*L*.25:
                        mass=self.mass[key];v=(self.s.gv[I]+self.delta[key])*L
                        arm=point-r.vector(b,1);relative=v-r.body_velocity(b,arm)
                        vn=relative.dot(normal);slip=(relative-normal*vn).norm()
                        total=ti.Vector.zero(ti.f32,3);jn=0.
                        if vn<0:
                            cross=arm.cross(normal)
                            W=1/mass+r.body[b,17]+cross.dot(r.inverse_inertia(b)@cross)
                            jn=-(1+r.body[b,27])*vn/W;impulse=normal*jn;total+=impulse
                            v+=impulse/mass;r.apply_body(b,-impulse,-arm.cross(impulse),True)
                            tangent=v-r.body_velocity(b,arm);tangent-=normal*tangent.dot(normal)
                            speed=tangent.norm();friction=ti.cast(self.params[b,part,2],ti.f32)
                            if speed>1e-12 and friction>0:
                                direction=tangent/speed;cross=arm.cross(direction)
                                Wt=1/mass+r.body[b,17]+cross.dot(r.inverse_inertia(b)@cross)
                                impulse=-direction*ti.min(friction*jn,speed/Wt);total+=impulse
                                v+=impulse/mass;r.apply_body(b,-impulse,-arm.cross(impulse),True)
                            self.delta[key]=v/L-self.s.gv[I]
                        torque=-arm.cross(total)
                        for a in ti.static(range(3)):
                            self.stats[b,part,a]-=ti.cast(total[a],ti.f64)
                            self.stats[b,part,3+a]+=ti.cast(torque[a],ti.f64)
                            self.stats[b,part,7+a]-=ti.cast(total[a]-jn*normal[a],ti.f64)
                        self.stats[b,part,6]+=ti.cast(jn,ti.f64)
                        self.stats[b,part,10]+=ti.cast(slip,ti.f64);self.stats[b,part,11]+=1.

    @ti.kernel
    def g2p(self,n:ti.i32,dt:ti.f32):
        h=self.s.mpm_h[None];origin=self.s.mpm_origin[None]
        for p in range(n):
            if self.s.is_solid(p) and not self.s.pinned[p]:
                part=self.s.lab.part[p]-1
                base=ti.cast(ti.floor((self.s.x[p]-origin)/h-.5),ti.i32)
                fx=(self.s.x[p]-origin)/h-base;w=self.s.weights(fx)
                v=ti.Vector.zero(ti.f64,3);C=ti.Matrix.zero(ti.f64,3,3)
                for x,y,z in ti.static(ti.ndrange(3,3,3)):
                    offset=ti.Vector([x,y,z]);I=base+offset
                    weight=w[x,0]*w[y,1]*w[z,2]
                    gv=self.s.gv[I]+self.delta[part,I[0],I[1],I[2]]
                    v+=weight*gv;C+=weight*gv.outer_product((offset-fx)*4/h)
                vf,cf=ti.cast(v,ti.f32),ti.cast(C,ti.f32)
                self.s.v[p],self.s.C[p]=vf,cf
                self.s.F[p]=self.s.project(p,(ti.Matrix.identity(ti.f32,3)+dt*cf)@self.s.F[p],dt)
                self.s.x[p]+=dt*vf

    def results(self,cpu,duration):
        if not self.definitions:return []
        gpu=self.stats.to_numpy();material=self.material_stats.to_numpy();cpu={r['id']:r['values'] for r in cpu};result=[]
        for definition in self.definitions:
            if definition['a'] in self.body_ids:
                b=self.body_ids.index(definition['a']);p=self.part_ids.index(definition['b']);v=gpu[b,p].copy()
            else:
                a=self.part_ids.index(definition['a']);b=self.part_ids.index(definition['b'])
                v=material[min(a,b),max(a,b)].copy()
                if a>b:
                    v[:3]*=-1;v[7:10]*=-1;v[13:15]*=-1
                    v[3:6]=material[a,b,3:6]
            other=cpu.get(definition['id'],np.zeros(16))
            depth=max(v[12],other[12]);v+=other;v[12]=depth
            rate=lambda x:float(x/duration) if duration else 0.
            result.append(dict(**definition,force=[rate(x) for x in v[:3]],torque=[rate(x) for x in v[3:6]],
                normalForce=rate(v[6]),tangentialForce=[rate(x) for x in v[7:10]],
                slipSpeed=float(v[10]/v[11]) if v[11] else 0.,samples=float(v[11]),
                maxPenetration=float(v[12]),heatRate=rate(v[13]),heat=float(v[13]),
                accumulatedHeat=float(v[14]),thermalSamples=float(v[15])))
        return result
