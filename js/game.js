// game.js — run state machine: menu -> run (endless) -> pick (level-up) -> over.
// Dirt pressure rises with elapsed time; death when global dirt hits the cap.
import { BALANCE, makeRunStats, rollPicks, applyPick, gainXp, xpNeed } from './upgrades.js';
import { Bot } from './bot.js';
import { DustSystem } from './dust.js';
import { Controls } from './controls.js';
import * as UI from './ui.js';
import * as Audio from './audio.js';

const SCREENS = ['screen-menu', 'screen-hangar', 'screen-over'];

export class Game {
  constructor(world, save) {
    this.world = world;
    this.save = save;
    this.controls = new Controls(world.canvas);
    this.dust = new DustSystem(world);
    this.state = 'menu';
    this.bot = null;
    this.stats = null;
    this.time = 0;
    this._warned = false;

    this.controls.onTap = (sx, sy) => {
      if (this.state !== 'run') return null;
      const p = world.screenToFloor(sx, sy);
      if (p) this._tapInput = p;
      return p;
    };
    this.controls.onJoyChange = () => { this._tapInput = null; };
  }

  newRun() {
    this.stats = makeRunStats(this.save.meta);
    this.time = 0;
    this._frac = 0;
    this._warned = false;
    this._fullWarned = false;
    this.dust.reset(BALANCE.dirt.start);
    if (this.bot) this.bot = null;
    this.bot = new Bot(this.world, this.stats);
    this.bot.onBoost = () => {
      Audio.sfx.boost();
      this.bot.boostCd = BALANCE.bot.boostCd * this.stats.boostCdMult;
      this.bot.boostCd = Math.max(BALANCE.bot.boostCdFloor, this.bot.boostCd);
    };
    this.state = 'run';
    UI.showAll(SCREENS, null);
    UI.show('hud');
    UI.show('joy');
  }

  // dirt pressure ramps with level (and a little with time)
  _spawnRate() {
    const r = Math.min(BALANCE.dirt.spawnMax,
      BALANCE.dirt.spawnBase +
      BALANCE.dirt.levelRamp * this.stats.level +
      BALANCE.dirt.spawnRamp * this.time);
    return r * this.stats.spawnMult;
  }

  update(dt) {
    if (this.state !== 'run' || !this.bot) return;
    this.time += dt;

    // input
    const j = this.controls.joy;
    const kv = this.controls.keyVector();
    let ix = 0, iy = 0;
    if (j.active) { ix = j.x; iy = -j.y; }
    else if (kv.active) { ix = kv.x; iy = kv.z; }
    const input = { x: ix, y: iy, boost: this.controls.boost || (kv.active && this.controls.keys[' ']), tap: this._tapInput };
    if (this._tapInput) {
      if (Math.hypot(this.bot.x - this._tapInput.x, this.bot.y - this._tapInput.y) < 0.8) this._tapInput = null;
    }

    this.bot.update(dt, input);
    this.dust.update(dt, this.bot, this.stats, {
      onSuck: () => Audio.sfx.suck(),
      onGold: () => Audio.sfx.gold(),
      onCollect: v => this._onCollect(v),
    });

    // continuous dirt spawn (regenerates)
    this.dust._spawnAcc += this._spawnRate() * dt;
    while (this.dust._spawnAcc >= 1) { this.dust._spawnAcc -= 1; this.dust.spawn(); }

    // passive shard trickle
    this._bankShards(BALANCE.shardPerSecond * this.stats.shardMult * dt);

    // dirt death check
    const frac = this.dust.count / this.stats.dirtCap;
    if (this.bot.full && !this._fullWarned) {
      this._fullWarned = true;
      UI.toast('Bin full — no vacuum! Drive to the dock', 'warn');
    } else if (!this.bot.full) {
      this._fullWarned = false;
    }
    if (frac >= 0.75 && !this._warned) { this._warned = true; Audio.sfx.hurt(); UI.toast('Dirt overload!', 'warn'); }
    if (frac < 0.6) this._warned = false;
    if (this.dust.count >= this.stats.dirtCap) { this.endRun(); return; }

    // dock: empty bin for XP
    const dock = BALANCE.dock;
    if (this.bot.bin > 0 &&
        Math.hypot(this.bot.x - dock.x, this.bot.y - dock.y) < dock.triggerR) {
      const v = this.bot.dumpBin();
      Audio.sfx.dump();
      gainXp(this.stats, v * dock.dumpXpPerMote);
      UI.toast(`Bin dumped — ${v} motes → XP`, 'good');
    }

    // HUD
    UI.setHud({
      dust: this.stats.dust,
      dirt: this.dust.count, dirtCap: this.stats.dirtCap, dirtFrac: Math.min(1, frac),
      level: this.stats.level, xp: this.stats.xp, xpNeed: xpNeed(this.stats),
      bin: this.bot.bin, binMax: this.stats.binMax,
      time: this.time,
    });
    const btn = document.getElementById('btn-boost');
    if (btn) btn.classList.toggle('cooling', this.bot.boostCd > 0);
  }

  _onCollect(val) {
    const leveled = gainXp(this.stats, val);
    this._bankShards(val * BALANCE.shardPerDust * this.stats.shardMult);
    if (leveled > 0) {
      Audio.sfx.clear();
      this._bankShards(BALANCE.shardPerLevel * leveled);
      this._showPick();
    }
  }

  _bankShards(n) {
    this._frac = (this._frac || 0) + n;
    const whole = Math.floor(this._frac);
    if (whole >= 1) {
      this._frac -= whole;
      this.stats.shardsEarned += whole;
      this.save.shards += whole;
    }
  }

  _showPick() {
    // non-blocking: run keeps running, panel sits top-right (never covers joystick)
    document.getElementById('pick-title').textContent = `LEVEL ${this.stats.level}`;
    const picks = rollPicks(this.stats);
    UI.buildPicks(picks, this.stats, id => {
      Audio.sfx.upgrade();
      applyPick(this.stats, id);
      UI.hide('pick-panel');
    });
    UI.show('pick-panel');
  }

  endRun() {
    if (this.state === 'over') return;
    this.state = 'over';
    Audio.sfx.over();
    this.save.runs++;
    this.save.lastSeen = Date.now();
    this.onSave && this.onSave();
    UI.hide('hud'); UI.hide('joy');
    UI.showAll(SCREENS, 'screen-over');
    UI.setOver({
      level: this.stats.level,
      dust: this.stats.dust,
      time: this.time,
      bestTime: Math.max(this.save.bestTime || 0, this.time),
      shardsGained: this.stats.shardsEarned,
    });
    if (this.time > (this.save.bestTime || 0)) this.save.bestTime = Math.floor(this.time);
    if (this.stats.shardsEarned > (this.save.bestShards || 0)) this.save.bestShards = this.stats.shardsEarned;
  }

  toMenu() {
    this.state = 'menu';
    this.save.lastSeen = Date.now();
    this.onSave && this.onSave();
    UI.hide('hud'); UI.hide('joy');
    UI.showAll(SCREENS, 'screen-menu');
    UI.setMenu({
      shards: this.save.shards,
      bestTime: this.save.bestTime || 0,
      runs: this.save.runs,
      bestShards: this.save.bestShards || 0,
      offline: this.save._offlineGain || 0,
    });
  }

  showHangar() {
    const buy = (id) => {
      const lvl = this.save.meta[id] || 0;
      const cost = metaCostLocal(id, lvl);
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

}

import { metaCost as metaCostLocal } from './upgrades.js';
