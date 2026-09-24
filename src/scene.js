import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const TAU = Math.PI * 2;
const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();

/**
 * The hero: a slowly turning ring of the best photographs with the robot
 * hovering in the middle. It owns one screen and nothing else - scrolling
 * past it just scrolls the page down to the gallery.
 */
export function createHeroScene({
  canvas,
  photos,
  reducedMotion,
  onPhotoSelect,
  onRobotClick,
  onHeadMove,
  onInputMode,
}) {
  const prefersCoarsePointer = matchMedia("(pointer: coarse)").matches;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !prefersCoarsePointer,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, prefersCoarsePointer ? 1.5 : 1.75));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 260);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2(0, 0);
  const pointerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const pointerWorld = new THREE.Vector3();
  const pointerWorldTarget = new THREE.Vector3(0, 1.4, 4);
  const cameraRest = new THREE.Vector3(0, 4.6, 24);
  const cameraLookAt = new THREE.Vector3(0, -0.5, 0);
  const timer = new THREE.Timer();

  const world = new THREE.Group();
  scene.add(world);
  const ringRoot = new THREE.Group();
  world.add(ringRoot);

  const ambient = new THREE.HemisphereLight(0xf2f5ff, 0x1a120c, 1.7);
  const keyLight = new THREE.DirectionalLight(0xffeedd, 2.6);
  keyLight.position.set(6, 12, 14);
  const rimLight = new THREE.DirectionalLight(0x9cc4ff, 1.6);
  rimLight.position.set(-9, 6, -10);
  const jetLight = new THREE.PointLight(0xffa860, 2.2, 7, 1.6);
  jetLight.position.set(0, -1.2, -0.6);
  scene.add(ambient, keyLight, rimLight, jetLight);

  const ringRadius = 6.4;
  // Below the robot's waist, so the card passing in front never hides its face.
  const ringY = -1.1;
  const textureLoader = new THREE.TextureLoader();
  const cards = [];
  const cardById = new Map();

  photos.forEach((photo, photoIndex) => {
    const card = createPhotoCard(photo, textureLoader, prefersCoarsePointer);
    card.userData.baseAngle = (photoIndex / Math.max(photos.length, 1)) * TAU;
    card.userData.hover = 0;
    ringRoot.add(card);
    cards.push(card);
    cardById.set(photo.id, card);
  });
  const cardPlanes = cards.map((card) => card.userData.plane);

  const robot = createRobot();
  robot.position.set(0, 0.1, 0.2);
  robot.scale.setScalar(1.12);
  world.add(robot);
  const parts = robot.userData;
  const robotMeshes = [];
  robot.traverse((object) => {
    if (object.isMesh && !object.userData.isFlame) {
      robotMeshes.push(object);
    }
  });

  let reduced = reducedMotion;
  let active = true;
  let frameHandle = 0;
  let hoveredId = null;
  let robotHovered = false;
  let ringRotation = 0;
  let ringRotationTarget = 0;
  let ringVelocity = 0;
  let waveUntil = 0;
  let happyUntil = 0;
  let lastHeadX = -1;
  let lastHeadY = -1;
  const autoSpin = 0.045;
  const drag = { active: false, pointerId: null, lastX: 0, moved: false, total: 0 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width / Math.max(rect.height, 1);
    camera.aspect = aspect;
    // Pull back on narrow screens - but only until most of the ring fits;
    // on a phone the outer cards may run off the edges so the robot stays big.
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
    const fitRadius = aspect < 1 ? ringRadius * 0.72 : ringRadius + 1.5;
    const needed = fitRadius / (halfWidth * 0.98) + ringRadius * 0.55;
    const distance = Math.max(24, needed);
    cameraRest.set(0, 4.6 * (distance / 24), distance);
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height, false);
    if (!frameHandle) {
      renderer.render(scene, camera);
    }
  }

  function setPointerFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    if (raycaster.ray.intersectPlane(pointerPlane, pointerWorld)) {
      pointerWorldTarget.set(
        pointerWorld.x,
        THREE.MathUtils.clamp(pointerWorld.y + 0.4, -2.4, 5.2),
        4,
      );
    }
  }

  function pick() {
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects([...cardPlanes, ...robotMeshes], false)[0];
    if (!hit) {
      return null;
    }
    if (hit.object.userData.photoId) {
      return { type: "photo", id: hit.object.userData.photoId };
    }
    return { type: "robot" };
  }

  function wave(duration = 2.4) {
    waveUntil = timer.getElapsed() + duration;
    happyUntil = Math.max(happyUntil, waveUntil);
  }

  function animate(timestamp) {
    frameHandle = requestAnimationFrame(animate);
    timer.update(timestamp);
    const delta = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();
    const ease = (rate) => (reduced ? 1 : 1 - Math.exp(-rate * delta));

    // Ring
    if (!drag.active) {
      ringVelocity *= Math.exp(-2.4 * delta);
      ringRotationTarget += ringVelocity * delta + (reduced ? 0 : autoSpin * delta);
    }
    ringRotation += (ringRotationTarget - ringRotation) * ease(8);

    for (const card of cards) {
      const theta = card.userData.baseAngle + ringRotation;
      const frontness = (Math.cos(theta) + 1) * 0.5;
      const isHovered = hoveredId === card.userData.photo.id;
      card.userData.hover += ((isHovered ? 1 : 0) - card.userData.hover) * ease(10);
      const hover = card.userData.hover;

      card.position.set(
        Math.sin(theta) * ringRadius,
        ringY + Math.sin(theta * 2 + t * 0.4) * 0.08,
        Math.cos(theta) * ringRadius,
      );
      card.rotation.y = Math.atan2(camera.position.x - card.position.x, camera.position.z - card.position.z);
      card.rotation.x = -0.14;
      card.scale.setScalar(1 + hover * 0.07);

      // Cards behind the robot recede into the dark instead of competing.
      const light = THREE.MathUtils.lerp(0.36, 1, Math.pow(frontness, 0.8));
      card.userData.material.color.setScalar(Math.min(1, light + hover * 0.2));
    }

    // Camera drifts a little with the pointer.
    tempVectorA.set(pointerNdc.x * 0.6, pointerNdc.y * 0.35, 0).add(cameraRest);
    camera.position.lerp(tempVectorA, ease(3));
    tempVectorB.set(cameraLookAt.x + pointerNdc.x * 0.25, cameraLookAt.y + pointerNdc.y * 0.12, 0);
    camera.lookAt(tempVectorB);

    // Robot: hover, look at the pointer, lean into the spin.
    const bob = reduced ? 0 : Math.sin(t * 1.5) * 0.09;
    robot.position.y = 0.1 + bob;
    robot.rotation.z = THREE.MathUtils.lerp(
      robot.rotation.z,
      reduced ? 0 : THREE.MathUtils.clamp(-ringVelocity * 0.12, -0.18, 0.18) + Math.sin(t * 0.7) * 0.025,
      ease(4),
    );

    const local = robot.worldToLocal(tempVectorC.copy(pointerWorldTarget));
    const maxTurn = THREE.MathUtils.degToRad(38);
    const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, Math.max(local.z, 0.4)), -maxTurn, maxTurn);
    const pitch = THREE.MathUtils.clamp(-Math.atan2(local.y - 1.9, Math.max(local.z, 0.4)) * 0.45, -0.4, 0.35);
    parts.head.rotation.y += (yaw - parts.head.rotation.y) * ease(6);
    parts.head.rotation.x += (pitch - parts.head.rotation.x) * ease(6);
    parts.head.rotation.z += (-yaw * 0.16 - parts.head.rotation.z) * ease(4);
    parts.body.rotation.y += (yaw * 0.2 - parts.body.rotation.y) * ease(3);

    // Expression
    const isWaving = t < waveUntil;
    const isHappy = t < happyUntil || Boolean(hoveredId) || robotHovered;
    parts.faceHappy += ((isHappy ? 1 : 0) - parts.faceHappy) * ease(9);
    const happy = parts.faceHappy;
    const blink = reduced ? 0 : Math.pow(Math.max(0, Math.sin(t * 1.3 + 0.4)), 60);
    for (const eye of parts.eyes) {
      eye.scale.y = Math.max(0.06, (1 - blink) * (1 - happy));
      eye.visible = eye.scale.y > 0.07;
    }
    for (const arc of parts.happyEyes) {
      arc.scale.setScalar(Math.max(0.001, happy));
      arc.visible = happy > 0.05;
    }
    parts.smile.scale.setScalar(Math.max(0.001, 0.55 + happy * 0.45));
    parts.cheekMaterial.opacity = 0.35 + happy * 0.45;

    // Arms: the right one waves, the left one floats.
    const [armLeft, armRight] = parts.arms;
    const float = reduced ? 0 : Math.sin(t * 1.5 + 0.6) * 0.06;
    armLeft.rotation.z += (0.22 + float - armLeft.rotation.z) * ease(6);
    armLeft.userData.elbow.rotation.z += (-0.25 - armLeft.userData.elbow.rotation.z) * ease(6);
    const rightTarget = isWaving ? 2.55 : 0.22 + float;
    armRight.rotation.z += (rightTarget - armRight.rotation.z) * ease(isWaving ? 7 : 4);
    const elbowTarget = isWaving && !reduced ? -0.35 + Math.sin(t * 11) * 0.55 : -0.25;
    armRight.userData.elbow.rotation.z += (elbowTarget - armRight.userData.elbow.rotation.z) * ease(14);

    for (const leg of parts.legs) {
      const swing = reduced ? 0 : Math.sin(t * 1.5 + leg.userData.phase) * 0.14;
      leg.rotation.x += (swing + 0.12 - leg.rotation.x) * ease(5);
    }

    // Antenna tip springs behind the head and pulses.
    parts.antenna.rotation.z += (-parts.head.rotation.y * 0.5 - parts.antenna.rotation.z) * ease(5);
    parts.antennaMaterial.emissiveIntensity = 1.4 + (reduced ? 0 : Math.sin(t * 2.6) * 0.8);
    parts.chestMaterial.emissiveIntensity = 0.9 + (reduced ? 0 : Math.sin(t * 2.2) * 0.5);

    // Jetpack
    for (const flame of parts.flames) {
      const flicker = reduced ? 0.5 : Math.sin(t * 17 + flame.userData.phase) * 0.5 + 0.5;
      const jitter = reduced ? 0 : Math.sin(t * 31 + flame.userData.phase * 2) * 0.06;
      flame.scale.set(1 + flicker * 0.08, 0.86 + flicker * 0.3 + jitter, 1);
    }
    jetLight.intensity = reduced ? 2.4 : 2 + Math.sin(t * 13) * 0.5;

    // The speech bubble follows the head.
    parts.head.getWorldPosition(tempVectorA);
    tempVectorA.y += 1.3;
    tempVectorA.project(camera);
    const rect = canvas.getBoundingClientRect();
    const headX = Math.round((tempVectorA.x * 0.5 + 0.5) * rect.width);
    const headY = Math.round((-tempVectorA.y * 0.5 + 0.5) * rect.height);
    if (headX !== lastHeadX || headY !== lastHeadY) {
      lastHeadX = headX;
      lastHeadY = headY;
      onHeadMove?.(headX, headY);
    }

    renderer.render(scene, camera);
  }

  function setHover(nextId, nextRobot) {
    hoveredId = nextId;
    robotHovered = nextRobot;
    canvas.classList.toggle("is-pointing", Boolean(nextId) || nextRobot);
  }

  canvas.addEventListener("pointermove", (event) => {
    setPointerFromEvent(event);
    onInputMode?.(event.pointerType === "mouse" ? "mouse" : "touch");

    if (drag.active && drag.pointerId === event.pointerId) {
      const deltaX = event.clientX - drag.lastX;
      drag.lastX = event.clientX;
      drag.total += Math.abs(deltaX);
      if (drag.total > 5) {
        drag.moved = true;
        setHover(null, false);
      }
      const step = deltaX * 0.006;
      ringRotationTarget += step;
      ringVelocity = THREE.MathUtils.lerp(ringVelocity, step / Math.max(delta(), 1 / 120), 0.3);
      return;
    }

    if (event.pointerType === "mouse") {
      const hit = pick();
      setHover(hit?.type === "photo" ? hit.id : null, hit?.type === "robot");
    }
  });

  let lastMoveTime = performance.now();
  function delta() {
    const now = performance.now();
    const value = (now - lastMoveTime) / 1000;
    lastMoveTime = now;
    return value;
  }

  canvas.addEventListener("pointerdown", (event) => {
    setPointerFromEvent(event);
    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.lastX = event.clientX;
    drag.moved = false;
    drag.total = 0;
    ringVelocity = 0;
    lastMoveTime = performance.now();
    canvas.setPointerCapture?.(event.pointerId);
  });

  function endDrag(event, cancelled) {
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.active = false;
    canvas.releasePointerCapture?.(event.pointerId);
    ringVelocity = THREE.MathUtils.clamp(ringVelocity, -3, 3);
    if (cancelled || drag.moved) {
      return;
    }
    setPointerFromEvent(event);
    const hit = pick();
    if (hit?.type === "photo") {
      happyUntil = timer.getElapsed() + 1.2;
      onPhotoSelect?.(hit.id, cardById.get(hit.id));
    } else if (hit?.type === "robot") {
      wave();
      onRobotClick?.();
    }
  }

  canvas.addEventListener("pointerup", (event) => endDrag(event, false));
  canvas.addEventListener("pointercancel", (event) => endDrag(event, true));
  canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") {
      setHover(null, false);
      pointerNdc.set(0, 0);
    }
  });

  window.addEventListener("resize", resize);
  resize();
  setTimeout(() => wave(2.6), 700);
  frameHandle = requestAnimationFrame(animate);

  return {
    wave,
    setActive(next) {
      if (next === active) {
        return;
      }
      active = next;
      if (active && !frameHandle) {
        timer.reset?.();
        frameHandle = requestAnimationFrame(animate);
      } else if (!active && frameHandle) {
        cancelAnimationFrame(frameHandle);
        frameHandle = 0;
      }
    },
    setReducedMotion(next) {
      reduced = next;
    },
  };
}

