# Logo and navigation refinement 02

Design-only review bundle. Application code and the original `frontend/assets/logo.png` were not changed by this revision.

- `figma-import-board.svg`: layered static SVG review board, with two launch-theme treatments and eight selected-tab states. Vector navigation icons and surfaces; logos remain raster images. It is not a `.fig` file, component library, auto-layout layout, or clickable prototype. Actual Figma import has not been verified.
- `figma-import-board.png`: visual reference rendered locally from the SVG.
- `logo-theme-preview.webm`: verified 804×680, 30fps, 1.533-second motion comparison. The video combines logo and navigation for review; the separate launch designs in the SVG have no bottom tabs.
- `logo-{light,dark}-{full,left,right}.png`: transparent 512×512 logo assets preserving the original shape through source masks, rather than a new drawing.
- `navigation-{light,dark}.png`: selected-Home button references.

The 48×32 active-icon pill is now opaque brand colour, with a contrasting icon, bold active label, and equal touch slots. Contrast checks: active icon 4.63:1 light / 7.19:1 dark; active label 4.63:1 / 6.92:1; inactive label 5.70:1 / 7.34:1. No faded active-label opacity.

The two logo figures move inward with small opposing rotations, settling without bounce. The name and helper line follow. Completion is approximately 1.04 seconds, once only; reduced-motion rendering is static. Future integration must never block an in-progress emergency report behind this motion.

Local preview checks passed: widths 320/390/430/768/1000 without horizontal overflow; minimum actual hit targets 67×60; Enter-key selection; unique SVG IDs; simulated 200% text enlargement; representative long English/Hindi labels without clipping; static reduced motion; successful WebM decoding; no page errors. These are artifact checks, not Android/emulator or whole-application test results.

## Figma status

Existing draft: https://www.figma.com/design/9oxxtLsIL1QNegeG7C9wkR

The connected account was checked on 2026-10-07 and still reports Starter / View. The earlier MCP tool-call quota error has not been resolved by a confirmed plan/seat change. This revision did not modify the actual Figma canvas. Existing-screen navigation overrides, native logo imports, prototype links, and remaining screen QA are still pending.

For a manual review, import the SVG into the existing Figma Design canvas with edit access. Check image/font fidelity there; separate PNG assets are included if an embedded image does not import correctly. Figma's import guidance: https://help.figma.com/hc/en-us/articles/360040030374-Copy-assets-between-design-tools

An approved Education plan can have higher MCP limits than the currently connected Starter/View plan. Student-email login alone does not confirm that approval or change the account already authorized in this connector. Re-authorize the intended Figma account and verify its returned plan/seat before retrying canvas work. Official limits: https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/

See `frontend-tech-plan.md` for the focused UI technology recommendations. No dependency or paid software was installed.
