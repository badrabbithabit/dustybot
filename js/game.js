// game.js — run state machine. A run is a sequence of themed LEVELS
// (residential -> office -> store -> space, looping with a per-rotation ramp).
// Each level: procedurally generated room layout (seeded per run) + a FIXED
// set of themed dirt scattered at start (no regen); the dirt count scales
// with the level number. Clear a level by vacuuming every mote AND dumping
// it all at the dock, then pick 1 of 3 upgrades. NO failure mode.
import { BALANCE, makeRunStats, rollPicks, applyPick, levelDef, metaCost as metaCostLocal, hangarRate } from './upgrades.js';
import { HangarIdle } from './hangar.js';
import { Bot } from './bot.js';
import { DustSystem } from './dust.js';
import { Controls } from './controls.js';
import * as UI from './ui.js';
import * as Audio from './audio.js';

const SCREENS = ['screen-menu', 'screen-hangar', 'screen-select'];

export class Game {
  constructor(world, save) {
    this.world = world;
    this.save = save;
    this.controls = new Controls(world.canvas);
    this.dust = new DustSystem(world);
    this.state = 'menu';
    this.bot = null;
    this.stats = null;
    this.selectedBot = (save && save.bot) || 'roomba';
    this.level = 1;
    this.time = 0;            // total run time
    this._frac = 0;
    this._fullWarned = false;
    this._introTimer = 0;
    this._levelDirtTotal = 0;
    this._runSeed = 0;      // per-run layout seed (set in newRun)
    this._def = null;       // cached levelDef for the current level
    this._screen = 'menu';  // which menu screen is visible (hangar idle needs it)
    this.hangar = null;     // live HangarIdle sim while the hangar screen is open

    this.controls.onTap = (sx, sy) => {
      if (this.state !== 'run') return null;
      const p = world.screenToFloor(sx, sy);
      if (p) this._tapInput = p;
      return p;
    };
    this.controls.onJoyChange = () => { this._tapInput = null; };
  }

  showSelect() {
    this._screen = 'select';
    const onPick = (id) => {
      this.selectedBot = id;
      this.save.bot = id;
      this.save.lastSeen = Date.now();
      this.onSave && this.onSave();
      Audio.sfx.click();
      UI.buildBots(this.save, this.selectedBot, onPick);
    };
    UI.showAll(SCREENS, 'screen-select');
    UI.hide('hud'); UI.hide('joy');
    UI.hideLevelIntro();
    UI.buildBots(this.save, this.selectedBot, onPick);
  }

  newRun() {
    this._screen = 'run';
    this.hangar = null;   // a real run replaces the idle bay
    this.save.runs = (this.save.runs || 0) + 1;   // count runs actually started
    this.onSave && this.onSave();
    this.stats = makeRunStats(this.save.meta, this.selectedBot);
    this.time = 0;
    this.level = 1;
    this._frac = 0;
    this._fullWarned = false;
    this._runSeed = (Math.random() * 4294967296) >>> 0; // fresh layouts each run
    this._cleared = 0;   // dirt dumped from the bin this level (drives level clear)
    this.bot = new Bot(this.world, this.stats);
    this.bot.onBoost = () => {
      Audio.sfx.boost();
      this.bot.boostCd = BALANCE.bot.boostCd * this.stats.boostCdMult;
      this.bot.boostCd = Math.max(BALANCE.bot.boostCdFloor, this.bot.boostCd);
    };
    UI.showAll(SCREENS, null);
    UI.show('hud');
    UI.show('joy');
    this.loadLevel(1);
  }

  // Set up level `n`: theme + obstacles on the world, bot at a clear spawn,
  // then scatter the fixed themed dirt. Input is frozen during the intro banner.
  loadLevel(n) {
    this.level = n;
    const def = levelDef(n, this._runSeed);
    this._def = def;   // cache: HUD reads theme from this every frame
    this.world.setLevel(def.theme, def.obstacles, def.themeKey);

    // bot at a clear spot (every layout keeps the arena center free)
    this.bot.x = this.world.W / 2;
    this.bot.y = this.world.H / 2;
    this.bot.vx = 0; this.bot.vy = 0;
    this.bot.heading = -Math.PI / 2; // face up, toward the dock

    // scatter the level's fixed themed dirt (does not regenerate)
    this._levelDirtTotal = def.dirtCount;
    this._cleared = 0;   // reset the dumped-dirt counter for this level
    this.dust.spawnLevel(def.dirtCount, def.theme, this.stats, def);

    this.state = 'intro';
    this._introTimer = 1.6;
    UI.showLevelIntro(def, n);
  }

