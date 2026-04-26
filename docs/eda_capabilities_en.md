# New EDA Tool — Capability Overview
*Working document. Draft for discussion with potential contributors.*

---

## Philosophy

Existing EDA tools split into two camps: free tools with architectural limitations (KiCad) and expensive ones with bloated codebases and sluggish interfaces (Altium). Eagle occupied a reasonable middle ground but was killed by Autodesk. Cloud-based solutions (EasyEDA) solve some problems at the cost of data ownership.

This tool is built on a set of principles that are not open to compromise:

- **Performance is an architectural property, not a feature.** GPU rendering, incremental algorithms, spatial indexing wherever spatial lookups are needed.
- **Local-first, no cloud.** Project data belongs to the engineer.
- **Open file format.** XML or JSON, self-documenting, suitable for git storage and external script processing.
- **Constraint-based geometry.** Arbitrary angles and geometric relationships are a foundation of the editor, not a workaround.
- **3D is a first-class citizen**, not an external viewer bolted on.

---

## Schematic Editor

Full standard feature set: hierarchical schematics, buses with proper semantics, net labels, live synchronisation with the board.

**Key differences from existing tools:**

- ERC runs incrementally, in real time. Violations are highlighted at the moment they are created, not after clicking a button.
- Assembly variants are built into the data model from day one, not retrofitted. One project — multiple BOMs for different product configurations.
- Hierarchical blocks with parameters, reusable across projects.

---

## Board Editor

### Constraint-based geometry

This is the primary architectural differentiator from every existing tool in this price segment.

Instead of the grid being the only way to define object placement — a system of geometric constraints: parallelism, perpendicularity, fixed distance, tangency, symmetry. A trace that must be parallel to the board edge stays parallel regardless of any changes to the outline. Arbitrary angles are a consequence of this architecture, not an exception to the rules.

The rectangular grid remains available as a convenient mode for straightforward cases.

### Performance

- GPU rendering: instanced drawing of identical objects (pads, vias of the same type), VBOs for traces.
- R-tree for all spatial queries: net highlighting, object picking under cursor, proximity DRC — no brute-force iteration.
- Incremental polygon fill: when a single object changes, only the affected area is recalculated.

### DRC

Runs incrementally, in real time. Rules are expressive: clearances can depend on net class, voltage difference, or layer. Violations are visible immediately, not on demand.

### Other board features

- Differential pairs and length matching.
- Full stackup control with impedance calculation.
- Blind and buried vias for multilayer boards.
- Group operations on components: align, distribute, rotate.

---

## 3D Editor

3D is not a separate application or a viewer. It is a working mode inside the same tool.

- **Bidirectional editing.** Moving a component in the 3D view updates its footprint in the board editor. One operation, one undo step.
- **Local 3D model libraries.** No dependency on cloud services.
- **Enclosure import.** A STEP file of the device enclosure is imported and used as a container: the engineer can immediately see whether the board fits and whether there are mechanical conflicts. Creating an enclosure from scratch inside the tool is not required — import and fit-check only.
- **Export.** STEP for handoff to mechanical engineers, and a textured model for visualisation — locally, without Fusion or any other cloud service.

---

## Multi-board Projects

A project can contain multiple boards connected through connectors.

**Connector verification** is a core feature that does not exist anywhere in this market segment. The tool automatically checks:
- Pinout match between connector A on board 1 and connector B on board 2.
- Correct connector orientation at assembly.
- Signal consistency between boards at the netlist level.

This moves the class of errors "wrong connector pinout" from "you'll find it when assembling the first prototype" to "won't pass verification".

---

## Flex and Rigid-Flex Boards

The approach mirrors sheet metal in mechanical CAD.

- Bend zones are defined explicitly with a specified bend radius.
- Flat pattern for manufacturing is generated automatically.
- DRC validates trace rules in bend zones: minimum width, via prohibition, trace orientation relative to the bend axis.
- The 3D model displays the board in its bent state.

---

## Simulation

Current SPICE integrations in EDA tools simulate analog circuits in isolation. The goal of this tool is to approach the Proteus model: simulation of the schematic together with microcontroller firmware behaviour.

First version: full SPICE simulation with a usable interface. Co-simulation of schematic and firmware — a subsequent development milestone.

---

## Library System

Eagle's library system is taken as the reference model for its class-leading transparency: the link between symbol, footprint, and 3D model is defined explicitly and unambiguously.

Extensions:
- Parametric component database: attributes (value, tolerance, temperature range, manufacturer part number) stored in structured form.
- Library versioning: a project records the component version at the time it was added.
- Python API for programmatic component generation — for parametric series (resistors of the same package, connectors of the same family).

---

## Scripting and Automation

Python API with access to the full object graph of the project: schematic, board, components, nets, attributes. This enables:

- Algorithmic component placement automation.
- BOM generation with queries to external supplier databases.
- Custom DRC rules written in Python.
- Programmatic component creation.

The project file format (XML/JSON) additionally allows processing the project with external scripts without using the API — for those who prefer to work directly with the data.

---

## File Format

- Plain text (XML or JSON), self-documenting. Structure is readable without consulting documentation.
- Git-friendly: diffs between versions are meaningful and human-readable.
- Parseable by external scripts in any language.
- Import from Eagle (.sch / .brd) and KiCad are the priority migration paths.

---

## Platforms

Windows, Linux. macOS — where feasible.

Local installation. No mandatory internet connection, no dependency on vendor servers.

---

## What the tool deliberately does not include

- An autorouter. Autorouters produce poor results; professional engineers do not use them.
- Cloud storage and collaborative editing in the first version.
- PLM integration (Teamcenter, Windchill) — that is an enterprise-scale problem of a different order.

---

*Data model and interface description are separate documents.*
