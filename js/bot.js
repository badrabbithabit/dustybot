// bot.js — the robot vacuum entity: low-poly roomba mesh, movement,
// battery, dust bin, collision, shield.
import * as THREE from './vendor/three.module.js';
import { BALANCE } from './upgrades.js';

export class Bot {
  constructor(world, stats) {
    this.world = world;
    this.stats = stats;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.heading = 0;
    this.vel = new THREE.Vector3();
    this.battery = stats.batteryMax;
    this.bin = 0;
    this.lives = stats.lives;
    this.shield = stats.shieldCharges;
    this.invuln = 0;
    this.boostCd = 0;
    this.boosting = false;
    this.clogged = false;
    this.alive = true;
    this._buildMesh();
  }

  _mat(color, opts = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...opts }); }

  _buildMesh() {
    const g = new THREE.Group();
    const R = BALANCE.bot.radius;
    // main disc body
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.02, 0.9, 24), this._mat(0xd14a28));
    body.position.y = 0.6;
    g.add(body);
    // top dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R * 0.82, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), this._mat(0xe8664a));
    dome.position.y = 1.0;
    g.add(dome);
    // center sensor turret
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.5, 16), this._mat(0x1c2735, { metalness: 0.6, roughness: 0.3 }));
    turret.position.y = 1.35;
    g.add(turret);
    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x4ac3ff, emissive: 0x4ac3ff, emissiveIntensity: 1.4 }));
    this.led.position.y = 1.62;
    g.add(this.led);
    // side brushes (visible, spin)
    this.brushL = this._brush(0xffd54a); this.brushL.position.set(-R * 0.7, 0.18, R * 0.55);
    this.brushR = this._brush(0xffd54a); this.brushR.position.set(R * 0.7, 0.18, R * 0.55);
    g.add(this.brushL, this.brushR);
    // front bumper accent
    const bump = new THREE.Mesh(new THREE.TorusGeometry(R * 0.98, 0.1, 8, 24, Math.PI * 0.8), this._mat(0xff8a66));
    bump.rotation.x = Math.PI / 2; bump.rotation.z = Math.PI * 0.6; bump.position.y = 0.5;
    g.add(bump);
    // fake blob shadow
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(R * 1.15, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02;
    g.add(shadow);
    this.mesh = g;
    this.world.group.add(g);
  }

  _brush(color) {
    const b = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.25, 8), this._mat(0x333));
    hub.position.y = 0.12;
    b.add(hub);
    for (let i = 0; i < 6; i++) {
      const bristle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), this._mat(color, { roughness: 0.9 }));
      bristle.rotation.y = (i / 6) * Math.PI * 2;
      bristle.position.set(Math.cos(bristle.rotation.y) * 0.22, 0.1, Math.sin(bristle.rotation.y) * 0.22);
      b.add(bristle);
    }
    return b;
  }

  setBattery(v, max) { this.battery = Math.max(0, Math.min(max, v)); }

  update(dt, input, world) {
    if (!this.alive) return;
    const s = this.stats;
    const S = BALANCE.room.size;

    // clog check
    this.clogged = this.bin >= BALANCE.bin.clogAt;
    const clogMult = this.clogged ? BALANCE.bin.clogSuctionMult : 1;

    // ---- steering ----
    let ix = input.x, iz = input.z;           // joystick/keys: x=right, z=forward(neg screen-down)
    let hasInput = (ix !== 0 || iz !== 0);
    if (input.tap) {
      // steer toward tap target
      const dx = input.tap.x - this.pos.x, dz = input.tap.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.6) { ix = dx / dist; iz = dz / dist; hasInput = true; }
    }
    if (hasInput) {
      const target = Math.atan2(ix, iz);
      let d = target - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const maxTurn = s.turnRate * dt;
      this.heading += Math.max(-maxTurn, Math.min(maxTurn, d));
    }

    // boost
    this.boostCd = Math.max(0, this.boostCd - dt);
    const wantBoost = input.boost && this.battery > 1 && this.boostCd === 0;
    if (wantBoost && !this.boosting) { this.boosting = true; this.onBoost && this.onBoost(); }
    if (!wantBoost) this.boosting = false;

    const speed = s.speed * (this.boosting ? BALANCE.bot.boostMult : 1) * (this.clogged ? 1 / BALANCE.bin.clogWeightMult : 1);
    // move along heading by input magnitude
    const mag = Math.min(1, Math.hypot(ix, iz));
    this.vel.set(
      Math.sin(this.heading) * speed * mag, 0,
      Math.cos(this.heading) * speed * mag
    );
    this.pos.addScaledVector(this.vel, dt);

    // battery drain
    let drain = BALANCE.battery.drainIdle;
    if (mag > 0) drain += BALANCE.battery.drainMove * (this.boosting ? BALANCE.battery.drainBoost / BALANCE.battery.drainMove : 1);
    this.battery -= drain * s.drainMult * dt;
    if (this.battery <= 0) {
      this.battery = 0;
      this._overload(dt);
    }

    // collisions: walls + obstacles (push out)
    const R = BALANCE.bot.radius;
    this.pos.x = Math.max(-S + R, Math.min(S - R, this.pos.x));
    this.pos.z = Math.max(-S + R, Math.min(S - R, this.pos.z));
    for (const o of world.obstacles) {
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
      const d = Math.hypot(dx, dz), min = R + o.r;
      if (d < min && d > 0.001) {
        this.pos.x = o.x + dx / d * min;
        this.pos.z = o.z + dz / d * min;
      }
    }

    // sync mesh
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.heading;
    const spin = dt * (this.boosting ? 30 : 14) * (mag > 0 ? 1 : 0.2);
    this.brushL.rotation.y += spin;
    this.brushR.rotation.y -= spin;
    // LED color by battery
    const bFrac = this.battery / s.batteryMax;
    const col = bFrac > 0.5 ? 0x4aff9e : bFrac > 0.25 ? 0xffd54a : 0xff4a6a;
    this.led.material.color.setHex(col);
    this.led.material.emissive.setHex(col);
    // blink when invuln
    this.mesh.visible = this.invuln > 0 ? (Math.floor(performance.now() / 100) % 2 === 0) : true;

    this.invuln = Math.max(0, this.invuln - dt);
    return { moving: mag > 0.1, speed };
  }

  _overload(dt) {
    // dead battery = take overload damage on a timer
    this._olTimer = (this._olTimer || 0) + dt;
    if (this._olTimer >= 2) {
      this._olTimer = 0;
      this.hurt(true);
    }
  }

  hurt(byOverload = false) {
    if (this.invuln > 0 || !this.alive) return false;
    if (this.shield > 0) { this.shield--; this.invuln = 1.2; this.onShield && this.onShield(); return true; }
    this.lives--;
    this.invuln = 2;
    this.onHurt && this.onHurt();
    if (this.lives <= 0) { this.alive = false; this.onDead && this.onDead(); }
    return true;
  }

  addDust(n) { this.bin = Math.min(this.stats.binMax, this.bin + n); }
  refill(padFillFrac) { this.battery = Math.min(this.stats.batteryMax, this.battery + this.stats.batteryMax * padFillFrac); }
  dumpBin() { const v = this.bin; this.bin = 0; return v; }
}
