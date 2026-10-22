A small, real piece of the stop snapshot, for the tests to serve instead of the published one.

Cut from `https://tigerasks.github.io/plan-my-trip-data-stops/` with the same tile format
`tools/refresh-stops.py` writes, trimmed to the stops within 1.7 km of the demo trip's three
points. Real data rather than invented, so the tests exercise the format the planner will actually
meet — including the awkward parts, such as a tile whose first stop has no name.

© OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/).
