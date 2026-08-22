# Desky repository guidance

- Read the current codebase and the relevant documents in `docs/` before changing architecture or behavior.
- Plan before implementation. Keep the plan current when scope changes.
- Preserve existing strategic logic and understand it before refactoring it.
- Treat Windows Store, Mac App Store, and direct-download capabilities as separate release profiles. Never silently weaken sandboxing to make an adapter work.
- Do not commit generated packages, downloaded avatar binaries, signing material, temporary files, or dependency directories.
- Do not use placeholder payloads to imply integrations work. Simulation adapters must be visibly labeled and isolated from production adapters.
- Update the relevant architecture, security, adapter, asset, or distribution document when changing a core contract.
- Validate the smallest credible slice before broad implementation.
- Commit every significant, verified round of changes. Do not push unless explicitly requested.
