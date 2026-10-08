"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RotateCcw, Move, Orbit, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { boneKey, findViolations, type Violation } from "./figureConstraints";
import { disposeFigure, loadFigures, makeFigure, type Sex } from "./figureRig";
import { decodePose, encodePose } from "@/lib/motion/poseCodec";
import { JOINTS, JOINT_COUNT } from "@/lib/motion/skeleton";
import { setSpreadAxis } from "@/lib/motion/critic";
import { PoseSmoother } from "@/lib/motion/smooth";
import { boneMap, retarget, type Frame, type Report } from "./retarget";
import { createDanceStudioRoom } from "./DanceStudioRoom";

const FIGURE_HEIGHT = 1.75;

/**
 * Longest edge of a captured render, and its JPEG quality.
 *
 * 800 because that is what the vision model resizes to anyway; anything
 * larger is bandwidth spent on pixels discarded on arrival. JPEG rather than
 * PNG because a render of a smooth figure compresses to a fraction of the
 * size and the model is judging a pose, not counting pixels.
 */
const CAPTURE_MAX = 800;
const CAPTURE_QUALITY = 0.85;

/**
 * Bones that exist in the export but are not part of the body.
 *
 * `KneeIK`, `LegIK`, `ElbowIK` and `HandIK` are Blender IK targets that came
 * through the export as ordinary bones. They carry no skin weight and nothing
 * drives them, so they sit wherever the export left them, and drawing them puts
 * four long lines across the scene converging on the floor — which reads as a
 * figure that has collapsed. They are not bones; they are controls.
 *
 * Matched anywhere in the name rather than at the end. `boneKey` keeps the side
 * suffix, so these arrive as `KneeIKL`, and the anchored `/IK$/` this started
 * as matched none of them — the filter looked right and did nothing.
 */
const IK = /IK/;

// What `show` hands the overlay. A clip is a finished performance: every joint
// in it carries a real rotation, so there is no such thing as an untracked bone
// to grey out — the distinction the colouring exists to draw only means
// something while a capture is running.
const ALL_DRIVEN = new Set(JOINTS.map((j) => j.key));

/**
 * Works out which knuckle axis spreads the fingers, by trying both.
 *
 * `figureConstraints` says outright that this rig's bone axes do not line up
 * with the sagittal and coronal planes, so "abduction is z" would be a guess —
 * and a wrong guess here does not fail, it quietly pushes fingers together when
 * asked to spread them. Measuring costs a few milliseconds once and removes the
 * guess: rotate the knuckles one way, see whether the fingertips moved apart,
 * then the other, and keep whichever did more.
 *
 * The rig is put back exactly as it was, so this can run before the first frame
 * is ever posed without leaving a mark on it.
 */
function calibrateSpread(mesh: THREE.SkinnedMesh) {
  const bones = boneMap(mesh);
  const knuckles = ["Index1L", "Middle1L", "Ring1L", "Pinky1L"]
    .map((k) => bones.get(k))
    .filter((b): b is THREE.Bone => !!b);
  const tips = ["Index3L", "Middle3L", "Ring3L", "Pinky3L"]
    .map((k) => bones.get(k))
    .filter((b): b is THREE.Bone => !!b);
  if (knuckles.length < 2 || tips.length < 2) return;

  const root = mesh.skeleton.bones[0];
  const at = new THREE.Vector3();

  /** Total distance between neighbouring fingertips — how open the hand is. */
  const spread = () => {
    root.updateMatrixWorld(true);
    let sum = 0;
    const points = tips.map((b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));
    for (let i = 1; i < points.length; i++) sum += points[i].distanceTo(points[i - 1]);
    return sum;
  };

  const saved = knuckles.map((b) => b.quaternion.clone());
  const restore = () => knuckles.forEach((b, i) => b.quaternion.copy(saved[i]));

  const before = spread();
  const test = (axis: "y" | "z") => {
    restore();
    // Fanned rather than turned together: rotating every knuckle the same way
    // swings the whole hand and moves the fingertips without separating them,
    // which reads as no change on both axes.
    knuckles.forEach((b, i) => {
      at.set(0, 0, 0);
      at[axis] = 1;
      const turn = ((i - (knuckles.length - 1) / 2) * 10 * Math.PI) / 180;
      b.quaternion.copy(saved[i]).multiply(new THREE.Quaternion().setFromAxisAngle(at, turn));
    });
    return Math.abs(spread() - before);
  };

  const byY = test("y");
  const byZ = test("z");
  restore();
  root.updateMatrixWorld(true);

  setSpreadAxis(byY > byZ ? "y" : "z");
}

type BoneOverlay = THREE.LineSegments & {
  userData: { update: (driven: Set<string>) => void; dispose: () => void };
};

/**
 * The skeleton, drawn as one line per real bone and coloured by whether the
 * capture actually drove it this frame.
 *
 * Not `SkeletonHelper`, for two reasons: it draws every bone in the object it
 * is given — including the IK controls above, and including the *other*
 * figure's skeleton, which `makeFigure` leaves in place when it drops that
 * figure's mesh — and it paints them all one colour, which is precisely the
 * distinction worth seeing here. A limb at rest because the dancer held it
 * still and a limb at rest because nothing found it look identical otherwise.
 */
