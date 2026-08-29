# ComputeQuest design direction

ComputeQuest is an industrial editorial control room for turning verified attention into compute energy. The visual system follows the supplied Figma critical states: graphite `#17151b`, dark surface `#242129`, warm paper `#f2eee6`, Monad purple `#836ef9`, energy yellow `#f3c94d`, muted lavender-grey `#a9a2ae`, and failure coral `#ff756b`.

The navigation includes a persistent light/dark theme control. Light mode uses white `#ffffff` and soft canvas `#fbfaff` for primary surfaces, Monad ink `#0e091c` for text, current Monad purple `#6e54ff` for brand/action accents, and pale lavender `#ddd7fe` for borders and depth. Energy yellow remains reserved for compute economics and primary task actions, so it retains meaning across both themes. The sponsor video remains dark media inside a light quest console for focus and legibility.

The UI deliberately avoids a dashboard card wall, neon Web3 styling, fake charts, and decorative 3D scenes. Large condensed headlines establish the product idea; mono labels communicate state and evidence. The yellow Compute Cell is the signature object, but its number and label come from the observed session/task ledger: starter balance, funding gap, committed spend, completion, or refund.

The product sequence is Brief → Quest → Settle → Build → Result. Every stage is driven by persisted server state. Missing configuration, paused attention, settlement finalization, already-claimed receipts, provider failures, and refunds must be shown as explicit states. UI language must never convert a submitted transaction, Gemini request, or local check into a confirmed outcome.

Responsive behavior changes the two-column hero and workbench to a single column below 840px, keeps the stage rail horizontally readable, and preserves touch-sized primary actions. Motion should be restrained to state transitions and the eventual confirmed energy transfer; reduced-motion preferences must be respected when motion is introduced.
