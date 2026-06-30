import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MAP_BOXES, ARENA_HALF, VOID_Y, JUMP_PADS, WEAPONS, WEAPON_KEYS } from '../../shared/constants.js';
import { RemotePlayer } from './RemotePlayer.js';

const FOV_HIP = 90;

// ── Procedural texture helpers ────────────────────────────────────────────────

function canvasTex(draw, size = 512) {
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function grassTex() {
  return canvasTex((ctx, s) => {
    ctx.fillStyle = '#4e6e3a'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 12000; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const v = (Math.random() - 0.5) * 28;
      ctx.fillStyle = `rgb(${clamp(60+v,0,255)},${clamp(110+v,0,255)},${clamp(50+v,0,255)})`;
      ctx.fillRect(x, y, Math.random() < 0.3 ? 2 : 1, Math.random() < 0.2 ? 3 : 1);
    }
  });
}

function concreteTex(base = [130, 118, 105]) {
  return canvasTex((ctx, s) => {
    ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 8000; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const v = (Math.random() - 0.5) * 22;
      ctx.fillStyle = `rgb(${clamp(base[0]+v,0,255)},${clamp(base[1]+v,0,255)},${clamp(base[2]+v,0,255)})`;
      ctx.fillRect(x, y, 1, 1);
    }
    // Panel lines every 64px
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
    for (let x = 0; x <= s; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke(); }
    for (let y = 0; y <= s; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
  });
}

