// world.js — three.js scene, room generation, props, lighting, camera.
import * as THREE from './vendor/three.module.js';
import { BALANCE } from './upgrades.js';

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x10151c);
    this.scene.fog = new THREE.Fog(0x10151c, 30, 70);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this._resize();
    addEventListener('resize', () => this._resize());

    // lights (no shadows for perf; fake blob shadow under bot)
    const amb = new THREE.AmbientLight(0x8899bb, 0.9);
    this.scene.add(amb);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(10, 24, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x4ac3ff, 0.35);
    fill.position.set(-12, 10, -6);
    this.scene.add(fill);

    this.group = new THREE.Group();   // room props, rebuilt each room
    this.scene.add(this.group);

    // tap-to-move marker (persists across rooms)
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.7, 20),
      new THREE.MeshBasicMaterial({ color: 0x4ac3ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.05;
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.raycaster = new THREE.Raycaster();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._camTarget = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this.camOffset = new THREE.Vector3(0, 16, 14);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  clear() {
    // dispose group children
    while (this.group.children.length) {
      const c = this.group.children.pop();
      c.traverse?.(o => {
        o.geometry?.dispose?.();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose?.());
      });
    }
  }

  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1, ...opts });
  }

  // Build a fresh room. Returns { walls:[Box3], pads:[vec3], vents:[vec3], dump:vec3, spawn:vec3 }
  buildRoom(roomNo, stats) {
    this.clear();
    const S = BALANCE.room.size;
    const cleanMult = 1 - 0.10 * ((this._meta?.meta_clean) || 0);

    // floor
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(S * 2, 0.5, S * 2),
      this._mat(0x2a3340, { roughness: 0.95 })
    );
    floor.position.y = -0.25;
    this.group.add(floor);
    // subtle checker via grid texture is overkill; add a center rug
    const rug = new THREE.Mesh(new THREE.BoxGeometry(S * 1.1, 0.06, S * 1.1), this._mat(0x35506b, { roughness: 0.9 }));
    rug.position.y = 0.03;
    this.group.add(rug);

    // walls (4 boxes)
    const wallMat = this._mat(0x1b222c, { roughness: 0.9 });
    const t = BALANCE.room.wall, H = 3;
    const mkWall = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat);
      m.position.set(x, H / 2, z);
      this.group.add(m);
    };
    mkWall(S * 2 + t * 2, t, 0, S + t / 2);
    mkWall(S * 2 + t * 2, t, 0, -S - t / 2);
    mkWall(t, S * 2, S + t / 2, 0);
    mkWall(t, S * 2, -S - t / 2, 0);
    this.walls = [
      new THREE.Box3(new THREE.Vector3(-S - t, 0, S), new THREE.Vector3(S + t, H, S + t)),
      new THREE.Box3(new THREE.Vector3(-S - t, 0, -S - t), new THREE.Vector3(S + t, H, -S)),
      new THREE.Box3(new THREE.Vector3(S, 0, -S - t), new THREE.Vector3(S + t, H, S + t)),
      new THREE.Box3(new THREE.Vector3(-S - t, 0, -S - t), new THREE.Vector3(-S, H, S + t)),
    ];

    // obstacles (furniture blocks) — circles for collision
    this.obstacles = [];
    const nObs = Math.round(BALANCE.room.obstacleCount(roomNo) * cleanMult);
    for (let i = 0; i < nObs; i++) {
      const r = 1.2 + Math.random() * 1.4;
      const x = (Math.random() * 2 - 1) * (S - 4);
      const z = (Math.random() * 2 - 1) * (S - 4);
      if (Math.hypot(x, z) < 5) continue; // keep spawn area clear
      const h = 1.5 + Math.random() * 1.5;
      const col = [0x4a5568, 0x52607a, 0x3f4a5c][i % 3];
      const box = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, h, r * 1.6), this._mat(col));
      box.position.set(x, h / 2, z);
      this.group.add(box);
      this.obstacles.push({ x, z, r: r * 0.9, box });
    }

    // charging pads
    this.pads = [];
    const padCount = roomNo >= 2 ? 2 : 1;
    for (let i = 0; i < padCount; i++) {
      const a = (i / padCount) * Math.PI * 2 + 0.8;
      const x = Math.cos(a) * (S - 3), z = Math.sin(a) * (S - 3);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.12, 24),
        this._mat(0x4aff9e, { emissive: 0x1a7a4c, emissiveIntensity: 0.6, roughness: 0.5 }));
      pad.position.set(x, 0.06, z);
      this.group.add(pad);
      this.pads.push(new THREE.Vector3(x, 0, z));
    }

    // vents on walls (dust spawners). Some become chargers via upgrade.
    this.vents = [];
    const nV = BALANCE.room.ventCount(roomNo);
    for (let i = 0; i < nV; i++) {
      const side = i % 4;
      let x, z;
      const off = ((i * 7) % (S * 2 - 4)) - (S - 2);
      if (side === 0) { x = off; z = S - 0.6; }
      else if (side === 1) { x = S - 0.6; z = off; }
      else if (side === 2) { x = -off; z = -S + 0.6; }
      else { x = -S + 0.6; z = -off; }
      const isCharger = i < (stats.chargerVents || 0);
      const v = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.5),
        this._mat(isCharger ? 0x4ac3ff : 0x39424e, { emissive: isCharger ? 0x1a6a9a : 0x000000, emissiveIntensity: isCharger ? 0.8 : 0 }));
      v.position.set(x, 0.3, z);
      v.lookAt(x * 2, 0.3, z * 2);
      this.group.add(v);
      this.vents.push({ x, z, isCharger });
    }
    if (this.vents.length) {
      const c = this.vents[0];
      this.pads.push(new THREE.Vector3(c.x, 0, c.z));
    }

    // dump station (trash bin) in a corner
    const dx = S - 2, dz = S - 2;
    const bin = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.7, 2.6, 12), this._mat(0x2f9e44, { roughness: 0.6 }));
    body.position.y = 1.3;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.2, 12), this._mat(0x2b8a3c));
    lid.position.y = 2.65;
    bin.add(body, lid);
    bin.position.set(dx, 0, dz);
    this.group.add(bin);
    this.dump = new THREE.Vector3(dx, 0, dz);

    this.spawn = new THREE.Vector3(0, 0, 0);
    return { walls: this.walls, pads: this.pads, vents: this.vents, dump: this.dump, spawn: this.spawn, obstacles: this.obstacles };
  }

  // screen -> floor world point (null if off-floor)
  screenToFloor(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const pt = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, pt);
    if (!hit) return null;
    const S = BALANCE.room.size + BALANCE.room.wall;
    if (Math.abs(pt.x) > S || Math.abs(pt.z) > S) return null;
    return { x: pt.x, z: pt.z };
  }

  followCamera(botPos, dt) {
    const target = new THREE.Vector3(botPos.x, 0, botPos.z);
    this._camTarget.lerp(target, Math.min(1, dt * 5));
    const desired = this._camTarget.clone().add(this.camOffset);
    this._camPos.lerp(desired, Math.min(1, dt * 6));
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camTarget.x, 0.5, this._camTarget.z);
  }

  initCamera(botPos) {
    this._camTarget.set(botPos.x, 0, botPos.z);
    this._camPos.copy(this._camTarget).add(this.camOffset);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camTarget.x, 0.5, this._camTarget.z);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