function makeBoneOverlay(mesh: THREE.SkinnedMesh): BoneOverlay {
  const pairs: { bone: THREE.Bone; parent: THREE.Bone; key: string }[] = [];
  for (const bone of mesh.skeleton.bones) {
    const key = boneKey(bone.name);
    if (IK.test(key)) continue;
    const parent = bone.parent as THREE.Bone | null;
    if (!parent?.isBone || IK.test(boneKey(parent.name))) continue;
    pairs.push({ bone, parent, key });
  }

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(pairs.length * 6);
  const col = new Float32Array(pairs.length * 6);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    // Drawn through the body: a bone behind the torso is exactly the one you
    // most want to see when checking whether a limb tracked.
    depthTest: false,
    transparent: true,
  });

  const lines = new THREE.LineSegments(geo, mat) as unknown as BoneOverlay;
  lines.renderOrder = 10;
  lines.frustumCulled = false;

  const tracked = new THREE.Color("#ff9933");
  const idle = new THREE.Color("#3a3a3a");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  lines.userData.update = (driven: Set<string>) => {
    mesh.skeleton.bones[0].updateMatrixWorld(true);
    pairs.forEach(({ bone, parent, key }, i) => {
      a.setFromMatrixPosition(parent.matrixWorld);
      b.setFromMatrixPosition(bone.matrixWorld);
      pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      const c = driven.has(key) ? tracked : idle;
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    });
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeBoundingSphere();
  };
  lines.userData.dispose = () => {
    geo.dispose();
    mat.dispose();
  };
  lines.userData.update(new Set());
  return lines;
}

export interface MocapApi {
  /**
   * Poses the figure from one frame of landmarks and returns how it went.
   *
   * `t` is the frame's time in seconds. Without it the steadying filter has no
   * timestep and is skipped, so a caller that wants a still figure has to say
   * *when* each frame is — and a caller replaying at an odd speed gets the
   * right amount of smoothing rather than an amount tied to the render rate.
   */
  pose: (frame: Frame, t?: number) => Report;
  /**
   * Forgets the steadying filter's history.
   *
   * Needed after a seek: without it the pose from before the jump is blended
   * into the pose after it, and the figure takes a visible moment to catch up
   * from wherever it used to be.
   */
  resettle: () => void;
  /** Returns the figure to its rest pose. */
  clear: () => void;
  /**
   * The pose the figure is currently holding, as a flat vector.
   *
   * Read off the rig rather than recomputed from the landmarks, so what gets
   * saved is what the figure actually did — the repaired leg chain, the joint
   * limits, every correction the retargeting applied along the way.
   *
   * `null` before the model has loaded.
   */
  snapshot: (out?: Float32Array) => Float32Array | null;
  /**
   * Poses the figure straight from a saved vector, with no landmarks involved.
   *
   * How a tutorial plays back. Nothing is solved and nothing is filtered — the
   * clip already holds the finished pose, and re-deriving it would only be a
   * chance to get it wrong.
   */
  show: (pose: ArrayLike<number>) => void;
  /**
   * Poses the rig from a vector and reports which probes ended up inside the
   * body.
   *
   * Exposed because the mesh lives in here and nowhere else. Whether a hand is
   * inside a chest is a fact about the *body*, not the skeleton — the same
   * joint angles collide on one figure and clear on the other — so the check
   * has to happen against a real posed mesh rather than against the numbers.
   *
   * Poses without grounding or redrawing: this is called several times per
   * frame by the collision pass, and dropping the figure onto the floor between
   * probes would be thousands of wasted vertex walks.
   */
  probe: (pose: ArrayLike<number>) => Violation[];
  /**
   * Renders the figure as it currently stands, from several angles.
   *
   * For handing to a vision model, which cannot judge a pose from one view: an
   * arm reaching toward the camera and an arm hanging at the side can project
   * to the same silhouette, and no amount of looking harder at that one image
   * separates them.
   *
   * `yaws` are degrees around the figure, 0 being the front. The camera is put
   * back where the viewer left it afterwards, so a capture never steals the
   * orbit out from under someone watching.
   */
  capture: (yaws?: number[]) => string[];
  /**
   * Resets the 3D camera to front-facing full body framing.
   */
  fitToScreen: () => void;
  /**
   * Smoothly animates camera to target a specific anatomical preset.
   */
  focusPreset: (preset: "full" | "face" | "mudras" | "feet") => void;
  /**
   * Moves one hand by a world-space offset, approximately.
   *
   * "The hand is too high" is not a rotation of any single joint, so it cannot
   * be expressed as a joint nudge the way a finger curl can. This turns the
   * offset into a shoulder rotation: swing the whole arm about the axis
   * perpendicular to both the arm and the requested direction, through the
   * angle that arc-length says moves the wrist that far.
   *
   * First-order and deliberately so. It is exact only for small offsets, and
   * the corrections it serves are capped at 10 cm — past that the honest answer
   * is that the capture was wrong, not that the arm needs bending.
   */
  shiftHand: (side: "L" | "R", delta: THREE.Vector3) => void;
}

