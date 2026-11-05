import {add,sub,mul,dot,norm,rotate,inverse,quaternion,inertia} from './model.js';
import {arr,obj,qa,cross} from './contact.js';
import {LENGTH as L} from './coupling-model.js';
import {inSelection} from '../simulation/references.js';

// Material membership is fixed at initialization. Constraints act on the
// interpolated MPM GRID velocity and scatter impulses with the same weights.
// G2P therefore sees the corrected velocity gradient (APIC C and deformation F).
export class RegionAttachments {
  constructor(engine) {
    this.engine=engine;this.items=[];this.excluded=new Map();const s=engine.particles,used=new Set();
    for(const definition of engine.model.coupling.attachments){
      const body=engine.bodies.get(definition.body),partIndex=engine.model.coupling.parts.findIndex(p=>p.id===definition.part),part=engine.model.coupling.parts[partIndex];
      if(!body||!part||part.method!=='mpm'||part.fracture.enabled)throw Error('区域连接需连接刚体与未启用断裂的 MPM 部件');
      const q=qa(body.rb.rotation()),center=arr(body.rb.translation()),members=[];
      for(let i=0;i<s.count;i++)if(s.lab.part[i]===partIndex+1){
        const point=[s.x[i]*L,s.y[i]*L,s.z[i]*L],local=rotate(inverse(quaternion(part.rotation)),sub(point,part.center));
        if(!inSelection(definition.selection,local))continue;
        if(!s.isSolid(i))throw Error('区域连接初始选区必须为固态；请降低初温');
        if(s.pinned[i]||used.has(i))throw Error('连接选区不能包含固定点，也不能与其他区域连接重叠');
        used.add(i);members.push({i,local:rotate(inverse(q),sub(point,center)),active:true});
        if(!this.excluded.has(body.definition.id))this.excluded.set(body.definition.id,new Set());
        this.excluded.get(body.definition.id).add(i);
      }
      if(!members.length)throw Error('区域连接未选中材料点，请检查局部范围和粒子间距');
      this.items.push({definition,body,members,work:0,totalPositiveWork:0,...this.emptyStep()});
    }
    if(this.items.length&&s.pinned.subarray(0,s.count).some(Boolean)){
      const g=s.mpm,nodes=i=>{
        g.stencil(s,i);const [bx,by,bz]=g.base.subarray(i*3,i*3+3),t=i*9,result=[];
        for(let z=0;z<3;z++)for(let y=0;y<3;y++)for(let x=0;x<3;x++)if(g.weights[t+x]*g.weights[t+3+y]*g.weights[t+6+z]>1e-8)result.push(((bz+z)*g.N+by+y)*g.N+bx+x);
        return result;
      },fixed=new Set();
      const key=(i,n)=>s.separatePartGrids?s.lab.part[i]*g.N**3+n:n;
      for(let i=0;i<s.count;i++)if(s.pinned[i]&&s.isSolid(i))for(const n of nodes(i))fixed.add(key(i,n));
      for(const item of this.items)for(const {i} of item.members)if(nodes(i).some(n=>fixed.has(key(i,n))))throw Error('区域连接与固定网格支撑重叠，请增大选区间距');
    }
  }
  emptyStep(){return {impulse:[0,0,0],torqueImpulse:[0,0,0],stepWork:0,bodyWork:0,positiveWork:0};}
  begin(){for(const item of this.items)Object.assign(item,this.emptyStep());}
  releaseMelted(){
    for(const item of this.items)for(const member of item.members)if(member.active&&!this.engine.particles.isSolid(member.i)){
      member.active=false;this.excluded.get(item.definition.body)?.delete(member.i);
    }
  }
  ignores(body,i){return this.excluded.get(body)?.has(i)??false;}
  solve(grid,dt){
    const s=this.engine.particles;
    this.releaseMelted();
    const prepared=this.items.map(item=>{
      const {definition:d,body,members}=item,q=qa(body.rb.rotation()),center=arr(body.rb.translation()),fixed=body.definition.type==='fixed',invM=fixed?0:1/body.definition.mass,I=inertia(body.definition);
      const inverseI=v=>fixed?[0,0,0]:rotate(q,rotate(inverse(q),v).map((x,k)=>x/I[k]));
      const axes=(d.mode==='slide'?[[1,0,0],[0,1,0]]:[[1,0,0],[0,1,0],[0,0,1]]).map(n=>rotate(q,rotate(quaternion(d.frame.rotation),n)));
      const k=d.stiffness/members.length,c=d.damping/members.length,gamma=d.mode==='elastic'?1/(dt*(c+dt*k)):0;
      const rows=members.filter(m=>m.active).map(({i,local})=>{
        const field=grid.fields?.[s.lab.part[i]]??grid;
        if(!s.isSolid(i))throw Error('连接材料点已失去固体状态');
        const point=[s.x[i]*L,s.y[i]*L,s.z[i]*L],target=add(center,rotate(q,local)),error=sub(point,target),nodes=[];
        const [bx,by,bz]=grid.base.subarray(i*3,i*3+3),w=grid.weights,t=i*9;
        let invGrid=0;
        for(let z=0;z<3;z++)for(let y=0;y<3;y++)for(let x=0;x<3;x++){
          const n=((bz+z)*grid.N+by+y)*grid.N+bx+x,weight=w[t+x]*w[t+3+y]*w[t+6+z];
          if(weight<1e-12)continue;
          if(field.fixed[n])throw Error('区域连接与固定网格支撑重叠，请增大选区间距');
          if(field.mass[n]<=1e-12)continue;
          nodes.push({n,weight});invGrid+=weight*weight/field.mass[n];
        }
        const r=sub(point,center),effective=axes.map(n=>invGrid+invM+dot(cross(r,n),inverseI(cross(r,n))));
        return {i,point,error,nodes,r,effective,invGrid,field,lambda:axes.map(()=>0)};
      });
      return {item,d,body,fixed,axes,k,c,gamma,rows};
    });
    // Iterate all connections together, including different selections whose
    // grid stencils overlap. Soft impulses accumulate across iterations.
    for(let iteration=0;iteration<this.engine.model.iterations;iteration++)for(const {item,d,body,fixed,axes,k,c,gamma,rows} of prepared){
      for(const row of rows)for(let a=0;a<axes.length;a++){
        const n=axes[a],v=[0,0,0];
        for(const node of row.nodes)for(let k=0;k<3;k++)v[k]+=node.weight*(row.field.v[node.n*3+k]+(s.contactGridDeltas?.[s.lab.part[row.i]]?.[node.n*3+k]??0))*L;
        const vb=fixed?[0,0,0]:arr(body.rb.velocityAtPoint(obj(row.point))),relative=dot(sub(v,vb),n),error=dot(row.error,n);
        const bias=d.mode==='elastic'?k*error/(c+dt*k):Math.max(-s.domain.spacing*L*.1/dt,Math.min(s.domain.spacing*L*.1/dt,.15*error/dt));
        const impulse=-(relative+bias+gamma*row.lambda[a])/(row.effective[a]+gamma);row.lambda[a]+=impulse;
        const J=mul(n,impulse),bodyW=row.effective[a]-row.invGrid;
        const work=impulse*relative+.5*impulse*impulse*row.effective[a];
        item.stepWork+=work;item.work+=work;item.bodyWork+=-dot(J,vb)+.5*impulse*impulse*bodyW;
        if(d.mode!=='elastic'){item.positiveWork+=Math.max(0,work);item.totalPositiveWork+=Math.max(0,work);}
        for(const node of row.nodes)for(let k=0;k<3;k++)row.field.v[node.n*3+k]+=node.weight*J[k]/row.field.mass[node.n]/L;
        if(!fixed)body.rb.applyImpulseAtPoint(obj(mul(J,-1)),obj(row.point),true);
        item.impulse=add(item.impulse,mul(J,-1));item.torqueImpulse=add(item.torqueImpulse,cross(row.r,mul(J,-1)));
      }
    }
  }
  results(dt){
    const s=this.engine.particles;
    return this.items.map(item=>{
      const {definition:d,body}=item,members=item.members.filter(m=>m.active),q=qa(body.rb.rotation()),center=arr(body.rb.translation()),axis=rotate(q,rotate(quaternion(d.frame.rotation),[0,0,1]));
      let error=0,square=0;const mean=[0,0,0];
      for(const {i,local} of members){
        const p=[s.x[i]*L,s.y[i]*L,s.z[i]*L];for(let k=0;k<3;k++)mean[k]+=p[k]/members.length;
        let delta=sub(p,add(center,rotate(q,local)));if(d.mode==='slide')delta=sub(delta,mul(axis,dot(delta,axis)));
        error=Math.max(error,norm(delta));square+=dot(delta,delta);
      }
      if(!members.length)for(const {i} of item.members)for(let k=0;k<3;k++)mean[k]+=s[['x','y','z'][k]][i]*L/item.members.length;
      return {id:d.id,name:d.name,type:'region',mode:d.mode,a:add(center,rotate(q,d.frame.position)),b:mean,axis,count:members.length,
        initialCount:item.members.length,releasedCount:item.members.length-members.length,state:members.length===item.members.length?'active':members.length?'partial':'released',error,
        force:dt?mul(item.impulse,1/dt):[0,0,0],torque:dt?mul(item.torqueImpulse,1/dt):[0,0,0],
        power:dt?item.stepWork/dt:0,bodyPower:dt?item.bodyWork/dt:0,work:item.work,positiveWork:item.positiveWork,
        elasticEnergy:d.mode==='elastic'?.5*d.stiffness*square/item.members.length:0};
    });
  }
}
