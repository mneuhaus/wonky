"""cad_khana's Assembly modeling API on Bend-built build123d shapes.

Same immutable builder as cad_khana.mechanism.assembly (cad-khana 0.x): named
parts with placement, color and material, nested sub-assemblies, revolute
joints and declared assertions. Differences, all explicit:

- Placements are applied eagerly when a part or sub-assembly is added, so a
  placement wonky cannot build fails on the model's own line.
- The default placement is build123d's `Location()`, and placements compose
  with build123d `Location` composition (python/_b3d_location.py), as in
  cad_khana; a joint at a nonzero angle rotates about its axis line.
- Assertions are recorded, not evaluated. Evaluating them is `check()`, a
  diagnostic wonky does not provide.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from cad_khana import _wonky
from cad_khana.mechanism.assertions import Clearance, ExpectedInterference, NoInterference


@dataclass(frozen=True)
class PlacedPart:
    name: str
    part: object
    location: object = None
    color: object = None
    material: str | None = None
    # The part at its placement and the recorded appearance, built on creation.
    world: object = field(init=False, repr=False, compare=False)
    appearance: dict | None = field(init=False, repr=False, compare=False)

    def __post_init__(self):
        if not isinstance(self.name, str) or not self.name:
            raise TypeError(f"cad_khana part name must be a nonempty string, not {self.name!r}")
        if self.material is not None and not isinstance(self.material, str):
            raise TypeError(f"cad_khana part '{self.name}': material must be a string or None")
        where = f"cad_khana part '{self.name}'"
        if self.location is None:
            object.__setattr__(self, "location", _wonky.identity())
        object.__setattr__(self, "appearance", _wonky.appearance(self.color, where))
        object.__setattr__(self, "world", _wonky.place(self.location, self.part, where))


@dataclass(frozen=True)
class RevoluteJoint:
    """Single-DOF revolute joint; `axis` is a build123d Axis in the parent frame."""

    axis: object
    angle_deg: float = 0.0

    def with_angle(self, angle_deg: float) -> "RevoluteJoint":
        return replace(self, angle_deg=angle_deg)

    @property
    def transform(self):
        """T(p) · R(d, angle) · T(-p) about the axis line, as in cad_khana.

        A zero angle is the exact identity (no placement is built for it).
        """
        if self.angle_deg == 0:
            return _wonky.identity()
        Location = _wonky.build123d().Location
        position, direction = self.axis.position, self.axis.direction
        pivot = Location((position.X, position.Y, position.Z))
        rotation = Location((0, 0, 0), (direction.X, direction.Y, direction.Z), self.angle_deg)
        return pivot * rotation * pivot.inverse()


@dataclass(frozen=True)
class SubAssembly:
    """A nested Assembly placed in its parent's frame."""

    name: str
    assembly: "Assembly"
    location: object = None
    joint: RevoluteJoint | None = None
    # (path, PlacedPart) leaves of the nested tree in this parent's frame.
    leaves: tuple = field(init=False, repr=False, compare=False)

    def __post_init__(self):
        if not isinstance(self.assembly, Assembly):
            raise TypeError(f"cad_khana sub-assembly '{self.name}' must be an Assembly")
        if self.location is None:
            object.__setattr__(self, "location", _wonky.identity())
        effective = self.effective_location
        object.__setattr__(self, "leaves", tuple(
            ((self.name, *path), replace(leaf, location=_wonky.compose(effective, leaf.location)))
            for path, leaf in self.assembly._leaves()))

    @property
    def effective_location(self):
        if self.joint is None:
            return self.location
        return _wonky.compose(self.joint.transform, self.location)


@dataclass(frozen=True)
class DetailOverride:
    """One entry of an Assembly.with_detailed_geometry mapping."""

    part: object
    location: object = None
    material: str | None = None
    color: object = None