/**
 * The figure, driven frame by frame from captured landmarks.
 *
 * Separate from `NamasteFigure` rather than a mode of it. That one exists to
 * show one solved pose and let someone nudge its joints; this one is fed a new
 * pose sixty times a second and must draw exactly when a frame arrives. They
 * share the model and the loaders and nothing else — folding the two together
 * would mean a render loop that either spins when nothing has changed or
 * stalls when something has.
 *
 * The skeleton is drawn on top of the body deliberately. The whole point of
 * putting this beside the video is to see *what the rig is doing*, and a
 * translucent body alone hides the difference between a bone that tracked and
 * a bone that stayed at rest.
 */
export default function MocapFigure({
  sex = "female",
  showSkeleton = true,
  showBody = true,
  steady = true,
  showOverlayControls = true,
  onReady,
  className = "",
}: {
  sex?: Sex;
  showSkeleton?: boolean;
  showBody?: boolean;
  /** Filter the solved rotations before drawing them. See `lib/motion/smooth`. */
  steady?: boolean;
  /** Show floating camera presets and controls directly inside 3D frame */
  showOverlayControls?: boolean;
  onReady?: (api: MocapApi) => void;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const steadyRef = useRef(steady);
  steadyRef.current = steady;
  // The collision probe needs to know which figure it is testing — the two
  // torsos differ by enough depth that one shared girth table reports a correct
  // pose on the woman as a collision.
  const sexRef = useRef(sex);
  sexRef.current = sex;
  // Read by `apply` after a swap. Swapping builds a fresh mesh and a fresh
  // overlay, and they have to come back at whatever the toggles say *now* —
  // the build effect runs once, so a closure over the props would restore
  // whatever they happened to be when the scene was first put together.
  const showSkeletonRef = useRef(showSkeleton);
  showSkeletonRef.current = showSkeleton;
  const showBodyRef = useRef(showBody);
  showBodyRef.current = showBody;
  const smootherRef = useRef<PoseSmoother | null>(null);
  if (!smootherRef.current) smootherRef.current = new PoseSmoother();
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  });

  const [navMode, setNavMode] = useState<"orbit" | "pan">("orbit");
  const [activePreset, setActivePreset] = useState<string>("full");
  const navModeRef = useRef<"orbit" | "pan">("orbit");
  navModeRef.current = navMode;

  const fitToScreenRef = useRef<() => void>(() => {});
  const focusPresetRef = useRef<(preset: "full" | "face" | "mudras" | "feet") => void>(() => {});
  const zoomInRef = useRef<() => void>(() => {});
  const zoomOutRef = useRef<() => void>(() => {});

  // Set by the build effect so the toggles below do not rebuild the scene.
  const visRef = useRef<((skeleton: boolean, body: boolean) => void) | null>(null);
  const swapRef = useRef<((s: Sex) => void) | null>(null);

  useEffect(() => {
    if (hostRef.current) {
      const canvas = hostRef.current.querySelector("canvas");
      if (canvas) {
        canvas.style.cursor = navMode === "pan" ? "move" : "grab";
      }
    }
  }, [navMode]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    // `preserveDrawingBuffer` so the canvas can be read back with
    // `toDataURL`. Without it the buffer is cleared on swap and every
    // capture comes back blank — silently, since reading it is still legal.
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = "width:100% !important;height:100% !important;display:block;touch-action:pan-y;";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, host.clientWidth / host.clientHeight, 0.1, 100);

    // Natya Shala Rehearsal Studio Lighting
    // Ambient / Hemisphere fill (soft warm ceiling to polished teakwood floor)
    const ambient = new THREE.HemisphereLight(0xfffaee, 0x382214, 0.85);
    scene.add(ambient);

    // Natural morning sunlight streaming through the windows on the left wall
    const windowSun = new THREE.DirectionalLight(0xfff6e8, 1.6);
    windowSun.position.set(-3.8, 3.2, 0.5);
    scene.add(windowSun);

    // Studio ceiling spotlight (warm key illumination from upper front-right)
    const studioKey = new THREE.DirectionalLight(0xffecd2, 1.4);
    studioKey.position.set(2.2, 3.4, 2.5);
    scene.add(studioKey);

    // Rehearsal mirror rim light (silver-amber back rim tracing dancer silhouette)
    const mirrorRim = new THREE.DirectionalLight(0xdbe8f5, 0.65);
    mirrorRim.position.set(0, 2.4, -3.2);
    scene.add(mirrorRim);

    // Warm floor bounce light
    const floorBounce = new THREE.DirectionalLight(0xffd2a0, 0.3);
    floorBounce.position.set(0, -0.6, 1.2);
    scene.add(floorBounce);

    // Authentic 3D Dance Classroom (Teakwood floor, lotus mandala, mirror, barre, windows, ceiling)
    const studio = createDanceStudioRoom();
    scene.add(studio.group);

    const rig = new THREE.Group();
    scene.add(rig);

    let mesh: THREE.SkinnedMesh | null = null;
    let group: THREE.Group | null = null;
    let helper: BoneOverlay | null = null;
    let chestBone: THREE.Bone | null = null;
    let chestBaseRot: THREE.Euler | null = null;

    // =========================================================================
    // STUDIO CAMERA & ZOOM LIMITS (ADJUST THESE TO CONSTRAIN VIEWPORT & ROOM)
    // =========================================================================
    /** Minimum zoom distance (close-up on mudras/face) */
    const MIN_ZOOM_DIST = 0.40;
    /** Maximum zoom distance (prevents camera from passing behind studio walls/mirrors) */
    const MAX_ZOOM_DIST = 3.90;
    /** Default front-facing distance on desktop landscape */
    const DEFAULT_DIST = 3.20;

    /** Computes optimal camera distance: adjusts for mobile portrait mode so dancer's full height & arm span are framed perfectly */
    const getDefaultDist = () => {
      const aspect = camera.aspect || (host.clientWidth / (host.clientHeight || 1));
      if (aspect < 0.60) return 3.75;
      if (aspect < 0.85) return 3.55;
      return DEFAULT_DIST;
    };

    /** Safe inner room bounding box [min, max] preventing wall clipping */
    const ROOM_BOUNDS = {
      minX: -3.50, // Studio width is 8.0m (-4.0 to +4.0)
      maxX: 3.50,
      minY: 0.18,  // Floor is at 0.0m
      maxY: 3.20,  // Ceiling is at 3.6m
      minZ: -3.20, // Back wall screen is at -3.58m
      maxZ: 3.20,  // Front rehearsal mirror is at +3.57m
    };

    /** Camera vertical pitch limits (radians): prevents flipping through floor or ceiling */
    const MIN_PITCH = -0.14; // ~ -8 deg (looking slightly up)
    const MAX_PITCH = 0.40;  // ~ 23 deg (looking down from above)

    // Orbit & Pan: yaw/pitch/distance driven by drag, wheel, presets, and gestures.
    let yaw = 0;
    let pitch = 0.04;
    let dist = getDefaultDist();
    const target = new THREE.Vector3(0, 0.95, 0);

    const place = () => {
      // 1. Calculate raw spherical camera coordinates
      let cx = target.x + dist * Math.cos(pitch) * Math.sin(yaw);
      let cy = target.y + dist * Math.sin(pitch);
      let cz = target.z + dist * Math.cos(pitch) * Math.cos(yaw);

      // 2. Hard clamp to safe room interior — camera NEVER penetrates walls or mirrors!
      cx = THREE.MathUtils.clamp(cx, ROOM_BOUNDS.minX, ROOM_BOUNDS.maxX);
      cy = THREE.MathUtils.clamp(cy, ROOM_BOUNDS.minY, ROOM_BOUNDS.maxY);
      cz = THREE.MathUtils.clamp(cz, ROOM_BOUNDS.minZ, ROOM_BOUNDS.maxZ);

      camera.position.set(cx, cy, cz);
      camera.lookAt(target);
    };
    place();

    // Smooth Camera Animation Controller
    const anim = {
      active: false,
      startTime: 0,
      duration: 450,
      startYaw: 0,
      startPitch: 0,
      startDist: 3.2,
      startTarget: new THREE.Vector3(),
      endYaw: 0,
      endPitch: 0,
      endDist: 3.2,
      endTarget: new THREE.Vector3(),
    };

    const animateCameraTo = (
      tYaw: number,
      tPitch: number,
      tDist: number,
      tTarget: THREE.Vector3,
      durationSec = 0.45
    ) => {
      anim.active = true;
      anim.startTime = performance.now();
      anim.duration = durationSec * 1000;
      anim.startYaw = yaw;
      anim.startPitch = pitch;
      anim.startDist = dist;
      anim.startTarget.copy(target);

      // Shortest angular turn for yaw
      let dy = (tYaw - yaw) % (Math.PI * 2);
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      anim.endYaw = yaw + dy;

      anim.endPitch = THREE.MathUtils.clamp(tPitch, MIN_PITCH, MAX_PITCH);
      anim.endDist = THREE.MathUtils.clamp(tDist, MIN_ZOOM_DIST, MAX_ZOOM_DIST);
      anim.endTarget.copy(tTarget);
      anim.endTarget.y = THREE.MathUtils.clamp(anim.endTarget.y, 0.15, 1.75);
      anim.endTarget.x = THREE.MathUtils.clamp(anim.endTarget.x, -1.8, 1.8);
      anim.endTarget.z = THREE.MathUtils.clamp(anim.endTarget.z, -1.5, 1.5);
      dirty = true;
    };

    const fitToScreen = () => {
      animateCameraTo(0, 0.04, getDefaultDist(), new THREE.Vector3(0, 0.95, 0), 0.45);
      setActivePreset("full");
    };
    fitToScreenRef.current = fitToScreen;

    const focusPreset = (preset: "full" | "face" | "mudras" | "feet") => {
      setActivePreset(preset);
      if (preset === "full") {
        animateCameraTo(0, 0.04, getDefaultDist(), new THREE.Vector3(0, 0.95, 0), 0.45);
      } else if (preset === "face") {
        animateCameraTo(0, 0.02, 0.85, new THREE.Vector3(0, 1.52, 0), 0.45);
      } else if (preset === "mudras") {
        animateCameraTo(0, 0.05, 1.25, new THREE.Vector3(0, 1.15, 0), 0.45);
      } else if (preset === "feet") {
        animateCameraTo(0, 0.12, 1.10, new THREE.Vector3(0, 0.22, 0), 0.45);
      }
    };
    focusPresetRef.current = focusPreset;

    const zoomIn = () => {
      anim.active = false;
      setActivePreset("");
      dist = THREE.MathUtils.clamp(dist * 0.78, MIN_ZOOM_DIST, MAX_ZOOM_DIST);
      place();
      dirty = true;
    };
    zoomInRef.current = zoomIn;

    const zoomOut = () => {
      anim.active = false;
      setActivePreset("");
      dist = THREE.MathUtils.clamp(dist * 1.28, MIN_ZOOM_DIST, MAX_ZOOM_DIST);
      place();
      dirty = true;
    };
    zoomOutRef.current = zoomOut;

    let dirty = true;
    const draw = () => {
      if (disposed) return;
      dirty = false;
      renderer.render(scene, camera);
    };

    // Render only when something changed.
    let raf = 0;
    const clock = new THREE.Clock();
    let lastPoseTime = 0;
    const tick = () => {
      if (disposed) return;
      const now = clock.getElapsedTime();

      // Camera animation progression
      if (anim.active) {
        const elapsed = performance.now() - anim.startTime;
        const p = Math.min(elapsed / anim.duration, 1);
        // Cubic ease-out: 1 - (1 - p)^3
        const ease = 1 - Math.pow(1 - p, 3);
        yaw = anim.startYaw + (anim.endYaw - anim.startYaw) * ease;
        pitch = anim.startPitch + (anim.endPitch - anim.startPitch) * ease;
        dist = anim.startDist + (anim.endDist - anim.startDist) * ease;
        target.lerpVectors(anim.startTarget, anim.endTarget, ease);
        place();
        dirty = true;
        if (p >= 1) anim.active = false;
      }

      // Gentle micro-breathing when idle (>0.25s since last mocap frame) and not dragging
      if (mesh && chestBone && chestBaseRot && now - lastPoseTime > 0.25 && !dragging && !anim.active) {
        const breath = Math.sin(now * 1.6) * 0.016;
        chestBone.rotation.x = chestBaseRot.x + breath;
        mesh.skeleton.bones[0].updateMatrixWorld(true);
        dirty = true;
      }
      if (dirty) draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    let dragging = false;
    let dragMode: "orbit" | "pan" = "orbit";
    let lastX = 0;
    let lastY = 0;
    const pointers = new Map<number, { x: number; y: number }>();
    let lastPinchDist = 0;
    let lastPinchCenter = { x: 0, y: 0 };

    const onDown = (e: PointerEvent) => {
      anim.active = false;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1) {
        dragging = true;
        const forcePan = e.button === 2 || e.button === 1 || e.shiftKey;
        dragMode = forcePan || navModeRef.current === "pan" ? "pan" : "orbit";
        lastX = e.clientX;
        lastY = e.clientY;
        renderer.domElement.setPointerCapture(e.pointerId);
        renderer.domElement.style.cursor = dragMode === "pan" ? "move" : "grabbing";
      } else if (pointers.size === 2) {
        const pArray = Array.from(pointers.values());
        lastPinchDist = Math.hypot(pArray[0].x - pArray[1].x, pArray[0].y - pArray[1].y);
        lastPinchCenter = {
          x: (pArray[0].x + pArray[1].x) / 2,
          y: (pArray[0].y + pArray[1].y) / 2,
        };
        renderer.domElement.style.cursor = "move";
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        // Multi-touch pinch-to-zoom & two-finger pan
        const pArray = Array.from(pointers.values());
        const newPinchDist = Math.hypot(pArray[0].x - pArray[1].x, pArray[0].y - pArray[1].y);
        const newCenter = {
          x: (pArray[0].x + pArray[1].x) / 2,
          y: (pArray[0].y + pArray[1].y) / 2,
        };

        if (lastPinchDist > 0 && newPinchDist > 0) {
          const ratio = newPinchDist / lastPinchDist;
          dist = THREE.MathUtils.clamp(dist / ratio, MIN_ZOOM_DIST, MAX_ZOOM_DIST);
          setActivePreset("");
        }

        const pdx = newCenter.x - lastPinchCenter.x;
        const pdy = newCenter.y - lastPinchCenter.y;
        const panSpeed = dist * 0.0016;
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);
        target.x = THREE.MathUtils.clamp(target.x - pdx * panSpeed * rightX, -1.8, 1.8);
        target.z = THREE.MathUtils.clamp(target.z - pdx * panSpeed * rightZ, -1.5, 1.5);
        target.y = THREE.MathUtils.clamp(target.y + pdy * panSpeed, 0.15, 1.75);

        lastPinchDist = newPinchDist;
        lastPinchCenter = newCenter;
        place();
        dirty = true;
        return;
      }

      if (!dragging || pointers.size !== 1) return;

      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (dragMode === "pan") {
        setActivePreset("");
        const panSpeed = dist * 0.0016;
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);
        target.x = THREE.MathUtils.clamp(target.x - dx * panSpeed * rightX, -1.8, 1.8);
        target.z = THREE.MathUtils.clamp(target.z - dx * panSpeed * rightZ, -1.5, 1.5);
        target.y = THREE.MathUtils.clamp(target.y + dy * panSpeed, 0.15, 1.75);
      } else {
        yaw -= dx * 0.008;
        pitch = THREE.MathUtils.clamp(pitch + dy * 0.005, MIN_PITCH, MAX_PITCH);
      }
      place();
      dirty = true;
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      try {
        renderer.domElement.releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      if (pointers.size === 0) {
        dragging = false;
        renderer.domElement.style.cursor = navModeRef.current === "pan" ? "move" : "grab";
      } else if (pointers.size === 1) {
        const remaining = Array.from(pointers.values())[0];
        lastX = remaining.x;
        lastY = remaining.y;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      anim.active = false;
      setActivePreset("");

      const rect = renderer.domElement.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Smooth geometric scaling
      const zoomFactor = Math.pow(0.92, -e.deltaY * 0.015);
      const oldDist = dist;
      const newDist = THREE.MathUtils.clamp(oldDist * zoomFactor, MIN_ZOOM_DIST, MAX_ZOOM_DIST);

      if (Math.abs(newDist - oldDist) > 1e-4) {
        // Calculate point on target plane under cursor
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const forward = new THREE.Vector3().subVectors(camera.position, target).normalize();
        const up = new THREE.Vector3().crossVectors(right, forward.clone().negate()).normalize();

        const fovRad = (camera.fov * Math.PI) / 180;
        const halfH = oldDist * Math.tan(fovRad / 2);
        const halfW = halfH * camera.aspect;

        const cursorWorld = target.clone()
          .addScaledVector(right, ndcX * halfW)
          .addScaledVector(up, ndcY * halfH);

        // Zoom toward cursor when zooming in (newDist < oldDist)
        const shiftRate = 1 - (newDist / oldDist);
        target.addScaledVector(new THREE.Vector3().subVectors(cursorWorld, target), shiftRate * 0.65);

        target.y = THREE.MathUtils.clamp(target.y, 0.15, 1.75);
        target.x = THREE.MathUtils.clamp(target.x, -1.8, 1.8);
        target.z = THREE.MathUtils.clamp(target.z, -1.5, 1.5);

        dist = newDist;
        place();
        dirty = true;
      }
    };

    const raycaster = new THREE.Raycaster();
    const mouseNdc = new THREE.Vector2();

    const onDblClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouseNdc, camera);

      // Raycast against the figure meshes in the rig
      const hits = group ? raycaster.intersectObjects(group.children, true) : [];
      if (hits.length > 0) {
        const hitPoint = hits[0].point;
        setActivePreset("");
        animateCameraTo(yaw, pitch, Math.max(dist * 0.55, 0.8), hitPoint, 0.40);
      } else {
        fitToScreen();
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointercancel", onUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("dblclick", onDblClick);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    const build = (which: Sex) => {
      if (group) {
        rig.remove(group);
        disposeFigure(group);
      }
      if (helper) {
        scene.remove(helper);
        helper.userData.dispose();
      }
      const made = makeFigure(source!, which, FIGURE_HEIGHT);
      group = made.group;
      mesh = made.mesh;
      chestBone = mesh.skeleton.bones.find((b) => /chest/i.test(b.name)) || null;
      if (chestBone) chestBaseRot = chestBone.rotation.clone();
      // Once per figure, before anything is posed: which knuckle axis
      // abducts is a fact about this export, not about anatomy.
      calibrateSpread(mesh);
      rig.add(group);

      helper = makeBoneOverlay(mesh);
      scene.add(helper);

      apply();
      dirty = true;
    };

    /**
     * Sits the figure back down on the floor after a pose.
     *
     * Retargeting only ever rotates bones — MediaPipe's world landmarks are
     * measured from the hip centre, so they place the hips at the origin by
     * construction and say nothing about where the dancer's body actually was.
     * Rotation alone cannot lower a body: aramandi comes out as bent knees on a
     * figure still standing at full height, with the feet hanging in the air.
     *
     * Measuring the lowest foot and dropping the whole rig by that much
     * recovers the missing height from the pose itself, which is what makes a
     * half-sit read as a half-sit. It assumes a foot is on the ground — true of
     * essentially all Bharatanatyam, and wrong only mid-jump, where it would
     * hold the figure down instead of letting it rise.
     */
    const ground = () => {
      if (!mesh || !group) return;
      // Measured from zero every time, not from wherever the last frame left
      // the rig: the feet are read in world space, so an offset already applied
      // is inside the measurement and the figure would climb by its own
      // correction on every frame.
      rig.position.y = 0;
      rig.updateMatrixWorld(true);

      let lowest = Infinity;
      for (const b of mesh.skeleton.bones) {
        if (!/^(Foot|Toes)[LR]$/.test(boneKey(b.name))) continue;
        lowest = Math.min(lowest, new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).y);
      }
      if (!Number.isFinite(lowest)) return;

      rig.position.y = -lowest;
      // Propagated from the rig rather than from the root bone: the overlay
      // reads bone world positions, and `Bone.updateMatrixWorld` walks
      // downward from the bone, so it never sees a transform that changed
      // above it. Without this the skeleton stays where the body used to be.
      rig.updateMatrixWorld(true);
    };

    const apply = () => {
      if (helper) helper.visible = showSkeletonRef.current;
      if (group) group.visible = showBodyRef.current;
    };
    visRef.current = (s, b) => {
      if (helper) helper.visible = s;
      if (group) group.visible = b;
      dirty = true;
    };
    swapRef.current = (s) => {
      if (source) build(s);
    };

    let source: THREE.Group | null = null;
    loadFigures().then((s) => {
      if (disposed) return;
      source = s;
      build(sex);
      readyRef.current?.({
        fitToScreen,
        focusPreset,
        pose: (frame: Frame, t?: number) => {
          if (!mesh) {
            return {
              solved: 0,
              driven: new Set<string>(),
              missing: [],
              residuals: [],
              worst: 0,
              visibility: 0,
              weak: [],
              hands: { left: false, right: false },
              contact: false,
            };
          }
          const report = retarget(mesh, frame);

          // After retargeting, never before it. The noise this removes is
          // created by the retargeting itself — a bone's direction is far more
          // sensitive to a jittery landmark than the landmark is jittery.
          const smoother = smootherRef.current;
          if (steadyRef.current && smoother && t !== undefined) {
            const bones = boneMap(mesh);
            smoother.feed(
              t,
              JOINT_COUNT,
              (i, into) => {
                const b = bones.get(JOINTS[i].key);
                if (!b) return false;
                into.copy(b.quaternion);
                return true;
              },
              (i, q) => {
                bones.get(JOINTS[i].key)?.quaternion.copy(q);
              },
            );
            mesh.skeleton.bones[0].updateMatrixWorld(true);
          }

          lastPoseTime = clock.getElapsedTime();
          ground();
          helper?.userData.update(report.driven);
          dirty = true;
          return report;
        },
        clear: () => {
          if (mesh) retarget(mesh, { pose: null, poseScreen: null, left: null, right: null });
          if (chestBone && chestBaseRot) chestBone.rotation.copy(chestBaseRot);
          helper?.userData.update(new Set());
          dirty = true;
        },
        snapshot: (out) => (mesh ? encodePose(mesh, out) : null),
        resettle: () => smootherRef.current?.reset(),
        show: (pose) => {
          if (!mesh) return;
          lastPoseTime = clock.getElapsedTime();
          decodePose(pose, mesh);
          ground();
          // The overlay has to follow the clip as well, or a tutorial played
          // with the skeleton on draws the bones wherever they were last put —
          // at rest, if the figure was just rebuilt.
          helper?.userData.update(ALL_DRIVEN);
          dirty = true;
        },
        capture: (yaws = [0, 60, -60]) => {
          const wasYaw = yaw;
          const shots: string[] = [];
          // Scratch canvas for the downscale. The vision model resizes
          // everything to about 800x800 at its end and charges a flat 384
          // tokens an image either way, so sending the full-size panel spends
          // upload bandwidth on pixels that are thrown away on arrival.
          const scratch = document.createElement("canvas");
          const ctx = scratch.getContext("2d");

          for (const angle of yaws) {
            yaw = (angle * Math.PI) / 180;
            place();
            // Read back in the same turn as the render: the drawing buffer is
            // only guaranteed to hold this frame until the browser swaps it.
            renderer.render(scene, camera);
            const source = renderer.domElement;

            if (!ctx || source.width <= CAPTURE_MAX) {
              shots.push(source.toDataURL("image/jpeg", CAPTURE_QUALITY));
              continue;
            }
            const scale = CAPTURE_MAX / source.width;
            scratch.width = CAPTURE_MAX;
            scratch.height = Math.round(source.height * scale);
            // The figure is drawn on transparency; JPEG has no alpha, so
            // without a fill it lands on black in some browsers and white in
            // others. Black matches the panel the figure is normally seen in.
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, scratch.width, scratch.height);
            ctx.drawImage(source, 0, 0, scratch.width, scratch.height);
            shots.push(scratch.toDataURL("image/jpeg", CAPTURE_QUALITY));
          }
          yaw = wasYaw;
          place();
          dirty = true;
          return shots;
        },
        shiftHand: (side, delta) => {
          if (!mesh) return;
          const bones = boneMap(mesh);
          const upper = bones.get(`UpperArm${side}`);
          const palm = bones.get(`Palm${side}`);
          if (!upper || !palm) return;

          upper.updateWorldMatrix(true, false);
          palm.updateWorldMatrix(true, false);
          const shoulder = new THREE.Vector3().setFromMatrixPosition(upper.matrixWorld);
          const wrist = new THREE.Vector3().setFromMatrixPosition(palm.matrixWorld);

          const arm = new THREE.Vector3().subVectors(wrist, shoulder);
          const reach = arm.length();
          if (reach < 1e-4 || delta.lengthSq() < 1e-12) return;

          // Only the part of the offset across the arm can be produced by
          // swinging it; the part along the arm would need the elbow, which
          // this does not touch.
          const across = delta.clone().addScaledVector(arm, -delta.dot(arm) / (reach * reach));
          if (across.lengthSq() < 1e-12) return;

          const axis = new THREE.Vector3().crossVectors(arm, across).normalize();
          const angle = across.length() / reach;

          const world = upper.getWorldQuaternion(new THREE.Quaternion());
          world.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
          if (upper.parent) {
            world.premultiply(upper.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
          }
          upper.quaternion.copy(world);
          mesh.skeleton.bones[0].updateMatrixWorld(true);
          dirty = true;
        },
        probe: (pose) => {
          if (!mesh) return [];
          decodePose(pose, mesh);
          return findViolations(mesh, FIGURE_HEIGHT, sexRef.current);
        },
      });
    });

    const ro = new ResizeObserver(() => {
      if (!host.clientWidth) return;
      renderer.setSize(host.clientWidth, host.clientHeight, false);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      dirty = true;
    });
    ro.observe(host);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointercancel", onUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("dblclick", onDblClick);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      studio.dispose();
      if (group) disposeFigure(group);
      helper?.userData.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // Built once. `sex` and the toggles are pushed in through the refs below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    visRef.current?.(showSkeleton, showBody);
  }, [showSkeleton, showBody]);

  useEffect(() => {
    swapRef.current?.(sex);
  }, [sex]);

  const renderControlPill = (isMobile = false) => (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full border border-white/15 bg-black/80 p-1 text-[11px] shadow-xl backdrop-blur-md transition-all",
        isMobile && "max-w-full overflow-x-auto scrollbar-none px-1.5"
      )}
    >
      <button
        type="button"
        onClick={() => focusPresetRef.current("full")}
        className={cn(
          "rounded-full px-2 py-0.5 whitespace-nowrap transition-colors",
          activePreset === "full"
            ? "bg-primary text-primary-foreground font-semibold"
            : "text-foreground/70 hover:bg-white/10 hover:text-foreground"
        )}
        title="Full figure framing"
      >
        Full
      </button>
      <button
        type="button"
        onClick={() => focusPresetRef.current("face")}
        className={cn(
          "rounded-full px-2 py-0.5 whitespace-nowrap transition-colors",
          activePreset === "face"
            ? "bg-primary text-primary-foreground font-semibold"
            : "text-foreground/70 hover:bg-white/10 hover:text-foreground"
        )}
        title="Zoom to Guru's face and expressions"
      >
        Face
      </button>
      <button
        type="button"
        onClick={() => focusPresetRef.current("mudras")}
        className={cn(
          "rounded-full px-2 py-0.5 whitespace-nowrap transition-colors",
          activePreset === "mudras"
            ? "bg-primary text-primary-foreground font-semibold"
            : "text-foreground/70 hover:bg-white/10 hover:text-foreground"
        )}
        title="Zoom to hand mudras and gestures"
      >
        Mudras
      </button>
      <button
        type="button"
        onClick={() => focusPresetRef.current("feet")}
        className={cn(
          "rounded-full px-2 py-0.5 whitespace-nowrap transition-colors",
          activePreset === "feet"
            ? "bg-primary text-primary-foreground font-semibold"
            : "text-foreground/70 hover:bg-white/10 hover:text-foreground"
        )}
        title="Zoom to feet and ghungroos"
      >
        Feet
      </button>

      <span className="mx-0.5 h-3 w-px bg-white/20 shrink-0" />

      {/* Mode toggle: Orbit vs Pan */}
      <button
        type="button"
        onClick={() => setNavMode((m) => (m === "orbit" ? "pan" : "orbit"))}
        className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 whitespace-nowrap transition-colors",
          navMode === "pan"
            ? "bg-amber-400/25 text-amber-300 font-medium"
            : "text-foreground/70 hover:bg-white/10 hover:text-foreground"
        )}
        title={navMode === "pan" ? "Current: Pan (click for Orbit)" : "Current: Orbit (click for Pan)"}
      >
        {navMode === "pan" ? <Move className="h-3 w-3 text-amber-300" /> : <Orbit className="h-3 w-3" />}
        <span className="capitalize">{navMode}</span>
      </button>

      <span className="mx-0.5 h-3 w-px bg-white/20 shrink-0" />

      {/* Quick Zoom Buttons */}
      <button
        type="button"
        onClick={() => zoomInRef.current()}
        className="rounded-full p-1 text-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground shrink-0"
        title="Zoom In (+)"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => zoomOutRef.current()}
        className="rounded-full p-1 text-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground shrink-0"
        title="Zoom Out (-)"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div className={cn("relative group overflow-hidden select-none w-full h-full min-w-0", className)}>
      <div ref={hostRef} className="h-full w-full min-w-0" />

      {showOverlayControls && (
        <>
          {/* Top-Right: Fit Front View Button (and Desktop Presets Pill) */}
          <div className="absolute top-2.5 right-2.5 sm:top-3 sm:right-3 z-10 flex flex-col items-end gap-1.5 pointer-events-auto">
            <button
              type="button"
              onClick={() => fitToScreenRef.current()}
              className="hidden sm:flex items-center gap-1 sm:gap-1.5 rounded-full border border-amber-500/40 bg-black/80 px-2.5 py-1 text-[11px] sm:px-3 sm:py-1.5 sm:text-xs font-medium text-amber-200 shadow-lg backdrop-blur-md transition-all hover:scale-105 hover:border-amber-400 hover:bg-black/95 hover:text-amber-100 active:scale-95"
              title="Reset 3D camera to front-facing view (Fit to Screen)"
            >
              <RotateCcw className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-amber-400" />
              <span>Fit Front View</span>
            </button>

            {/* Desktop placement: docked neatly beneath Fit Front View */}
            <div className="hidden sm:block">
              {renderControlPill(false)}
            </div>
          </div>

          {/* Mobile placement: floats at bottom center, leaving Guru's head, face & mudras 100% unobstructed */}
          <div className="sm:hidden absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10 pointer-events-auto max-w-[calc(100%-1rem)] w-max">
            {renderControlPill(true)}
          </div>
        </>
      )}
    </div>
  );
}
