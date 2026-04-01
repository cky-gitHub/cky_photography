import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { MathUtils } from "three";
import { photoManifest } from "./generated/photos.js";
import { createGalleryScene } from "./scene.js";

gsap.registerPlugin(ScrollTrigger);

const desktopQuery = matchMedia("(min-width: 960px) and (pointer: fine)");
const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");

const timeline = buildTimeline(photoManifest);
const photoById = new Map(timeline.photos.map((photo) => [photo.id, photo]));

const state = {
  hoveredId: null,
  focusedId: null,
  soloPhotoId: null,
  frontId: timeline.photos[0]?.id ?? null,
  activeMonthId: timeline.months[0]?.id ?? null,
  scrollProgress: 0,
  pointerWorldTarget: { x: 0, y: 1.4, z: 0 },
  inputMode: desktopQuery.matches ? "mouse" : "touch",
};

const cursor = document.getElementById("cursor");
const wheelRoot = document.getElementById("wheelRoot");
const scrollRail = document.getElementById("scrollRail");
const monthColumnLeft = document.getElementById("monthColumnLeft");
const monthColumnRight = document.getElementById("monthColumnRight");
const canvas = document.getElementById("scene");
const heroMessage = document.getElementById("heroMessage");
const monthRailMonths = buildMonthRailMonths(timeline.months);
const monthRailTravel = Math.max(0, (monthRailMonths.length - 3) * 214);

document.body.classList.toggle("is-touch", state.inputMode === "touch");
scrollRail.style.height = `${Math.max(300, Math.round((timeline.maxScrollTurn + 1) * 70))}vh`;

let lenis = null;
let gallery = null;
let monthPlateColumns = [];

try {
  gallery = createGalleryScene({
    canvas,
    months: timeline.months,
    photos: timeline.photos,
    maxScrollTurn: timeline.maxScrollTurn,
    state,
    reducedMotion: reducedMotionQuery.matches,
    onHover(photoId) {
      state.hoveredId = photoId;
      updateUi();
    },
    onFocus(photoId) {
      state.focusedId = photoId;
      updateUi();
    },
    onFrontPhotoChange(photoId) {
      state.frontId = photoId;
      updateUi();
    },
    onMonthChange(monthId) {
      state.activeMonthId = monthId;
      updateUi();
    },
    onPhotoSelect(photoId) {
      selectPhoto(photoId, true);
    },
    onInputMode(mode) {
      state.inputMode = mode;
      document.body.classList.toggle("is-touch", mode === "touch");
      if (mode === "touch") {
        cursor.classList.remove("is-visible");
      }
    },
  });
} catch (error) {
  console.error(error);
  canvas.hidden = true;
}

renderMonthRails();
updateUi();
playHeroTyping();
setupScroll();
setupCursor();
setupControls();

function buildTimeline(photos) {
  const grouped = new Map();
  for (const photo of photos) {
    if (!grouped.has(photo.monthId)) {
      grouped.set(photo.monthId, []);
    }
    grouped.get(photo.monthId).push(photo);
  }

  const INTRO_TURNS = 0.9;
  const MONTH_RING_TURNS = 0.9;
  const MONTH_GAP_TURNS = 0.26;
  const OUTRO_TURNS = 1.08;

  const monthIds = [...grouped.keys()].sort().reverse();

  let cursorTurn = INTRO_TURNS;
  const months = monthIds.map((monthId, index) => {
    const photosInMonth = [...(grouped.get(monthId) ?? [])].sort((left, right) => left.order - right.order);
    const startTurn = cursorTurn;

    const preparedPhotos = photosInMonth.map((photo, photoIndex) => {
      const t =
        photosInMonth.length === 1
          ? 0.5
          : 0.06 + (photoIndex / (photosInMonth.length - 1)) * 0.84;

      return {
        ...photo,
        monthIndex: index,
        spiralTurn: startTurn + t * MONTH_RING_TURNS,
      };
    });

    const endTurn = startTurn + MONTH_RING_TURNS;
    cursorTurn = endTurn + MONTH_GAP_TURNS;

    return {
      id: monthId,
      index,
      label: formatMonthLabel(monthId),
      startTurn,
      endTurn,
      photos: preparedPhotos,
      previewPhotoId: preparedPhotos[0]?.id ?? null,
    };
  });

  const maxScrollTurn = cursorTurn + OUTRO_TURNS;
  const allPhotos = months.flatMap((month) =>
    month.photos.map((photo) => ({
      ...photo,
      targetProgress: photo.spiralTurn / maxScrollTurn,
    })),
  );
  const photosById = new Map(allPhotos.map((photo) => [photo.id, photo]));

  return {
    months: months.map((month) => ({
      ...month,
      photos: month.photos.map((photo) => photosById.get(photo.id)),
      previewPhotoId: month.previewPhotoId,
      targetProgress: (((month.startTurn + month.endTurn) / 2) / maxScrollTurn),
    })),
    photos: allPhotos,
    maxScrollTurn,
    introThreshold: Math.max(0.04, (INTRO_TURNS - 0.22) / maxScrollTurn),
  };
}

