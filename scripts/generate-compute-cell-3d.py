import math
import os
import sys

import bpy
from mathutils import Vector


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_DIR = os.path.join(ROOT, "public", "models")
GLB_PATH = os.path.join(OUTPUT_DIR, "compute-cell.glb")
PREVIEW_PATH = os.path.join(OUTPUT_DIR, "compute-cell-preview.png")


def material(name, base, metallic=0.0, roughness=0.45, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*base, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def assign(obj, mat):
    obj.data.materials.append(mat)


def smooth(obj):
    if hasattr(obj.data, "polygons"):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True


def uv_sphere(name, location, radius, mat, segments=48, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=radius,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    smooth(obj)
    return obj


def torus(name, major_radius, minor_radius, rotation, mat, major_segments=96, minor_segments=10):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=(0, 0, 0),
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    smooth(obj)
    return obj


def bevelled_cube(name, location, scale, rotation, mat, bevel=0.12):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new("Edge bevel", "BEVEL")
    modifier.width = bevel
    modifier.segments = 3
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    assign(obj, mat)
    smooth(obj)
    return obj


def panel(name, direction, tangent_rotation, graphite, purple, index):
    direction = Vector(direction).normalized()
    location = direction * 1.02
    rotation = direction.to_track_quat("Z", "Y").to_euler()
    rotation.rotate_axis("Z", tangent_rotation)
    shell = bevelled_cube(
        f"Shell_{name}",
        location,
        (0.48, 0.62, 0.105),
        rotation,
        graphite,
        bevel=0.11,
    )
    shell["computeCellPart"] = "mechanical-shell"
    if index % 2 == 0:
        accent = bevelled_cube(
            f"PurpleAccent_{name}",
            direction * 1.142,
            (0.25, 0.055, 0.022),
            rotation,
            purple,
            bevel=0.025,
        )
        accent["computeCellPart"] = "state-accent"


def build_model():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    graphite = material("Graphite", (0.035, 0.043, 0.052), metallic=0.82, roughness=0.28)
    dark_metal = material("DarkMetal", (0.11, 0.105, 0.10), metallic=0.9, roughness=0.22)
    yellow = material(
        "EnergyYellow",
        (1.0, 0.46, 0.015),
        metallic=0.0,
        roughness=0.18,
        emission=(1.0, 0.30, 0.0),
        strength=7.0,
    )
    soft_yellow = material(
        "EnergyFilament",
        (1.0, 0.72, 0.08),
        metallic=0.15,
        roughness=0.2,
        emission=(1.0, 0.48, 0.02),
        strength=4.0,
    )
    purple = material(
        "MonadPurpleAccent",
        (0.42, 0.12, 0.82),
        metallic=0.35,
        roughness=0.24,
        emission=(0.34, 0.06, 0.72),
        strength=2.2,
    )

    root = bpy.data.objects.new("ComputeCellRoot", None)
    bpy.context.collection.objects.link(root)
    root["asset"] = "ComputeQuest Compute Cell"
    root["stateDriven"] = True
    root["animationSource"] = "persisted application state"

    core = uv_sphere("EnergyCore", (0, 0, 0), 0.71, yellow, segments=64, rings=32)
    core.parent = root
    core["computeCellPart"] = "energy-core"
    core["emissiveStateTarget"] = True

    for index, rotation in enumerate(((0, 0, 0), (math.radians(62), 0, math.radians(28)))):
        filament = torus(
            f"EnergyFilament_{index + 1}",
            0.77 + index * 0.035,
            0.012,
            rotation,
            soft_yellow,
            major_segments=72,
            minor_segments=6,
        )
        filament.parent = root
        filament["computeCellPart"] = "energy-filament"

    cage = torus("InnerGraphiteCage", 0.92, 0.055, (math.radians(90), 0, 0), graphite)
    cage.parent = root
    cage["computeCellPart"] = "mechanical-cage"

    directions = []
    for index in range(8):
        angle = index * math.tau / 8
        directions.append((math.cos(angle), math.sin(angle), 0.18 * math.sin(angle * 2)))
    directions.extend(((0.15, 0, 1), (-0.15, 0, -1)))
    for index, direction in enumerate(directions):
        panel(f"{index + 1:02d}", direction, index * 0.19, graphite, purple, index)

    ring_specs = (
        ("OrbitRing_A", (math.radians(68), 0, math.radians(14)), 1.48),
        ("OrbitRing_B", (math.radians(-38), math.radians(56), math.radians(18)), 1.60),
        ("OrbitRing_C", (math.radians(18), math.radians(-54), math.radians(74)), 1.72),
    )
    for index, (name, rotation, radius) in enumerate(ring_specs):
        ring = torus(name, radius, 0.035 + index * 0.004, rotation, dark_metal)
        ring.parent = root
        ring["computeCellPart"] = "orbital-ring"
        ring["stateRotationTarget"] = True

    for index, position in enumerate(((1.48, 0, 0), (-0.92, 1.29, 0.24), (0.20, -0.72, 1.53))):
        node = uv_sphere(f"OrbitNode_{index + 1}", position, 0.115, graphite, segments=24, rings=12)
        node.parent = root
        node["computeCellPart"] = "orbit-node"
        inset = uv_sphere(
            f"OrbitNodeEnergy_{index + 1}",
            Vector(position) * 1.006,
            0.052,
            purple if index == 1 else yellow,
            segments=18,
            rings=9,
        )
        inset.parent = root
        inset["computeCellPart"] = "state-accent"

    bpy.context.view_layer.objects.active = root
    root.select_set(True)

    bpy.ops.object.light_add(type="AREA", location=(3.8, -4.0, 4.6))
    key = bpy.context.object
    key.name = "PreviewKey"
    key.data.energy = 900
    key.data.shape = "DISK"
    key.data.size = 4.0
    key.rotation_euler = (math.radians(27), 0, math.radians(42))
    bpy.ops.object.light_add(type="AREA", location=(-3.4, 1.8, 2.2))
    fill = bpy.context.object
    fill.name = "PreviewFill"
    fill.data.energy = 650
    fill.data.color = (0.42, 0.18, 0.85)
    fill.data.size = 3.0

    bpy.ops.object.camera_add(location=(4.8, -6.1, 3.7))
    camera = bpy.context.object
    camera.name = "PreviewCamera"
    direction = Vector((0, 0, 0.1)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 58
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = PREVIEW_PATH
    scene.render.image_settings.color_mode = "RGBA"
    scene.world = bpy.data.worlds.new("PreviewWorld")
    scene.world.color = (0.008, 0.008, 0.008)
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)

    for helper in (key, fill, camera):
        bpy.data.objects.remove(helper, do_unlink=True)

    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=True,
    )
    print(f"GLB={GLB_PATH}")
    print(f"PREVIEW={PREVIEW_PATH}")
    print(f"MESH_OBJECTS={sum(1 for obj in bpy.data.objects if obj.type == 'MESH')}")


if __name__ == "__main__":
    try:
        build_model()
    except Exception as error:
        print(f"COMPUTE_CELL_GENERATION_FAILED: {error}", file=sys.stderr)
        raise
