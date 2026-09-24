/**
 * The page's sky: a fixed canvas of distant stars behind everything.
 *
 * Most stars are single dim points; a handful are bright, with a soft halo
 * and faint spikes - the "far away lights". Stars sit at different depths
 * and drift at different speeds as the page scrolls, so the black has depth
 * without anything moving on its own apart from a slow twinkle.
 */
export function createStarfield(canvas, { reducedMotion = false } = {}) {
  const context = canvas.getContext("2d");
  let reduced = reducedMotion;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let stars = [];
  let beacons = [];
  let frame = 0;
  let lastDraw = 0;
  let scroll = window.scrollY;

  const halo = createHaloSprite();

  function seedRandom(seed) {
    // Same sky on every visit and every resize.
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function build() {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const random = seedRandom(1357);
    const count = Math.round((width * height) / 2300);
    stars = Array.from({ length: count }, () => {
      const depth = random();
      const tint = random();
      return {
        x: random() * width,
        y: random() * height,
        depth,
        radius: 0.25 + Math.pow(random(), 3) * 0.9 + depth * 0.25,
        alpha: 0.18 + Math.pow(random(), 2) * 0.6,
        twinkle: random() < 0.35 ? 0.6 + random() * 1.6 : 0,
        phase: random() * Math.PI * 2,
        color: tint < 0.14 ? "255,214,170" : tint < 0.3 ? "190,210,255" : "240,244,255",
      };
    });

    const beaconCount = Math.max(4, Math.round((width * height) / 260000));
    beacons = Array.from({ length: beaconCount }, (_, index) => ({
      x: (0.08 + random() * 0.84) * width,
      y: ((index + random() * 0.8) / beaconCount) * height * 1.6,
      depth: 0.2 + random() * 0.5,
      size: 16 + random() * 26,
      alpha: 0.5 + random() * 0.4,
      phase: random() * Math.PI * 2,
      spikes: random() < 0.55,
      color: random() < 0.5 ? [255, 200, 150] : [170, 200, 255],
    }));
  }

  function wrap(value, span) {
    return ((value % span) + span) % span;
  }

  function draw(time) {
    const t = time / 1000;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    for (const star of stars) {
      const y = wrap(star.y - scroll * (0.015 + star.depth * 0.07), height);
      let alpha = star.alpha;
      if (star.twinkle && !reduced) {
        alpha *= 0.65 + 0.35 * Math.sin(t * star.twinkle + star.phase);
      }
      context.fillStyle = `rgba(${star.color},${alpha.toFixed(3)})`;
      if (star.radius < 0.7) {
        const size = star.radius * 2;
        context.fillRect(star.x - star.radius, y - star.radius, size, size);
      } else {
        context.beginPath();
        context.arc(star.x, y, star.radius, 0, Math.PI * 2);
        context.fill();
      }
    }

    const span = height * 1.6;
    context.globalCompositeOperation = "lighter";
    for (const beacon of beacons) {
      const y = wrap(beacon.y - scroll * (0.03 + beacon.depth * 0.08), span) - height * 0.3;
      if (y < -60 || y > height + 60) {
        continue;
      }
      const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 0.7 + beacon.phase);
      const [r, g, b] = beacon.color;
      const size = beacon.size * pulse;

      context.globalAlpha = beacon.alpha * 0.8;
      context.drawImage(halo, beacon.x - size, y - size, size * 2, size * 2);
      context.globalAlpha = 1;

      if (beacon.spikes) {
        const reach = size * 1.6;
        const gradient = context.createLinearGradient(beacon.x - reach, y, beacon.x + reach, y);
        gradient.addColorStop(0, `rgba(${r},${g},${b},0)`);
        gradient.addColorStop(0.5, `rgba(${r},${g},${b},${0.22 * beacon.alpha})`);
        gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
        context.fillStyle = gradient;
        context.fillRect(beacon.x - reach, y - 0.5, reach * 2, 1);
        const vertical = context.createLinearGradient(beacon.x, y - reach, beacon.x, y + reach);
        vertical.addColorStop(0, `rgba(${r},${g},${b},0)`);
        vertical.addColorStop(0.5, `rgba(${r},${g},${b},${0.18 * beacon.alpha})`);
        vertical.addColorStop(1, `rgba(${r},${g},${b},0)`);
        context.fillStyle = vertical;
        context.fillRect(beacon.x - 0.5, y - reach, 1, reach * 2);
      }

      context.fillStyle = `rgba(255,250,240,${beacon.alpha})`;
      context.beginPath();
      context.arc(beacon.x, y, 1.6, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = "source-over";
  }

  function loop(time) {
    frame = requestAnimationFrame(loop);
    // Twinkling doesn't need 60fps; scrolling does.
    if (time - lastDraw < 32 && window.scrollY === scroll) {
      return;
    }
    scroll = window.scrollY;
    lastDraw = time;
    draw(time);
  }

  function start() {
    if (frame) {
      return;
    }
    if (reduced) {
      draw(0);
      return;
    }
    frame = requestAnimationFrame(loop);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      build();
      draw(performance.now());
    }, 120);
  });

  window.addEventListener(
    "scroll",
    () => {
      if (reduced) {
        scroll = window.scrollY;
        draw(0);
      }
    },
    { passive: true },
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
    } else {
      start();
    }
  });

  build();
  draw(0);
  start();

  return {
    setReducedMotion(next) {
      reduced = next;
      stop();
      start();
    },
    pause: stop,
    resume: start,
  };
}

function createHaloSprite() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,248,236,0.95)");
  gradient.addColorStop(0.08, "rgba(255,236,210,0.55)");
  gradient.addColorStop(0.3, "rgba(200,210,255,0.12)");
  gradient.addColorStop(1, "rgba(200,210,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return canvas;
}
