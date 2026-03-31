import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const TAU = Math.PI * 2;
const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempColor = new THREE.Color();

export function createGalleryScene({
  canvas,
  months,
  photos,
  maxScrollTurn,
  state,
  reducedMotion,
  onHover,
  onFocus,
  onFrontPhotoChange,
  onMonthChange,
  onPhotoSelect,
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
  renderer.toneMappingExposure = 1.16;
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, prefersCoarsePointer ? 1.25 : 1.75));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 260);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const pointerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const pointerWorld = new THREE.Vector3();
  const cameraRest = new THREE.Vector3(0, 5, 20);
  const cameraLookAt = new THREE.Vector3(0, 1.00, 0);
  const soloViewPosition = new THREE.Vector3(0, 2.15, 5.4);
  const pointerOffset = new THREE.Vector3();
  const clock = new THREE.Clock();

  const world = new THREE.Group();
  scene.add(world);

  const ambient = new THREE.HemisphereLight(0xf5f8ff, 0x1d130c, 1.9);
  const keyLight = new THREE.DirectionalLight(0xffe8cf, 2.85);
  keyLight.position.set(7, 15, 12);
  const rimLight = new THREE.DirectionalLight(0x98c4ff, 1.25);
  rimLight.position.set(-10, 9, -12);
  const jetLight = new THREE.PointLight(0xffb86c, 2.2, 20, 1.25);
  jetLight.position.set(0, -0.3, -1.6);
  scene.add(ambient, keyLight, rimLight, jetLight);

  const floorGlow = new THREE.Mesh(
    new THREE.CircleGeometry(2.5, 72),
    new THREE.MeshBasicMaterial({
      color: 0x111822,
      transparent: true,
      opacity: 0.66,
    }),
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.set(0, -1.32, 0);
  world.add(floorGlow);

  const stars = createStars(prefersCoarsePointer);
  world.add(stars);

  const helixRadius = 6.7;
  const helixPitch = 2.05;
  const helixAnchorY = 1.35;
  const cardPitchCompensation = -0.18;
  const textureLoader = new THREE.TextureLoader();
  const photoGroups = new Map();
  const interactiveObjects = [];

  for (const photo of photos) {
    const card = createPhotoCard(photo, textureLoader, prefersCoarsePointer);
    card.userData = {
      photo,
      frame: card.getObjectByName("frame"),
      imagePlane: card.getObjectByName("imagePlane"),
    };
    world.add(card);
    photoGroups.set(photo.id, card);
    interactiveObjects.push(card.userData.imagePlane);
  }

  const robot = createRobot();
  robot.position.set(0, -0.18, 0.15);
  robot.scale.setScalar(1.18);
  world.add(robot);

  const robotHead = robot.getObjectByName("robotHead");
  const robotBody = robot.getObjectByName("robotBody");
  const robotEyes = robot.getObjectByName("robotEyes");
  const thrusters = robot.userData.thrusters ?? [];
  const eyeMeshes = robot.userData.eyeMeshes ?? [];

  let reduced = reducedMotion;
  let hoveredId = state.hoveredId;
  let focusedId = state.focusedId;
  let soloPhotoId = state.soloPhotoId;
  let scrollProgress = 0;
  let activeMonthId = months[0]?.id ?? null;
  let frontPhotoId = photos[0]?.id ?? null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    camera.aspect = rect.width / Math.max(rect.height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height, false);
  }

  function setPointerFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    raycaster.ray.intersectPlane(pointerPlane, pointerWorld);
    state.pointerWorldTarget.x = pointerWorld.x;
    state.pointerWorldTarget.y = THREE.MathUtils.clamp(pointerWorld.y + 0.45, -2.4, 5.2);
    state.pointerWorldTarget.z = THREE.MathUtils.clamp(pointerWorld.z, -8, 8);
  }

  function pickPhoto() {
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(interactiveObjects, false);
    return hits[0]?.object?.userData?.photoId ?? null;
  }

  function getMonthByTurn(scrollTurn) {
    const firstMonth = months[0] ?? null;
    const lastMonth = months.at(-1) ?? null;

    if (firstMonth && scrollTurn < firstMonth.startTurn) {
      return firstMonth;
    }

    return months.find((month) => scrollTurn >= month.startTurn && scrollTurn < month.endTurn) ?? lastMonth;
  }

  function updateHover(nextHoveredId) {
    if (hoveredId !== nextHoveredId) {
      hoveredId = nextHoveredId;
      onHover(nextHoveredId);
    }
  }

  function focusPhoto(photoId) {
    focusedId = photoId;
    onFocus(photoId);
  }

  function clearFocus() {
    focusedId = null;
    onFocus(null);
  }

  function setScrollProgress(progress) {
    scrollProgress = THREE.MathUtils.clamp(progress, 0, 1);
  }

  function animate() {
    const delta = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;
    const scrollTurn = scrollProgress * maxScrollTurn;
    const activeMonth = getMonthByTurn(scrollTurn);
    let nearestPhotoId = frontPhotoId;
    let nearestDistance = Infinity;

    if (activeMonth?.id && activeMonth.id !== activeMonthId) {
      activeMonthId = activeMonth.id;
      onMonthChange(activeMonthId);
    }

    if (!reduced) {
      stars.rotation.y += delta * 0.008;
    }

    stars.material.opacity = THREE.MathUtils.lerp(
      stars.material.opacity,
      soloPhotoId ? 0 : 0.3,
      reduced ? 0.22 : 0.1,
    );
    floorGlow.material.opacity = THREE.MathUtils.lerp(
      floorGlow.material.opacity,
      soloPhotoId ? 0 : 0.66,
      reduced ? 0.22 : 0.1,
    );
    robot.visible = !soloPhotoId;

    pointerOffset.set(pointerNdc.x * 0.52, pointerNdc.y * 0.36, 0);
    tempVectorA.copy(cameraRest).add(pointerOffset);
    camera.position.lerp(tempVectorA, reduced ? 0.16 : 0.08);
    tempVectorB.set(
      cameraLookAt.x + pointerNdc.x * 0.28,
      cameraLookAt.y + pointerNdc.y * 0.12,
      cameraLookAt.z,
    );
    camera.lookAt(tempVectorB);

    for (const photo of photos) {
      const card = photoGroups.get(photo.id);
      const frame = card.userData.frame;
      const imagePlane = card.userData.imagePlane;
      const relativeTurn = photo.spiralTurn - scrollTurn;
      const theta = -relativeTurn * TAU;
      const isHovered = hoveredId === photo.id;
      const isFocused = focusedId === photo.id;
      const isSoloTarget = soloPhotoId === photo.id;
      const centerCloseness = THREE.MathUtils.clamp(1 - Math.abs(relativeTurn) / 0.62, 0, 1);

      if (soloPhotoId && isSoloTarget) {
        tempVectorA.copy(soloViewPosition);
      } else {
        tempVectorA.set(
          Math.sin(theta) * helixRadius,
          helixAnchorY - relativeTurn * helixPitch,
          Math.cos(theta) * helixRadius,
        );
        tempVectorA.y += isFocused ? centerCloseness * 0.9 + 0.14 : isHovered ? 0.08 : 0;
        tempVectorA.z += isFocused ? centerCloseness * 0.92 + 0.12 : isHovered ? 0.1 : 0;
      }

      card.position.lerp(tempVectorA, reduced ? 0.2 : 0.12);

      const targetYaw = soloPhotoId && isSoloTarget
        ? 0
        : Math.atan2(camera.position.x - card.position.x, camera.position.z - card.position.z);
      card.rotation.y = lerpAngle(card.rotation.y, targetYaw, reduced ? 0.2 : 0.14);
      card.rotation.x = THREE.MathUtils.lerp(
        card.rotation.x,
        soloPhotoId && isSoloTarget ? cardPitchCompensation : cardPitchCompensation,
        reduced ? 0.2 : 0.16,
      );
      card.rotation.z = THREE.MathUtils.lerp(card.rotation.z, 0, reduced ? 0.2 : 0.16);

      const targetScale = soloPhotoId
        ? isSoloTarget ? 2.3 : 1
        : 1 + centerCloseness * 0.04 + (isHovered ? 0.06 : 0) + (isFocused ? centerCloseness * 0.7 + 0.2 : 0);
      card.scale.x = THREE.MathUtils.lerp(card.scale.x || 1, targetScale, reduced ? 0.2 : 0.14);
      card.scale.y = THREE.MathUtils.lerp(card.scale.y || 1, targetScale, reduced ? 0.2 : 0.14);
      card.scale.z = THREE.MathUtils.lerp(card.scale.z || 1, targetScale, reduced ? 0.2 : 0.14);

      if (!soloPhotoId) {
        frame.material.color.lerp(
          tempColor.set(isFocused ? "#f6f3ef" : isHovered ? "#e7eef8" : "#ccd5e1"),
          reduced ? 0.18 : 0.12,
        );
      }
      frame.material.opacity = THREE.MathUtils.lerp(
        frame.material.opacity,
        soloPhotoId ? 0 : isFocused ? 0.24 : isHovered ? 0.16 : 0.08,
        reduced ? 0.18 : 0.12,
      );
      imagePlane.material.opacity = THREE.MathUtils.lerp(
        imagePlane.material.opacity,
        soloPhotoId ? (isSoloTarget ? 1 : 0) : 1,
        reduced ? 0.22 : 0.12,
      );

      const distanceToCenter = Math.abs(relativeTurn);
      if (distanceToCenter < nearestDistance) {
        nearestDistance = distanceToCenter;
        nearestPhotoId = photo.id;
      }
    }

    if (nearestPhotoId && nearestPhotoId !== frontPhotoId) {
      frontPhotoId = nearestPhotoId;
      onFrontPhotoChange(frontPhotoId);
    }

    const localPointer = robot.worldToLocal(
      tempVectorC.set(
        state.pointerWorldTarget.x,
        state.pointerWorldTarget.y,
        state.pointerWorldTarget.z,
      ),
    );
    const maxHeadTurn = THREE.MathUtils.degToRad(40);
    const yaw = Math.atan2(localPointer.x, Math.max(localPointer.z + 1.4, 0.35));
    const pitch = Math.atan2(localPointer.y - 1.8, Math.max(localPointer.z + 1.7, 0.45));
    const limitedYaw = THREE.MathUtils.clamp(yaw * 0.98, -maxHeadTurn, maxHeadTurn);
    const limitedPitch = THREE.MathUtils.clamp(-pitch * 0.38, -maxHeadTurn, maxHeadTurn);
    robotHead.rotation.y = THREE.MathUtils.lerp(robotHead.rotation.y, limitedYaw, reduced ? 0.18 : 0.1);
    robotHead.rotation.x = THREE.MathUtils.lerp(robotHead.rotation.x, limitedPitch, reduced ? 0.18 : 0.1);
    robotBody.rotation.y = THREE.MathUtils.lerp(robotBody.rotation.y, yaw * 0.18, reduced ? 0.16 : 0.08);

    if (!reduced) {
      robot.position.y = -0.18 + Math.sin(elapsed * 1.55) * 0.07;
      robot.position.x = Math.sin(elapsed * 0.8) * 0.03;
      jetLight.intensity = 1.9 + (Math.sin(elapsed * 7) * 0.5 + 0.5) * 0.8;

      for (const thruster of thrusters) {
        const pulse = 0.8 + (Math.sin(elapsed * 12 + thruster.userData.phase) * 0.5 + 0.5) * 0.55;
        thruster.scale.set(1, pulse, 1);
      }

      if (robotEyes?.material) {
        robotEyes.material.emissiveIntensity = 1 + (Math.sin(elapsed * 3.4) * 0.5 + 0.5) * 0.24;
      }
    }

    const blink = Math.pow(Math.max(0, Math.sin(elapsed * 1.35 + 0.4)), 48);
    const blinkScale = THREE.MathUtils.clamp(1 - blink * 0.92, 0.08, 1);
    for (const eye of eyeMeshes) {
      eye.scale.y = blinkScale;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  canvas.addEventListener("pointermove", (event) => {
    setPointerFromEvent(event);
    onInputMode("mouse");
    updateHover(pickPhoto());
  });

  canvas.addEventListener("pointerdown", (event) => {
    setPointerFromEvent(event);
    onInputMode(prefersCoarsePointer ? "touch" : "mouse");
    const photoId = pickPhoto();
    if (photoId) {
      onPhotoSelect(photoId);
    } else if (focusedId) {
      clearFocus();
    }
  });

  canvas.addEventListener("pointerleave", () => {
    updateHover(null);
  });

  canvas.addEventListener(
    "touchstart",
    () => {
      onInputMode("touch");
    },
    { passive: true },
  );

  window.addEventListener("resize", resize);
  resize();
  animate();

  return {
    focusPhoto,
    clearFocus,
    setSoloPhoto(photoId) {
      soloPhotoId = photoId;
    },
    clearSoloView() {
      soloPhotoId = null;
    },
    setScrollProgress,
    setReducedMotion(nextValue) {
      reduced = nextValue;
    },
  };
}

function createPhotoCard(photo, textureLoader, prefersCoarsePointer) {
  const card = new THREE.Group();
  const frameWidth = photo.orientation === "landscape" ? 2.55 : 2.02;
  const imageHeight = frameWidth / photo.aspect;
  const frameHeight = imageHeight + 0.06;

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0xccd5e1,
    roughness: 0.24,
    metalness: 0.08,
    transparent: true,
    opacity: 0.08,
  });

  const frame = new THREE.Mesh(
    new RoundedBoxGeometry(frameWidth + 0.06, frameHeight + 0.06, 0.035, 4, 0.035),
    frameMaterial,
  );
  frame.name = "frame";
  card.add(frame);

  const texture = textureLoader.load(photo.src);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = prefersCoarsePointer ? 2 : 8;

  const imageMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    toneMapped: false,
    transparent: true,
    opacity: 1,
  });
  const imagePlane = new THREE.Mesh(new THREE.PlaneGeometry(frameWidth, imageHeight), imageMaterial);
  imagePlane.position.z = 0.026;
  imagePlane.name = "imagePlane";
  imagePlane.userData.photoId = photo.id;
  card.add(imagePlane);

  return card;
}

