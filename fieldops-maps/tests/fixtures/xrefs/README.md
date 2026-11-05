Synthetic reference fixtures generated using the pinned ACadSharp writer, with no customer data.

- `host.dwg`: a blue host line and two inserts of `Survey`, with stored path `C:\Mine\CAD\survey.dwg`. The first insert is at (500000, 7000000), rotated 90° and scaled (2, 3). The second is at (500100, 7000000), without rotation or scaling.
- `survey.dwg`: insertion base (10, 20), a green ByLayer point (11, 22), an attachment `Nested` inserted at (20, 30), and a nested overlay. The nested overlay must not propagate to the host.
- `nested.dwg`: a red point at (1, 1).
- `expected.dxf`: independent world-coordinate geometry: the host line, green points (499994, 7000002) and (500101, 7000002), and red points (499967, 7000022) and (500111, 7000011).

Run `tests/browser-xrefs.html` through the Vite server. Coordinate comparisons use EPSG:7856 solely for this synthetic fixture. `Program.cs.txt` is the generator source; run it in a .NET 10 console project referencing the pinned ACadSharp project and pass the fixture output directory as its argument.

`hatched.dwg` contains a yellow solid hatch with an inner hole and a cyan ANSI31-pattern hatch on separate layers, with insertion base (10,20). `hatches-expected.dxf` contains independently positioned hatch boundaries for the two host inserts. `Hatches.cs.txt` generates this pair. `tests/browser-xref-hatches.html` verifies polygons, holes, CAD colours, layer separation and placement; CAD pattern strokes are represented by solid map fills.
