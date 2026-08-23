# Netrin Interface Contract

`interface-contract.json` is the style-neutral handoff for AI agents and human implementers.
It defines required screens, elements, states, actions, accessibility obligations and the
boundary between application behavior and presentation. It intentionally contains no
colors, fonts, shapes, visual effects or named design styles.

Use it together with a separate creative brief. A generated runtime skin must satisfy the
appearance package schema and validator. A generated phenotype must additionally pass the
TypeScript build, viewport screenshots and release review before it is bundled.
