# Project Photography

Desktop-first 3D photography wheel built with Vite, Three.js, GSAP ScrollTrigger, Lenis, and a Sharp-based image pipeline.

## Experience

- Full-screen sticky 3D stage
- Horizontal picture wheel that rotates as you scroll
- Hover and click interaction on frames
- Small central robot that tracks attention
- Minimal HUD with focus preview and wheel progress

## Stack

- `three` for the 3D scene and robot
- `gsap` + `ScrollTrigger` for scroll-driven wheel rotation
- `lenis` for smooth desktop scrolling
- `sharp` for generating optimized image assets and the photo manifest
- `vite` for development and production builds

## Main Files

- `index.html`: stage shell and minimal HUD
- `styles.css`: clean full-screen layout, atmosphere, cursor, responsive behavior
- `src/main.js`: scroll control, focus panel, progress UI, cursor, controls
- `src/scene.js`: rotating wheel, robot, hover/focus behavior
- `scripts/prepare-photos.mjs`: generates `public/photos` and `src/generated/photos.js`

## Commands

Install dependencies:

```powershell
npm install
```

Rebuild optimized photo assets and manifest:

```powershell
npm run prepare:photos
```

Start the dev server:

```powershell
npm run dev
```

Create a production build:

```powershell
npm run build
```

Preview the production build:

```powershell
npm run preview
```

## Notes

- Source images stay in `Photos/`.
- Generated web-ready images are written to `public/photos/`.
- The build succeeds cleanly, though Vite still warns that the final JavaScript bundle is large because Three.js and the motion libraries are substantial runtime dependencies.