function createStars(prefersCoarsePointer) {
  const starGeometry = new THREE.BufferGeometry();
  const count = prefersCoarsePointer ? 140 : 220;
  const positions = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    const radius = 9 + Math.random() * 15;
    const angle = Math.random() * TAU;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.random() * 16 - 3;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
  }

  starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  return new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      size: prefersCoarsePointer ? 0.035 : 0.05,
      color: 0xf8d8b6,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  );
}

function lerpAngle(from, to, alpha) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * alpha;
}

function createRobot() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = "robotBody";
  root.add(body);

  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0xf0ece6,
    roughness: 0.5,
    metalness: 0.08,
  });
  const shellShadeMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6cfc6,
    roughness: 0.56,
    metalness: 0.08,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x15181f,
    roughness: 0.62,
    metalness: 0.2,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0x7f8ca3,
    roughness: 0.44,
    metalness: 0.28,
  });
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0x0d1117,
    emissive: new THREE.Color(0xd2f8ff),
    emissiveIntensity: 1,
  });
  const neonTop = new THREE.MeshStandardMaterial({
    color: 0x7bf5ff,
    emissive: new THREE.Color(0x7bf5ff),
    emissiveIntensity: 1.8,
    roughness: 0.28,
    metalness: 0.12,
  });
  const neonRight = new THREE.MeshStandardMaterial({
    color: 0xff8b7d,
    emissive: new THREE.Color(0xff8b7d),
    emissiveIntensity: 1.6,
    roughness: 0.28,
    metalness: 0.12,
  });
  const neonBottom = new THREE.MeshStandardMaterial({
    color: 0xeaf36e,
    emissive: new THREE.Color(0xeaf36e),
    emissiveIntensity: 1.45,
    roughness: 0.32,
    metalness: 0.1,
  });
  const neonLeft = new THREE.MeshStandardMaterial({
    color: 0x9487ff,
    emissive: new THREE.Color(0x9487ff),
    emissiveIntensity: 1.55,
    roughness: 0.28,
    metalness: 0.12,
  });
  const flameCoreMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1b0 });
  const flameOuterMaterial = new THREE.MeshBasicMaterial({
    color: 0xff9d4d,
    transparent: true,
    opacity: 0.82,
  });

  const torso = new THREE.Mesh(new RoundedBoxGeometry(0.92, 1.2, 0.66, 6, 0.14), shellMaterial);
  torso.position.y = 0.7;
  body.add(torso);

  const torsoPanel = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.84, 0.08, 4, 0.08), shellShadeMaterial);
  torsoPanel.position.set(0, 0.72, 0.35);
  body.add(torsoPanel);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 14), eyeMaterial);
  chest.position.set(0, 1.02, 0.37);
  body.add(chest);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.18, 12), darkMaterial);
  neck.position.y = 1.42;
  body.add(neck);

  const head = new THREE.Group();
  head.name = "robotHead";
  head.position.y = 1.92;
  body.add(head);

  const helmetBack = new THREE.Mesh(new RoundedBoxGeometry(1.48, 1.44, 1.34, 8, 0.24), shellShadeMaterial);
  helmetBack.position.set(0, 0.06, -0.02);
  head.add(helmetBack);

  const helmetTop = new THREE.Mesh(new RoundedBoxGeometry(1.34, 0.46, 0.98, 6, 0.16), darkMaterial);
  helmetTop.position.set(0, 0.48, -0.04);
  head.add(helmetTop);

  const faceFrame = new THREE.Mesh(new RoundedBoxGeometry(1.4, 1.34, 0.34, 8, 0.22), shellMaterial);
  faceFrame.position.set(0, -0.02, 0.46);
  head.add(faceFrame);

  const screen = new THREE.Mesh(new RoundedBoxGeometry(0.98, 0.94, 0.09, 6, 0.12), darkMaterial);
  screen.position.set(0, -0.03, 0.63);
  head.add(screen);

  const topGlow = new THREE.Mesh(new RoundedBoxGeometry(0.94, 0.12, 0.06, 4, 0.05), neonTop);
  topGlow.position.set(0, 0.48, 0.64);
  head.add(topGlow);

  const bottomGlow = new THREE.Mesh(new RoundedBoxGeometry(0.92, 0.11, 0.06, 4, 0.05), neonBottom);
  bottomGlow.position.set(0, -0.52, 0.64);
  head.add(bottomGlow);

  const leftGlow = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.86, 0.06, 4, 0.05), neonLeft);
  leftGlow.position.set(-0.52, -0.02, 0.64);
  head.add(leftGlow);

  const rightGlow = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.86, 0.06, 4, 0.05), neonRight);
  rightGlow.position.set(0.52, -0.02, 0.64);
  head.add(rightGlow);

  const eyes = new THREE.Group();
  eyes.name = "robotEyes";
  head.add(eyes);

  const eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), eyeMaterial);
  eyeLeft.scale.set(1, 1.1, 0.52);
  eyeLeft.position.set(-0.13, -0.01, 0.69);
  eyes.add(eyeLeft);

  const eyeRight = eyeLeft.clone();
  eyeRight.position.x = 0.13;
  eyes.add(eyeRight);

  const earLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 24), shellShadeMaterial);
  earLeft.rotation.z = Math.PI / 2;
  earLeft.position.set(-0.84, -0.02, 0.04);
  head.add(earLeft);

  const earRight = earLeft.clone();
  earRight.position.x = 0.8;
  head.add(earRight);

  const earCapLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.07, 18), darkMaterial);
  earCapLeft.rotation.z = Math.PI / 2;
  earCapLeft.position.set(-0.9, -0.02, 0.06);
  head.add(earCapLeft);

  const earCapRight = earCapLeft.clone();
  earCapRight.position.x = 0.88;
  head.add(earCapRight);

  const antennaLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.28, 10), shellShadeMaterial);
  antennaLeft.position.set(-0.34, 0.72, -0.08);
  antennaLeft.rotation.z = 0.25;
  head.add(antennaLeft);

  const antennaRight = antennaLeft.clone();
  antennaRight.position.x = 0.34;
  antennaRight.rotation.z = -0.25;
  head.add(antennaRight);

  const tipLeft = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), shellMaterial);
  tipLeft.position.set(-0.4, 0.84, -0.08);
  head.add(tipLeft);

  const tipRight = tipLeft.clone();
  tipRight.position.x = 0.44;
  head.add(tipRight);

  const backpack = new THREE.Group();
  backpack.position.set(0, 0.76, -0.42);
  body.add(backpack);

  const tankLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.38, 18), darkMaterial);
  tankLeft.position.set(-0.17, 0, -0.08);
  tankLeft.rotation.z = 0.06;
  backpack.add(tankLeft);

  const tankRight = tankLeft.clone();
  tankRight.position.x = 0.17;
  tankRight.rotation.z = -0.06;
  backpack.add(tankRight);

  const centralPack = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.3, 0.16, 4, 0.06), shellShadeMaterial);
  centralPack.position.set(0, 0, 0.02);
  backpack.add(centralPack);

  const thrusters = [];
  for (const x of [-0.17, 0.17]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.12, 14), darkMaterial);
    nozzle.position.set(x, -0.28, -0.08);
    backpack.add(nozzle);

    const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 14), flameOuterMaterial);
    flameOuter.position.set(x, -0.52, -0.08);
    flameOuter.rotation.x = Math.PI;
    flameOuter.userData.phase = x < 0 ? 0 : 1.1;
    backpack.add(flameOuter);
    thrusters.push(flameOuter);

    const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22, 12), flameCoreMaterial);
    flameCore.position.set(x, -0.48, -0.08);
    flameCore.rotation.x = Math.PI;
    flameCore.userData.phase = x < 0 ? 0.4 : 1.6;
    backpack.add(flameCore);
    thrusters.push(flameCore);
  }

  const armLeft = createArm(shellMaterial, darkMaterial, accentMaterial);
  armLeft.position.set(-0.53, 0.82, 0.04);
  body.add(armLeft);

  const armRight = createArm(shellMaterial, darkMaterial, accentMaterial);
  armRight.position.set(0.53, 0.82, 0.04);
  armRight.scale.x = -1;
  body.add(armRight);

  const hip = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.12, 0.18, 4, 0.04), darkMaterial);
  hip.position.y = -0.02;
  body.add(hip);

  const legLeft = createLeg(shellMaterial, darkMaterial, accentMaterial);
  legLeft.position.set(-0.14, -0.18, 0);
  body.add(legLeft);

  const legRight = createLeg(shellMaterial, darkMaterial, accentMaterial);
  legRight.position.set(0.14, -0.18, 0);
  body.add(legRight);

  root.userData.thrusters = thrusters;
  root.userData.eyeMeshes = [eyeLeft, eyeRight];
  return root;
}

