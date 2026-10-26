# Research notes

Design and research notes written while building NSW RealVision: data cleaning, outlier detection,
price smoothing, the LOESS pipeline and heatmap rendering. They record why the code works the way it
does, including options that were considered and rejected. Some describe earlier states of the code;
[../methodology.md](../methodology.md) and [../architecture.md](../architecture.md) describe what it
does now.

| Note | Topic |
|---|---|
| [data-cleaning-outlier-detection.md](data-cleaning-outlier-detection.md) | Nominal transfers, partial interests, duplicates and spatial outliers |
| [spatial-outlier-scalability.md](spatial-outlier-scalability.md) | Why KNN outlier detection fails at scale, and the alternatives compared |
| [price-smoothing-and-index-methods.md](price-smoothing-and-index-methods.md) | Why raw medians are volatile, industry index methods, and trend-fitting and smoothing options |
| [loess-methodology-improvements.md](loess-methodology-improvements.md) | Sale-count weighting, adaptive bandwidth, minimum points and edge bias |
| [full-curve-loess-architecture.md](full-curve-loess-architecture.md) | Precomputing whole LOESS curves instead of endpoints |
| [loess-pipeline-audit.md](loess-pipeline-audit.md) | An audit of the LOESS pipeline end to end |
| [heatmap-value-consistency.md](heatmap-value-consistency.md) | Keeping the heatmap, tooltip and dialog values in agreement |
| [heatmap-consistency-enforcement.md](heatmap-consistency-enforcement.md) | Enforcing that consistency in code |
| [growth-heatmap-feasibility.md](growth-heatmap-feasibility.md) | The original feasibility study for the heatmap |
| [growth-heatmap-advanced-rendering.md](growth-heatmap-advanced-rendering.md) | IDW gradient rendering, DuckDB acceleration, transitions and multi-resolution zoom |
| [growth-heatmap-code-audit.md](growth-heatmap-code-audit.md) | A code audit of the heatmap widget |
| [custom-map-areas.md](custom-map-areas.md) | Drawing polygons, storing areas, and point-in-polygon queries in DuckDB |
