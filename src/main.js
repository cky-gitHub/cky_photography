import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { MathUtils } from "three";
import { photoManifest } from "./generated/photos.js";
import { createGalleryScene } from "./scene.js";

gsap.registerPlugin(ScrollTrigger);

const desktopQuery = matchMedia("(min-width: 960px) and (pointer: fine)");
const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const RING_ALBUM_ID = "best";

const allPhotos = [...photoManifest];
const ringPhotos = allPhotos.filter((photo) => photo.albumId === RING_ALBUM_ID);
const timeline = buildTimeline(ringPhotos);
const albumDirectory = buildAlbumDirectory(allPhotos);
const photoById = new Map(timeline.photos.map((photo) => [photo.id, photo]));

const state = {
  hoveredId: null,
  focusedId: null,
  soloPhotoId: null,
  openAlbumId: null,
  frontId: timeline.photos[0]?.id ?? null,
  activeAlbumId: albumDirectory[0]?.id ?? null,
  scrollProgress: 0,
  pointerWorldTarget: { x: 0, y: 1.4, z: 0 },
  inputMode: desktopQuery.matches ? "mouse" : "touch",
};

const cursor = document.getElementById("cursor");
const wheelRoot = document.getElementById("wheelRoot");
const scrollRail = document.getElementById("scrollRail");
const monthRails = document.getElementById("monthRails");
const monthColumnLeft = document.getElementById("monthColumnLeft");
const monthColumnRight = document.getElementById("monthColumnRight");
const monthGallery = document.getElementById("monthGallery");
const monthGalleryTitle = document.getElementById("monthGalleryTitle");
const monthGalleryCount = document.getElementById("monthGalleryCount");
const monthGalleryGrid = document.getElementById("monthGalleryGrid");
const monthGalleryClose = document.getElementById("monthGalleryClose");
const canvas = document.getElementById("scene");
const heroMessage = document.getElementById("heroMessage");
const albumLookup = new Map(albumDirectory.map((album) => [album.id, album]));
const albumRailColumns = buildAlbumRailColumns(albumDirectory);
const monthRailTravel = Math.max(2200, (Math.max(albumRailColumns.left.length, albumRailColumns.right.length) - 1) * 420);

document.body.classList.toggle("is-touch", state.inputMode === "touch");
scrollRail.style.height = `${Math.max(300, Math.round((timeline.maxScrollTurn + 1) * 70))}vh`;

let lenis = null;
let gallery = null;
let monthPlateColumns = [];
let lockedScrollY = 0;

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
    onAlbumChange(albumId) {
      state.activeAlbumId = albumId;
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
renderAlbumGallery();
updateUi();
playHeroTyping();
setupScroll();
setupCursor();
setupControls();
setupAlbumGallery();

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

function buildAlbumDirectory(photos) {
  const grouped = new Map();

  for (const photo of photos) {
    if (photo.albumId === RING_ALBUM_ID) {
      continue;
    }

    if (!grouped.has(photo.albumId)) {
      grouped.set(photo.albumId, {
        id: photo.albumId,
        label: photo.albumLabel,
        photos: [],
      });
    }

    grouped.get(photo.albumId).photos.push(photo);
  }

  return [...grouped.values()].sort((left, right) => {
    const leftTimestamp = Date.parse(left.photos[0]?.capturedAt ?? "1970-01-01T00:00:00.000Z");
    const rightTimestamp = Date.parse(right.photos[0]?.capturedAt ?? "1970-01-01T00:00:00.000Z");
    return rightTimestamp - leftTimestamp || left.label.localeCompare(right.label);
  });
}

function formatMonthLabel(monthId) {
  const [year, month] = monthId.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function createAlbumRailItem(album) {
  return {
    id: album.id,
    label: album.label,
    photos: album.photos,
    previewPhoto: album.photos.find((photo) => photo.isCover) ?? album.photos[0] ?? null,
    key: album.id,
  };
}

function buildAlbumRailColumns(albums) {
  return albums.reduce(
    (columns, album, index) => {
      const side = index % 2 === 0 ? "left" : "right";
      columns[side].push(createAlbumRailItem(album));
      return columns;
    },
    { left: [], right: [] },
  );
}

function splitDisplayLabel(label) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return [label, ""];
  }

  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint).join(" "), words.slice(midpoint).join(" ")];
}

function buildAlbumPlateMarkup(item, index) {
  const [titleLine, subtitleLine] = splitDisplayLabel(item.label);
  const previewPhoto = item.previewPhoto;
  const countLabel = `${item.photos.length} photo${item.photos.length === 1 ? "" : "s"}`;

  return `
    <div
      class="hud__month-plate-slot"
      data-month-plate-id="${item.id}"
      data-month-plate-key="${item.key}"
      data-month-plate-index="${index}"
    >
      <article
        class="hud__month-plate"
        tabindex="0"
        role="button"
        aria-label="Open ${item.label} album"
      >
        <p class="hud__month-plate-kicker">Album in view</p>
        <h2 class="hud__month-plate-title">
          <span class="hud__month-plate-title-line">${titleLine}</span>
          <span class="hud__month-plate-title-line">${subtitleLine}</span>
        </h2>
        <div class="hud__month-plate-preview">
          ${previewPhoto ? `<img class="hud__month-plate-image" src="${previewPhoto.src}" alt="${previewPhoto.alt}" loading="lazy" />` : ""}
        </div>
        <p class="hud__month-plate-copy">${countLabel}</p>
      </article>
    </div>
  `;
}

