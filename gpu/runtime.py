"""Explicit native GPU selection; never silently fall back to a CPU backend."""
import os
from pathlib import Path
import subprocess
import taichi as ti


def initialize(arch="cuda"):
    if arch not in ("cuda", "vulkan"):
        raise ValueError("GPU backend must be cuda or vulkan")
    root = Path(__file__).resolve().parent.parent
    os.environ.setdefault("TI_ENABLE_TORCH", "0")
    ti.init(arch=getattr(ti, arch), enable_fallback=False, default_fp=ti.f32,
            fast_math=False, device_memory_GB=2,
            offline_cache_file_path=str(root / ".taichi-cache"))
    if ti.lang.impl.current_cfg().arch != getattr(ti, arch):
        raise RuntimeError("Requested GPU backend was not selected")
    device = "Vulkan device" if arch == "vulkan" else "CUDA device"
    if arch == "cuda":
        try:
            device = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                text=True, timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
            ).strip().splitlines()[0]
        except (OSError, subprocess.SubprocessError):
            pass
    return {"name": "Taichi", "arch": arch, "device": device, "version": ".".join(map(str, ti.__version__))}
