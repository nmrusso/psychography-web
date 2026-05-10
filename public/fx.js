/* Psychography FX — Three.js 3D objects + Canvas particles, scroll-driven */
(function () {
  'use strict';

  // ---------- Scroll tracking (single source of truth) ----------
  const fx = {
    scrollY: 0,
    vh: window.innerHeight,
    level: 'full', // full | minimal | off
    progress: 0,   // 0..1 over full doc
    sections: {},  // name -> { top, h, p (0..1 through it) }
    mouseX: 0, mouseY: 0,
  };

  function measure() {
    fx.vh = window.innerHeight;
    const docH = Math.max(1, document.documentElement.scrollHeight - fx.vh);
    fx.progress = Math.min(1, Math.max(0, fx.scrollY / docH));
    const ids = ['top','about','members','music','video','press','shows','contact'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = r.top + fx.scrollY;
      const h = r.height;
      const center = top + h / 2;
      const viewCenter = fx.scrollY + fx.vh / 2;
      const p = 1 - Math.min(1, Math.abs(viewCenter - center) / (h/2 + fx.vh/2));
      fx.sections[id] = { top, h, p };
    });
  }

  window.addEventListener('scroll', () => { fx.scrollY = window.scrollY; measure(); }, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('mousemove', (e) => {
    fx.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    fx.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  // ---------- Utility ----------
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const lerp = (a,b,t) => a + (b-a) * t;
  function accentColor() {
    const cls = document.body.classList;
    if (cls.contains('theme-violet')) return { hex: 0xa066ff, css: '#a066ff', rgb: [160, 102, 255] };
    if (cls.contains('theme-red'))    return { hex: 0x8B0000, css: '#8B0000', rgb: [139, 0, 0] };
    return { hex: 0xC9A84C, css: '#C9A84C', rgb: [201, 168, 76] };
  }

  // ================================================================
  //  THREE.JS 3D LAYER
  // ================================================================
  let THREE, renderer, scene, camera, three_ready = false;
  let emblemMesh = null, treeGroup = null;
  let emblemTex = null;
  // Scroll velocity tracker para que las raíces "respiren" con el scroll
  let _lastScrollY = 0, _scrollVel = 0;

  async function loadThree() {
    if (window.THREE) return window.THREE;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/three@0.160.0/build/three.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    return window.THREE;
  }

  async function initThree() {
    if (three_ready) return;
    THREE = await loadThree();

    const canvas = document.getElementById('fx-3d');
    if (!canvas) return;

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 8);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambient);
    const rim = new THREE.DirectionalLight(0xa066ff, 2.2);
    rim.position.set(-4, 3, 3); scene.add(rim);
    const key = new THREE.DirectionalLight(0xC9A84C, 1.2);
    key.position.set(4, 2, 4); scene.add(key);

    // A — Emblem (billboard plane with texture, slow rotation)
    const loader = new THREE.TextureLoader();
    emblemTex = loader.load('assets/emblema-white-trans.webp');
    emblemTex.anisotropy = 4;
    if (THREE.SRGBColorSpace) emblemTex.colorSpace = THREE.SRGBColorSpace;
    const emblemMat = new THREE.MeshBasicMaterial({
      map: emblemTex, transparent: true, opacity: 0.32,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    emblemMesh = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), emblemMat);
    emblemMesh.position.set(0, 0.2, 0);
    scene.add(emblemMesh);

    // B — TREE / ROOTS (árbol fractal: ramas arriba, raíces abajo)
    // Las ramas se generan recursivamente con segmentos. Las raíces son una
    // copia espejada que vive en el mundo y "ondea" con el scroll.
    treeGroup = new THREE.Group();
    const branchMat = new THREE.LineBasicMaterial({
      color: 0xC9A84C, transparent: true, opacity: 0.85
    });
    const rootMat = new THREE.LineBasicMaterial({
      color: 0xa066ff, transparent: true, opacity: 0.7
    });

    // Construye un árbol fractal: devuelve { lines, leafPositions } en world coords.
    function buildFractal(rootPos, rootDir, length, depth, angleSpread, lengthMul, rng) {
      const lines = [];     // [{ a: Vec3, b: Vec3, depth, t0, t1 }] (t0..t1 = porción 0..1 de la "longitud" total para animar)
      const leafPositions = [];

      // Calcular longitud "acumulada" para parametrizar t (0 = raíz/tronco, 1 = puntas)
      // Usamos depth como aproximación de t.
      function recurse(pos, dir, len, d, parentT) {
        if (d <= 0 || len < 0.04) {
          leafPositions.push(pos.clone());
          return;
        }
        // segmentar la rama en N tramos para poder curvarla en el render
        const N = 5;
        const seg = len / N;
        let cur = pos.clone();
        // ligera curva natural — tomamos una perpendicular consistente
        const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0,0,1));
        if (perp.lengthSq() < 0.01) perp.set(1,0,0);
        perp.normalize();
        const curveAmt = (rng() - 0.5) * 0.18 * len;
        const tStart = parentT;
        const tEnd = parentT + 1;
        for (let i = 0; i < N; i++) {
          const tA = i / N, tB = (i+1) / N;
          // bend: parabólica suave a lo largo del segmento
          const bendA = Math.sin(tA * Math.PI) * curveAmt;
          const bendB = Math.sin(tB * Math.PI) * curveAmt;
          const a = pos.clone().add(dir.clone().multiplyScalar(seg * i)).add(perp.clone().multiplyScalar(bendA));
          const b = pos.clone().add(dir.clone().multiplyScalar(seg * (i+1))).add(perp.clone().multiplyScalar(bendB));
          const t0 = tStart + tA * (tEnd - tStart);
          const t1 = tStart + tB * (tEnd - tStart);
          lines.push({ a, b, depth: d, t0, t1 });
          cur = b;
        }
        // Nuevas direcciones: 2-3 ramas
        const nBranches = 2 + (rng() < 0.35 ? 1 : 0);
        for (let i = 0; i < nBranches; i++) {
          // ángulo respecto a dir actual
          const ang = (i - (nBranches-1)/2) * angleSpread + (rng() - 0.5) * 0.25;
          // eje arbitrario perpendicular a dir
          const axis = new THREE.Vector3(rng()-0.5, 0, rng()-0.5).normalize();
          if (axis.lengthSq() < 0.01) axis.set(1,0,0);
          const newDir = dir.clone().applyAxisAngle(axis, ang).normalize();
          // mantener orientación dominante (arriba o abajo) para que el árbol no se cierre sobre sí
          recurse(cur, newDir, len * lengthMul * (0.85 + rng()*0.25), d - 1, parentT + 1);
        }
      }

      // RNG semilla simple para layout determinista
      recurse(rootPos, rootDir, length, depth, angleSpread, lengthMul, rng);
      return { lines, leafPositions };
    }
    function seededRng(seed) {
      let s = seed >>> 0;
      return function() { s = (s * 1664525 + 1013904223) >>> 0; return (s & 0xffffffff) / 0x100000000; };
    }

    // Generar ramas (arriba) y raíces (abajo) desde el origen (0,0,0)
    const branchData = buildFractal(
      new THREE.Vector3(0, -1.4, 0),
      new THREE.Vector3(0, 1, 0),
      1.3, 5, 0.55, 0.72, seededRng(11)
    );
    const rootData = buildFractal(
      new THREE.Vector3(0, -1.4, 0),
      new THREE.Vector3(0, -1, 0),
      1.0, 5, 0.7, 0.7, seededRng(47)
    );

    // Convertir cada línea a un par de vértices en un BufferGeometry compartido
    function buildLineMesh(data, mat, isRoots) {
      const N = data.lines.length;
      const positions = new Float32Array(N * 2 * 3);
      // Guardar posiciones originales para animar (raíces)
      const orig = new Float32Array(N * 2 * 3);
      for (let i = 0; i < N; i++) {
        const ln = data.lines[i];
        positions[i*6+0] = ln.a.x; positions[i*6+1] = ln.a.y; positions[i*6+2] = ln.a.z;
        positions[i*6+3] = ln.b.x; positions[i*6+4] = ln.b.y; positions[i*6+5] = ln.b.z;
        orig[i*6+0] = ln.a.x; orig[i*6+1] = ln.a.y; orig[i*6+2] = ln.a.z;
        orig[i*6+3] = ln.b.x; orig[i*6+4] = ln.b.y; orig[i*6+5] = ln.b.z;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mesh = new THREE.LineSegments(geom, mat);
      mesh.userData.orig = orig;
      mesh.userData.lines = data.lines;
      mesh.userData.isRoots = !!isRoots;
      return mesh;
    }

    const branchMesh = buildLineMesh(branchData, branchMat, false);
    const rootMesh = buildLineMesh(rootData, rootMat, true);
    treeGroup.add(branchMesh);
    treeGroup.add(rootMesh);

    // Pequeñas "yemas" / partículas en las puntas de las ramas
    const leafGeom = new THREE.BufferGeometry();
    const leafPos = new Float32Array(branchData.leafPositions.length * 3);
    branchData.leafPositions.forEach((p, i) => {
      leafPos[i*3+0] = p.x; leafPos[i*3+1] = p.y; leafPos[i*3+2] = p.z;
    });
    leafGeom.setAttribute('position', new THREE.BufferAttribute(leafPos, 3));
    const leafMat = new THREE.PointsMaterial({
      color: 0xC9A84C, size: 0.07, transparent: true, opacity: 0.9, sizeAttenuation: true
    });
    const leaves = new THREE.Points(leafGeom, leafMat);
    treeGroup.add(leaves);
    treeGroup.userData.branchMesh = branchMesh;
    treeGroup.userData.rootMesh = rootMesh;
    treeGroup.userData.leaves = leaves;
    treeGroup.visible = false;
    scene.add(treeGroup);

    window.addEventListener('resize', () => {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    });

    three_ready = true;
  }

  function updateThree(t) {
    if (!three_ready) return;
    const level = fx.level;
    if (level === 'off') { renderer.clear(); return; }

    const s = fx.sections;
    const vpFactor = level === 'minimal' ? 0.5 : 1;
    const accent = accentColor();

    // ----- A — EMBLEM: visible in hero → fades into about, rotates with scroll -----
    const heroP = (s.top && s.top.p) || 0;
    const aboutP = (s.about && s.about.p) || 0;
    const emblemVis = Math.max(heroP, aboutP * 0.4);
    emblemMesh.material.opacity = emblemVis * 0.16 * (level === 'minimal' ? 0.6 : 1);
    // Rotate slowly; scroll accelerates Y rotation
    emblemMesh.rotation.y = t * 0.0001 + fx.progress * Math.PI * 1.6;
    emblemMesh.rotation.x = Math.sin(t * 0.00015) * 0.15 + fx.mouseY * 0.08;
    emblemMesh.rotation.z = fx.mouseX * 0.06;
    // Scroll parallax — slide up as we leave hero
    const heroTransition = clamp(fx.scrollY / fx.vh, 0, 1.5);
    emblemMesh.position.y = 0.2 - heroTransition * 2.2;
    emblemMesh.position.z = -heroTransition * 1.5;
    emblemMesh.scale.setScalar(lerp(1, 0.7, heroTransition * 0.5));
    emblemMesh.visible = emblemVis > 0.02 && level !== 'off';

    // ----- B — TREE / ROOTS: activo en members + music + press + shows + contact
    const memP = (s.members && s.members.p) || 0;
    const musP = (s.music && s.music.p) || 0;
    const presP = (s.press && s.press.p) || 0;
    const showP = (s.shows && s.shows.p) || 0;
    const contP = (s.contact && s.contact.p) || 0;
    // Visible en todas las secciones de la mitad-baja con peso variable
    const treeVis = Math.max(memP, musP * 0.7, presP * 0.7, showP * 0.85, contP * 0.7);

    if (treeGroup) treeGroup.visible = treeVis > 0.05 && level !== 'off';

    if (treeGroup && treeGroup.visible) {
      // Track scroll velocity (suavizado) — para que las raíces "se muevan" al scrollear
      const dY = fx.scrollY - _lastScrollY;
      _lastScrollY = fx.scrollY;
      _scrollVel = _scrollVel * 0.9 + dY * 0.1;
      const scrollMag = Math.min(1.5, Math.abs(_scrollVel) * 0.05);

      // Rotación muy suave alrededor del eje Y
      treeGroup.rotation.y = t * 0.00008 + fx.mouseX * 0.25;
      treeGroup.rotation.z = Math.sin(t*0.0002) * 0.04 + fx.mouseX * 0.05;
      treeGroup.rotation.x = fx.mouseY * 0.08;

      // Animar BRANCHES — sway sutil tipo viento, puntas se mueven más
      const bMesh = treeGroup.userData.branchMesh;
      if (bMesh) {
        const orig = bMesh.userData.orig;
        const lines = bMesh.userData.lines;
        const pos = bMesh.geometry.attributes.position.array;
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];
          const fA = Math.max(0, ln.a.y + 1.4) * 0.18;
          const fB = Math.max(0, ln.b.y + 1.4) * 0.18;
          const phase = ln.t0 * 0.6;
          const swayA = Math.sin(t*0.0008 + phase) * fA * 0.3;
          const swayB = Math.sin(t*0.0008 + ln.t1*0.6) * fB * 0.3;
          pos[i*6+0] = orig[i*6+0] + swayA;
          pos[i*6+2] = orig[i*6+2] + Math.cos(t*0.0007 + phase) * fA * 0.2;
          pos[i*6+3] = orig[i*6+3] + swayB;
          pos[i*6+5] = orig[i*6+5] + Math.cos(t*0.0007 + ln.t1*0.6) * fB * 0.2;
          pos[i*6+1] = orig[i*6+1];
          pos[i*6+4] = orig[i*6+4];
        }
        bMesh.geometry.attributes.position.needsUpdate = true;
        bMesh.material.opacity = 0.85 * treeVis * vpFactor;
        bMesh.material.color.setHex(accent.hex);
      }

      // Animar RAÍCES — ondulación + curvatura por velocidad de scroll
      const rMesh = treeGroup.userData.rootMesh;
      if (rMesh) {
        const orig = rMesh.userData.orig;
        const lines = rMesh.userData.lines;
        const pos = rMesh.geometry.attributes.position.array;
        const baseAmp = 0.04;
        const scrollAmp = scrollMag * 0.35;
        const dirSign = Math.sign(_scrollVel) || 1;
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];
          const depthA = Math.max(0, -ln.a.y - 1.4);
          const depthB = Math.max(0, -ln.b.y - 1.4);
          const fA = depthA * 0.22;
          const fB = depthB * 0.22;
          const wA = Math.sin(t*0.0015 + ln.t0*1.2 + ln.a.y*1.5) * (baseAmp + scrollAmp) * fA;
          const wB = Math.sin(t*0.0015 + ln.t1*1.2 + ln.b.y*1.5) * (baseAmp + scrollAmp) * fB;
          const wzA = Math.cos(t*0.0012 + ln.t0*1.4) * (baseAmp + scrollAmp*0.7) * fA;
          const wzB = Math.cos(t*0.0012 + ln.t1*1.4) * (baseAmp + scrollAmp*0.7) * fB;
          pos[i*6+0] = orig[i*6+0] + wA + dirSign*scrollAmp*fA*0.5;
          pos[i*6+2] = orig[i*6+2] + wzA;
          pos[i*6+3] = orig[i*6+3] + wB + dirSign*scrollAmp*fB*0.5;
          pos[i*6+5] = orig[i*6+5] + wzB;
          pos[i*6+1] = orig[i*6+1];
          pos[i*6+4] = orig[i*6+4];
        }
        rMesh.geometry.attributes.position.needsUpdate = true;
        rMesh.material.opacity = (0.55 + scrollMag*0.25) * treeVis * vpFactor;
      }

      // Yemas — opacidad pulsante
      const lvs = treeGroup.userData.leaves;
      if (lvs) {
        lvs.material.opacity = (0.7 + Math.sin(t*0.001)*0.2) * treeVis * vpFactor;
        lvs.material.color.setHex(accent.hex);
        lvs.material.size = 0.07 * (0.9 + treeVis*0.3);
      }

      // Posicionamiento: el árbol se mueve sutilmente entre secciones.
      // En members/music vive a la derecha; en press/shows/contact deriva al centro/izquierda
      // para sentirse como divider entre secciones (donde antes estaba el cristal).
      const lateProgress = Math.max(presP, showP, contP);
      const earlyProgress = Math.max(memP, musP);
      // x: si estamos en sección "tardía", traerlo más al centro/izquierda
      const xEarly = musP > memP ? -2.6 : 2.6;
      const xLate = lerp(2.4, -2.4, Math.sin(fx.progress * Math.PI * 2) * 0.5 + 0.5);
      const xMix = earlyProgress > lateProgress ? xEarly : xLate;
      treeGroup.position.x = xMix + fx.mouseX * 0.4;
      treeGroup.position.y = lerp(0.8, -0.4, fx.progress);
      treeGroup.scale.setScalar(0.75 + treeVis * 0.45);
    }

    // Camera dolly — subtle on scroll
    camera.position.z = 8 + fx.progress * 1.5;
    camera.position.x = fx.mouseX * 0.25;
    camera.position.y = -fx.mouseY * 0.2;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  // ================================================================
  //  CANVAS 2D PARTICLES
  // ================================================================
  const pCanvas = document.getElementById('fx-particles');
  const pCtx = pCanvas ? pCanvas.getContext('2d') : null;
  let pW = 0, pH = 0, pDpr = 1;
  function sizeParticles() {
    if (!pCanvas) return;
    pDpr = Math.min(2, window.devicePixelRatio || 1);
    pW = pCanvas.width = Math.floor(window.innerWidth * pDpr);
    pH = pCanvas.height = Math.floor(window.innerHeight * pDpr);
    pCanvas.style.width = window.innerWidth + 'px';
    pCanvas.style.height = window.innerHeight + 'px';
  }
  if (pCanvas) sizeParticles();
  window.addEventListener('resize', sizeParticles);

  // --- Ash drift (hero → about) ---
  const ash = [];
  function initAsh() {
    ash.length = 0;
    const N = 90;
    for (let i = 0; i < N; i++) {
      ash.push({
        x: Math.random() * pW,
        y: Math.random() * pH,
        z: Math.random(),
        r: (0.4 + Math.random() * 1.3) * pDpr,
        vy: (0.2 + Math.random() * 0.5) * pDpr,
        vx: (Math.random() - 0.5) * 0.2 * pDpr,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }
  initAsh();

  // --- Hero stage smoke — humo denso subiendo desde el suelo del hero ---
  const heroSmoke = [];
  function spawnHeroSmoke(y) {
    heroSmoke.push({
      x: Math.random() * pW,
      y: (y !== undefined ? y : pH * (0.85 + Math.random() * 0.25)),
      r: (180 + Math.random() * 220) * pDpr,
      vx: (Math.random() - 0.5) * 0.25 * pDpr,
      vy: -(0.15 + Math.random() * 0.35) * pDpr,
      life: 0,
      maxLife: 1 + Math.random() * 0.8,
      tint: Math.random(),  // 0..1 — mezcla entre acento y blanco humo
    });
  }
  function initHeroSmoke() {
    heroSmoke.length = 0;
    // semilla: empezamos con varios puffs ya en el aire, distribuidos
    for (let i = 0; i < 18; i++) {
      spawnHeroSmoke(pH * (0.4 + Math.random() * 0.55));
      heroSmoke[heroSmoke.length-1].life = Math.random() * 0.8;
    }
  }
  initHeroSmoke();

  // --- Smoke (music → video) ---
  const smoke = [];
  function initSmoke() {
    smoke.length = 0;
    const N = 14;
    for (let i = 0; i < N; i++) {
      smoke.push({
        x: Math.random() * pW,
        y: pH * (0.3 + Math.random() * 0.7),
        r: (150 + Math.random() * 180) * pDpr,
        vx: (Math.random() - 0.5) * 0.3 * pDpr,
        vy: -(0.1 + Math.random() * 0.2) * pDpr,
        life: Math.random(),
      });
    }
  }
  initSmoke();

  // --- Sparks (press → shows) ---
  const sparks = [];
  function spawnSpark() {
    sparks.push({
      x: Math.random() * pW,
      y: pH * (0.2 + Math.random() * 0.7),
      vx: (Math.random() - 0.5) * 3 * pDpr,
      vy: (Math.random() - 0.5) * 3 * pDpr,
      life: 1,
      decay: 0.015 + Math.random() * 0.03,
      size: (0.8 + Math.random() * 1.8) * pDpr,
    });
  }

  function drawParticles(t) {
    if (!pCtx || fx.level === 'off') { if(pCtx) pCtx.clearRect(0,0,pW,pH); return; }
    pCtx.clearRect(0, 0, pW, pH);
    const accent = accentColor();
    const vpMul = fx.level === 'minimal' ? 0.4 : 1;
    const s = fx.sections;

    // ---- HERO STAGE SMOKE (top section) ----
    const heroVis = (s.top && s.top.p) || 0;
    if (heroVis > 0.05) {
      pCtx.save();
      pCtx.globalCompositeOperation = 'screen';
      // spawn rate: while hero is on screen, mantenemos ~22 puffs activos
      while (heroSmoke.length < 22) spawnHeroSmoke();
      const accentRgb = accent.rgb || [200, 160, 255];
      for (let i = heroSmoke.length - 1; i >= 0; i--) {
        const p = heroSmoke[i];
        p.life += 0.0035;
        if (p.life >= p.maxLife) {
          heroSmoke.splice(i, 1);
          continue;
        }
        p.x += p.vx + Math.sin(t*0.0006 + p.tint*7) * 0.15 * pDpr;
        p.y += p.vy;
        // parallax con scroll — el humo se queda atrás cuando bajás
        const sy = p.y - fx.scrollY * 0.35;
        // life curve: fade in fast, fade out slow
        const lifeN = p.life / p.maxLife;
        const env = lifeN < 0.18
          ? lifeN / 0.18
          : Math.pow(1 - (lifeN - 0.18) / 0.82, 1.2);
        const alpha = env * 0.18 * heroVis * vpMul;
        if (alpha < 0.005) continue;
        // crece con la edad
        const r = p.r * (0.55 + lifeN * 0.85);
        const grad = pCtx.createRadialGradient(p.x, sy, 0, p.x, sy, r);
        // mezcla entre acento (cálido/frio según paleta) y un humo blanco-gris
        const mix = 0.35 + p.tint * 0.5;
        const cr = Math.round(accentRgb[0] * mix + 200 * (1-mix));
        const cg = Math.round(accentRgb[1] * mix + 195 * (1-mix));
        const cb = Math.round(accentRgb[2] * mix + 210 * (1-mix));
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`);
        grad.addColorStop(0.45, `rgba(${cr},${cg},${cb},${alpha*0.45})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        pCtx.fillStyle = grad;
        pCtx.beginPath();
        pCtx.arc(p.x, sy, r, 0, Math.PI * 2);
        pCtx.fill();
      }
      pCtx.restore();
    }

    // ---- ASH (hero + about) ----
    const ashVis = Math.max((s.top?.p)||0, (s.about?.p||0) * 0.8);
    if (ashVis > 0.05) {
      pCtx.save();
      pCtx.globalCompositeOperation = 'lighter';
      for (const p of ash) {
        // parallax: far ones move slower, near ones faster — also respond to scroll
        const depthMul = 0.4 + p.z * 1.4;
        p.y += p.vy * depthMul;
        p.x += p.vx + Math.sin(t*0.0005 + p.phase) * 0.3 * pDpr;
        // Scroll also nudges them up as we scroll down (parallax counter)
        p.y -= (fx.scrollY - (p._lastScroll||fx.scrollY)) * 0.15 * p.z;
        p._lastScroll = fx.scrollY;
        if (p.y > pH + 10) { p.y = -10; p.x = Math.random() * pW; }
        if (p.y < -20) { p.y = pH + 10; }
        if (p.x < -10) p.x = pW + 10;
        if (p.x > pW + 10) p.x = -10;
        const alpha = 0.35 * p.z * ashVis * vpMul;
        pCtx.fillStyle = `rgba(255, 245, 210, ${alpha})`;
        pCtx.beginPath();
        pCtx.arc(p.x, p.y, p.r * depthMul, 0, Math.PI * 2);
        pCtx.fill();
      }
      pCtx.restore();
    }

    // ---- SMOKE (music + video) ----
    const smokeVis = Math.max((s.music?.p)||0, (s.video?.p)||0, (s.about?.p||0)*0.3);
    if (smokeVis > 0.05) {
      pCtx.save();
      pCtx.globalCompositeOperation = 'screen';
      for (const p of smoke) {
        p.x += p.vx;
        p.y += p.vy - fx.scrollY * 0 ;
        p.life += 0.002;
        if (p.life > 1) p.life = 0;
        if (p.x < -p.r) p.x = pW + p.r;
        if (p.x > pW + p.r) p.x = -p.r;
        if (p.y < -p.r) { p.y = pH + p.r; p.x = Math.random()*pW; }
        // parallax with scroll
        const sy = p.y - fx.scrollY * 0.08;
        const alpha = Math.sin(p.life * Math.PI) * 0.08 * smokeVis * vpMul;
        const grad = pCtx.createRadialGradient(p.x, sy, 0, p.x, sy, p.r);
        grad.addColorStop(0, `rgba(160, 102, 255, ${alpha})`);
        grad.addColorStop(0.5, `rgba(120, 70, 200, ${alpha * 0.5})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        pCtx.fillStyle = grad;
        pCtx.beginPath();
        pCtx.arc(p.x, sy, p.r, 0, Math.PI * 2);
        pCtx.fill();
      }
      pCtx.restore();
    }

    // ---- SPARKS (press + shows) ----
    const sparkVis = Math.max((s.press?.p)||0, (s.shows?.p)||0, (s.contact?.p||0)*0.5);
    if (sparkVis > 0.05) {
      // spawn rate scales with section presence
      const rate = Math.floor(sparkVis * 3 * vpMul);
      for (let i = 0; i < rate; i++) spawnSpark();
      pCtx.save();
      pCtx.globalCompositeOperation = 'lighter';
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.x += sp.vx;
        sp.y += sp.vy + 0.15 * pDpr;
        sp.vy += 0.06 * pDpr; // gravity
        sp.vx *= 0.99;
        sp.life -= sp.decay;
        if (sp.life <= 0) { sparks.splice(i, 1); continue; }
        const a = sp.life * sparkVis * vpMul;
        pCtx.fillStyle = `rgba(201, 168, 76, ${a})`;
        if (document.body.classList.contains('theme-violet')) pCtx.fillStyle = `rgba(160,102,255,${a})`;
        if (document.body.classList.contains('theme-red')) pCtx.fillStyle = `rgba(220,60,60,${a})`;
        pCtx.beginPath();
        pCtx.arc(sp.x, sp.y, sp.size, 0, Math.PI*2);
        pCtx.fill();
        // trail
        pCtx.strokeStyle = pCtx.fillStyle;
        pCtx.globalAlpha = a * 0.3;
        pCtx.beginPath();
        pCtx.moveTo(sp.x, sp.y);
        pCtx.lineTo(sp.x - sp.vx*3, sp.y - sp.vy*3);
        pCtx.lineWidth = sp.size * 0.5;
        pCtx.stroke();
        pCtx.globalAlpha = 1;
      }
      pCtx.restore();

      // occasional static lines
      if (Math.random() < 0.04 * sparkVis * vpMul) {
        pCtx.save();
        pCtx.globalCompositeOperation = 'lighter';
        pCtx.strokeStyle = `rgba(201,168,76, ${0.15 * sparkVis})`;
        if (document.body.classList.contains('theme-violet')) pCtx.strokeStyle = `rgba(160,102,255, ${0.15*sparkVis})`;
        pCtx.lineWidth = 1 * pDpr;
        pCtx.beginPath();
        const yL = Math.random() * pH;
        pCtx.moveTo(0, yL);
        pCtx.lineTo(pW, yL + (Math.random()-0.5)*20*pDpr);
        pCtx.stroke();
        pCtx.restore();
      }
    }
  }

  // ================================================================
  //  IMAGE PARALLAX (background images slide at different speeds)
  // ================================================================
  function updateParallax() {
    if (fx.level === 'off') {
      document.querySelectorAll('[data-parallax]').forEach(el => {
        el.style.transform = '';
      });
      return;
    }
    document.querySelectorAll('[data-parallax]').forEach(el => {
      const speed = parseFloat(el.dataset.parallax) || 0.2;
      const rect = el.getBoundingClientRect();
      const parent = el.parentElement.getBoundingClientRect();
      const parentMid = parent.top + parent.height / 2;
      const offset = (parentMid - fx.vh / 2) * speed;
      el.style.transform = `translate3d(0, ${-offset}px, 0) scale(1.12)`;
    });
  }

  // ================================================================
  //  MAIN LOOP
  // ================================================================
  function loop(t) {
    updateThree(t);
    drawParticles(t);
    updateParallax();
    requestAnimationFrame(loop);
  }

  // ================================================================
  //  INIT + EXPORT
  // ================================================================
  measure();
  initThree().then(() => {
    requestAnimationFrame(loop);
  }).catch(err => {
    console.warn('Three failed, running particles only', err);
    requestAnimationFrame(loop);
  });

  window.PsyFX = {
    setLevel(v) { fx.level = v; },
    getLevel() { return fx.level; },
    setMetalObject(v) { /* deprecated — only tree remains */ },
    getMetalObject() { return 'tree'; },
    refresh() { measure(); },
  };
})();
