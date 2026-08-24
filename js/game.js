// game.js — run state machine: menu -> room loop -> pick -> over.
import { BALANCE, makeRunStats, rollPicks, applyPick } from './upgrades.js';
import { Bot } from './bot.js';
import { DustSystem } from './dust.js';
import { Controls } from './controls.js';
import * as UI from './ui.js';
import * as Audio from './audio.js';

const SCREENS = ['screen-menu', 'screen-hangar', 'screen-pick', 'screen-over'];

export class Game {
  constructor(world, save) {
    this.world = world;
    this.save = save;
    this.controls = new Controls(world.canvas);
    this.dust = new DustSystem(world);
    this.state = 'menu';
    this.bot = null;
    this.stats = null;
    this.roomNo = 1;
    this.dustBudget = 0;
    this.collectedThisRoom = 0;
    this._lastPad = 0;
    this._transition = 0;

    // controls wiring
    this.controls.onTap = (sx, sy) => {
      if (this.state !== 'room') return null;
      const p = world.screenToFloor(sx, sy);
      if (p) { this._tapInput = p; UI.toast(''); }
      return p;
    };
    this.controls.onJoyChange = () => { this._tapInput = null; };

    // bot callbacks
    this._wireBotCallbacks();
  }

  _wireBotCallbacks() {
    // (set on each new bot in startRoom)
  }

  newRun() {
    this.stats = makeRunStats(this.save.meta);
    this.roomNo = 1;
    this.startRoom();
  }

