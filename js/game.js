// game.js — run state machine. A run is a sequence of themed LEVELS
// (residential -> office -> store -> space, looping with a per-rotation ramp).
// Each level: fixed obstacles + a FIXED set of themed dirt scattered at start
// (no regen). Clear a level by vacuuming every mote. NO failure mode.
// XP from dumping the bin at the dock drives bot level-ups + upgrade picks.
import { BALANCE, makeRunStats, rollPicks, applyPick, gainXp, xpNeed, levelDef, metaCost as metaCostLocal } from './upgrades.js';
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
    this.level = 1;
    this.time = 0;            // total run time
    this._frac = 0;
    this._fullWarned = false;
    this._introTimer = 0;
    this._clearedTimer = 0;
    this._levelDirtTotal = 0;

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
    this.level = 1;
    this._frac = 0;
    this._fullWarned = false;
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
    const def = levelDef(n);
    this.world.setLevel(def.theme, def.obstacles, def.themeKey);

    // bot at a clear spot (every layout keeps the arena center free)
    this.bot.x = this.world.W / 2;
    this.bot.y = this.world.H / 2;
    this.bot.vx = 0; this.bot.vy = 0;
    this.bot.heading = -Math.PI / 2; // face up, toward the dock

    // scatter the level's fixed themed dirt (does not regenerate)
    this._levelDirtTotal = def.dirtCount;
    this.dust.spawnLevel(def.dirtCount, def.theme);

    this.state = 'intro';
    this._introTimer = 1.6;
    UI.showLevelIntro(def, n);
  }

  update(dt) {
    if (this.state === 'intro') {
      this._introTimer -= dt;
      if (this._introTimer <= 0) {
        UI.hideLevelIntro();
        this.state = 'run';
      }
      return;
    }
    if (this.state === 'cleared') {
      this._clearedTimer -= dt;
      if (this._clearedTimer <= 0) this.loadLevel(this.level + 1);
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
      onCollect: (v, it) => this._onCollect(v, it),
    });

    // bin-full nudge (bin still caps suction; there is no dirt-death)
    if (this.bot.full && !this._fullWarned) {
      this._fullWarned = true;
      UI.toast('Bin full — no vacuum! Drive to the dock', 'warn');
    } else if (!this.bot.full) {
      this._fullWarned = false;
    }

    // dock: empty bin for XP (may level the bot up -> upgrade pick)
    const dock = BALANCE.dock;
    if (this.bot.bin > 0 &&
        Math.hypot(this.bot.x - dock.x, this.bot.y - dock.y) < dock.triggerR) {
      const v = this.bot.dumpBin();
      Audio.sfx.dump();
      const leveled = gainXp(this.stats, this.bot._dumpXp * dock.dumpXpPerMote);
      this.bot._dumpXp = 0;
      UI.toast(`Bin dumped — ${v} motes`, 'good');
      if (leveled > 0) {
        Audio.sfx.clear();
        this._bankShards(BALANCE.shardPerLevel * leveled);
        this._showPick();
        return; // paused while picking
      }
    }

    // passive shard trickle
    this._bankShards(BALANCE.shardPerSecond * this.stats.shardMult * dt);

    // level clears when every mote is vacuumed up
    if (this.dust.count <= 0) { this._levelClear(); return; }

    // HUD
    UI.setHud({
      dust: this.stats.dust,
      dirt: this.dust.count, dirtTotal: this._levelDirtTotal,
      level: this.level, themeIcon: levelDef(this.level).theme.icon,
      botLevel: this.stats.level, xp: this.stats.xp, xpNeed: xpNeed(this.stats),
      bin: this.bot.bin, binMax: this.stats.binMax,
      time: this.time,
    });
    const btn = document.getElementById('btn-boost');
    if (btn) btn.classList.toggle('cooling', this.bot.boostCd > 0);
  }

  _onCollect(val, it) {
    this.stats.dust += 1;
    if (it) it._xp = val;
    this._bankShards(val * BALANCE.shardPerDust * this.stats.shardMult);
  }

  _levelClear() {
    Audio.sfx.clear();
    UI.toast(`Level ${this.level} clear!`, 'good');
    this._bankShards(BALANCE.shardPerLevel);
    this.state = 'cleared';
    this._clearedTimer = 1.1;
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
    // gameplay pauses while picking
    this.state = 'pick';
    document.getElementById('pick-title').textContent = `BOT LEVEL ${this.stats.level}`;
    const picks = rollPicks(this.stats);
    UI.buildPicks(picks, this.stats, id => {
      Audio.sfx.upgrade();
      applyPick(this.stats, id);
      UI.hide('pick-panel');
      this.state = 'run';
    });
    UI.show('pick-panel');
  }

  toMenu() {
    this.state = 'menu';
    this.save.lastSeen = Date.now();
    this.onSave && this.onSave();
    UI.hide('hud'); UI.hide('joy');
    UI.hideLevelIntro();
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