function formatMonthLabel(monthId) {
  const [year, month] = monthId.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildMonthRailMonths(months) {
  if (!months.length) {
    return [];
  }

  const filled = [];
  const targetLength = Math.max(9, months.length * 3);
  while (filled.length < targetLength) {
    const month = months[filled.length % months.length];
    filled.push({
      key: `${month.id}-${filled.length}`,
      month,
    });
  }
  return filled;
}

function splitMonthLabel(label) {
  const lastSpaceIndex = label.lastIndexOf(" ");
  if (lastSpaceIndex === -1) {
    return [label, ""];
  }

  return [label.slice(0, lastSpaceIndex), label.slice(lastSpaceIndex + 1)];
}

function buildMonthPlateMarkup(item, index) {
  const { month, key } = item;
  const [monthLine, yearLine] = splitMonthLabel(month.label);
  const previewPhoto = month.photos[0] ?? null;
  const countLabel = `${month.photos.length} frame${month.photos.length === 1 ? "" : "s"}`;

  return `
    <article class="hud__month-plate" data-month-plate-id="${month.id}" data-month-plate-key="${key}" data-month-plate-index="${index}">
      <p class="hud__month-plate-kicker">Month in view</p>
      <h2 class="hud__month-plate-title">
        <span class="hud__month-plate-title-line">${monthLine}</span>
        <span class="hud__month-plate-title-line">${yearLine}</span>
      </h2>
      <div class="hud__month-plate-preview">
        ${previewPhoto ? `<img class="hud__month-plate-image" src="${previewPhoto.src}" alt="${previewPhoto.alt}" loading="lazy" />` : ""}
      </div>
      <p class="hud__month-plate-copy">${countLabel}</p>
    </article>
  `;
}

function renderMonthRails() {
  const markup = monthRailMonths.map((month, index) => buildMonthPlateMarkup(month, index)).join("");
  monthColumnLeft.innerHTML = markup;
  monthColumnRight.innerHTML = markup;
  monthPlateColumns = [
    [...monthColumnLeft.querySelectorAll("[data-month-plate-index]")],
    [...monthColumnRight.querySelectorAll("[data-month-plate-index]")],
  ];
  updateMonthRailState();
}

function getMonthRailMotion() {
  const progress = MathUtils.clamp((state.scrollProgress - 0.2) / 0.58, 0, 1);
  const visibility =
    MathUtils.smoothstep(state.scrollProgress, 0.2, 0.3) *
    (1 - MathUtils.smoothstep(state.scrollProgress, 0.6, 0.75));
  const shift = MathUtils.lerp(400, -monthRailTravel, progress);

  return { progress, visibility, shift };
}

function updateMonthRailState() {
  monthPlateColumns.forEach((column, columnIndex) => {
    const inwardDirection = columnIndex === 0 ? 1 : -1;
    const viewportCenterY = window.innerHeight * 0.5;
    let activePlate = null;
    let activeDistance = Number.POSITIVE_INFINITY;

    for (const plate of column) {
      const rect = plate.getBoundingClientRect();
      const centerY = rect.top + rect.height * 0.5;
      const distance = Math.abs(centerY - viewportCenterY);

      if (distance < activeDistance) {
        activeDistance = distance;
        activePlate = plate;
      }
    }

    column.forEach((plate) => {
      const rect = plate.getBoundingClientRect();
      const centerY = rect.top + rect.height * 0.5;
      const distance = Math.abs(centerY - viewportCenterY);
      const normalizedDistance = Math.min(distance / Math.max(window.innerHeight * 0.64, 180), 1);
      const opacity = MathUtils.lerp(1, 0.16, normalizedDistance);
      const scale = MathUtils.lerp(1.06, 0.88, normalizedDistance);
      const blur = MathUtils.lerp(0, 2.6, normalizedDistance);
      const offsetX = inwardDirection * MathUtils.lerp(16, 0, normalizedDistance);

      plate.classList.toggle("is-active", plate === activePlate);
      plate.style.setProperty("--plate-opacity", opacity.toFixed(3));
      plate.style.setProperty("--plate-scale", scale.toFixed(3));
      plate.style.setProperty("--plate-offset-x", `${offsetX.toFixed(1)}px`);
      plate.style.setProperty("--plate-blur", `${blur.toFixed(2)}px`);
    });
  });
}

function updateUi() {
  const isIntro = state.scrollProgress < timeline.introThreshold;
  const introFade = 1 - Math.min(state.scrollProgress / Math.max(timeline.introThreshold, 0.001), 1);
  const monthRailMotion = getMonthRailMotion();

  document.body.classList.toggle("is-intro", isIntro);
  document.body.classList.toggle("is-solo", Boolean(state.soloPhotoId));
  wheelRoot.style.setProperty("--hero-opacity", introFade.toFixed(3));
  wheelRoot.style.setProperty("--hero-translate-y", `${(1 - introFade) * -72}px`);
  wheelRoot.style.setProperty("--month-rails-opacity", monthRailMotion.visibility.toFixed(3));
  wheelRoot.style.setProperty("--month-rails-shift", `${monthRailMotion.shift.toFixed(1)}px`);
  updateMonthRailState();
}

function setFocusedPhoto(photoId) {
  state.focusedId = photoId;
  if (photoId) {
    gallery?.focusPhoto(photoId);
  } else {
    state.soloPhotoId = null;
    gallery?.clearSoloView();
    gallery?.clearFocus();
  }
  updateUi();
}

function setSoloPhoto(photoId) {
  state.soloPhotoId = photoId;
  gallery?.setSoloPhoto(photoId);
  updateUi();
}

function clearSoloPhoto() {
  state.soloPhotoId = null;
  gallery?.clearSoloView();
  updateUi();
}

function selectPhoto(photoId, shouldScroll) {
  const photo = photoById.get(photoId);
  if (!photo) {
    return;
  }

  if (state.soloPhotoId === photo.id) {
    clearSoloPhoto();
    return;
  }

  if (state.focusedId === photo.id && !state.soloPhotoId) {
    setSoloPhoto(photo.id);
    return;
  }

  state.hoveredId = null;
  clearSoloPhoto();
  setFocusedPhoto(photo.id);
}

function cyclePhoto(direction) {
  if (!timeline.photos.length) {
    return;
  }

  const currentPhoto =
    photoById.get(state.focusedId) ||
    photoById.get(state.hoveredId) ||
    photoById.get(state.frontId) ||
    timeline.photos[0];

  const currentIndex = timeline.photos.findIndex((photo) => photo.id === currentPhoto?.id);
  const next = timeline.photos[(currentIndex + direction + timeline.photos.length) % timeline.photos.length];
  selectPhoto(next.id, true);
}

function setupControls() {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.soloPhotoId) {
      clearSoloPhoto();
      return;
    }

    if (event.key === "Escape") {
      setFocusedPhoto(null);
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      cyclePhoto(1);
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      cyclePhoto(-1);
    }
  });
}

