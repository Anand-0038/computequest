import os
import sys

import bpy


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GLB_PATH = os.path.join(ROOT, "public", "models", "compute-cell.glb")


def fail(message):
    print(f"COMPUTE_CELL_VALIDATION_FAILED: {message}", file=sys.stderr)
    raise SystemExit(1)


bpy.ops.wm.read_factory_settings(use_empty=True)
if not os.path.isfile(GLB_PATH):
    fail("GLB_MISSING")

bpy.ops.import_scene.gltf(filepath=GLB_PATH)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
materials = {slot.material.name for obj in meshes for slot in obj.material_slots if slot.material}
roots = [obj for obj in bpy.context.scene.objects if obj.name == "ComputeCellRoot"]
energy_cores = [obj for obj in meshes if obj.get("computeCellPart") == "energy-core"]
orbital_rings = [obj for obj in meshes if obj.get("computeCellPart") == "orbital-ring"]
state_accents = [obj for obj in meshes if obj.get("computeCellPart") == "state-accent"]

if len(roots) != 1:
    fail(f"EXPECTED_ONE_ROOT_FOUND_{len(roots)}")
if len(meshes) < 20:
    fail(f"MESH_COUNT_TOO_LOW_{len(meshes)}")
if len(energy_cores) != 1:
    fail(f"EXPECTED_ONE_ENERGY_CORE_FOUND_{len(energy_cores)}")
if len(orbital_rings) != 3:
    fail(f"EXPECTED_THREE_ORBITAL_RINGS_FOUND_{len(orbital_rings)}")
if not state_accents:
    fail("STATE_ACCENTS_MISSING")
for expected in ("EnergyYellow", "Graphite", "MonadPurpleAccent"):
    if expected not in materials:
        fail(f"MATERIAL_MISSING_{expected}")
if os.path.getsize(GLB_PATH) > 1_000_000:
    fail("GLB_EXCEEDS_ONE_MEGABYTE")

print(f"GLB={GLB_PATH}")
print(f"BYTES={os.path.getsize(GLB_PATH)}")
print(f"MESHES={len(meshes)}")
print(f"MATERIALS={len(materials)}")
print(f"ORBITAL_RINGS={len(orbital_rings)}")
print(f"STATE_ACCENTS={len(state_accents)}")
print("VALIDATION=PASS")
