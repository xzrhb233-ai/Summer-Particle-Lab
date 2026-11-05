"""GPU CSR completeness at boundaries, translated domains and full-size domains."""
import itertools,json
from pathlib import Path
import numpy as np
import taichi as ti
from solver import Solver
from runtime import initialize

@ti.kernel
def query(s:ti.template(),n:ti.i32,out:ti.types.ndarray(ndim=2,dtype=ti.i32)):
    for i in range(n):
        c=s.cell_index[i]
        for a,b,d in ti.ndrange((-1,2),(-1,2),(-1,2)):
            cid=s.cell_id(c+ti.Vector([a,b,d]))
            for slot in range(s.prefix[cid]-s.counts[cid],s.prefix[cid]):
                j=s.sorted_ids[slot]
                if (s.x[i]-s.x[j]).norm()<7.99:out[i,j]+=1

backend=initialize('cuda');rng=np.random.default_rng(58);rows=[]
for lo,hi in [([-48,-12,-36],[48,60,36]),([101.3,-33.7,88.1],[113.6,-21.5,100.9]),([-240]*3,[240]*3)]:
    domain=dict(lower=lo,upper=hi,cellSize=8,particlesPerAxis=2)
    # Corners, points straddling cell planes, random interior, and exterior
    # positions from a failed speculative step must all have safe bin indices.
    points=np.array(list(itertools.product(*[(a,a+.01,b-.01,b) for a,b in zip(lo,hi)])),np.float32)
    points=np.concatenate((points,rng.uniform(lo,hi,(64,3)),np.array([lo,hi])+np.array([[-.1]*3,[.1]*3]))).astype(np.float32)
    n=len(points);s=Solver(n,neighbor_domain=domain);s.configure_domain(domain);s.x.from_numpy(points)
    s.clear_neighbors();s.build_neighbors(n)
    actual=np.zeros((n,n),np.int32);query(s,n,actual)
    expected=(np.linalg.norm(points[:,None]-points[None,:],axis=2)<7.99).astype(np.int32)
    assert np.array_equal(actual,expected),'Missing or duplicate neighbors'
    counts=s.counts.to_numpy();prefix=s.prefix.to_numpy();ids=s.sorted_ids.to_numpy()
    assert np.array_equal(prefix,np.cumsum(counts)) and sorted(ids)==list(range(n))
    changed=dict(domain,upper=[v+8 for v in hi])
    try:s.configure_domain(changed);raise AssertionError('Mutable compact domain accepted')
    except ValueError:pass
    rows.append(dict(shape=s.neighbor_shape,cells=s.neighbor_cells,particles=n))
result=dict(backend=backend,cases=rows,complete=True)
Path('artifacts/v058-neighbors.json').write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result))
