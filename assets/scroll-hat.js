/* RIM Cowboy Hat — scroll-driven 3D product experience
 * Three.js + GSAP ScrollTrigger
 *
 * Mesh names in the source GLB are blank — the only named node is a
 * "Generic Human Head" reference mannequin (excluded). Parts are identified
 * by material color/name instead:
 *   Plastic            (yellow)        -> honeycomb impact padding
 *   Plastic (5)        (red)           -> rubber gasket
 *   "Leather light brown (1)"          -> leather sweatband
 *   <unnamed material> (black)         -> foam liner
 *   Plastic (1), Plastic (7) (grey)    -> aluminum sensor hub band + leads
 *   Plastic (2), Plastic (8), Plastic (3) (tan/khaki) -> felt hat shell
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

(function () {
  const { gsap } = window;
  const { Observer } = window;
  gsap.registerPlugin(Observer);

  const MATERIAL_GROUPS = {
    shell: ['Plastic (2)', 'Plastic (8)', 'Plastic (3)'],
    padding: ['Plastic'],
    gasket: ['Plastic (5)'],
    band: ['Plastic (1)', 'Plastic (7)'],
    sweatband: ['Leather light brown (1)'],
    liner: ['', null, undefined],
  };

  // Vertical stacking order for the exploded view (top to bottom).
  const EXPLODE_ORDER = ['shell', 'padding', 'gasket', 'band', 'sweatband', 'liner'];
  const EXPLODE_SPACING = 0.25; // world units between parts when fully exploded

  function initHatScroll(root) {
    const canvasHost = root.querySelector('[data-hat-canvas]');
    const heroText = root.querySelectorAll('[data-hero-text]');
    const spinText = root.querySelector('[data-spin-text]');
    const spinText2 = root.querySelector('[data-spin-text-2]');

    const scene = new THREE.Scene();
    const FOV = 35;
    const FOV_RAD = THREE.MathUtils.degToRad(FOV);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);
    camera.lookAt(0, 0, 0);

    // Layout values are mutable and recomputed per-aspect (see updateFraming) so the
    // hat stays fully framed on narrow/portrait phone viewports instead of the fixed
    // desktop-tuned offsets clipping it.
    const layout = { baseX: -0.6, baseY: 0.6, baseScale: 1 };
    let modelHalfExtent = null; // half of the hat's largest dimension, set once the GLB loads

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.localClippingEnabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    canvasHost.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(2, 3, 4);
    scene.add(dir);
    // Front fill light, coincident with the camera — the hat yaws a full 180° across the
    // sequence, and a single fixed directional light leaves whatever rotates away from it
    // nearly black against the dark background. This keeps the camera-facing side lit
    // regardless of how the hat is rotated.
    const fill = new THREE.DirectionalLight(0xffffff, 0.9);
    fill.position.set(0, 0.5, 5);
    scene.add(fill);

    // `placement` handles on-screen positioning (no rotation); `hatRoot` is the spin
    // pivot, re-centered so its own local origin sits at the hat's visual center.
    const placement = new THREE.Group();
    scene.add(placement);
    const hatRoot = new THREE.Group();
    placement.add(hatRoot);

    // Sub-groups per part, each holding the meshes that share its materials.
    const partGroups = {};
    EXPLODE_ORDER.forEach((key) => {
      partGroups[key] = new THREE.Group();
      hatRoot.add(partGroups[key]);
    });

    // Cutaway clipping plane, applied only to the shell's materials.
    const clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 10); // 10 = fully open (no cut)

    // Picks a camera distance, hat scale, and on-screen offset that keep the whole hat
    // (plus its left-shifted hero placement) inside the frustum at the current aspect
    // ratio. On narrow/portrait phone screens the horizontal frustum is much tighter
    // than on desktop, so without this the hat reads as zoomed-in/cropped.
    function updateFraming(aspect) {
      if (modelHalfExtent == null) return;
      const isPortrait = aspect < 0.9;

      if (!isPortrait) {
        // Desktop/landscape: a bigger, closer hat, shifted right and up to clear the
        // "RIM" hero text instead of overlapping it.
        layout.baseScale = 2.6 / (2 * modelHalfExtent);
        layout.baseX = 0.45;
        layout.baseY = 0.5;
        layout.heroY = layout.baseY;
        camera.position.z = 3.4;
        return;
      }

      // Shrink the hat itself a bit on portrait screens, and stop shifting it off to
      // the left (the hero text sits above it on mobile, not beside it). On mobile the
      // hat starts lower (heroY) on the hero screen, then rises to baseY as the user
      // scrolls into step 1 so it clears the spin-callout text box anchored near the
      // bottom — see the heroLift tween in buildTimeline.
      layout.baseScale = 1.15 / (2 * modelHalfExtent);
      layout.baseX = 0;
      layout.baseY = 0.55;
      layout.heroY = 0.1;

      const objHalfSize = modelHalfExtent * layout.baseScale;
      const reachX = Math.abs(layout.baseX) + objHalfSize * 1.15;
      const reachY = Math.max(Math.abs(layout.baseY), Math.abs(layout.heroY)) + objHalfSize * 1.15;

      const zForHeight = reachY / Math.tan(FOV_RAD / 2);
      const zForWidth = reachX / (Math.tan(FOV_RAD / 2) * aspect);
      camera.position.z = Math.max(zForHeight, zForWidth, 3);
    }

    function resize() {
      const w = canvasHost.clientWidth;
      const h = canvasHost.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      updateFraming(camera.aspect);
      camera.updateProjectionMatrix();
    }

    console.log('[scroll-hat] loading', canvasHost.dataset.model);
    const loader = new GLTFLoader();
    loader.load(
      canvasHost.dataset.model,
      (gltf) => {
        console.log('[scroll-hat] GLB loaded');
        const modelRoot = gltf.scene;
        const restPositions = new Map();

        let headNode = null;
        const allNames = [];
        modelRoot.traverse((node) => {
          allNames.push(node.name);
          if (node.name && node.name.toLowerCase().includes('head')) headNode = node;
        });
        console.log('[scroll-hat] all node names:', allNames);
        console.log('[scroll-hat] headNode found:', !!headNode, headNode && headNode.name);
        function isInsideHead(node) {
          for (let n = node; n; n = n.parent) {
            if (n === headNode) return true;
          }
          return false;
        }

        // Collect meshes first; reparenting (attach) during traverse() mutates
        // the children array mid-iteration and corrupts the traversal.
        const meshes = [];
        modelRoot.traverse((node) => {
          if (!node.isMesh) return;
          if (headNode && isInsideHead(node)) return; // exclude the reference mannequin entirely
          meshes.push(node);
        });

        meshes.forEach((node) => {
          const matName = node.material ? node.material.name : null;
          let groupKey = null;
          for (const key of Object.keys(MATERIAL_GROUPS)) {
            if (MATERIAL_GROUPS[key].includes(matName)) {
              groupKey = key;
              break;
            }
          }
          if (!groupKey) groupKey = 'shell'; // fallback: unmatched materials default to shell

          if (groupKey === 'shell') {
            node.material = node.material.clone();
            node.material.clippingPlanes = [clipPlane];
            node.material.side = THREE.DoubleSide;
            node.material.clipShadows = true;
          }

          partGroups[groupKey].attach(node);
        });

        // Re-center every part-group around the assembly's true visual center so that
        // hatRoot's local origin (the spin pivot) sits in the middle of the hat, not
        // off to one side — otherwise rotation sweeps a wide arc instead of spinning in place.
        const box = new THREE.Box3().setFromObject(hatRoot);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        EXPLODE_ORDER.forEach((key) => {
          partGroups[key].position.sub(center);
          restPositions.set(key, partGroups[key].position.clone());
        });

        modelHalfExtent = Math.max(size.x, size.y, size.z) / 2;
        hatRoot.rotation.x = -0.12; // tilt down slightly

        resize();
        buildTimeline(restPositions);
      },
      (xhr) => {
        if (xhr.total) console.log(`[scroll-hat] loading ${Math.round((xhr.loaded / xhr.total) * 100)}%`);
      },
      (err) => console.error('[scroll-hat] failed to load GLB', err)
    );

    function buildTimeline(restPositions) {
      const explodeOffsets = EXPLODE_ORDER.map((_, i) => (i - (EXPLODE_ORDER.length - 1) / 2) * EXPLODE_SPACING);
      const state = { explode: 0, clip: 0, spin: 0, lift: 0, shrink: 0, shiftRight: 0, riseUp: 0, heroLift: 0 };

      function render() {
        // Cutaway: clip.constant from 10 (no cut, fully solid) down to 0 (cut through center).
        clipPlane.constant = THREE.MathUtils.lerp(10, 0, state.clip);

        hatRoot.rotation.y = state.spin * Math.PI * 2;
        hatRoot.scale.setScalar(layout.baseScale * THREE.MathUtils.lerp(1, 0.25, state.shrink));
        placement.position.x = layout.baseX + state.shiftRight * 0.1; // move into the right side of the screen for the explode
        const restY = THREE.MathUtils.lerp(layout.heroY, layout.baseY, state.heroLift);
        placement.position.y = restY + state.lift * 0.6 + state.riseUp * 0.2; // keep the exploded stack on screen

        EXPLODE_ORDER.forEach((key, i) => {
          const rest = restPositions.get(key);
          const offsetY = explodeOffsets[i] * state.explode;
          partGroups[key].position.set(rest.x, rest.y + offsetY, rest.z);
        });

        renderer.render(scene, camera);
      }

      function tick() {
        render();
        requestAnimationFrame(tick);
      }
      tick();

      // Exactly 3 discrete steps. The timeline is paused and never scrubbed by native
      // scroll — each wheel/touch gesture advances (or reverses) it by one full step,
      // and the page itself stays scroll-locked (see CSS: html/body overflow:hidden)
      // until all 3 steps are complete, at which point native scroll is restored so the
      // user can continue down into the waitlist section.
      const STEP_COUNT = 2;
      const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });

      // --- Step 1 (label 0 -> 1) ---
      // Hero text exits left, hat turns a half turn (180°) and stays put — same on-screen
      // position it started in — while the cutaway reveals internals.
      // rotation.y = spin * 2π, so a 180° turn lands at spin = 0.5.
      tl.addLabel('step0', 0);
      tl.to(heroText, { xPercent: -150, opacity: 0, duration: 0.4 }, 0)
        .to(state, { spin: 0.5, lift: 0, clip: 1, heroLift: 1, duration: 1 }, 0);

      if (spinText) {
        gsap.set(spinText, { yPercent: 120, opacity: 0 });
        tl.to(spinText, { yPercent: 0, opacity: 1, duration: 0.5, ease: 'power2.out' }, 0);
      }
      tl.addLabel('step1', 1);

      // --- Step 2 (label 1 -> 2) ---
      // The first text box exits upward off-screen; a new box ("Engineered From the Inside
      // Out.") rises in from the bottom-left. No further spin here — the hat just
      // reassembles, shrinks, and the exploded view settles on the right side of the screen.
      if (spinText) {
        tl.to(spinText, { yPercent: -150, opacity: 0, duration: 0.35 }, 1);
      }
      if (spinText2) {
        gsap.set(spinText2, { yPercent: 120, opacity: 0 });
        tl.to(spinText2, { yPercent: 0, opacity: 1, duration: 0.4, ease: 'power2.out' }, 1.2);
      }
      tl.to(state, { clip: 0, shrink: 1, shiftRight: 1, riseUp: 1, duration: 0.5 }, 1)
        .to(state, { explode: 1, duration: 1.5, ease: 'sine.inOut' }, 1.4);
      // Final step — hold the exploded view here through the waitlist transition.
      tl.addLabel('step2', 2.9);

      let currentStep = 0;
      let isAnimating = false;

      function unlockScroll() {
        document.documentElement.classList.add('scroll-unlocked');
        document.body.classList.add('scroll-unlocked');
      }
      function lockScroll() {
        document.documentElement.classList.remove('scroll-unlocked');
        document.body.classList.remove('scroll-unlocked');
      }

      function goToStep(step) {
        isAnimating = true;
        currentStep = step;
        gsap.to(tl, {
          time: tl.labels['step' + step],
          duration: 0.9,
          ease: 'power2.inOut',
          onComplete: () => {
            isAnimating = false;
          },
        });
      }

      // `unlocked` tracks whether native page scroll is currently in control (true once
      // the user has scrolled past the last step, into the waitlist section below). The
      // observer itself is fully disabled while unlocked — rather than selectively calling
      // preventDefault per callback (which let raw wheel ticks leak through between throttled
      // callback triggers and fight the CSS scroll-lock, causing jitter) — and re-enabled the
      // moment the page scrolls back to the very top.
      let unlocked = false;

      // GSAP's Observer reports drag-style touch movement in the opposite sense from
      // wheel scrolling: a wheel "down" tick (deltaY > 0, onDown) means scroll/advance
      // forward, but swiping a finger up the screen — the natural "scroll down" gesture —
      // fires onUp because the touch point itself moved up. Touch events need the two
      // callbacks swapped so a forward swipe (up) advances and a backward swipe (down)
      // reverses, matching wheel behavior.
      function advance() {
        if (isAnimating) return;
        if (currentStep >= STEP_COUNT) return;
        goToStep(currentStep + 1);
      }
      function reverse() {
        if (isAnimating) return;
        if (currentStep <= 0) return;
        goToStep(currentStep - 1);
      }
      function tryUnlock(self) {
        if (isAnimating) return false;
        if (currentStep < STEP_COUNT) return false;
        // All steps are done. Require a more deliberate scroll here specifically —
        // with a low tolerance for snappy single-scroll stepping, tiny wheel/touch noise
        // right after landing on the last step could otherwise falsely trigger this
        // (irreversible) unlock when the user actually meant to scroll back up.
        if (Math.abs(self.deltaY) < 8) return false;
        unlocked = true;
        unlockScroll();
        observer.disable();
        return true;
      }

      const observer = Observer.create({
        target: window,
        type: 'wheel,touch,pointer',
        tolerance: 2,
        preventDefault: true,
        onDown: (self) => {
          const isTouch = self.event && self.event.type && self.event.type.indexOf('touch') === 0;
          if (isTouch) {
            reverse();
            return;
          }
          if (tryUnlock(self)) return;
          advance();
        },
        onUp: (self) => {
          const isTouch = self.event && self.event.type && self.event.type.indexOf('touch') === 0;
          if (isTouch) {
            if (tryUnlock(self)) return;
            advance();
            return;
          }
          reverse();
        },
      });

      // Re-lock once the hat section is actually back in view, rather than computing it from
      // raw window.scrollY — pixel-offset checks against a tolerance get unreliable once the
      // page has scrolled deep into tall content below (momentum/rubber-banding can land
      // anywhere), whereas "is this section visible again" is a direct, simple fact.
      const topObserver = new IntersectionObserver(
        (entries) => {
          if (!unlocked) return;
          if (entries[0].intersectionRatio < 0.95) return;
          // Just hand control back to gesture-based stepping — currentStep is still at
          // STEP_COUNT (the explode pose), matching what's already on screen. Letting the
          // next real wheel/touch gesture trigger the reversal (instead of doing it
          // automatically here) avoids racing the user's own next scroll against this one.
          unlocked = false;
          lockScroll();
          window.scrollTo(0, 0);
          observer.enable();
        },
        { threshold: [0, 0.95, 1] }
      );
      topObserver.observe(root);

      window.addEventListener('resize', () => {
        resize();
        render();
      });
    }

    resize();
  }

  function init() {
    document.querySelectorAll('[data-hat-scroll]').forEach(initHatScroll);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
