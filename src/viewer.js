const ICONS = {
  heart:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3l-1.2-1.1C6.2 15 3.2 12.3 3.2 8.9 3.2 6.2 5.3 4.1 8 4.1c1.5 0 3 .7 4 1.9 1-1.2 2.5-1.9 4-1.9 2.7 0 4.8 2.1 4.8 4.8 0 3.4-3 6.1-7.6 10.3L12 20.3z"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/></svg>',
  share:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
};

const HASH_PREFIX = "#photo/";

/**
 * Full-screen viewer. Black, the photo as large as it fits, and a thin row of
 * controls that fades out when the pointer rests so nothing sits on the image.
 *
 * Opening pushes a history entry, so the back button closes it and a copied
 * URL reopens the same photo.
 */
export function createViewer({ likes, onClose }) {
  const root = document.createElement("div");
  root.className = "viewer";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Photo viewer");
  root.dataset.lenisPrevent = "";
  root.innerHTML = `
    <div class="viewer__backdrop"></div>
    <div class="viewer__stage">
      <img class="viewer__image" alt="" draggable="false" />
      <span class="viewer__burst" aria-hidden="true">${ICONS.heart}</span>
    </div>
    <div class="viewer__bar">
      <p class="viewer__meta">
        <span class="viewer__country"></span>
        <span class="viewer__count"></span>
      </p>
      <div class="viewer__actions">
        <button class="viewer__action viewer__like" type="button" aria-pressed="false" aria-label="Like">
          ${ICONS.heart}<span class="viewer__action-label">Like</span>
        </button>
        <a class="viewer__action viewer__download" href="" download aria-label="Download">
          ${ICONS.download}<span class="viewer__action-label">Download</span>
        </a>
        <button class="viewer__action viewer__share" type="button" aria-label="Copy link">
          ${ICONS.share}<span class="viewer__action-label">Share</span>
        </button>
        <button class="viewer__action viewer__close" type="button" aria-label="Close">
          ${ICONS.close}
        </button>
      </div>
    </div>
    <button class="viewer__nav viewer__nav--prev" type="button" aria-label="Previous photo">${ICONS.prev}</button>
    <button class="viewer__nav viewer__nav--next" type="button" aria-label="Next photo">${ICONS.next}</button>
    <p class="viewer__toast" role="status" aria-live="polite"></p>
  `;
  document.body.append(root);

  const stage = root.querySelector(".viewer__stage");
  const image = root.querySelector(".viewer__image");
  const burst = root.querySelector(".viewer__burst");
  const countryEl = root.querySelector(".viewer__country");
  const countEl = root.querySelector(".viewer__count");
  const likeButton = root.querySelector(".viewer__like");
  const downloadLink = root.querySelector(".viewer__download");
  const shareButton = root.querySelector(".viewer__share");
  const closeButton = root.querySelector(".viewer__close");
  const prevButton = root.querySelector(".viewer__nav--prev");
  const nextButton = root.querySelector(".viewer__nav--next");
  const toast = root.querySelector(".viewer__toast");

  let list = [];
  let index = 0;
  let isOpen = false;
  let pushedHistory = false;
  let returnFocus = null;
  let idleTimer = 0;
  let toastTimer = 0;
  let loadToken = 0;
  const preloaded = new Set();

  const current = () => list[index];

  /** The box the photo occupies: as large as fits, never upscaled past its pixels. */
  function fitRect(photo) {
    const narrow = window.innerWidth < 720;
    const padX = narrow ? 0 : 88;
    const padTop = narrow ? 64 : 76;
    const padBottom = narrow ? 64 : 48;
    const maxWidth = window.innerWidth - padX * 2;
    const maxHeight = window.innerHeight - padTop - padBottom;
    let width = Math.min(maxWidth, photo.width);
    let height = width / photo.aspect;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * photo.aspect;
    }
    return {
      left: (window.innerWidth - width) / 2,
      top: padTop + (maxHeight - height) / 2,
      width,
      height,
    };
  }

  function placeImage(photo) {
    const rect = fitRect(photo);
    image.style.left = `${rect.left}px`;
    image.style.top = `${rect.top}px`;
    image.style.width = `${rect.width}px`;
    image.style.height = `${rect.height}px`;
    return rect;
  }

  function preload(photo) {
    if (!photo || preloaded.has(photo.srcLarge)) {
      return;
    }
    preloaded.add(photo.srcLarge);
    const img = new Image();
    img.decoding = "async";
    img.src = photo.srcLarge;
  }

  function show(photo, direction = 0) {
    const token = ++loadToken;
    const rect = placeImage(photo);
    image.alt = photo.alt;
    // The grid's thumbnail is already cached: show it at once, swap in the
    // large file when it arrives, in the same box so nothing jumps.
    image.src = photo.thumb;
    image.classList.remove("is-sharp");
    const large = new Image();
    large.decoding = "async";
    large.onload = () => {
      if (token !== loadToken) {
        return;
      }
      image.src = photo.srcLarge;
      image.classList.add("is-sharp");
    };
    large.src = photo.srcLarge;

    if (direction) {
      image.animate(
        [
          { opacity: 0, transform: `translateX(${direction * 28}px)` },
          { opacity: 1, transform: "translateX(0)" },
        ],
        { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
    }

    countryEl.textContent = photo.country ?? "";
    countEl.textContent = list.length > 1 ? `${index + 1} / ${list.length}` : "";
    downloadLink.href = photo.srcLarge;
    downloadLink.setAttribute("download", `cky-photography-${photo.id}.jpg`);
    syncLike();
    prevButton.hidden = list.length < 2;
    nextButton.hidden = list.length < 2;
    preload(list[(index + 1) % list.length]);
    preload(list[(index - 1 + list.length) % list.length]);
    return rect;
  }

  function syncLike() {
    const photo = current();
    if (!photo) {
      return;
    }
    const liked = likes.has(photo);
    likeButton.setAttribute("aria-pressed", String(liked));
    likeButton.setAttribute("aria-label", liked ? "Unlike" : "Like");
    likeButton.querySelector(".viewer__action-label").textContent = liked ? "Liked" : "Like";
  }

  function toggleLike(forceOn = false) {
    const photo = current();
    if (!photo) {
      return;
    }
    const liked = likes.has(photo);
    if (liked && forceOn) {
      popBurst();
      return;
    }
    likes.toggle(photo);
    syncLike();
    if (!liked) {
      popBurst();
      likeButton.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }],
        { duration: 340, easing: "ease-out" },
      );
    }
  }

  function popBurst() {
    burst.classList.remove("is-popping");
    void burst.offsetWidth;
    burst.classList.add("is-popping");
  }

  function hashFor(photo) {
    return `${location.pathname}${location.search}${HASH_PREFIX}${encodeURIComponent(photo.id)}`;
  }

  async function share() {
    const photo = current();
    const url = `${location.origin}${hashFor(photo)}`;
    const title = photo.country ? `A photograph from ${photo.country}` : "A photograph";
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      flash("Link copied");
    } catch (error) {
      if (error?.name !== "AbortError") {
        flash("Couldn't copy the link");
      }
    }
  }

  function flash(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
  }

  function go(step) {
    if (list.length < 2) {
      return;
    }
    index = (index + step + list.length) % list.length;
    show(current(), step);
    history.replaceState(history.state, "", hashFor(current()));
    wake();
  }

  function wake() {
    root.classList.remove("is-idle");
    clearTimeout(idleTimer);
    if (matchMedia("(hover: hover)").matches) {
      idleTimer = setTimeout(() => root.classList.add("is-idle"), 2600);
    }
  }

  /**
   * @param {object[]} photos the sequence to step through
   * @param {number} startIndex
   * @param {{ from?: Element | null, fromRect?: DOMRect | null, pushHistory?: boolean }} options
   */
  function open(photos, startIndex, { from = null, fromRect = null, pushHistory = true } = {}) {
    list = photos;
    index = Math.max(0, Math.min(startIndex, photos.length - 1));
    returnFocus = from ?? document.activeElement;

    root.hidden = false;
    document.documentElement.classList.add("is-viewing");
    const rect = show(current());

    // Grow out of the thumbnail that was clicked.
    const origin = fromRect ?? from?.getBoundingClientRect?.();
    if (origin && origin.width > 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const scale = origin.width / rect.width;
      const dx = origin.left + origin.width / 2 - (rect.left + rect.width / 2);
      const dy = origin.top + origin.height / 2 - (rect.top + rect.height / 2);
      image.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, borderRadius: `${4 / scale}px` },
          { transform: "none", borderRadius: "2px" },
        ],
        { duration: 460, easing: "cubic-bezier(.2,.75,.15,1)" },
      );
    }

    requestAnimationFrame(() => root.classList.add("is-open"));
    isOpen = true;
    if (pushHistory) {
      history.pushState({ viewer: true }, "", hashFor(current()));
      pushedHistory = true;
    } else {
      pushedHistory = false;
    }
    closeButton.focus({ preventScroll: true });
    wake();
  }

  function close({ fromHistory = false } = {}) {
    if (!isOpen) {
      return;
    }
    isOpen = false;
    loadToken += 1;
    root.classList.remove("is-open", "is-idle");
    document.documentElement.classList.remove("is-viewing");
    setTimeout(() => {
      if (!isOpen) {
        root.hidden = true;
        image.removeAttribute("src");
      }
    }, 260);

    if (!fromHistory) {
      if (pushedHistory) {
        history.back();
      } else {
        history.replaceState(null, "", `${location.pathname}${location.search}`);
      }
    }
    pushedHistory = false;
    returnFocus?.focus?.({ preventScroll: true });
    onClose?.();
  }

  // Controls
  closeButton.addEventListener("click", () => close());
  prevButton.addEventListener("click", () => go(-1));
  nextButton.addEventListener("click", () => go(1));
  likeButton.addEventListener("click", () => toggleLike());
  shareButton.addEventListener("click", share);
  root.querySelector(".viewer__backdrop").addEventListener("click", () => close());
  stage.addEventListener("click", (event) => {
    if (event.target === stage) {
      close();
    }
  });
  image.addEventListener("dblclick", () => toggleLike(true));
  root.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") {
      wake();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (!isOpen) {
      return;
    }
    if (event.key === "Escape") {
      close();
    } else if (event.key === "ArrowRight") {
      go(1);
    } else if (event.key === "ArrowLeft") {
      go(-1);
    } else if (event.key.toLowerCase() === "l" && !event.metaKey && !event.ctrlKey) {
      toggleLike();
    } else if (event.key === "Tab") {
      // Keep focus inside the dialog.
      const focusable = [...root.querySelectorAll("button:not([hidden]), a[href]")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      wake();
    }
  });

  window.addEventListener("resize", () => {
    if (isOpen) {
      placeImage(current());
    }
  });

  window.addEventListener("popstate", () => {
    if (isOpen && !location.hash.startsWith(HASH_PREFIX)) {
      close({ fromHistory: true });
    }
  });

  // Touch: swipe sideways to step, down to close, tap to show/hide controls,
  // double-tap to like.
  const touch = { id: null, x: 0, y: 0, dx: 0, dy: 0, time: 0, lastTap: 0, axis: null };
  stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") {
      return;
    }
    touch.id = event.pointerId;
    touch.x = event.clientX;
    touch.y = event.clientY;
    touch.dx = 0;
    touch.dy = 0;
    touch.axis = null;
    touch.time = performance.now();
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (event.pointerId !== touch.id) {
      return;
    }
    touch.dx = event.clientX - touch.x;
    touch.dy = event.clientY - touch.y;
    if (!touch.axis && Math.hypot(touch.dx, touch.dy) > 8) {
      touch.axis = Math.abs(touch.dx) > Math.abs(touch.dy) ? "x" : "y";
    }
    if (touch.axis === "x") {
      image.style.transform = `translateX(${touch.dx}px)`;
    } else if (touch.axis === "y" && touch.dy > 0) {
      image.style.transform = `translateY(${touch.dy}px) scale(${1 - Math.min(touch.dy / 1600, 0.12)})`;
      root.style.setProperty("--viewer-fade", String(1 - Math.min(touch.dy / 500, 0.7)));
    }
  });
  function endTouch(event) {
    if (event.pointerId !== touch.id) {
      return;
    }
    touch.id = null;
    image.style.transform = "";
    root.style.removeProperty("--viewer-fade");
    if (touch.axis === "x" && Math.abs(touch.dx) > 60) {
      go(touch.dx < 0 ? 1 : -1);
      return;
    }
    if (touch.axis === "y" && touch.dy > 110) {
      close();
      return;
    }
    if (!touch.axis && performance.now() - touch.time < 300) {
      const now = performance.now();
      if (now - touch.lastTap < 320) {
        touch.lastTap = 0;
        toggleLike(true);
        root.classList.remove("is-idle");
      } else {
        touch.lastTap = now;
        setTimeout(() => {
          if (touch.lastTap === now) {
            root.classList.toggle("is-idle");
          }
        }, 330);
      }
    }
  }
  stage.addEventListener("pointerup", endTouch);
  stage.addEventListener("pointercancel", endTouch);

  return {
    open,
    close,
    get isOpen() {
      return isOpen;
    },
    /** The photo id in the URL, if the page was opened on one. */
    idFromHash() {
      if (!location.hash.startsWith(HASH_PREFIX)) {
        return null;
      }
      return decodeURIComponent(location.hash.slice(HASH_PREFIX.length));
    },
  };
}
