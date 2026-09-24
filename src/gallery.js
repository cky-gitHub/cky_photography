const LIKED = "__liked";

/**
 * The gallery under the hero: every photo in one quiet masonry grid, newest
 * first, with the country written underneath. A row of country names above
 * it narrows the grid down; nothing else sits around the pictures.
 */
export function createGallery({ grid, filters, summary, photos, likes, onOpen }) {
  const countries = groupCountries(photos);
  const tiles = new Map();
  let active = null;
  let columnCount = 0;
  let visible = photos;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in-view");
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );

  summary.textContent = `${photos.length} photographs · ${countries.length} ${countries.length === 1 ? "country" : "countries"}`;

  for (const photo of photos) {
    tiles.set(photo.id, createTile(photo));
  }

  function createTile(photo) {
    const figure = document.createElement("figure");
    figure.className = "tile";
    figure.dataset.id = photo.id;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tile__button";
    button.setAttribute("aria-label", `Open ${photo.alt.toLowerCase()}`);
    button.style.aspectRatio = `${photo.width} / ${photo.height}`;

    const img = document.createElement("img");
    img.className = "tile__image";
    img.alt = photo.alt;
    img.width = photo.width;
    img.height = photo.height;
    img.loading = "lazy";
    img.decoding = "async";
    const thumbWidth = Math.round(Math.min(photo.width, 900 * Math.min(1, photo.aspect)));
    const smallWidth = Math.round(Math.min(photo.width, 1600 * Math.min(1, photo.aspect)));
    img.srcset = `${photo.thumb} ${thumbWidth}w, ${photo.src} ${smallWidth}w`;
    img.sizes = "(max-width: 560px) calc(100vw - 32px), (max-width: 1080px) 46vw, 30vw";
    img.src = photo.thumb;
    if (img.complete) {
      img.classList.add("is-loaded");
    } else {
      img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    }
    button.append(img);

    const caption = document.createElement("figcaption");
    caption.className = "tile__caption";
    caption.innerHTML = `<span class="tile__country"></span><span class="tile__liked" aria-label="Liked">&#9829;</span>`;
    caption.querySelector(".tile__country").textContent = photo.country ?? "";

    figure.append(button, caption);
    button.addEventListener("click", () => {
      onOpen(visible, visible.indexOf(photo), img);
    });
    return figure;
  }

  function columnsFor(width) {
    if (width < 560) {
      return 1;
    }
    if (width < 1080) {
      return 2;
    }
    return 3;
  }

  /** Shortest-column-first, so the reading order stays newest to oldest, left to right. */
  function layout(force = false) {
    const count = columnsFor(grid.clientWidth || window.innerWidth);
    if (!force && count === columnCount) {
      return;
    }
    columnCount = count;
    const columns = Array.from({ length: count }, () => {
      const column = document.createElement("div");
      column.className = "grid__column";
      return { element: column, height: 0 };
    });
    for (const photo of visible) {
      const target = columns.reduce((low, column) => (column.height < low.height ? column : low));
      target.element.append(tiles.get(photo.id));
      // Height of a unit-width tile, plus room for the caption.
      target.height += 1 / photo.aspect + 0.12;
    }
    grid.replaceChildren(...columns.map((column) => column.element));
    grid.style.setProperty("--columns", String(count));
    for (const photo of visible) {
      observer.observe(tiles.get(photo.id));
    }
  }

  function renderFilters() {
    const likedCount = photos.filter((photo) => likes.has(photo)).length;
    const items = [
      { id: null, label: "All", count: photos.length },
      ...countries.map((country) => ({ id: country.name, label: country.name, count: country.count })),
    ];
    if (likedCount > 0 || active === LIKED) {
      items.push({ id: LIKED, label: "Liked", count: likedCount, liked: true });
    }
    filters.replaceChildren(
      ...items.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `filter${item.liked ? " filter--liked" : ""}`;
        button.setAttribute("aria-pressed", String(active === item.id));
        button.innerHTML = `<span class="filter__label"></span><span class="filter__count">${item.count}</span>`;
        button.querySelector(".filter__label").textContent = item.label;
        button.addEventListener("click", () => setFilter(item.id));
        return button;
      }),
    );
  }

  function setFilter(id) {
    active = id;
    visible =
      id === null
        ? photos
        : id === LIKED
          ? photos.filter((photo) => likes.has(photo))
          : photos.filter((photo) => photo.country === id);
    renderFilters();
    grid.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 380, easing: "ease-out" });
    layout(true);
  }

  function syncLikes() {
    for (const photo of photos) {
      tiles.get(photo.id).classList.toggle("is-liked", likes.has(photo));
    }
    if (active === LIKED) {
      setFilter(LIKED);
    } else {
      renderFilters();
    }
  }

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => layout());
  });

  renderFilters();
  layout(true);
  syncLikes();

  return {
    syncLikes,
    find(id) {
      return photos.find((photo) => photo.id === id) ?? null;
    },
    tileImage(id) {
      return tiles.get(id)?.querySelector("img") ?? null;
    },
    visiblePhotos() {
      return visible;
    },
  };
}

function groupCountries(photos) {
  const counts = new Map();
  for (const photo of photos) {
    if (!photo.country) {
      continue;
    }
    counts.set(photo.country, (counts.get(photo.country) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}
