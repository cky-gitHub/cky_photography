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
  const photosRoot = new THREE.Group();
  world.add(photosRoot);
  const wallRoot = new THREE.Group();
  wallRoot.position.set(0, -24, 0);
  world.add(wallRoot);

  const ambient = new THREE.HemisphereLight(0xf5f8ff, 0x1d130c, 1.9);
  const keyLight = new THREE.DirectionalLight(0xffe8cf, 2.85);
  keyLight.position.set(7, 15, 12);
  const rimLight = new THREE.DirectionalLight(0x98c4ff, 1.25);
  rimLight.position.set(-10, 9, -12);
  const jetLight = new THREE.PointLight(0xffb86c, 2.2, 20, 1.25);
  jetLight.position.set(0, -0.3, -1.6);
  scene.add(ambient, keyLight, rimLight, jetLight);

  let walkGroundY = -25.42;

  const stars = createStars(prefersCoarsePointer);
  world.add(stars);

  const helixRadius = 6.7;
  const ringY = 0;
  const cardPitchCompensation = -0.18;
  const textureLoader = new THREE.TextureLoader();
  const photoGroups = new Map();
  const wallGroups = new Map();
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const interactiveObjects = [];

  photos.forEach((photo, photoIndex) => {
    const card = createPhotoCard(photo, textureLoader, prefersCoarsePointer);
    card.userData = {
      photo,
      baseAngle: (photoIndex / Math.max(photos.length, 1)) * TAU,
      frame: card.getObjectByName("frame"),
      imagePlane: card.getObjectByName("imagePlane"),
    };
    card.userData.imagePlane.userData.source = "ring";
    photosRoot.add(card);
    photoGroups.set(photo.id, card);
    interactiveObjects.push(card.userData.imagePlane);
  });

  const wallRows = 1;
  const wallPhotoCount = Math.max(photos.length * 2, 20);
  const wallSpacing = 6.85;
  const wallStartX = -5.4;
  const wallPictureY = 2.0;
  const wallPictureScale = 1.84;
  for (let wallIndex = 0; wallIndex < wallPhotoCount; wallIndex += 1) {
    const photo = photos[wallIndex % Math.max(photos.length, 1)];
    if (!photo) {
      continue;
    }

    const card = createPhotoCard(photo, textureLoader, prefersCoarsePointer);
    const row = wallIndex % wallRows;
    const column = Math.floor(wallIndex / wallRows);
    const x = column * wallSpacing + wallStartX;
    const y = wallPictureY;
    const z = -1;
    const key = `wall-${wallIndex}`;

    card.position.set(x, y, z);
    card.scale.setScalar(wallPictureScale);
    card.userData = {
      ...card.userData,
      photo,
      wallKey: key,
      frame: card.getObjectByName("frame"),
      imagePlane: card.getObjectByName("imagePlane"),
      basePosition: new THREE.Vector3(x, y, z),
    };
    card.rotation.set(0, 0, 0);
    card.userData.imagePlane.userData.photoId = photo.id;
    card.userData.imagePlane.userData.wallKey = key;
    card.userData.imagePlane.userData.source = "wall";
    wallRoot.add(card);
    wallGroups.set(key, card);
    interactiveObjects.push(card.userData.imagePlane);
  }

  const wallColumns = Math.ceil(wallPhotoCount / wallRows);
  const wallTravelMax = wallColumns * wallSpacing - 2.2;
  const wallTravelDistance = wallTravelMax * 0.2;
  const wallMessage = createWallMessage();
  wallMessage.position.set(wallColumns * wallSpacing - 0.8, 2.2, 0.2);
  wallRoot.add(wallMessage);

  const robot = createRobot();
  robot.position.set(0, -0.18, 0.15);
  robot.scale.setScalar(1.18);
  world.add(robot);

  const robotHead = robot.getObjectByName("robotHead");
  const robotBody = robot.getObjectByName("robotBody");
  const robotEyes = robot.getObjectByName("robotEyes");
  const robotArms = robot.userData.arms ?? [];
  const robotLegs = robot.userData.legs ?? [];
  const thrusters = robot.userData.thrusters ?? [];
  const eyeMeshes = robot.userData.eyeMeshes ?? [];
  const robotFootBottomOffset = -0.8;

  let reduced = reducedMotion;
  let hoveredId = state.hoveredId;
  let focusedId = state.focusedId;
  let soloPhotoId = state.soloPhotoId;
  let scrollProgress = 0;
  let activeMonthId = months[0]?.id ?? null;
  let frontPhotoId = photos[0]?.id ?? null;
  let ringRotation = 0;
  let ringRotationTarget = 0;
  let focusedWallKey = null;
  let lastPickInfo = null;
  let previousScrollProgress = 0;
  let scrollMomentum = 0;
  let walkPhase = 0;
  let wallTravelProgress = 0;
  const dragState = {
    active: false,
    pointerId: null,
    lastX: 0,
    moved: false,
    totalDelta: 0,
  };

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
    const hit = hits[0];
    if (!hit?.object?.userData?.photoId) {
      lastPickInfo = null;
      return null;
    }

    lastPickInfo = {
      photoId: hit.object.userData.photoId,
      wallKey: hit.object.userData.wallKey ?? null,
      source: hit.object.userData.source ?? "ring",
    };
    return lastPickInfo;
  }

  function updateHover(nextHoveredId) {
    if (hoveredId !== nextHoveredId) {
      hoveredId = nextHoveredId;
      onHover(nextHoveredId);
    }
  }

  function focusPhoto(photoId) {
    focusedId = photoId;
    if (lastPickInfo?.photoId === photoId && lastPickInfo?.source === "wall") {
      focusedWallKey = lastPickInfo.wallKey;
    } else {
      focusedWallKey = null;
    }
    onFocus(photoId);
  }

  function clearFocus() {
    focusedId = null;
    focusedWallKey = null;
    onFocus(null);
  }

  function setScrollProgress(progress) {
    scrollProgress = THREE.MathUtils.clamp(progress, 0, 1);
  }

  function animate() {
    const delta = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;
    let nearestPhotoId = frontPhotoId;
    let nearestFrontness = -Infinity;
    const launchProgress = THREE.MathUtils.smoothstep(scrollProgress, 0.02, 0.14);
    const fallProgress = THREE.MathUtils.smoothstep(scrollProgress, 0.1, 0.28);
    const landProgress = THREE.MathUtils.smoothstep(scrollProgress, 0.3, 0.62);
    const walkProgress = THREE.MathUtils.smoothstep(scrollProgress, 0.68, 1);
    const turnProgress = THREE.MathUtils.smoothstep(scrollProgress, 0.66, 0.8);
    const wallReveal = THREE.MathUtils.smoothstep(scrollProgress, 0.56, 0.78);
    const descentProgress = THREE.MathUtils.smoothstep(scrollProgress, 0.12, 0.62);
    const ringOpacity = 1;
    const ringLift = THREE.MathUtils.smoothstep(scrollProgress, 0.02, 0.52) * 12;
    const landingSceneY = THREE.MathUtils.lerp(-20, 0, wallReveal);
    const targetGroundY = -1.42 + landingSceneY;
    const targetRobotY = THREE.MathUtils.lerp(-0.18, -0.68, descentProgress);
    const targetGroundTopY = targetGroundY + 0.11;
    const targetFootClearance = targetRobotY + robotFootBottomOffset - targetGroundTopY;
    const landedFactor = THREE.MathUtils.smoothstep(-targetFootClearance, 0.02, 0.16);
    const effectiveTurnProgress = turnProgress * landedFactor;
    const effectiveWalkProgress = walkProgress * landedFactor;
    const turnTargetYaw = Math.PI / 2 * effectiveTurnProgress;
    const remainingTurn = Math.abs(turnTargetYaw - robot.rotation.y);
    const travelUnlocked = effectiveTurnProgress > 0.995 && remainingTurn < 0.03;
    const scrollDelta = scrollProgress - previousScrollProgress;
    previousScrollProgress = scrollProgress;
    if (travelUnlocked || wallTravelProgress > 0) {
      wallTravelProgress = THREE.MathUtils.clamp(wallTravelProgress + scrollDelta * 5.6, 0, 1);
    }
    const effectiveTravelProgress = wallTravelProgress;
    const wallTravel = effectiveTravelProgress * wallTravelDistance;
    const walkDriveTarget = effectiveTravelProgress * THREE.MathUtils.clamp(Math.abs(scrollDelta) * 12, 0, 0.32);
    scrollMomentum = walkDriveTarget;
    walkPhase += scrollDelta * 1.8;

    if (!reduced) {
      stars.rotation.y += delta * 0.008;
    }

    stars.material.opacity = THREE.MathUtils.lerp(
      stars.material.opacity,
      soloPhotoId ? 0 : 0.3,
      reduced ? 0.22 : 0.1,
    );
    wallRoot.position.y = THREE.MathUtils.lerp(
      wallRoot.position.y,
      landingSceneY,
      reduced ? 0.2 : 0.08,
    );
    walkGroundY = THREE.MathUtils.lerp(
      walkGroundY,
      targetGroundY,
      reduced ? 0.2 : 0.08,
    );
    photosRoot.position.y = THREE.MathUtils.lerp(
      photosRoot.position.y,
      ringLift,
      reduced ? 0.2 : 0.12,
    );
    photosRoot.visible = ringOpacity > 0.02 || Boolean(soloPhotoId);
    robot.visible = !soloPhotoId;
    wallRoot.position.x = THREE.MathUtils.lerp(
      wallRoot.position.x,
      -wallTravel,
      reduced ? 0.2 : 0.08,
    );

    const focusedCard = focusedId && !focusedWallKey ? photoGroups.get(focusedId) : null;
    if (!dragState.active && focusedCard) {
      ringRotationTarget = -focusedCard.userData.baseAngle;
    }
    ringRotation = lerpAngle(ringRotation, ringRotationTarget, reduced ? 0.22 : 0.12);

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
      const theta = card.userData.baseAngle + ringRotation;
      const isHovered = hoveredId === photo.id;
      const isFocused = focusedId === photo.id;
      const isSoloTarget = soloPhotoId === photo.id;
      const frontness = (Math.cos(theta) + 1) * 0.5;
      const centerCloseness = THREE.MathUtils.clamp(frontness, 0, 1);

      if (soloPhotoId && isSoloTarget) {
        tempVectorA.copy(soloViewPosition);
      } else {
        tempVectorA.set(
          Math.sin(theta) * helixRadius,
          ringY,
          Math.cos(theta) * helixRadius,
        );
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
        soloPhotoId ? 0 : (isFocused ? 0.24 : isHovered ? 0.16 : 0.08) * ringOpacity,
        reduced ? 0.18 : 0.12,
      );
      imagePlane.material.opacity = THREE.MathUtils.lerp(
        imagePlane.material.opacity,
        soloPhotoId ? (isSoloTarget ? 1 : 0) : ringOpacity,
        reduced ? 0.22 : 0.12,
      );

      if (!soloPhotoId && tempVectorA.z > nearestFrontness) {
        nearestFrontness = tempVectorA.z;
        nearestPhotoId = photo.id;
      }
    }

    for (const card of wallGroups.values()) {
      const frame = card.userData.frame;
      const imagePlane = card.userData.imagePlane;
      const basePosition = card.userData.basePosition;
      const isHovered = hoveredId === card.userData.photo.id && lastPickInfo?.wallKey === card.userData.wallKey;
      const isFocused = focusedWallKey === card.userData.wallKey && focusedId === card.userData.photo.id;
      const isSoloTarget = soloPhotoId === card.userData.photo.id && focusedWallKey === card.userData.wallKey;
      const localX = basePosition.x + wallRoot.position.x;
      const centerWeight = 1 - THREE.MathUtils.clamp(Math.abs(localX) / 7.4, 0, 1);

      if (soloPhotoId && isSoloTarget) {
        tempVectorA.copy(soloViewPosition);
      } else {
        tempVectorA.set(basePosition.x, basePosition.y, basePosition.z);
        tempVectorA.z += isFocused ? 0.9 : isHovered ? 0.22 : 0;
      }

      card.position.lerp(tempVectorA, reduced ? 0.2 : 0.12);
      const targetYaw = soloPhotoId && isSoloTarget ? 0 : 0;
      card.rotation.y = lerpAngle(card.rotation.y, targetYaw, reduced ? 0.2 : 0.14);
      card.rotation.x = THREE.MathUtils.lerp(card.rotation.x, soloPhotoId && isSoloTarget ? cardPitchCompensation : 0, reduced ? 0.2 : 0.16);
      card.rotation.z = THREE.MathUtils.lerp(card.rotation.z, 0, reduced ? 0.2 : 0.16);

      const targetScale = soloPhotoId
        ? isSoloTarget ? 2.3 : 1
        : 1.08 + centerWeight * 0.06 + (isHovered ? 0.05 : 0) + (isFocused ? 0.18 : 0);
      card.scale.x = THREE.MathUtils.lerp(card.scale.x || 1.08, targetScale, reduced ? 0.2 : 0.14);
      card.scale.y = THREE.MathUtils.lerp(card.scale.y || 1.08, targetScale, reduced ? 0.2 : 0.14);
      card.scale.z = THREE.MathUtils.lerp(card.scale.z || 1.08, targetScale, reduced ? 0.2 : 0.14);

      frame.material.color.lerp(
        tempColor.set(isFocused ? "#f6f3ef" : isHovered ? "#e7eef8" : "#ccd5e1"),
        reduced ? 0.18 : 0.12,
      );
      frame.material.opacity = THREE.MathUtils.lerp(
        frame.material.opacity,
        soloPhotoId ? 0 : 0.12 + (isFocused ? 0.16 : isHovered ? 0.08 : 0),
        reduced ? 0.18 : 0.12,
      );
      imagePlane.material.opacity = THREE.MathUtils.lerp(
        imagePlane.material.opacity,
        soloPhotoId ? (isSoloTarget ? 1 : 0) : 1,
        reduced ? 0.22 : 0.12,
      );

      card.visible = true;

      if (!soloPhotoId && effectiveWalkProgress > 0.05 && centerWeight > nearestFrontness) {
        nearestFrontness = centerWeight;
        nearestPhotoId = card.userData.photo.id;
      }
    }

    if (nearestPhotoId && nearestPhotoId !== frontPhotoId) {
      frontPhotoId = nearestPhotoId;
      onFrontPhotoChange(frontPhotoId);
    }

    const displayMonthId = photoById.get(focusedId || frontPhotoId)?.monthId ?? activeMonthId;
    if (displayMonthId && displayMonthId !== activeMonthId) {
      activeMonthId = displayMonthId;
      onMonthChange(activeMonthId);
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
    const walkingLook = effectiveTurnProgress > 0.06;
    const headYawTarget = walkingLook
      ? THREE.MathUtils.clamp(limitedYaw, 0, THREE.MathUtils.degToRad(45))
      : limitedYaw;
    const headPitchTarget = walkingLook
      ? THREE.MathUtils.clamp(limitedPitch, -THREE.MathUtils.degToRad(10), THREE.MathUtils.degToRad(10))
      : limitedPitch;
    robotHead.rotation.y = THREE.MathUtils.lerp(robotHead.rotation.y, headYawTarget, reduced ? 0.18 : 0.1);
    robotHead.rotation.x = THREE.MathUtils.lerp(robotHead.rotation.x, headPitchTarget, reduced ? 0.18 : 0.1);
    robotBody.rotation.y = THREE.MathUtils.lerp(robotBody.rotation.y, walkingLook ? 0 : yaw * 0.18, reduced ? 0.16 : 0.08);

    const walkCycle = Math.sin(walkPhase) * scrollMomentum;
    const armRaise = fallProgress * (1 - landProgress);
    for (const arm of robotArms) {
      const side = arm.userData.side ?? 1;
      arm.rotation.z = THREE.MathUtils.lerp(
        arm.rotation.z,
        side * (0.12 + 0.96 * armRaise + 0.14 * walkCycle),
        reduced ? 0.22 : 0.12,
      );
      arm.rotation.x = THREE.MathUtils.lerp(
        arm.rotation.x,
        -0.16 - 0.18 * armRaise,
        reduced ? 0.22 : 0.12,
      );
    }

    for (const leg of robotLegs) {
      const side = leg.userData.side ?? 1;
      leg.rotation.x = THREE.MathUtils.lerp(
        leg.rotation.x,
        side * 1.8 * walkCycle,
        reduced ? 0.18 : 0.12,
      );
    }

    if (!reduced) {
      const hoverBounce = Math.sin(elapsed * 1.55) * 0.07 * (1 - fallProgress);
      const walkBounce = Math.abs(Math.sin(walkPhase)) * 0.18 * scrollMomentum;
      robot.position.y = targetRobotY + hoverBounce + walkBounce;
      robot.position.x = 0;
      robot.rotation.y = THREE.MathUtils.lerp(robot.rotation.y, turnTargetYaw, 0.045);
      robot.rotation.z = THREE.MathUtils.lerp(robot.rotation.z, 0, 0.08);
      robot.rotation.x = THREE.MathUtils.lerp(robot.rotation.x, 0, 0.08);
      const groundTopY = walkGroundY + 0.11;
      const robotFootBottomY = robot.position.y + robotFootBottomOffset;
      const feetClearance = robotFootBottomY - groundTopY;
      const jetpackPower = THREE.MathUtils.smoothstep(feetClearance, 0.015, 0.14);
      jetLight.intensity = (2.6 + (Math.sin(elapsed * 9) * 0.5 + 0.5) * 1.5) * jetpackPower;

      for (const thruster of thrusters) {
        const flicker = Math.sin(elapsed * 14 + thruster.userData.phase) * 0.5 + 0.5;
        const pulse = (0.96 + flicker * 0.86) * jetpackPower;
        const sway = Math.sin(elapsed * 9.4 + thruster.userData.phase) * 0.06 * jetpackPower;
        thruster.scale.set(1.02 + flicker * 0.08, pulse, 1.02);
        thruster.rotation.z = sway;
        thruster.position.y = -1.12 - flicker * 0.09;
        thruster.position.z = -0.1;
        thruster.visible = jetpackPower > 0.025;
      }

      if (robotEyes?.material) {
        robotEyes.material.emissiveIntensity = 1 + (Math.sin(elapsed * 3.4) * 0.5 + 0.5) * 0.24;
      }
    } else {
      robot.position.y = targetRobotY;
      robot.position.x = 0;
      robot.rotation.y = turnTargetYaw;
      robot.rotation.z = 0;
      robot.rotation.x = 0;
      const groundTopY = walkGroundY + 0.11;
      const robotFootBottomY = robot.position.y + robotFootBottomOffset;
      const feetClearance = robotFootBottomY - groundTopY;
      const jetpackPower = THREE.MathUtils.smoothstep(feetClearance, 0.015, 0.14);
      jetLight.intensity = 3 * jetpackPower;
      for (const thruster of thrusters) {
        thruster.scale.set(1.06, Math.max(jetpackPower * 1.5, 0.001), 1.02);
        thruster.rotation.z = 0;
        thruster.position.y = -1.14;
        thruster.position.z = -0.1;
        thruster.visible = jetpackPower > 0.025;
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

    if (dragState.active && dragState.pointerId === event.pointerId && !soloPhotoId) {
      const deltaX = event.clientX - dragState.lastX;
      dragState.lastX = event.clientX;
      dragState.totalDelta += Math.abs(deltaX);
      if (dragState.totalDelta > 4) {
        dragState.moved = true;
      }
      if (dragState.moved && focusedId) {
        clearFocus();
      }
      ringRotationTarget += deltaX * 0.0085;
      updateHover(null);
      return;
    }

    updateHover(pickPhoto()?.photoId ?? null);
  });

  canvas.addEventListener("pointerdown", (event) => {
    setPointerFromEvent(event);
    onInputMode(prefersCoarsePointer ? "touch" : "mouse");
    dragState.active = true;
    dragState.pointerId = event.pointerId;
    dragState.lastX = event.clientX;
    dragState.moved = false;
    dragState.totalDelta = 0;
    canvas.setPointerCapture?.(event.pointerId);
  });

  function endPointerInteraction(event) {
    if (!dragState.active || dragState.pointerId !== event.pointerId) {
      return;
    }

    setPointerFromEvent(event);
    const wasMoved = dragState.moved;
    dragState.active = false;
    dragState.pointerId = null;
    canvas.releasePointerCapture?.(event.pointerId);

    if (wasMoved) {
      return;
    }

    const pick = pickPhoto();
    if (pick?.photoId) {
      onPhotoSelect(pick.photoId);
    } else if (focusedId) {
      clearFocus();
    }
  }

  canvas.addEventListener("pointerup", endPointerInteraction);
  canvas.addEventListener("pointercancel", endPointerInteraction);

  canvas.addEventListener("pointerleave", () => {
    dragState.active = false;
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
    spinToMonth(monthId) {
      const month = months.find((item) => item.id === monthId);
      const targetPhoto = month?.photos?.[0];
      if (!targetPhoto) {
        return;
      }
      focusedId = null;
      ringRotationTarget = -photoGroups.get(targetPhoto.id).userData.baseAngle;
      activeMonthId = monthId;
      onMonthChange(monthId);
    },
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
  const flameCoreMaterial = new THREE.MeshBasicMaterial({ color: 0xfff7dd });
  const flameMidMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd36b,
    transparent: true,
    opacity: 0.96,
  });
  const flameOuterMaterial = new THREE.MeshBasicMaterial({
    color: 0xff8a3c,
    transparent: true,
    opacity: 0.9,
  });
  const jetpackShellMaterial = new THREE.MeshStandardMaterial({
    color: 0x8f99a8,
    roughness: 0.46,
    metalness: 0.18,
  });
  const jetpackDarkMaterial = new THREE.MeshStandardMaterial({
    color: 0x4e5763,
    roughness: 0.52,
    metalness: 0.22,
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
  backpack.position.set(0, 0.9, -0.4);
  backpack.scale.setScalar(1.12);
  body.add(backpack);

  const centralPack = new THREE.Mesh(new RoundedBoxGeometry(0.72, 1.06, 0.28, 6, 0.1), jetpackDarkMaterial);
  centralPack.position.set(0, 0.04, 0.06);
  backpack.add(centralPack);

  const packShell = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.86, 0.12, 4, 0.06), jetpackShellMaterial);
  packShell.position.set(0, 0.02, 0.24);
  backpack.add(packShell);

  const packRib = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.04), accentMaterial);
  packRib.position.set(0, 0.18, 0.31);
  backpack.add(packRib);

  const packRibMid = packRib.clone();
  packRibMid.position.y = 0.0;
  backpack.add(packRibMid);

  const packRibLow = packRib.clone();
  packRibLow.position.y = -0.18;
  backpack.add(packRibLow);

  const tankCapGeometry = new THREE.SphereGeometry(0.17, 18, 18, 0, TAU, 0, Math.PI / 2);
  const sideHoseGeometry = new THREE.TorusGeometry(0.25, 0.024, 10, 28, Math.PI * 0.92);
  const thrusters = [];
  for (const x of [-0.46, 0.46]) {
    const tank = new THREE.Group();
    tank.position.set(x, 0.06, 0.02);
    backpack.add(tank);

    const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.92, 20), jetpackShellMaterial);
    tank.add(canister);

    const bandTop = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 22), shellShadeMaterial);
    bandTop.rotation.x = Math.PI / 2;
    bandTop.position.y = 0.18;
    tank.add(bandTop);

    const bandBottom = bandTop.clone();
    bandBottom.position.y = -0.16;
    tank.add(bandBottom);

    const tankTop = new THREE.Mesh(tankCapGeometry, jetpackShellMaterial);
    tankTop.rotation.x = Math.PI;
    tankTop.position.y = 0.46;
    tank.add(tankTop);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 18), jetpackDarkMaterial);
    cap.position.y = 0.52;
    tank.add(cap);

    const hose = new THREE.Mesh(sideHoseGeometry, new THREE.MeshStandardMaterial({
      color: 0xbd7b35,
      roughness: 0.56,
      metalness: 0.12,
    }));
    hose.rotation.z = x < 0 ? Math.PI * 0.12 : -Math.PI * 0.12;
    hose.position.set(x * 0.46, -0.02, 0.28);
    backpack.add(hose);

    const nozzleNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.18, 16), jetpackDarkMaterial);
    nozzleNeck.position.y = -0.52;
    tank.add(nozzleNeck);

    const nozzleBell = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.13, 0.34, 18), jetpackShellMaterial);
    nozzleBell.position.y = -0.76;
    tank.add(nozzleBell);

    const nozzleLip = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.018, 8, 22), jetpackDarkMaterial);
    nozzleLip.rotation.x = Math.PI / 2;
    nozzleLip.position.y = -0.91;
    tank.add(nozzleLip);

    const flame = new THREE.Group();
    flame.position.set(x, -1.08, -0.08);
    flame.userData.phase = x < 0 ? 0 : 1.1;

    const outerMain = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.12, 18), flameOuterMaterial);
    outerMain.position.y = -0.5;
    outerMain.rotation.x = Math.PI;
    flame.add(outerMain);

    const outerLeft = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.72, 16), flameOuterMaterial);
    outerLeft.position.set(-0.09, -0.38, 0.01);
    outerLeft.rotation.set(Math.PI, 0, -0.2);
    flame.add(outerLeft);

    const outerRight = outerLeft.clone();
    outerRight.position.x = 0.09;
    outerRight.rotation.z = 0.2;
    flame.add(outerRight);

    const midMain = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.82, 16), flameMidMaterial);
    midMain.position.y = -0.34;
    midMain.rotation.x = Math.PI;
    flame.add(midMain);

    const coreMain = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.56, 14), flameCoreMaterial);
    coreMain.position.y = -0.24;
    coreMain.rotation.x = Math.PI;
    flame.add(coreMain);

    const flameCap = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 14), flameMidMaterial);
    flameCap.scale.set(1, 0.6, 1);
    flameCap.position.y = 0.02;
    flame.add(flameCap);

    const exhaustGlow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), flameCoreMaterial);
    exhaustGlow.scale.set(1.1, 0.42, 1.1);
    exhaustGlow.position.y = -0.02;
    flame.add(exhaustGlow);

    backpack.add(flame);
    thrusters.push(flame);
  }

  const armLeft = createArm(shellMaterial, darkMaterial, accentMaterial);
  armLeft.position.set(-0.53, 0.92, 0.04);
  armLeft.userData.side = -1;
  body.add(armLeft);

  const armRight = createArm(shellMaterial, darkMaterial, accentMaterial);
  armRight.position.set(0.53, 0.92, 0.04);
  armRight.scale.x = -1;
  armRight.userData.side = 1;
  body.add(armRight);

  const hip = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.12, 0.18, 4, 0.04), darkMaterial);
  hip.position.y = -0.02;
  body.add(hip);

  const legLeft = createLeg(shellMaterial, darkMaterial, accentMaterial);
  legLeft.position.set(-0.14, -0.18, 0);
  legLeft.userData.side = -1;
  body.add(legLeft);

  const legRight = createLeg(shellMaterial, darkMaterial, accentMaterial);
  legRight.position.set(0.14, -0.18, 0);
  legRight.userData.side = 1;
  body.add(legRight);

  root.userData.thrusters = thrusters;
  root.userData.eyeMeshes = [eyeLeft, eyeRight];
  root.userData.arms = [armLeft, armRight];
  root.userData.legs = [legLeft, legRight];
  return root;
}

function createArm(suitMaterial, trimMaterial, copperMaterial) {
  const group = new THREE.Group();

  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 14), trimMaterial);
  group.add(shoulder);

  const upper = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.72, 0.2, 4, 0.09), suitMaterial);
  upper.position.set(0.2, -0.28, 0.03);
  upper.rotation.z = -0.5;
  group.add(upper);

  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 14), trimMaterial);
  hand.scale.set(1, 0.84, 1.1);
  hand.position.set(0.42, -0.55, 0.08);
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

function createWallMessage() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 320;
  const context = canvas.getContext("2d");

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,255,255,0.88)";
  context.font = "700 98px 'Space Grotesk', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("Stay tuned for more", canvas.width / 2, canvas.height / 2 - 18);

  context.fillStyle = "rgba(255,191,125,0.9)";
  context.font = "500 28px 'Space Grotesk', sans-serif";
  context.fillText("New frames are on the way.", canvas.width / 2, canvas.height / 2 + 62);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return new THREE.Mesh(
    new THREE.PlaneGeometry(5.8, 1.8),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      toneMapped: false,
    }),
  );
}
