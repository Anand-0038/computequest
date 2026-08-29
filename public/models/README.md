# Compute Cell 3D asset

`compute-cell.glb` is a locally generated, web-ready signature object for the Compute Cell UI. It is a mechanical energy reactor, not a token or coin.

The GLB contains named state targets:

- `EnergyCore` with `computeCellPart: energy-core` for balance-driven brightness and scale;
- `OrbitRing_A`, `OrbitRing_B`, and `OrbitRing_C` with `stateRotationTarget: true` for settlement-state motion;
- purple and yellow objects with `computeCellPart: state-accent` for verified/finalized pulses;
- `ComputeCellRoot` for the slow idle rotation.

Application state must remain authoritative. Rendering code may animate these targets from persisted CE, settlement, and job props, but the model must never invent or advance economic state.

Files:

- `compute-cell.glb`: production model;
- `compute-cell-preview.png`: transparent Blender render of the production model;
- `compute-cell-reference.png`: generated visual direction used while modeling.

Regenerate and validate:

```bash
blender --background --python scripts/generate-compute-cell-3d.py
blender --background --python scripts/validate-compute-cell-3d.py
```
