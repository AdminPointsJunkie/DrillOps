# Public website layout

Scope: home, EOS, Account, Project, FieldOps, FieldMaps, Support, FieldOps Support, Privacy and FieldOps Privacy. Preserve all product facts, original screenshots, app destinations and legal copy.

- Public pages use one standalone stylesheet, independent of app and brand override styles. The homepage is a public document, not a hidden operational workspace. Old sign-in and recovery URLs forward unchanged to EOS.
- Shared white navigation: 80px desktop / 68px mobile; fixed logo and action slots; identical product links and footer on all pages. Mobile menu below 960px, keyboard accessible and dismissible.
- Shared 1200px content container; 32px side gutters (20px on phones). A 4/8px spacing scale; 80px section spacing desktop, 48px mobile.
- Product introductions use equal columns with top-aligned text and a reserved screenshot area; single column below 800px. All product headings follow the same scale. Screenshots retain aspect ratio and are never cropped.
- Home uses the same grid and typography, with a clear five-product directory. Support and privacy share an 800px reading column and structured cards.
- One responsive system: navigation at 960px; content at 800px; small-phone adjustment at 400px. No horizontal overflow; 44px touch targets; visible focus; reduced-motion support.
- Reserve image dimensions, use a stable local system font stack, and avoid entrance animation to prevent loading jumps.

Validation: all ten pages at 360, 390, 768, 1024 and 1440px; navigation, footer, image loading, long text, menus, links and old sign-in routes. Check generated output is reproducible and app files are unchanged.

## Product positioning and visual direction

Inspired by CorePlan's bold opening hierarchy and clear product calls to action, while using DrillOps colours and authentic screenshots.

- Home: dark green opening panel, real app screenshots, two prominent field-product highlights and a clear five-product directory.
- FieldOps: available now; direct App Store purchase link in the first screen and sticky navigation. Dark green/lime presentation with the actual map screenshot.
- FieldMaps: warm launch panel, coming-soon label, benefit-led introduction and email link to request launch updates. No public registration or launch date claims.
- EOS, Account and Project: restrained business presentation focused on workflows and organisation access.
- Portrait screenshot frames use their image's natural aspect ratio, with captions outside the image. Verify vertical containment as well as horizontal overflow. Detect image formats from file content because two existing .png assets contain JPEG data.
