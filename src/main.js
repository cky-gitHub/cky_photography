// Self-hosted in place of the former fonts.googleapis.com request, which sent
// every visitor's IP to Google before they had agreed to anything.
import "@fontsource/syne/500.css";
import "@fontsource/syne/700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";

import Lenis from "lenis";
import { photoManifest } from "./generated/photos.js";
import { createGallery } from "./gallery.js";
import { createHeroScene } from "./scene.js";
import { createStarfield } from "./starfield.js";
import { createViewer } from "./viewer.js";

const RING_ALBUM_ID = "best";
const LIKES_KEY = "cky-photography:likes";

const desktopQuery = matchMedia("(min-width: 960px) and (pointer: fine)");
const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");

const ringPhotos = photoManifest.filter((photo) => photo.albumId === RING_ALBUM_ID);
const galleryPhotos = photoManifest.filter((photo) => photo.albumId !== RING_ALBUM_ID);

const hero = document.getElementById("hero");
const canvas = document.getElementById("scene");
const speech = document.getElementById("speech");
const heroMessage = document.getElementById("heroMessage");
const scrollCue = document.getElementById("scrollCue");
const cursor = document.getElementById("cursor");

const ROBOT_LINES = [
  "Hi there, welcome to CKY photography!",
  "Drag the ring to spin it.",
  "Scroll down, there's more below.",
  "Tap a photo to see it properly.",
  "Double-tap a photo to like it.",
];
let robotLine = 0;

// ── likes ──────────────────────────────────────────────────────────────────
// Kept in this browser only; nothing is sent anywhere. A ring photo and its
// original in a country folder count as the same photo.
const likes = (() => {
  let ids = new Set();
  try {
    ids = new Set(JSON.parse(localStorage.getItem(LIKES_KEY) ?? "[]"));
  } catch {
    // Storage blocked or corrupt: likes just won't persist.
  }
  const key = (photo) => photo.originalId ?? photo.id;
  const save = () => {
    try {
      localStorage.setItem(LIKES_KEY, JSON.stringify([...ids]));
    } catch {
      // ignore
    }
  };
  return {
    has: (photo) => ids.has(key(photo)),
    toggle(photo) {
      const id = key(photo);
      if (ids.has(id)) {
        ids.delete(id);
      } else {
        ids.add(id);
      }
      save();
      gallery?.syncLikes();
    },
  };
})();

// ── pieces ─────────────────────────────────────────────────────────────────
createStarfield(document.getElementById("stars"), { reducedMotion: reducedMotionQuery.matches });

const viewer = createViewer({ likes });

let lenis = null;
const gallery = createGallery({
  grid: document.getElementById("grid"),
  filters: document.getElementById("filters"),
  summary: document.getElementById("gallerySummary"),
  photos: galleryPhotos,
  likes,
  onOpen(list, index, fromImage) {
    viewer.open(list, index, { from: fromImage });
  },
});

let scene = null;
try {
  scene = createHeroScene({
    canvas,
    photos: ringPhotos,
    reducedMotion: reducedMotionQuery.matches,
    onPhotoSelect(photoId) {
      const index = ringPhotos.findIndex((photo) => photo.id === photoId);
      viewer.open(ringPhotos, index, { fromRect: pointerRect() });
    },
    onRobotClick() {
      robotLine = (robotLine + 1) % ROBOT_LINES.length;
      typeMessage(ROBOT_LINES[robotLine]);
    },
    onHeadMove(x, y) {
      speech.style.setProperty("--head-x", `${x}px`);
      speech.style.setProperty("--head-y", `${y}px`);
      speech.classList.add("is-placed");
    },
    onInputMode(mode) {
      document.body.classList.toggle("is-touch", mode === "touch");
    },
  });
} catch (error) {
  // No WebGL: the gallery below still works; the hero just shows the stars.
  console.error(error);
  canvas.hidden = true;
  hero.classList.add("is-static");
}

// Only draw the 3D hero while it's on screen.
new IntersectionObserver(([entry]) => scene?.setActive(entry.isIntersecting), { threshold: 0 }).observe(hero);

// ── scroll ─────────────────────────────────────────────────────────────────
if (desktopQuery.matches && !reducedMotionQuery.matches) {
  lenis = new Lenis({ duration: 1.15, smoothWheel: true });
  const raf = (time) => {
    lenis.raf(time);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
}

// The hero fades and drifts up as the gallery takes over.
function onScroll() {
  const progress = Math.min(window.scrollY / (hero.offsetHeight * 0.75), 1);
  hero.style.setProperty("--hero-fade", (1 - progress).toFixed(3));
  hero.style.setProperty("--hero-shift", `${(window.scrollY * 0.35).toFixed(1)}px`);
}
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

scrollCue.addEventListener("click", () => {
  const target = document.getElementById("gallery");
  if (lenis) {
    lenis.scrollTo(target, { offset: -8 });
  } else {
    target.scrollIntoView({ behavior: reducedMotionQuery.matches ? "auto" : "smooth" });
  }
});

// Freeze the page behind the viewer.
new MutationObserver(() => {
  const viewing = document.documentElement.classList.contains("is-viewing");
  if (viewing) {
    lenis?.stop();
  } else {
    lenis?.start();
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

// ── deep links ─────────────────────────────────────────────────────────────
function openFromHash() {
  const id = viewer.idFromHash();
  if (!id || viewer.isOpen) {
    return;
  }
  const inGallery = galleryPhotos.findIndex((photo) => photo.id === id);
  if (inGallery >= 0) {
    viewer.open(galleryPhotos, inGallery, { pushHistory: false });
    return;
  }
  const inRing = ringPhotos.findIndex((photo) => photo.id === id);
  if (inRing >= 0) {
    viewer.open(ringPhotos, inRing, { pushHistory: false });
  }
}
openFromHash();
window.addEventListener("hashchange", openFromHash);

// ── the robot's speech bubble ─────────────────────────────────────────────
let typingTimer = 0;
function typeMessage(message) {
  clearTimeout(typingTimer);
  heroMessage.setAttribute("aria-label", message);
  if (reducedMotionQuery.matches) {
    heroMessage.textContent = message;
    heroMessage.classList.add("is-typed");
    return;
  }
  heroMessage.classList.remove("is-typed");
  let index = 0;
  const step = () => {
    index += 1;
    heroMessage.textContent = message.slice(0, index);
    if (index < message.length) {
      typingTimer = setTimeout(step, index < 4 ? 36 : 44);
    } else {
      heroMessage.classList.add("is-typed");
    }
  };
  heroMessage.textContent = "";
  typingTimer = setTimeout(step, 120);
}
setTimeout(() => typeMessage(ROBOT_LINES[0]), 420);

// ── cursor (hero only) ─────────────────────────────────────────────────────
let lastPointer = { x: 0, y: 0 };
function pointerRect() {
  return new DOMRect(lastPointer.x - 40, lastPointer.y - 50, 80, 100);
}
window.addEventListener(
  "pointermove",
  (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (event.pointerType !== "mouse" || !desktopQuery.matches) {
      return;
    }
    const overHero = event.target === canvas;
    cursor.classList.toggle("is-visible", overHero);
    cursor.classList.toggle("is-pointing", canvas.classList.contains("is-pointing"));
    cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  },
  { passive: true },
);
window.addEventListener("pointerdown", (event) => {
  lastPointer = { x: event.clientX, y: event.clientY };
});
document.addEventListener("mouseleave", () => cursor.classList.remove("is-visible"));

reducedMotionQuery.addEventListener("change", (event) => {
  scene?.setReducedMotion(event.matches);
});
