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
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);
    camera.lookAt(0, 0, 0);

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

    function resize() {
      const w = canvasHost.clientWidth;
      const h = canvasHost.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
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

        const baseScale = 1.6 / Math.max(size.x, size.y, size.z);
        hatRoot.scale.setScalar(baseScale);
        hatRoot.rotation.x = -0.12; // tilt down slightly

        const baseX = -0.6; // shift slightly right of the hero text on the far left
        const baseY = 0.6; // lift to align with the hero text block

        resize();
        buildTimeline(restPositions, baseX, baseY, baseScale);
      },
      (xhr) => {
        if (xhr.total) console.log(`[scroll-hat] loading ${Math.round((xhr.loaded / xhr.total) * 100)}%`);
      },
      (err) => console.error('[scroll-hat] failed to load GLB', err)
    );

    function buildTimeline(restPositions, baseX, baseY, baseScale) {
      const explodeOffsets = EXPLODE_ORDER.map((_, i) => (i - (EXPLODE_ORDER.length - 1) / 2) * EXPLODE_SPACING);
      const state = { explode: 0, clip: 0, spin: 0, lift: 0, shrink: 0, shiftRight: 0, riseUp: 0 };

      function render() {
        // Cutaway: clip.constant from 10 (no cut, fully solid) down to 0 (cut through center).
        clipPlane.constant = THREE.MathUtils.lerp(10, 0, state.clip);

        hatRoot.rotation.y = state.spin * Math.PI * 2;
        hatRoot.scale.setScalar(baseScale * THREE.MathUtils.lerp(1, 0.25, state.shrink));
        placement.position.x = baseX + state.shiftRight * 0.1; // move into the right side of the screen for the explode
        placement.position.y = baseY + state.lift * 0.6 + state.riseUp * 0.2; // keep the exploded stack on screen

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
        .to(state, { spin: 0.5, lift: 0, clip: 1, duration: 1 }, 0);

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

      const observer = Observer.create({
        target: window,
        type: 'wheel,touch,pointer',
        tolerance: 2,
        preventDefault: true,
        onDown: (self) => {
          if (isAnimating) return;
          if (currentStep >= STEP_COUNT) {
            // All steps are done. Require a more deliberate scroll here specifically —
            // with a low tolerance for snappy single-scroll stepping, tiny wheel noise
            // right after landing on the last step could otherwise falsely trigger this
            // (irreversible) unlock when the user actually meant to scroll back up.
            if (Math.abs(self.deltaY) < 8) return;
            unlocked = true;
            unlockScroll();
            observer.disable();
            return;
          }
          goToStep(currentStep + 1);
        },
        onUp: () => {
          if (isAnimating) return;
          if (currentStep <= 0) return;
          goToStep(currentStep - 1);
        },
      });

      // Driven off actual scroll position rather than gesture detection — far less prone
      // to jitter from trackpad momentum/rubber-banding than trying to catch this mid-gesture.
      window.addEventListener('scroll', () => {
        if (!unlocked) return;
        if (window.scrollY > 0) return;
        unlocked = false;
        lockScroll();
        observer.enable();
        if (!isAnimating) goToStep(Math.max(0, currentStep - 1));
      });

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
