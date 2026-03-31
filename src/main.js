import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
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
const monthToggle = document.getElementById("monthToggle");
const monthTitle = document.getElementById("monthTitle");
const monthMenu = document.getElementById("monthMenu");
const monthPreview = document.getElementById("monthPreview");
const monthImage = document.getElementById("monthImage");
const monthCopy = document.getElementById("monthCopy");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const canvas = document.getElementById("scene");
const heroMessage = document.getElementById("heroMessage");

document.body.classList.toggle("is-touch", state.inputMode === "touch");
scrollRail.style.height = `${Math.max(300, Math.round((timeline.maxScrollTurn + 1) * 70))}vh`;

let lenis = null;
let gallery = null;
let monthPickerOpen = false;

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
  monthCopy.textContent = "WebGL could not start on this device, but the archive is still loaded.";
}

updateUi();
renderMonthMenu();
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

function getActiveMonth() {
  return timeline.months.find((month) => month.id === state.activeMonthId) ?? timeline.months[0];
}

function getDisplayPhotoForMonth(month) {
  if (!month?.photos?.length) {
    return null;
  }

  return (
    month.photos.find((photo) => photo.id === state.focusedId) ||
    month.photos.find((photo) => photo.id === state.hoveredId) ||
    month.photos.find((photo) => photo.id === state.frontId) ||
    month.photos[0]
  );
}

function updateUi() {
  const activeMonth = getActiveMonth();
  const displayPhoto = getDisplayPhotoForMonth(activeMonth);
  const isIntro = state.scrollProgress < timeline.introThreshold;
  const introFade = 1 - Math.min(state.scrollProgress / Math.max(timeline.introThreshold, 0.001), 1);

  document.body.classList.toggle("is-intro", isIntro);
  document.body.classList.toggle("is-solo", Boolean(state.soloPhotoId));
  wheelRoot.style.setProperty("--hero-opacity", introFade.toFixed(3));
  wheelRoot.style.setProperty("--hero-translate-y", `${(1 - introFade) * -72}px`);

  if (activeMonth) {
    monthTitle.textContent = activeMonth.label;
    monthToggle.setAttribute("aria-expanded", String(monthPickerOpen));
    if (activeMonth.photos.length) {
      monthCopy.textContent = `${activeMonth.photos.length} frame${activeMonth.photos.length === 1 ? "" : "s"} drifting in this month. Click any visible photo to bring it straight to center.`;
    } else {
      monthCopy.textContent = `No image was added in ${activeMonth.label}. The spiral keeps moving to the next available month.`;
    }
  }

  if (displayPhoto) {
    monthImage.src = displayPhoto.srcLarge;
    monthImage.alt = displayPhoto.alt;
    monthPreview.classList.add("has-image");
  } else {
    monthImage.removeAttribute("src");
    monthImage.alt = "";
    monthPreview.classList.remove("has-image");
  }

  progressFill.style.width = `${Math.round(state.scrollProgress * 100)}%`;
  progressLabel.textContent = isIntro
    ? "Welcome to CKY photography"
    : `${activeMonth?.label ?? "Archive"} - ${Math.round(state.scrollProgress * 100)}% through the spiral`;

  renderMonthMenu();
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

  if (shouldScroll) {
    scrollToProgress(photo.targetProgress);
  }
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

function getMonthByProgress(progress) {
  const scrollTurn = progress * timeline.maxScrollTurn;
  const firstMonth = timeline.months[0] ?? null;
  const lastMonth = timeline.months.at(-1) ?? null;

  if (firstMonth && scrollTurn < firstMonth.startTurn) {
    return firstMonth;
  }

  return timeline.months.find((month) => scrollTurn >= month.startTurn && scrollTurn < month.endTurn) ?? lastMonth;
}

function renderMonthMenu() {
  const activeMonthId = state.activeMonthId;
  monthMenu.innerHTML = timeline.months
    .map((month) => {
      const activeClass = month.id === activeMonthId ? " is-active" : "";
      return `
        <button type="button" class="hud__month-option${activeClass}" data-month-id="${month.id}">
          <span class="hud__month-option-label">${month.label}</span>
          <span class="hud__month-option-count">${month.photos.length} frame${month.photos.length === 1 ? "" : "s"}</span>
        </button>
      `;
    })
    .join("");
}

function setMonthPickerOpen(nextValue) {
  monthPickerOpen = nextValue;
  monthToggle.setAttribute("aria-expanded", String(nextValue));
  monthToggle.closest(".hud__month")?.classList.toggle("is-open", nextValue);
}

function setupControls() {
  monthToggle.addEventListener("click", () => {
    setMonthPickerOpen(!monthPickerOpen);
  });

  monthMenu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-month-id]");
    if (!option) {
      return;
    }

    const month = timeline.months.find((item) => item.id === option.dataset.monthId);
    if (!month) {
      return;
    }

    setMonthPickerOpen(false);
    scrollToProgress(month.targetProgress);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!monthPickerOpen) {
      return;
    }

    if (event.target.closest(".hud__month")) {
      return;
    }

    setMonthPickerOpen(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && monthPickerOpen) {
      setMonthPickerOpen(false);
      return;
    }

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
    scrub: reducedMotionQuery.matches ? false : 1,
    onUpdate(self) {
      state.scrollProgress = self.progress;
      state.activeMonthId = getMonthByProgress(self.progress)?.id ?? state.activeMonthId;
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