  update(dt) {
    // The hangar bay auto-vacuums while its screen is open (idle channel #2).
    if (this.hangar && this._screen === 'hangar') this._updateHangar(dt);
    if (this.state === 'intro') {
      this._introTimer -= dt;
      if (this._introTimer <= 0) {
        UI.hideLevelIntro();
        this.state = 'run';
      }
      return;
    }
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
      onCollect: (v) => this._onCollect(v),
    }, this.world);

    // Heavy-dust drag: motes in the suction field load the motor down.
    // motor (base bot + Tractor Motor + Drivetrain Kit) vs summed heavy mass.
    const motor = this.stats.motor;
    this.bot.speedMult = motor / (motor + BALANCE.drag.motorCost * (this.dust.dragMass || 0));
    this.bot.strain = 1 - this.bot.speedMult;
    this.world.updateWet(dt);

    // bin-full nudge (bin still caps suction; there is no dirt-death)
    if (this.bot.full && !this._fullWarned) {
      this._fullWarned = true;
      UI.toast('Bin full — no vacuum! Drive to the dock', 'warn');
    } else if (!this.bot.full) {
      this._fullWarned = false;
    }

    // dock: empty the bin. Dirt only counts as CLEARED once it leaves the bin
    // here, so the level ends when you've dumped everything you vacuumed —
    // not the moment it's sucked up (the bin still holds it).
    const dock = BALANCE.dock;
    if (this.bot.bin > 0 &&
        Math.hypot(this.bot.x - dock.x, this.bot.y - dock.y) < dock.triggerR) {
      const v = this.bot.dumpBin();
      this._cleared = Math.min(this._levelDirtTotal, this._cleared + v);
      Audio.sfx.dump();
      UI.toast(`Bin dumped — ${v} motes`, 'good');
    }

    // passive shard trickle
    this._bankShards(BALANCE.shardPerSecond * this.stats.shardMult * dt);

    // level clears once every mote of this level has been vacuumed AND dumped
    if (this._cleared >= this._levelDirtTotal) {
      this._levelClear();
      return;
    }

    // HUD
    UI.setHud({
      dust: this.stats.dust,
      dirt: this.dust.count, dirtTotal: this._levelDirtTotal,
      level: this.level, themeIcon: this._def.theme.icon,
      bin: this.bot.bin, binMax: this.stats.binMax,
      time: this.time,
    });
    const btn = document.getElementById('btn-boost');
    if (btn) btn.classList.toggle('cooling', this.bot.boostCd > 0);
    const drag = document.getElementById('drag-hud');
    if (drag) {
      if (this.bot.strain > 0.03) {
        drag.textContent = `🐗 HEAVY DUST ${Math.round(this.bot.strain * 100)}%`;
        drag.classList.remove('hidden');
      } else {
        drag.classList.add('hidden');
      }
    }
  }

  _onCollect(val) {
    this.stats.dust += val;   // count dust VALUE (gold = 2), not motes
    this._bankShards(val * BALANCE.shardPerDust * this.stats.shardMult);
  }

  _levelClear() {
    // lifetime best level gates bot unlocks (mop @5, hog @12, zippy @20)
    this.save.bestLevel = Math.max(this.save.bestLevel || 0, this.level);
    // fastest level-1 clear is the menu "best" time
    if (this.level === 1 && (!this.save.bestTime || this.time < this.save.bestTime)) {
      this.save.bestTime = this.time;
    }
    Audio.sfx.clear();
    UI.toast(`Level ${this.level} clear!`, 'good');
    this._bankShards(BALANCE.shardPerLevel + BALANCE.shardPerLevelPerLevel * (this.level - 1));
    this.onSave && this.onSave();   // persist best stats + banked shards
    this._showPick();
  }

  _bankShards(n) {
    this._frac = (this._frac || 0) + n;
    const whole = Math.floor(this._frac);
    if (whole >= 1) {
      this._frac -= whole;
      this.stats.shardsEarned += whole;
      this.save.shards += whole;
      if (this.stats.shardsEarned > (this.save.bestShards || 0)) this.save.bestShards = this.stats.shardsEarned;
    }
  }

  _showPick() {
    // show the 1-of-3 upgrade pick at the END of a cleared level
    this.state = 'pick';
    const picks = rollPicks(this.stats);
    if (!picks.length) {
      // every run upgrade is maxed — bank a bonus and keep rolling
      const bonus = 5 + this.level;
      this._bankShards(bonus);
      Audio.sfx.upgrade();
      UI.toast(`All upgrades maxed — +${bonus} ✦ bonus`, 'good');
      this.loadLevel(this.level + 1);
      return;
    }
    document.getElementById('pick-title').textContent = `LEVEL ${this.level} CLEAR`;
    UI.buildPicks(picks, this.stats, id => {
      Audio.sfx.upgrade();
      applyPick(this.stats, id);
      UI.hide('pick-panel');
      this.loadLevel(this.level + 1);
    });
    UI.show('pick-panel');
  }

  toMenu() {
    this.state = 'menu';
    this._screen = 'menu';
    // Persist hangar idle stats, then tear the sim down.
    if (this.hangar) {
      this.save.idle = this.save.idle || { motes: 0, ms: 0 };
      this.save.idle.motes += this.hangar.collected;
      this.save.idle.ms += this.hangar.time * 1000;
      this.hangar = null;
    }
    this.save.lastSeen = Date.now();
    this.onSave && this.onSave();
    UI.hide('hud'); UI.hide('joy');
    UI.hideLevelIntro();
    UI.showAll(SCREENS, 'screen-menu');
    const offline = this.save._offlineGain || 0;
    this.save._offlineGain = 0;   // toast once per session, not on every menu visit
    UI.setMenu({
      shards: this.save.shards,
      bestTime: this.save.bestTime || 0,
      runs: this.save.runs,
      bestShards: this.save.bestShards || 0,
      offline,
    });
  }

  showHangar() {
    this._screen = 'hangar';
    // Start (or resume) the little auto-bay sim. It's a pure visual; the
    // shard economy is the flat hangarRate(save), banked in _updateHangar.
    if (!this.hangar) this.hangar = new HangarIdle(this.save);
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
    UI.setHangarIdle(this._idleInfo());
  }

  _idleInfo() {
    return {
      motes: this.hangar ? this.hangar.collected : 0,
      time: this.hangar ? this.hangar.time : 0,
      rate: hangarRate(this.save),
      locked: hangarRate(this.save) <= 0,
    };
  }

  _updateHangar(dt) {
    this.hangar.update(dt);
    const rate = hangarRate(this.save);
    if (rate > 0) this._bankShards(rate * dt / 3600);
    UI.setHangarIdle(this._idleInfo());
  }
}