function renderMonthRails() {
  monthColumnLeft.innerHTML = albumRailColumns.left.map((album, index) => buildAlbumPlateMarkup(album, index)).join("");
  monthColumnRight.innerHTML = albumRailColumns.right.map((album, index) => buildAlbumPlateMarkup(album, index)).join("");
  monthPlateColumns = [
    [...monthColumnLeft.querySelectorAll("[data-month-plate-index]")],
    [...monthColumnRight.querySelectorAll("[data-month-plate-index]")],
  ];
  updateMonthRailState();
}

function buildAlbumGalleryMarkup(photo) {
  return `
    <article class="month-gallery__card">
      <div class="month-gallery__image-frame">
        <img class="month-gallery__image" src="${photo.srcLarge}" alt="${photo.alt}" loading="lazy" decoding="async" />
        <p class="month-gallery__label">${photo.label}</p>
      </div>
    </article>
  `;
}

function renderAlbumGallery() {
  const album = state.openAlbumId ? albumLookup.get(state.openAlbumId) ?? null : null;

  if (!album) {
    monthGallery.hidden = true;
    monthGalleryTitle.textContent = "";
    monthGalleryCount.textContent = "";
    monthGalleryGrid.innerHTML = "";
    return;
  }

  monthGallery.hidden = false;
  monthGalleryTitle.textContent = album.label;
  monthGalleryCount.textContent = `${album.photos.length} photo${album.photos.length === 1 ? "" : "s"} in this album`;
  monthGalleryGrid.innerHTML = album.photos.map((photo) => buildAlbumGalleryMarkup(photo)).join("");
}

function lockPageScroll() {
  lockedScrollY = window.scrollY;
  lenis?.stop();
  document.body.classList.add("is-month-gallery-open");
  document.body.style.top = `-${lockedScrollY}px`;
}

function unlockPageScroll() {
  document.body.classList.remove("is-month-gallery-open");
  document.body.style.top = "";
  window.scrollTo(0, lockedScrollY);
  lenis?.start();
  ScrollTrigger.update();
}

function openAlbumGallery(albumId) {
  if (!albumLookup.has(albumId)) {
    return;
  }

  const wasOpen = Boolean(state.openAlbumId);
  state.openAlbumId = albumId;
  renderAlbumGallery();
  if (!wasOpen) {
    lockPageScroll();
  }
  updateUi();
  monthGalleryClose?.focus({ preventScroll: true });
}

function closeAlbumGallery() {
  if (!state.openAlbumId) {
    return;
  }

  state.openAlbumId = null;
  renderAlbumGallery();
  unlockPageScroll();
  updateUi();
}

function getMonthRailMotion() {
  const progress = MathUtils.clamp((state.scrollProgress - 0.2) / 0.8, 0, 1);
  const visibility = MathUtils.smoothstep(state.scrollProgress, 0.2, 0.3);
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
      const normalizedDistance = Math.min(distance / Math.max(window.innerHeight * 0.84, 360), 1);
      const opacity = MathUtils.lerp(1, 0.16, normalizedDistance);
      const blur = MathUtils.lerp(0, 2.6, normalizedDistance);
      const offsetX = inwardDirection * MathUtils.lerp(16, 0, normalizedDistance);
      const card = plate.querySelector(".hud__month-plate");

      card?.classList.toggle("is-active", plate === activePlate);
      card?.style.setProperty("--plate-opacity", opacity.toFixed(3));
      card?.style.setProperty("--plate-scale", "1");
      card?.style.setProperty("--plate-offset-x", `${offsetX.toFixed(1)}px`);
      card?.style.setProperty("--plate-blur", `${blur.toFixed(2)}px`);
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

function setupAlbumGallery() {
  monthRails?.addEventListener("click", (event) => {
    const plate = event.target.closest("[data-month-plate-id]");
    if (!plate) {
      return;
    }

    openAlbumGallery(plate.dataset.monthPlateId);
  });

  monthRails?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const plate = event.target.closest("[data-month-plate-id]");
    if (!plate) {
      return;
    }

    event.preventDefault();
    openAlbumGallery(plate.dataset.monthPlateId);
  });

  monthGalleryClose?.addEventListener("click", closeAlbumGallery);
  monthGallery?.querySelector("[data-month-gallery-close]")?.addEventListener("click", closeAlbumGallery);
}

function setupControls() {
  window.addEventListener("keydown", (event) => {
    if (state.openAlbumId) {
      if (event.key === "Escape") {
        closeAlbumGallery();
      }
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
