// dust.js — dust motes (pooled Points), hazards, pickup logic, vents.
import * as THREE from './vendor/three.module.js';
import { BALANCE } from './upgrades.js';

const MAX_DUST = 600;

export class DustSystem {
  constructor(world) {
    this.world = world;
    this.items = [];            // {x,y,z, val, type, r, alive, vx, vz, spin, mesh}
    this.hazards = [];
    this._free = [];
    // shared geometry/materials
    this.geoSmall = new THREE.SphereGeometry(0.28, 6, 5);
    this.geoBig = new THREE.SphereGeometry(0.45, 7, 6);
    this.matDust = new THREE.MeshStandardMaterial({ color: 0xc9b28a, roughness: 0.9 });
    this.matGold = new THREE.MeshStandardMaterial({ color: 0xffd54a, roughness: 0.4, metalness: 0.5, emissive: 0x5a4a00, emissiveIntensity: 0.5 });
    this.matHazmat = new THREE.MeshStandardMaterial({ color: 0x7CFF4f, roughness: 0.6, emissive: 0x2a7a0a, emissiveIntensity: 0.8 });
    this.matDebris = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.85 });
  }

  reset() {
    for (const it of this.items) { it.alive = false; if (it.mesh) it.mesh.visible = false; this._free.push(it); }
    this.items = [];
    this.hazards = [];
  }

  _get() {
    if (this._free.length) return this._free.pop();
    const it = { alive: false, mesh: null };
    return it;
  }

  spawnMote(x, z, type, val) {
    if (this.items.length >= MAX_DUST) return;
    const it = this._get();
    it.type = type; it.val = val; it.alive = true;
    it.x = x; it.y = 0.3 + Math.random() * 0.4; it.z = z;
    it.vx = 0; it.vz = 0;
    it.spin = Math.random() * 4 - 2;
    it.r = type === 'big' ? 0.5 : type === 'gold' ? 0.4 : 0.3;
    // mesh
    if (!it.mesh || it.mesh.userData.type !== type) {
      if (it.mesh) { it.mesh.removeFromParent(); }
      const geo = type === 'big' ? this.geoBig : this.geoSmall;
      const mat = type === 'gold' ? this.matGold : type === 'hazmat' ? this.matHazmat : type === 'debris' ? this.matDebris : this.matDust;
      const m = new THREE.Mesh(geo, mat);
      m.userData.type = type;
      it.mesh = m;
    }
    it.mesh.position.set(x, it.y, z);
    it.mesh.visible = true;
    if (!it.mesh.parent) this.world.group.add(it.mesh);
    this.items.push(it);
  }

  spawnHazard(kind, x, z) {
    const g = new THREE.Group();
    let r = 1.0;
    if (kind === 'fan') {
      r = 1.4;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.2, 16), new THREE.MeshStandardMaterial({ color: 0x222a35, roughness: 0.6 }));
      base.position.y = 0.1;
      const blades = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 1.1), new THREE.MeshStandardMaterial({ color: 0x9aa7b8, metalness: 0.6, roughness: 0.3 }));
        b.rotation.y = (i / 4) * Math.PI * 2;
        b.position.set(Math.cos(b.rotation.y) * 0.5, 0.3, Math.sin(b.rotation.y) * 0.5);
        blades.add(b);
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x444 }));
      pole.position.y = 0.3;
      g.add(base, blades, pole);
      g.userData.blades = blades;
    } else if (kind === 'cable') {
      r = 1.6;
      const c = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.12, 6, 20), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 }));
      c.rotation.x = Math.PI / 2; c.position.y = 0.1;
      const c2 = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.1, 6, 16), new THREE.MeshStandardMaterial({ color: 0x222, roughness: 0.7 }));
      c2.rotation.x = Math.PI / 2; c2.rotation.y = 0.5; c2.position.y = 0.12;
      g.add(c, c2);
    } else if (kind === 'mine') {
      r = 0.9;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.4, metalness: 0.4 }));
      m.position.y = 0.5;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 16), new THREE.MeshStandardMaterial({ color: 0xff4a6a, emissive: 0x7a1a2a, emissiveIntensity: 0.8 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.5;
      g.add(m, ring);
    }
    g.position.set(x, 0, z);
    this.world.group.add(g);
    this.hazards.push({ kind, x, z, r, mesh: g, hitCd: 0 });
  }

  clearHazards() {
    for (const h of this.hazards) h.mesh.removeFromParent();
    this.hazards = [];
  }

  update(dt, bot, stats, world, cb) {
    const S = BALANCE.room.size;
    // vents spawn
    this._spawnTimer = (this._spawnTimer || 0) + dt;
    const rate = BALANCE.room.spawnRate(world._roomNo || 1);
    if (this._spawnTimer > 1 / rate && bot.bin / stats.binMax < 0.8) {
      this._spawnTimer = 0;
      const vents = world.vents.filter(v => !v.isCharger);
      if (vents.length) {
        const v = vents[Math.floor(Math.random() * vents.length)];
        const roll = Math.random();
        const goldP = stats.goldChance;
        let type = 'dust', val = BALANCE.room.moteValue(world._roomNo || 1);
        if (roll < goldP) { type = 'gold'; val = 10; }
        else if (roll < goldP + 0.12) { type = 'debris'; val = 3; }
        else if (roll < goldP + 0.20) { type = 'hazmat'; val = 4 * stats.hazmatValueMult; }
        else if (roll < goldP + 0.30) { type = 'big'; val = 5; }
        const a = Math.random() * Math.PI * 2, d = Math.random() * 1.5;
        this.spawnMote(v.x + Math.cos(a) * d, v.z + Math.sin(a) * d, type, val);
      }
    }

    // dust physics + suction
    const suckR = stats.suctionRange * stats.suction;
    const magR = stats.magnetRange;
    const pickupR = stats.pickupRadius;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.alive) continue;
      // drift
      it.x += it.vx * dt; it.z += it.vz * dt;
      it.spin += dt;
      if (it.x < -S) it.x = -S; if (it.x > S) it.x = S;
      if (it.z < -S) it.z = -S; if (it.z > S) it.z = S;
      // suction from bot
      const dx = bot.pos.x - it.x, dz = bot.pos.z - it.z;
      const dist = Math.hypot(dx, dz);
      if (dist < suckR + pickupR) {
        const force = (1 - dist / (suckR + pickupR)) * 14 * stats.suction * (bot.clogged ? BALANCE.bin.clogSuctionMult : 1);
        it.vx += dx / (dist + 0.001) * force * dt * 6;
        it.vz += dz / (dist + 0.001) * force * dt * 6;
      }
      // magnet passive pull
      if (magR > 0 && dist < magR + 2) {
        it.vx += dx / (dist + 0.001) * 3 * dt;
        it.vz += dz / (dist + 0.001) * 3 * dt;
      }
      // friction
      it.vx *= (1 - Math.min(1, dt * 3));
      it.vz *= (1 - Math.min(1, dt * 3));
      // pickup
      if (dist < pickupR) {
        it.alive = false; it.mesh.visible = false;
        this._free.push(it);
        this.items.splice(i, 1);
        this._collected(it, bot, stats, cb);
        continue;
      }
      it.mesh.position.set(it.x, it.y + Math.sin(it.spin * 2) * 0.1, it.z);
    }

    // hazards
    for (const h of this.hazards) {
      h.hitCd = Math.max(0, h.hitCd - dt);
      if (h.kind === 'fan') { const b = h.mesh.userData.blades; if (b) b.rotation.y += dt * 12; }
      if (h.kind === 'mine') { h.mesh.children[1].rotation.z += dt * 2; }
      const dx = bot.pos.x - h.x, dz = bot.pos.z - h.z;
      const d = Math.hypot(dx, dz);
      if (d < h.r + 1.0 && h.hitCd === 0) {
        if (h.kind === 'fan') {
          // knockback + damage
          const kb = 6;
          bot.vel.x += dx / (d + 0.001) * kb; bot.vel.z += dz / (d + 0.001) * kb;
          h.hitCd = 1;
          bot.hurt();
        } else if (h.kind === 'cable') {
          bot.hurt();
          h.hitCd = 1.2;
          bot.vel.multiplyScalar(0.4); // slow
        } else if (h.kind === 'mine') {
          bot.setBattery(bot.battery - stats.batteryMax * 0.2, stats.batteryMax);
          cb.onMine && cb.onMine();
          h.mesh.visible = false;
          h.hitCd = 9999;
          // respawn after a while
          setTimeout(() => { h.mesh.visible = true; h.hitCd = 0; }, 6000);
        }
      }
    }
  }

  _collected(it, bot, stats, cb) {
    bot.addDust(1);
    stats.dust += it.val;
    if (it.type === 'gold') { cb.onGold && cb.onGold(); }
    else cb.onSuck && cb.onSuck(it.type);
  }
}
