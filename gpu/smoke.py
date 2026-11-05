from runtime import initialize
from solver import Solver
print(initialize(),flush=True)
s=Solver()
s.reset("models")
s.step()
meta,data=s.snapshot()
print({k:meta[k] for k in ("count","time","mass","minJ","profile")},flush=True)
s.reset("coupled")
s.step()
print(s.snapshot()[0],flush=True)