function createArm(suitMaterial, trimMaterial, copperMaterial) {
  const group = new THREE.Group();

  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 14), trimMaterial);
  group.add(shoulder);

  const upper = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.54, 0.2, 4, 0.08), suitMaterial);
  upper.position.set(0.18, -0.18, 0.02);
  upper.rotation.z = -0.36;
  group.add(upper);

  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 12), copperMaterial);
  elbow.position.set(0.22, -0.46, 0.02);
  group.add(elbow);

  const lower = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.46, 0.18, 4, 0.08), suitMaterial);
  lower.position.set(0.28, -0.64, 0.05);
  lower.rotation.z = -0.12;
  group.add(lower);

  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 14), trimMaterial);
  hand.scale.set(1, 0.84, 1.1);
  hand.position.set(0.33, -0.88, 0.08);
  group.add(hand);

  return group;
}

function createLeg(suitMaterial, trimMaterial, copperMaterial) {
  const group = new THREE.Group();

  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.24, 12), trimMaterial);
  upper.position.y = -0.06;
  group.add(upper);

  const knee = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), copperMaterial);
  knee.position.y = -0.2;
  group.add(knee);

  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 12), trimMaterial);
  lower.position.y = -0.36;
  group.add(lower);

  const boot = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.16, 0.24, 4, 0.05), suitMaterial);
  boot.position.set(0, -0.54, 0.03);
  group.add(boot);

  return group;
}