  startRoom() {
    this.dust.reset();
    this.dust.clearHazards();
    this.world._roomNo = this.roomNo;
    this.world._meta = this.save.meta;
    const info = this.world.buildRoom(this.roomNo, this.stats);
    this.dust.clearHazards();

    // place hazards
    const cleanMult = 1 - 0.10 * ((this.save.meta.meta_clean) || 0);
    const nHaz = Math.round(BALANCE.room.hazardCount(this.roomNo) * cleanMult);
    for (let i = 0; i < nHaz; i++) {
      const kinds = this.roomNo >= 4 ? ['fan', 'cable', 'mine'] : this.roomNo >= 2 ? ['fan', 'cable'] : ['fan'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const S = BALANCE.room.size;
      let x = (Math.random() * 2 - 1) * (S - 4);
      let z = (Math.random() * 2 - 1) * (S - 4);
      if (Math.hypot(x, z) < 5) { x += 6; z += 6; }
      this.dust.spawnHazard(kind, x, z);
    }

    // (re)create bot
    if (this.bot) { this.bot.mesh.removeFromParent(); }
    this.bot = new Bot(this.world, this.stats);
    this.bot.pos.copy(info.spawn);
    this.bot.onHurt = () => { Audio.sfx.hurt(); UI.toast('Ouch!', 'warn'); };
    this.bot.onDead = () => this.endRun(false);
    this.bot.onShield = () => { Audio.sfx.life(); UI.toast('Shield!', 'good'); };
    this.bot.onBoost = () => { Audio.sfx.boost(); this.bot.boostCd = BALANCE.bot.boostCd * this.stats.boostCdMult; this.bot.boostCd = Math.max(BALANCE.bot.boostCdFloor, this.bot.boostCd); };
    this.world.initCamera(this.bot.pos);

    // seed initial dust on floor
    const S = BALANCE.room.size;
    const seed = Math.round(BALANCE.room.dustBudget(this.roomNo) * 0.5);
    for (let i = 0; i < seed; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * (S - 3);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const roll = Math.random();
      let type = 'dust', val = BALANCE.room.moteValue(this.roomNo);
      if (roll < this.stats.goldChance) { type = 'gold'; val = 10; }
      else if (roll < 0.1) { type = 'debris'; val = 3; }
      else if (roll < 0.18) { type = 'hazmat'; val = 4 * this.stats.hazmatValueMult; }
      else if (roll < 0.28) { type = 'big'; val = 5; }
      this.dust.spawnMote(x, z, type, val);
    }

    this.dustBudget = BALANCE.room.dustBudget(this.roomNo);
    this.collectedThisRoom = 0;
    this._roomDustStart = this.stats.dust;
    this._tapInput = null;
    this.state = 'room';
    UI.showAll(SCREENS, null);
    UI.show('hud');
    UI.show('joy');
  }

  update(dt) {
    if (this.state !== 'room' || !this.bot || !this.bot.alive) return;

    // build input vector
    const j = this.controls.joy;
    const kv = this.controls.keyVector();
    let ix = 0, iz = 0;
    if (j.active) { ix = j.x; iz = -j.y; }
    else if (kv.active) { ix = kv.x; iz = kv.z; }
    const input = { x: ix, z: iz, boost: this.controls.boost || (kv.active && this.controls.keys[' ']), tap: this._tapInput };
    // clear tap target if reached + marker
    if (this._tapInput) {
      this.world.marker.visible = true;
      this.world.marker.position.set(this._tapInput.x, 0.05, this._tapInput.z);
      if (Math.hypot(this.bot.pos.x - this._tapInput.x, this.bot.pos.z - this._tapInput.z) < 0.8) {
        this._tapInput = null;
      }
    } else {
      this.world.marker.visible = false;
    }

    const before = this.stats.dust;
    this.bot.update(dt, input, this.world);
    this.dust.update(dt, this.bot, this.stats, this.world, {
      onSuck: t => Audio.sfx.suck(),
      onGold: () => Audio.sfx.gold(),
      onMine: () => { Audio.sfx.hurt(); UI.toast('Battery mine! -20% ⚡', 'warn'); },
    });

    // pads / chargers
    const now = performance.now();
    for (const p of this.world.pads) {
      if (Math.hypot(this.bot.pos.x - p.x, this.bot.pos.z - p.z) < 1.8 && this.bot.battery < this.stats.batteryMax - 1) {
        if (now - this._lastPad > 400) { this._lastPad = now; this.bot.refill(BALANCE.battery.padFill / 100); Audio.sfx.pad(); }
      }
    }

    // dump station
    const d = this.world.dump;
    if (Math.hypot(this.bot.pos.x - d.x, this.bot.pos.z - d.z) < 2.2 && this.bot.bin > 0) {
      const v = this.bot.dumpBin();
      this.stats.dust += v * 0.5; // dumping banks bonus dust
      Audio.sfx.dump();
      UI.toast(`Dumped bin (+${Math.round(v * 0.5)} bonus)`, 'good');
    }

    // room clear?
    this.collectedThisRoom = this.stats.dust - this._roomDustStart;
    if (this.collectedThisRoom >= this.dustBudget) this.roomCleared();

    // HUD
    UI.setHud({
      lives: this.bot.lives, maxLives: this.stats.maxLives, shield: this.bot.shield,
      roomNo: this.roomNo, dust: this.stats.dust,
      battery: this.bot.battery, batteryMax: this.stats.batteryMax,
      bin: this.bot.bin, binMax: this.stats.binMax,
      progress: Math.min(1, this.collectedThisRoom / this.dustBudget),
    });
    // boost button cooldown visual
    const btn = document.getElementById('btn-boost');
    if (btn) btn.classList.toggle('cooling', this.bot.boostCd > 0);

    this.world.followCamera(this.bot.pos, dt);
  }

  roomCleared() {
    if (this.state !== 'room') return;
    this.state = 'cleared';
    Audio.sfx.clear();
    const bonus = BALANCE.room.shardBonus(this.roomNo);
    const shards = Math.round((this.stats.dust * BALANCE.shardPerDust + bonus) * this.stats.shardMult);
    this.stats.shardsEarned += shards;
    this.save.shards += shards;
    this.bot.lives = Math.min(this.stats.maxLives, this.bot.lives + 1);
    this.bot.refill(1.0);
    if (this.roomNo > this.save.bestRoom) this.save.bestRoom = this.roomNo;
    if (this.stats.dust > this.save.bestDust) this.save.bestDust = Math.round(this.stats.dust);
    this.save.offlineRate = this._computeOfflineRate();

    this._pendingRoom = this.roomNo + 1;
    this._showPick(shards);
  }

  _showPick(shards) {
    UI.showAll(SCREENS, 'screen-pick');
    UI.hide('hud'); UI.hide('joy');
    document.getElementById('pick-title').textContent = `ROOM ${this.roomNo} CLEARED  (+${shards} ✦)`;
    const picks = rollPicks(this.stats);
    UI.buildPicks(picks, this.stats, id => {
      Audio.sfx.upgrade();
      applyPick(this.stats, id);
      // heal on shield pick already handled in apply
      this.roomNo = this._pendingRoom;
      this.startRoom();
    });
  }

  endRun(won) {
    if (this.state === 'over') return;
    this.state = 'over';
    Audio.sfx.over();
    const gain = this.stats ? this.stats.shardsEarned : 0;
    this.save.runs++;
    this.save.shards += 0; // shards already banked per room
    if (this.roomNo > this.save.bestRoom) this.save.bestRoom = this.roomNo;
    if (this.stats && this.stats.dust > this.save.bestDust) this.save.bestDust = Math.round(this.stats.dust);
    this.save.lastSeen = Date.now();
    this.onSave && this.onSave();
    UI.hide('hud'); UI.hide('joy');
    UI.showAll(SCREENS, 'screen-over');
    UI.setOver({ won, roomNo: this.roomNo, dust: this.stats ? this.stats.dust : 0, bestRoom: this.save.bestRoom, shardsGained: gain });
  }

  toMenu() {
    this.state = 'menu';
    this.save.lastSeen = Date.now();
    this.onSave && this.onSave();
    UI.hide('hud'); UI.hide('joy');
    UI.showAll(SCREENS, 'screen-menu');
    UI.setMenu({ shards: this.save.shards, bestRoom: this.save.bestRoom, runs: this.save.runs, bestDust: this.save.bestDust, offline: this.save._offlineGain || 0 });
  }

  showHangar() {
    const buy = (id) => {
      const lvl = this.save.meta[id] || 0;
      const cost = require_meta_cost(id, lvl);
      if (this.save.shards >= cost) {
        this.save.shards -= cost;
        this.save.meta[id] = lvl + 1;
        Audio.sfx.buy();
        this.save.lastSeen = Date.now();
        this.onSave && this.onSave();
        UI.buildHangar(this.save, buy);
      }
    };
    UI.showAll(SCREENS, 'screen-hangar');
    UI.buildHangar(this.save, buy);
  }

  _computeOfflineRate() {
    const m = this.save.meta;
    return BALANCE.offline.basePerHour * (1 + BALANCE.offline.metaPerHour * ((m.meta_polish || 0) + (m.meta_suction || 0)));
  }
}

// helper to fetch meta cost without circular import issues
import { metaCost as require_meta_cost } from './upgrades.js';