function metalTex() {
  return canvasTex((ctx, s) => {
    ctx.fillStyle = '#5a6070'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 6000; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const v = (Math.random() - 0.5) * 18;
      ctx.fillStyle = `rgb(${clamp(90+v,0,255)},${clamp(96+v,0,255)},${clamp(112+v,0,255)})`;
      ctx.fillRect(x, y, 1, 1);
    }
    // Horizontal scratch lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (let i = 0; i < 30; i++) {
      const y = Math.random() * s;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
    }
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Main class ────────────────────────────────────────────────────────────────

export class Game {
  constructor(canvas) {
    this.canvas        = canvas;
    this.remotePlayers = new Map();
    this._adsLerp      = 0;

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._buildMap();
    this._buildScenery();
    this._buildViewmodel();
    this._buildImpactPool();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();
  }

  // ── Renderer ───────────────────────────────────────────────────────────────

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.autoClear         = false;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(0x7ab3d4);
  }

  // ── Scene & lighting ───────────────────────────────────────────────────────

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x9cc2da, 0.014);

    // ── Image-based lighting (IBL) ─────────────────────────────────────────
    // A pre-filtered environment map gives realistic ambient light and proper
    // reflections on metallic surfaces (weapons, metal cover) — a big quality
    // jump over flat ambient light, with almost no runtime cost.
    const pmrem  = new THREE.PMREMGenerator(this.renderer);
    this._envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this._envTex;

    // ── Gradient sky dome ──────────────────────────────────────────────────
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          top:      { value: new THREE.Color(0x2a6bbf) },
          mid:      { value: new THREE.Color(0x8fc0e0) },
          bottom:   { value: new THREE.Color(0xd9e8f2) },
        },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
          void main(){
            float h = normalize(vP).y;
            vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bottom, pow(-h, 0.5));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    sky.frustumCulled = false;
    this.scene.add(sky);
    this._sky = sky;

    // Soft hemisphere ambient (IBL does most of the fill now, so keep it low)
    this.scene.add(new THREE.HemisphereLight(0x9ac8ef, 0x4a6830, 0.35));

    // Main sun with soft shadows
    const sun = new THREE.DirectionalLight(0xfff2d0, 2.2);
    sun.position.set(24, 48, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near   = 1;
    sun.shadow.camera.far    = 160;
    sun.shadow.camera.left   = sun.shadow.camera.bottom = -70;
    sun.shadow.camera.right  = sun.shadow.camera.top    =  70;
    sun.shadow.bias          = -0.0003;
    sun.shadow.normalBias    = 0.02;
    this.scene.add(sun);

    // Cool bounce fill from the opposite side
    const fill = new THREE.DirectionalLight(0xbcdcf0, 0.3);
    fill.position.set(-12, 10, -14);
    this.scene.add(fill);

    // Warm/cool accent point lights around the arena
    const ptCfg = [
      { pos: [ 18, 2.5,  18], color: 0xff9955, intensity: 14, dist: 15 },
      { pos: [-18, 2.5,  18], color: 0xff9955, intensity: 14, dist: 15 },
      { pos: [ 18, 2.5, -18], color: 0x55aaff, intensity: 12, dist: 15 },
      { pos: [-18, 2.5, -18], color: 0x55aaff, intensity: 12, dist: 15 },
      { pos: [  0, 3.5,  0 ], color: 0xffd080, intensity: 20, dist: 18 },
    ];
    for (const { pos, color, intensity, dist } of ptCfg) {
      const pl = new THREE.PointLight(color, intensity, dist, 2);
      pl.position.set(...pos);
      this.scene.add(pl);
    }
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(FOV_HIP, 1, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
  }

  // ── Map ─────────────────────────────────────────────────────────────────────

  _buildMap() {
    const gt  = grassTex();    gt.repeat.set(14, 14);
    const ct  = concreteTex(); ct.repeat.set(4, 4);
    const wt  = concreteTex([100, 92, 84]); wt.repeat.set(3, 2);
    const mt  = metalTex();    mt.repeat.set(3, 3);

    const stdMat = (map, rough = 0.85, metal = 0) =>
      new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: metal });

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
      stdMat(gt, 0.92, 0),
    );
    floor.rotation.x  = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Meshes that bullets can hit (used for impact-decal raycasting)
    this._collidables = [floor];

    // Dark "abyss" plane far below the parkour zone (purely visual depth cue)
    const voidPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 100),
      new THREE.MeshStandardMaterial({ color: 0x161b26, roughness: 1 }),
    );
    voidPlane.rotation.x = -Math.PI / 2;
    voidPlane.position.set(65, VOID_Y - 2, 0);
    this.scene.add(voidPlane);

    // Materials reused for parkour platforms (cached so we don't rebuild per box)
    const easyMat = new THREE.MeshStandardMaterial({ color: 0x33aa66, emissive: 0x0e3320, emissiveIntensity: 0.4, roughness: 0.6 });
    const hardMat = new THREE.MeshStandardMaterial({ color: 0xcc4a2a, emissive: 0x331005, emissiveIntensity: 0.4, roughness: 0.6 });
    const cpMat   = new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0x664400, emissiveIntensity: 0.9, roughness: 0.4 });
    const wallMat = stdMat(wt, 0.88);

    // Concentric shooting-range target texture (red/white rings, yellow bull)
    const targetTex = canvasTex((ctx, s) => {
      const rings = [['#d63a2f', 0.5], ['#ffffff', 0.4], ['#d63a2f', 0.3], ['#ffffff', 0.2], ['#f4c430', 0.1]];
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, s, s);
      for (const [col, rad] of rings) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s/2, s/2, s * rad, 0, 7); ctx.fill();
      }
    }, 256);
    const targetMat = new THREE.MeshStandardMaterial({ map: targetTex, roughness: 0.7 });

    // Build every collidable box, choosing a look from its `kind`
    for (const b of MAP_BOXES) {
      let mat;
      switch (b.kind) {
        case 'wall':         mat = wallMat; break;
        case 'checkpoint':   mat = cpMat;   break;
        case 'parkour':      mat = b.z < 0 ? hardMat : easyMat; break;
        case 'parkourStart': mat = stdMat(ct, 0.85); break;
        case 'target':       mat = targetMat; break;
        default: {           // cover
          const isLarge = b.w > 4 || b.d > 4;
          mat = isLarge ? stdMat(ct, 0.85) : stdMat(mt, 0.55, 0.35);
        }
      }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
      mesh.position.set(b.x, b.y, b.z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      this._collidables.push(mesh);
    }

    // Decorative pillar at arena centre
    const pillarMat = stdMat(concreteTex([90, 82, 74]), 0.8);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 4, 8), pillarMat);
    pillar.position.set(0, 2, 0);
    pillar.castShadow = pillar.receiveShadow = true;
    this.scene.add(pillar);
    this._collidables.push(pillar);

    // Course beacons just outside the portal: red glow = hard (left/−z),
    // green glow = easy (right/+z). Tall thin emissive markers + a light.
    const beacon = (z, color) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 7, 0.4),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.5 }),
      );
      m.position.set(29.5, 3.5, z);
      this.scene.add(m);
      const pl = new THREE.PointLight(color, 8, 16, 2);
      pl.position.set(29.5, 4, z);
      this.scene.add(pl);
    };
    beacon(-4, 0xff4422);  // hard course side
    beacon( 4, 0x33dd66);  // easy course side

    // Ground markings (lines / decals via thin planes)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.18, transparent: true });
    for (const z of [-10, 0, 10]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, 0.12), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.01, z);
      this.scene.add(line);
    }
  }

  // ── Decorative scenery: sun, clouds, trees, mountains, dust ─────────────────

  _buildScenery() {
    // Large decorative grass ground for the surroundings. It only extends WEST
    // of the portal (x ≤ ARENA_HALF) so the parkour zone stays a void of
    // floating islands. Sits just below the arena floor to avoid z-fighting.
    const groundTex = grassTex(); groundTex.repeat.set(60, 60);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(280, 520),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(ARENA_HALF - 140, -0.05, 0); // right edge at the portal
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Sun disc with a soft additive glow, placed in the light's direction
    const sunDir  = new THREE.Vector3(24, 48, 22).normalize();
    const sunTex  = canvasTex((ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
      g.addColorStop(0.0, 'rgba(255,255,245,1)');
      g.addColorStop(0.18, 'rgba(255,250,225,0.95)');
      g.addColorStop(0.4, 'rgba(255,225,150,0.35)');
      g.addColorStop(1.0, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    }, 256);
    const sunMat = new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false });
    const sun = new THREE.Sprite(sunMat);
    sun.position.copy(sunDir.multiplyScalar(360));
    sun.scale.set(90, 90, 1);
    this.scene.add(sun);

    // Drifting cloud billboards
    const cloudTex = canvasTex((ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      for (let i = 0; i < 46; i++) {
        const x = s*0.5 + (Math.random()-0.5)*s*0.72;
        const y = s*0.5 + (Math.random()-0.5)*s*0.40;
        const r = s * (0.07 + Math.random()*0.17);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
    }, 256);
    this._clouds = [];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.78, depthWrite: false, fog: true });
      const c = new THREE.Sprite(m);
      const ang = (i / 9) * Math.PI * 2 + Math.random();
      const rad = 130 + Math.random() * 90;
      c.position.set(Math.cos(ang) * rad, 48 + Math.random() * 34, Math.sin(ang) * rad);
      const sc = 50 + Math.random() * 45;
      c.scale.set(sc, sc * 0.5, 1);
      c._drift = 0.6 + Math.random() * 0.9;   // units/sec
      this.scene.add(c);
      this._clouds.push(c);
    }

    // Distant mountain ring (hazy silhouette for horizon depth). Placed on the
    // west arc only, so none float over the parkour void; far enough to read as
    // a soft fogged backdrop.
    const mtnMat = new THREE.MeshStandardMaterial({ color: 0x53657a, roughness: 1, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const ang = Math.PI * 0.5 + (i / 13) * Math.PI;   // -x hemisphere (west)
      const rad = 140 + (i % 3) * 16;
      const h   = 40 + (i % 4) * 18;
      const m = new THREE.Mesh(new THREE.ConeGeometry(36 + (i % 3) * 8, h, 5), mtnMat);
      m.position.set(Math.cos(ang) * rad, h/2 - 4, Math.sin(ang) * rad);
      m.rotation.y = Math.random() * Math.PI;
      this.scene.add(m);
    }

    // Low-poly trees on the grass around the arena (west of the portal only,
    // so none float over the parkour void)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.9 });
    const leafMats = [0x2f6b32, 0x3a7d3e, 0x4f8a3a].map(c =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true }));
    const makeTree = (x, z, scale = 1) => {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6), trunkMat);
      trunk.position.y = 1.2; trunk.castShadow = true;
      g.add(trunk);
      const lm = leafMats[(Math.random() * leafMats.length) | 0];
      for (let k = 0; k < 3; k++) {
        const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 - k * 0.32, 0), lm);
        foliage.position.y = 2.6 + k * 1.0;
        foliage.castShadow = true;
        g.add(foliage);
      }
      g.position.set(x, 0, z);
      g.scale.setScalar(scale * (0.8 + Math.random() * 0.6));
      g.rotation.y = Math.random() * Math.PI;
      this.scene.add(g);
    };
    for (let i = 0; i < 40; i++) {
      const ang = (i / 40) * Math.PI * 2 + Math.random() * 0.3;
      const rad = 33 + Math.random() * 34;
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (x > ARENA_HALF - 2) continue;   // keep clear of the parkour corridor
      makeTree(x, z, 1.1);
    }

    // Floating dust motes for atmosphere
    const N = 160, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i*3]   = (Math.random() - 0.5) * 120;
      pos[i*3+1] = Math.random() * 14 + 0.5;
      pos[i*3+2] = (Math.random() - 0.5) * 90;
    }
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._dust = new THREE.Points(dGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.06, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    this.scene.add(this._dust);

    // ── Minigame bounce pads (glowing discs + a light) ─────────────────────
    this._pads = [];
    for (const p of JUMP_PADS) {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(p.r, p.r * 1.05, 0.25, 24),
        new THREE.MeshStandardMaterial({ color: 0x33e0ff, emissive: 0x1577aa, emissiveIntensity: 1.1, roughness: 0.35, metalness: 0.4 }),
      );
      disc.position.set(p.x, 0.12, p.z);
      disc.receiveShadow = true;
      this.scene.add(disc);
      // Ring marker
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(p.r * 0.96, 0.07, 8, 28),
        new THREE.MeshStandardMaterial({ color: 0x9af0ff, emissive: 0x66ddff, emissiveIntensity: 1.4 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.x, 0.26, p.z);
      this.scene.add(ring);
      const pl = new THREE.PointLight(0x33ddff, 6, 9, 2);
      pl.position.set(p.x, 1.2, p.z);
      this.scene.add(pl);
      this._pads.push(ring);
    }

    // ── Gate signs above the two portals ───────────────────────────────────
    // West wall → MINI GAMES, East wall → PARKOUR
    this._buildGateSign('MINI GAMES', -ARENA_HALF + 0.3, 0, +1, 0xff7733);
    this._buildGateSign('PARKOUR',     ARENA_HALF - 0.3, 0, -1, 0x33ddaa);
  }

  // A glowing text banner floating above a wall gate. `face` = +1 → readable
  // from the −x side, −1 → from the +x side.
  _buildGateSign(text, x, z, face, color) {
    const cw = 1024, ch = 256;
    const cv = Object.assign(document.createElement('canvas'), { width: cw, height: ch });
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    // rounded translucent panel
    ctx.fillStyle = 'rgba(8,10,18,0.72)';
    const r = 40;
    ctx.beginPath();
    ctx.moveTo(r, 10); ctx.arcTo(cw-10, 10, cw-10, ch-10, r);
    ctx.arcTo(cw-10, ch-10, 10, ch-10, r); ctx.arcTo(10, ch-10, 10, 10, r);
    ctx.arcTo(10, 10, cw-10, 10, r); ctx.closePath(); ctx.fill();
    // text
    ctx.font = 'bold 150px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, cw/2, ch/2 + 6);
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillText(text, cw/2, ch/2 + 6);

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(13, 3.25), mat);
    sign.position.set(x, 6.4, z);
    sign.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.scene.add(sign);

    // soft backlight so the sign reads against the sky
    const bl = new THREE.PointLight(color, 5, 14, 2);
    bl.position.set(x + face * 1.5, 6, z);
    this.scene.add(bl);
  }

  // Animate clouds + dust (called each frame from render)
  _animateScenery(nowMs) {
    const t = nowMs / 1000;
    if (this._clouds) {
      for (const c of this._clouds) {
        c.position.x += c._drift * 0.016;
        if (c.position.x > 230) c.position.x = -230;
      }
    }
    if (this._dust) {
      this._dust.position.y = Math.sin(t * 0.3) * 0.4;
      this._dust.rotation.y = t * 0.01;
    }
    if (this._pads) {
      for (let i = 0; i < this._pads.length; i++) {
        const ring = this._pads[i];
        const ph = t * 3 + i;
        ring.position.y = 0.26 + Math.sin(ph) * 0.1;
        const sc = 1 + Math.sin(ph) * 0.08;
        ring.scale.set(sc, sc, 1);
      }
    }
  }

  // ── Viewmodel ──────────────────────────────────────────────────────────────

  _buildViewmodel() {
    this.vmScene  = new THREE.Scene();
    this.vmScene.environment = this._envTex;   // reflections on the weapon metal
    this.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.vmCamera.rotation.order = 'YXZ';

    this.vmScene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const vmSun = new THREE.DirectionalLight(0xfff4d6, 1.2);
    vmSun.position.set(1, 2, 0.5);
    this.vmScene.add(vmSun);

    this._weaponGroups = {};
    for (const id of WEAPON_KEYS) {
      const g = this._makeWeaponMesh(id);
      g.position.set(0.28, -0.22, -0.45);
      g.visible = false;
      this.vmScene.add(g);
      this._weaponGroups[id] = g;
    }

    this._swayX       = 0;
    this._swayY       = 0;
    this._prevMouseDX = 0;
    this._prevMouseDY = 0;

    // Track mouse for weapon sway
    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this._prevMouseDX = e.movementX;
      this._prevMouseDY = e.movementY;
    });

    this.setWeapon('pistol');
  }

  _makeWeaponMesh(id) {
    const w      = WEAPONS[id];
    const grp    = new THREE.Group();
    const body   = new THREE.MeshStandardMaterial({ color: w.bodyColor, roughness: 0.55, metalness: 0.6 });
    const dark   = new THREE.MeshStandardMaterial({ color: 0x222233,    roughness: 0.4,  metalness: 0.8 });
    const grip_m = new THREE.MeshStandardMaterial({ color: 0x1a1a22,    roughness: 0.9,  metalness: 0.1 });

    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      grp.add(m);
    };

    // Body
    add(new THREE.BoxGeometry(0.082, 0.095, 0.22), body, 0, 0, 0);
    // Barrel
    add(new THREE.BoxGeometry(0.022, 0.022, w.barrelLen), dark, 0, 0.028, -(w.barrelLen / 2) - 0.11);
    // Grip
    add(new THREE.BoxGeometry(0.058, 0.11, 0.065), grip_m, 0, -0.09, 0.065, 0.18);
    // Trigger guard
    add(new THREE.TorusGeometry(0.022, 0.006, 6, 8, Math.PI), dark, 0, -0.032, -0.01, Math.PI / 2);

    if (id === 'rifle') {
      // Stock
      add(new THREE.BoxGeometry(0.07, 0.055, 0.14), body, 0, 0.02, 0.18);
      // Mag
      add(new THREE.BoxGeometry(0.04, 0.1, 0.06), dark, 0, -0.07, 0.01);
      // Rail
      add(new THREE.BoxGeometry(0.085, 0.01, 0.18), dark, 0, 0.056, -0.04);
    }

    if (id === 'shotgun') {
      // Pump
      add(new THREE.BoxGeometry(0.068, 0.038, 0.12), grip_m, 0, -0.006, -(w.barrelLen * 0.4) - 0.05);
      // Wide barrel shroud
      add(new THREE.BoxGeometry(0.038, 0.038, w.barrelLen * 0.8), body, 0, 0.02, -(w.barrelLen * 0.4) - 0.08);
    }

    if (id === 'sniper') {
      // Long scope body
      const scopeGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.22, 10);
      const scope    = new THREE.Mesh(scopeGeo, dark);
      scope.rotation.z = Math.PI / 2;
      scope.position.set(0, 0.07, -0.08);
      grp.add(scope);
      // Scope lens
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), new THREE.MeshStandardMaterial({ color: 0x224488, roughness: 0.1, metalness: 0.9, emissive: 0x001133 }));
      lens.rotation.y = Math.PI / 2;
      lens.position.set(0.023, 0.07, -0.18);
      grp.add(lens);
      // Bipod legs
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(0.006, 0.08, 0.006), dark, sx * 0.028, -0.07, -(w.barrelLen * 0.5) - 0.04);
      }
    }

    return grp;
  }

  // ── Bullet impact decals ─────────────────────────────────────────────────
  // No muzzle flash, no recoil animation — the only shooting feedback is a
  // bullet hole where the round actually strikes world geometry.

  _buildImpactPool() {
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 200;

    // Dark "bullet hole" texture: black centre, faint cracked ring, soft edge.
    const holeTex = canvasTex((ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
      g.addColorStop(0.0, 'rgba(10,8,6,0.95)');
      g.addColorStop(0.45, 'rgba(20,16,12,0.85)');
      g.addColorStop(0.7, 'rgba(40,34,28,0.35)');
      g.addColorStop(1.0, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      // A few light cracks radiating out
      ctx.strokeStyle = 'rgba(120,110,100,0.5)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = s * (0.15 + Math.random() * 0.25);
        ctx.beginPath();
        ctx.moveTo(s/2, s/2);
        ctx.lineTo(s/2 + Math.cos(a) * r, s/2 + Math.sin(a) * r);
        ctx.stroke();
      }
    }, 128);

    // Pool of reusable decal quads (round-robin so we never grow unbounded)
    this._impactPool = [];
    this._impactIdx  = 0;
    const POOL = 40;
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: holeTex, transparent: true, opacity: 0,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), mat);
      m.visible    = false;
      m._born      = 0;     // timestamp when last spawned (for fade)
      this.scene.add(m);
      this._impactPool.push(m);
    }
  }

  // Called once per shot from main.js. Raycasts each pellet against the world
  // and drops a bullet hole at the first surface it hits.
  spawnImpacts(eye, yaw, pitch, weaponId) {
    const weap    = WEAPONS[weaponId] ?? WEAPONS.pistol;
    // Cap visible holes per shot (shotgun has many pellets)
    const pellets = Math.min(weap.pellets, 6);

    for (let p = 0; p < pellets; p++) {
      const sy = (Math.random() - 0.5) * weap.spread;
      const sp = (Math.random() - 0.5) * weap.spread;
      const ey = yaw + sy, ep = pitch + sp;

      const dir = new THREE.Vector3(
        -Math.sin(ey) * Math.cos(ep),
         Math.sin(ep),
        -Math.cos(ey) * Math.cos(ep),
      ).normalize();

      this._raycaster.set(new THREE.Vector3(eye.x, eye.y, eye.z), dir);
      const hits = this._raycaster.intersectObjects(this._collidables, false);
      if (!hits.length) continue;

      const hit = hits[0];
      const m   = this._impactPool[this._impactIdx];
      this._impactIdx = (this._impactIdx + 1) % this._impactPool.length;

      // Place slightly off the surface, oriented to the surface normal
      const n = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : dir.clone().negate();
      m.position.copy(hit.point).addScaledVector(n, 0.012);
      m.lookAt(hit.point.clone().add(n));
      m.rotation.z = Math.random() * Math.PI * 2;
      const sc = 0.7 + Math.random() * 0.6;
      m.scale.set(sc, sc, sc);

      m.visible           = true;
      m.material.opacity  = 0.95;
      m._born             = performance.now();
    }
  }

  setWeapon(id) {
    this._currentWeaponId = id;
    for (const [k, g] of Object.entries(this._weaponGroups)) g.visible = k === id;
  }

  // ── Remote players ─────────────────────────────────────────────────────────

  addRemotePlayer(id, name) {
    if (!this.remotePlayers.has(id))
      this.remotePlayers.set(id, new RemotePlayer(id, name, this.scene));
  }

  removeRemotePlayer(id) {
    const rp = this.remotePlayers.get(id);
    if (rp) { rp.destroy(this.scene); this.remotePlayers.delete(id); }
  }

  processSnapshot(snap, myId, localPlayer) {
    for (const ps of snap.players) {
      if (ps.id === myId) { localPlayer.reconcile(ps); continue; }
      if (!this.remotePlayers.has(ps.id)) this.addRemotePlayer(ps.id, ps.name);
      this.remotePlayers.get(ps.id)?.addSnapshot(ps, Date.now());
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render(localPlayer, dt) {
    const nowMs  = performance.now();
    const weap   = WEAPONS[localPlayer.currentWeapon];

    // ADS smooth lerp
    this._adsLerp += ((localPlayer.ads ? 1 : 0) - this._adsLerp) * Math.min(1, dt * 14);
    this.camera.fov = FOV_HIP + (weap.adsFov - FOV_HIP) * this._adsLerp;
    this.camera.updateProjectionMatrix();

    // Camera placement (live predicted position + smoothed server corrections)
    const eye = localPlayer.eyePosition(dt);
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.y = localPlayer.yaw;
    this.camera.rotation.x = localPlayer.pitch;
    this.camera.rotation.z = -localPlayer.bobRoll; // subtle lean

    // Update remote players
    for (const [, rp] of this.remotePlayers) rp.update(this.camera, this.renderer);

    // Animate decorative scenery (clouds drift, dust floats)
    this._animateScenery(nowMs);

    // ── Pass 1: world ────────────────────────────────────────────────────
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    // ── Bullet-hole fade ─────────────────────────────────────────────────
    // Holes stay solid for a few seconds, then fade out and hide.
    const HOLD = 5000, FADE = 2500;
    for (const m of this._impactPool) {
      if (!m.visible) continue;
      const age = nowMs - m._born;
      if (age > HOLD + FADE) { m.visible = false; m.material.opacity = 0; }
      else if (age > HOLD)   { m.material.opacity = 0.95 * (1 - (age - HOLD) / FADE); }
    }

    // ── Weapon position: ADS sway + mouse sway (no recoil animation) ─────
    this._swayX += (this._prevMouseDX * -0.0004 - this._swayX) * Math.min(1, dt * 8);
    this._swayY += (this._prevMouseDY * -0.0003 - this._swayY) * Math.min(1, dt * 8);
    this._prevMouseDX = 0;
    this._prevMouseDY = 0;

    // Hide viewmodel if sniper + fully ADS → handled externally (HUD scope overlay)
    const hideVM = localPlayer.currentWeapon === 'sniper' && this._adsLerp > 0.85;
    const wgrp   = this._weaponGroups[this._currentWeaponId];
    if (wgrp) {
      const adsX  = 0.28 * (1 - this._adsLerp * 0.92);
      const adsY  = -0.22 + this._adsLerp * 0.04;
      wgrp.position.set(adsX + this._swayX, adsY + this._swayY, -0.45);
      wgrp.visible = !hideVM;
    }

    // vmCamera matches only the pitch (gun hangs from camera)
    this.vmCamera.rotation.x = 0;
    this.vmCamera.rotation.y = 0;
    this.vmCamera.aspect     = this.camera.aspect;
    this.vmCamera.updateProjectionMatrix();

    // ── Pass 2: viewmodel (on top of world, clear only depth) ────────────
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect   = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }
}