@dataclass(frozen=True)
class Assembly:
    parts: tuple[PlacedPart, ...] = ()
    subassemblies: tuple[SubAssembly, ...] = ()
    assertions: tuple = ()

    def with_part(self, name, part, location=None, color=None, material=None) -> "Assembly":
        placed = PlacedPart(name, part, location, color, material)
        return replace(self, parts=self.parts + (placed,))

    def with_subassembly(self, name, assembly, location=None, joint=None) -> "Assembly":
        sub = SubAssembly(name=name, assembly=assembly, location=location, joint=joint)
        return replace(self, subassemblies=self.subassemblies + (sub,))

    def with_joint(self, path: str, joint: RevoluteJoint) -> "Assembly":
        """Set the joint on the named (or dotted-path) sub-assembly."""
        return self._update_sub(path, lambda sub: replace(sub, joint=joint),
                                lambda sub, rest: sub.assembly.with_joint(rest, joint))

    def with_joint_angle(self, path: str, angle_deg: float) -> "Assembly":
        """Update the angle of the named (or dotted-path) sub-assembly's joint."""
        def leaf(sub):
            if sub.joint is None:
                raise ValueError(f"sub-assembly {sub.name!r} has no joint to update")
            return replace(sub, joint=sub.joint.with_angle(angle_deg))
        return self._update_sub(path, leaf, lambda sub, rest: sub.assembly.with_joint_angle(rest, angle_deg))

    def _update_sub(self, path, leaf, nested):
        head, _, rest = path.partition(".")
        updated, found = [], False
        for sub in self.subassemblies:
            if sub.name == head:
                updated.append(replace(sub, assembly=nested(sub, rest)) if rest else leaf(sub))
                found = True
            else:
                updated.append(sub)
        if not found:
            raise KeyError(f"no sub-assembly named {head!r}")
        return replace(self, subassemblies=tuple(updated))

    def with_materials(self, mapping: dict) -> "Assembly":
        """Replace the material of each named part, recursing into sub-assemblies."""
        parts = tuple(replace(p, material=mapping.get(p.name, p.material)) if p.name in mapping else p
                      for p in self.parts)
        subs = tuple(replace(s, assembly=s.assembly.with_materials(mapping)) for s in self.subassemblies)
        return replace(self, parts=parts, subassemblies=subs)

    def with_detailed_geometry(self, mapping: dict) -> "Assembly":
        """Swap named parts' geometry anywhere in the tree; append new top-level parts."""
        overrides = {name: value if isinstance(value, DetailOverride) else DetailOverride(part=value)
                     for name, value in mapping.items()}
        swapped = self._swap_detail(overrides)
        names = swapped._all_part_names()
        additions = []
        for name, override in overrides.items():
            if name in names:
                continue
            if override.location is None:
                raise ValueError(f"with_detailed_geometry: addition {name!r} requires an explicit location")
            additions.append(PlacedPart(name, override.part, override.location, override.color, override.material))
        return replace(swapped, parts=swapped.parts + tuple(additions))

    def _swap_detail(self, overrides):
        parts = tuple(
            replace(p, part=overrides[p.name].part,
                    location=overrides[p.name].location or p.location,
                    material=overrides[p.name].material or p.material,
                    color=overrides[p.name].color or p.color)
            if p.name in overrides else p
            for p in self.parts)
        subs = tuple(replace(s, assembly=s.assembly._swap_detail(overrides)) for s in self.subassemblies)
        return replace(self, parts=parts, subassemblies=subs)

    def _all_part_names(self) -> set:
        names = {p.name for p in self.parts}
        for sub in self.subassemblies:
            names.update(sub.assembly._all_part_names())
        return names

    def assert_no_interference(self, a, b, name=None) -> "Assembly":
        assertion = NoInterference(a=a, b=b, name=name or f"no_interference:{a}/{b}")
        return replace(self, assertions=self.assertions + (assertion,))

    def assert_clearance(self, a, b, min_mm, name=None) -> "Assembly":
        assertion = Clearance(a=a, b=b, min_mm=min_mm, name=name or f"clearance:{a}/{b}>={min_mm}")
        return replace(self, assertions=self.assertions + (assertion,))

    def assert_interference(self, a, b, reason=None, name=None) -> "Assembly":
        assertion = ExpectedInterference(a=a, b=b, name=name or f"interference:{a}/{b}", reason=reason)
        return replace(self, assertions=self.assertions + (assertion,))

    def _leaves(self):
        """(path, PlacedPart) for every part, placed in this assembly's frame."""
        leaves = [((p.name,), p) for p in self.parts]
        for sub in self.subassemblies:
            leaves.extend(sub.leaves)
        return tuple(leaves)

    @property
    def placed_parts(self) -> tuple:
        """Flat walk over the tree with locations composed through the parents."""
        return tuple(leaf for _, leaf in self._leaves())

    @property
    def compound(self):
        """A build123d Compound of the placed parts (fails at use if the shim lacks Compound)."""
        return _wonky.build123d().Compound(children=[p.world for p in self.placed_parts])

    def _wonky_parts(self) -> list:
        """Runner result protocol (python/_wonky_runtime.py): (name, placed shape, color) per part.

        Parts come in cad_khana's placed_parts order with its leaf names. A
        shape placed more than once at the same spot gets an exact Bend copy
        (zero translation), so every part owns distinct bodies instead of
        sharing the first part's. Colors are (r, g, b, a) sRGB tuples in 0..1.
        """
        parts, seen = [], set()
        for _, leaf in self._leaves():
            shape = leaf.world
            if shape._handle in seen:
                shape = _wonky.copy(shape)
            seen.add(shape._handle)
            color = leaf.appearance
            parts.append((leaf.name, shape, None if color is None else
                          (color["red"], color["green"], color["blue"], color["alpha"])))
        return parts

    def _wonky_metadata(self) -> dict:
        """Assembly facts beyond name and color, index-aligned with _wonky_parts().

        Paths name the sub-assembly chain; assertions are declared, never
        evaluated (evaluation is check(), which wonky refuses).
        """
        return {"kind": "cad_khana.Assembly",
                "parts": [{"name": leaf.name, "path": list(path), "material": leaf.material}
                          for path, leaf in self._leaves()],
                "assertions": [{**assertion._wonky_record(), "status": "declared-not-evaluated"}
                               for assertion in self.assertions]}


__getattr__ = _wonky.module_getattr(__name__)