/** Photos have soft corners and nothing around them. */
const cornerMasks = new Map();
function getCornerMask(aspect) {
  const key = aspect.toFixed(2);
  if (cornerMasks.has(key)) {
    return cornerMasks.get(key);
  }
  const width = 256;
  const height = Math.round(width / aspect);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#fff";
  context.beginPath();
  context.roundRect(0, 0, width, height, width * 0.035);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  cornerMasks.set(key, texture);
  return texture;
}

function createPhotoCard(photo, textureLoader, prefersCoarsePointer) {
  const card = new THREE.Group();
  const width = photo.orientation === "landscape" ? 2.35 : 1.78;
  const height = width / photo.aspect;

  const texture = textureLoader.load(photo.src);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = prefersCoarsePointer ? 2 : 8;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    alphaMap: getCornerMask(photo.aspect),
    transparent: true,
    toneMapped: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  plane.userData.photoId = photo.id;
  card.add(plane);

  card.userData.photo = photo;
  card.userData.plane = plane;
  card.userData.material = material;
  return card;
}

function createRobot() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const shell = new THREE.MeshPhysicalMaterial({
    color: 0xf3efe9,
    roughness: 0.42,
    metalness: 0.04,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
  });
  const shellShade = new THREE.MeshPhysicalMaterial({
    color: 0xd8d0c5,
    roughness: 0.5,
    metalness: 0.05,
    clearcoat: 0.3,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.55, metalness: 0.2 });
  const visor = new THREE.MeshPhysicalMaterial({
    color: 0x090b10,
    roughness: 0.12,
    metalness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xdffbff,
    emissive: new THREE.Color(0xbff4ff),
    emissiveIntensity: 1.6,
  });
  const cheekMaterial = new THREE.MeshBasicMaterial({
    color: 0xff8f9a,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const antennaMaterial = new THREE.MeshStandardMaterial({
    color: 0xffc78a,
    emissive: new THREE.Color(0xffb46a),
    emissiveIntensity: 1.6,
    roughness: 0.3,
  });
  const chestMaterial = new THREE.MeshStandardMaterial({
    color: 0x9ff2ff,
    emissive: new THREE.Color(0x7be9ff),
    emissiveIntensity: 1,
    roughness: 0.3,
  });
  const packMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa3b1, roughness: 0.45, metalness: 0.25 });
  const packDark = new THREE.MeshStandardMaterial({ color: 0x4a525e, roughness: 0.5, metalness: 0.25 });
  const neon = [0x7bf5ff, 0xff9b8c, 0xeaf36e, 0xa597ff].map(
    (color) =>
      new THREE.MeshStandardMaterial({
        color,
        emissive: new THREE.Color(color),
        emissiveIntensity: 1.25,
        roughness: 0.3,
      }),
  );

  // Torso
  const torso = new THREE.Mesh(new RoundedBoxGeometry(0.9, 1.04, 0.66, 6, 0.24), shell);
  torso.position.y = 0.74;
  body.add(torso);

  const belly = new THREE.Mesh(new RoundedBoxGeometry(0.54, 0.6, 0.08, 4, 0.1), shellShade);
  belly.position.set(0, 0.68, 0.33);
  body.add(belly);

  const chestLight = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 16), chestMaterial);
  chestLight.position.set(0, 0.86, 0.38);
  body.add(chestLight);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 16), dark);
  neck.position.y = 1.32;
  body.add(neck);

  // Head
  const head = new THREE.Group();
  head.position.y = 1.9;
  body.add(head);

  const helmet = new THREE.Mesh(new RoundedBoxGeometry(1.5, 1.34, 1.28, 8, 0.36), shell);
  helmet.position.set(0, 0.04, 0);
  head.add(helmet);

  const helmetCap = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.3, 0.96, 6, 0.14), shellShade);
  helmetCap.position.set(0, 0.62, -0.06);
  head.add(helmetCap);

  const screen = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.92, 0.12, 8, 0.2), visor);
  screen.position.set(0, -0.02, 0.6);
  head.add(screen);

  // A thin light strip in four colours framing the visor - the old neon bars, slimmed.
  const stripDepth = 0.04;
  const strips = [
    { size: [0.62, 0.045], pos: [0, 0.42], mat: neon[0] },
    { size: [0.045, 0.46], pos: [0.52, -0.02], mat: neon[1] },
    { size: [0.62, 0.045], pos: [0, -0.46], mat: neon[2] },
    { size: [0.045, 0.46], pos: [-0.52, -0.02], mat: neon[3] },
  ];
  for (const strip of strips) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(strip.size[0], strip.size[1], stripDepth, 2, 0.02),
      strip.mat,
    );
    mesh.position.set(strip.pos[0], strip.pos[1], 0.665);
    head.add(mesh);
  }

  const faceZ = 0.668;
  const eyeGeometry = new THREE.CapsuleGeometry(0.075, 0.1, 6, 16);
  const eyes = [-0.2, 0.2].map((x) => {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.scale.z = 0.35;
    eye.position.set(x, 0.04, faceZ);
    head.add(eye);
    return eye;
  });

  // ^ ^ for when it's pleased
  const arcGeometry = new THREE.TorusGeometry(0.1, 0.03, 8, 24, Math.PI);
  const happyEyes = [-0.2, 0.2].map((x) => {
    const arc = new THREE.Mesh(arcGeometry, eyeMaterial);
    arc.position.set(x, 0.0, faceZ);
    arc.scale.setScalar(0.001);
    arc.visible = false;
    head.add(arc);
    return arc;
  });

  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.022, 8, 20, Math.PI), eyeMaterial);
  smile.rotation.z = Math.PI;
  smile.position.set(0, -0.2, faceZ);
  head.add(smile);

  const cheekGeometry = new THREE.CircleGeometry(0.07, 20);
  for (const x of [-0.34, 0.34]) {
    const cheek = new THREE.Mesh(cheekGeometry, cheekMaterial);
    cheek.scale.y = 0.6;
    cheek.position.set(x, -0.16, faceZ + 0.001);
    head.add(cheek);
  }

  for (const x of [-0.79, 0.79]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 28), shellShade);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(x, 0, 0.02);
    head.add(ear);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 20), dark);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(x * 1.06, 0, 0.02);
    head.add(cap);
  }

  const antenna = new THREE.Group();
  antenna.position.set(0, 0.76, -0.06);
  head.add(antenna);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.34, 10), dark);
  stalk.position.y = 0.17;
  antenna.add(stalk);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 20), antennaMaterial);
  bulb.position.y = 0.38;
  antenna.add(bulb);

  // Jetpack
  const pack = new THREE.Group();
  pack.position.set(0, 0.86, -0.46);
  body.add(pack);
  const packBody = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.9, 0.3, 6, 0.12), packDark);
  pack.add(packBody);
  const flames = [];
  for (const x of [-0.42, 0.42]) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.6, 8, 20), packMaterial);
    tank.position.set(x, 0.02, 0);
    pack.add(tank);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.18, 20, 1, true), packDark);
    nozzle.position.set(x, -0.55, 0);
    pack.add(nozzle);

    const flame = createFlame();
    flame.position.set(x, -0.64, 0);
    flame.userData.phase = x < 0 ? 0 : 1.7;
    pack.add(flame);
    flames.push(flame);
  }

  // Arms: shoulder pivot -> upper arm -> elbow pivot -> forearm and mitten.
  const arms = [-1, 1].map((side) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.53, 1.08, 0.02);
    body.add(arm);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 18), shellShade);
    arm.add(shoulder);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.24, 6, 16), shell);
    upper.position.y = -0.22;
    arm.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.4;
    arm.add(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.18, 6, 16), shell);
    fore.position.y = -0.14;
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 18), shellShade);
    hand.scale.set(1, 0.9, 0.9);
    hand.position.y = -0.33;
    elbow.add(hand);
    arm.userData.elbow = elbow;
    // Mirror the left arm so positive z swings either arm outward.
    if (side < 0) {
      arm.scale.x = -1;
    }
    return arm;
  });

  // Legs dangle while it hovers.
  const legs = [-1, 1].map((side) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.2, 0.22, 0);
    body.add(leg);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.16, 6, 14), dark);
    thigh.position.y = -0.16;
    leg.add(thigh);
    const boot = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.2, 0.32, 4, 0.09), shell);
    boot.position.set(0, -0.4, 0.04);
    leg.add(boot);
    leg.userData.phase = side < 0 ? 0 : 1.3;
    return leg;
  });

  Object.assign(root.userData, {
    body,
    head,
    eyes,
    happyEyes,
    smile,
    cheekMaterial,
    antenna,
    antennaMaterial,
    chestMaterial,
    arms,
    legs,
    flames,
    faceHappy: 0,
  });
  return root;
}

/** Soft additive cones: a hot core inside a wider glow. */
function createFlame() {
  const flame = new THREE.Group();
  const layers = [
    { radius: 0.15, length: 0.9, color: 0xff7a2e, opacity: 0.35 },
    { radius: 0.1, length: 0.66, color: 0xffb65c, opacity: 0.55 },
    { radius: 0.055, length: 0.42, color: 0xfff1d0, opacity: 0.9 },
  ];
  for (const layer of layers) {
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(layer.radius, layer.length, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: layer.color,
        transparent: true,
        opacity: layer.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = Math.PI;
    mesh.position.y = -layer.length / 2;
    mesh.userData.isFlame = true;
    flame.add(mesh);
  }
  return flame;
}