function setupScroll() {
  if (desktopQuery.matches && !reducedMotionQuery.matches) {
    lenis = new Lenis({
      duration: 1.2,
      smoothWheel: true,
      smoothTouch: false,
    });

    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => {
      lenis?.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);
  }

  ScrollTrigger.create({
    trigger: wheelRoot,
    start: "top top",
    end: "bottom bottom",
    scrub: reducedMotionQuery.matches ? false : true,
    onUpdate(self) {
      state.scrollProgress = self.progress;
      updateUi();
      gallery?.setScrollProgress(self.progress);
    },
  });

  ScrollTrigger.refresh();
}

function scrollToProgress(progress) {
  const clampedProgress = Math.max(0, Math.min(progress, 0.999));
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const targetY = scrollable * clampedProgress;

  if (lenis) {
    lenis.scrollTo(targetY, {
      duration: reducedMotionQuery.matches ? 0 : 1.3,
    });
    return;
  }

  window.scrollTo({
    top: targetY,
    behavior: reducedMotionQuery.matches ? "auto" : "smooth",
  });
}

function setupCursor() {
  const cursorState = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };

  window.addEventListener(
    "pointermove",
    (event) => {
      if (state.inputMode !== "mouse" || !desktopQuery.matches) {
        return;
      }

      const nextX = event.clientX;
      const nextY = event.clientY;
      cursorState.vx = nextX - cursorState.x;
      cursorState.vy = nextY - cursorState.y;
      cursorState.x = nextX;
      cursorState.y = nextY;

      const speed = Math.min(Math.hypot(cursorState.vx, cursorState.vy), 28);
      const angle = Math.atan2(cursorState.vy, cursorState.vx);
      const stretchX = 1 + speed * 0.018;
      const stretchY = Math.max(0.82, 1 - speed * 0.01);

      cursor.style.transform = `translate(${cursorState.x - 43}px, ${cursorState.y - 43}px) rotate(${angle}rad) scale(${stretchX}, ${stretchY})`;
      cursor.classList.add("is-visible");
    },
    { passive: true },
  );

  window.addEventListener("blur", () => {
    cursor.classList.remove("is-visible");
  });
}

function playHeroTyping() {
  if (!heroMessage) {
    return;
  }

  const message = heroMessage.dataset.message ?? "";
  const reducedMotion = reducedMotionQuery.matches;

  heroMessage.textContent = reducedMotion ? message : "";
  heroMessage.classList.toggle("is-typed", reducedMotion);

  if (reducedMotion) {
    return;
  }

  let index = 0;
  const step = () => {
    index += 1;
    heroMessage.textContent = message.slice(0, index);

    if (index < message.length) {
      window.setTimeout(step, index < 4 ? 36 : 48);
      return;
    }

    heroMessage.classList.add("is-typed");
  };

  window.setTimeout(step, 520);
}

reducedMotionQuery.addEventListener("change", (event) => {
  gallery?.setReducedMotion(event.matches);
});
