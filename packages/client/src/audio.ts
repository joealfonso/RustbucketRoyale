// Every sound in the game, played through Web Audio. There are no sound files yet, so each sound is built from
// noise and tones on the spot, as a grey-box placeholder with the right weight and timing. Art hook: give a sound a
// `file` in data/audio.json and that recording plays instead, at the same volume, in the same places.
// Sounds from the world come from where they happen, so you can hear which way a fight is. They also sit in a space:
// a shared echo (a junkyard ringed with metal walls), and the further away a sound is the darker it gets and the more
// of it is echo, so a far fight booms instead of ticking.

export type SoundName =
  | "shot" | "shotScattergun" | "shotSpikeDriver" | "impact" | "explosion" | "smash" | "hitMarker" | "hurt"
  | "dash" | "jets" | "step" | "grenadeThrow" | "countdown" | "go" | "pickup" | "swap" | "loot" | "repair"
  | "ram" | "pounce" | "slam" | "mortar" | "shellIncoming" | "decoy" | "fizz" | "wade" | "splash" | "treeFall" | "treeLand"
  | "uiHover" | "uiClick" | "uiPick" | "uiWhoosh" | "railCharge" | "railShot";

export interface AudioConfig {
  master: number;
  maxVoices: number; // more than this many at once and the newest are skipped, so a big fight does not turn to mush
  hearingMeters: number;
  echo: { seconds: number; level: number }; // the shared space every world sound sits in
  // Distance darkens: highs above `nearHz` fall away by half every `halfMeters`, never below `farHz`; and the share
  // of echo grows up to `farEcho` times its near amount.
  air: { nearHz: number; halfMeters: number; farHz: number; farEcho: number };
  variation: { pitch: number; level: number }; // each play is this much higher or lower, louder or quieter, at random
  weaponShots: Record<string, SoundName>; // weapon id to its shot sound
  // `echo` is how much of the sound goes into the shared space, 0 to 1.
  sounds: Record<SoundName, { volume: number; echo?: number; file: string | null }>;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private echo: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private grit: Float32Array<ArrayBuffer> | null = null; // the distortion curve that roughens shots, roars and crunches
  private files = new Map<SoundName, AudioBuffer>();
  private voices = 0;
  private jets: { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private ears = { x: 0, y: 0, z: 0 };
  muted = false;

  constructor(private config: AudioConfig) {}

  // Browsers only allow sound after the player has clicked something, so this is called from the click that locks the mouse.
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    const compressor = new DynamicsCompressorNode(ctx, { threshold: -14, knee: 12, ratio: 4, attack: 0.004, release: 0.25 });
    compressor.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = this.config.master;
    this.out.connect(compressor);
    // The shared space: a made-up impulse of a yard ringed with sheet metal, a few hard early slaps and a dark tail.
    this.echo = new ConvolverNode(ctx, { buffer: yardImpulse(ctx, this.config.echo.seconds) });
    this.echo.connect(new GainNode(ctx, { gain: this.config.echo.level })).connect(this.out);
    // One second of white noise, reused by every noisy sound.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // A soft-clipping curve: driven hard, a clean tone or noise comes out with the grit of metal and engines.
    this.grit = new Float32Array(1024);
    for (let i = 0; i < this.grit.length; i++) { const x = (i / (this.grit.length - 1)) * 2 - 1; this.grit[i] = Math.tanh(x * 4); }
    this.ctx = ctx;
    for (const [name, s] of Object.entries(this.config.sounds) as [SoundName, { file: string | null }][]) {
      if (s.file) void fetch(s.file).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((buffer) => this.files.set(name, buffer)).catch(() => {});
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.out) this.out.gain.value = this.muted ? 0 : this.config.master;
    return this.muted;
  }

  // Where the ears are: the camera, and which way it faces.
  setListener(x: number, y: number, z: number, forwardX: number, forwardY: number, forwardZ: number): void {
    this.ears.x = x; this.ears.y = y; this.ears.z = z;
    const l = this.ctx?.listener;
    if (!l) return;
    l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
    l.forwardX.value = forwardX; l.forwardY.value = forwardY; l.forwardZ.value = forwardZ;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  }

  // The shot sound for a weapon, by its id in data/weapons.json.
  shotFor(weaponId: string | undefined): SoundName {
    return (weaponId && this.config.weaponShots[weaponId]) || "shot";
  }

  // Plays a sound. With a position it comes from that spot in the world, without one it plays in your head (UI sounds).
  // `pitch` scales a made-up sound's tones, so one footstep can be a heavy mech's stomp or a light one's step.
  play(name: SoundName, at?: { x: number; y: number; z: number }, loudness = 1, pitch = 1): void {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out || this.muted || this.voices >= this.config.maxVoices) return;
    const settings = this.config.sounds[name];
    const { variation, air } = this.config;
    const volume = settings.volume * loudness * (1 + (Math.random() * 2 - 1) * variation.level);
    if (volume <= 0) return;
    const p = pitch * (1 + (Math.random() * 2 - 1) * variation.pitch);

    const gain = new GainNode(ctx, { gain: volume });
    if (at) {
      const distance = Math.hypot(at.x - this.ears.x, at.y - this.ears.y, at.z - this.ears.z);
      const panner = new PannerNode(ctx, {
        panningModel: "equalpower", distanceModel: "inverse", refDistance: 8, rolloffFactor: 1.2,
        maxDistance: this.config.hearingMeters, positionX: at.x, positionY: at.y, positionZ: at.z,
      });
      const darker = new BiquadFilterNode(ctx, { type: "lowpass", Q: 0.5, frequency: Math.max(air.farHz, air.nearHz * 0.5 ** (distance / air.halfMeters)) });
      gain.connect(darker).connect(panner).connect(out);
      // The echo is not panned or faded with distance as much as the sound itself: far away, it is most of what you hear.
      const send = (settings.echo ?? 0) * (1 + (air.farEcho - 1) * Math.min(1, distance / this.config.hearingMeters));
      if (send > 0 && this.echo) darker.connect(new GainNode(ctx, { gain: send * Math.min(1, 24 / Math.max(8, distance)) ** 0.5 })).connect(this.echo);
    } else {
      gain.connect(out);
      if ((settings.echo ?? 0) > 0 && this.echo) gain.connect(new GainNode(ctx, { gain: settings.echo })).connect(this.echo);
    }

    this.voices++;
    const length = this.files.has(name) ? this.playFile(name, gain, p) : this.synth(name, gain, p);
    window.setTimeout(() => { this.voices--; gain.disconnect(); }, length * 1000 + 100);
  }

  // The jet thrusters roar for as long as they are on, so they are one held sound rather than repeated ones.
  setJets(on: boolean): void {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out || !this.noise) return;
    if (!this.jets) {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      // Mostly low roar with a little hiss on top, rather than a thin hiss alone.
      const filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 1100, Q: 0.8 });
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(out);
      source.start();
      this.jets = { source, gain, filter };
    }
    const target = on ? this.config.sounds.jets.volume : 0;
    this.jets.gain.gain.setTargetAtTime(target, ctx.currentTime, on ? 0.03 : 0.08);
  }

  private playFile(name: SoundName, into: AudioNode, pitch: number): number {
    const source = this.ctx!.createBufferSource();
    source.buffer = this.files.get(name)!;
    source.playbackRate.value = pitch;
    source.connect(into);
    source.start();
    return source.buffer.duration / pitch;
  }

  // ---- the placeholder sounds
  // Each is a few layers: a body (a falling low tone, felt more than heard, plus an octave up so laptop speakers,
  // which drop everything under ~150 Hz, still carry the weight), a texture (crack, crunch, metal) and sometimes a
  // tail. `p` is the pitch for this play, already varied. `d` on a helper delays that layer, in seconds.

  private synth(name: SoundName, into: AudioNode, p: number): number {
    const r = Math.random;
    switch (name) {
      // Autocannon: a hard crack, a chest thump, the bolt cycling, then the shot rolling away.
      case "shot":
        this.burst(into, 0.015, "highpass", 2600, 0.6, 0.0005);
        this.crunch(into, 0.09, "bandpass", 1700 * p, 1.2);
        this.body(into, 150 * p, 46 * p, 0.24, 1);
        this.body(into, 300 * p, 140 * p, 0.1, 0.45);
        this.clank(into, 760 * p, 0.05, 0.12, 0.03);
        return this.burst(into, 0.4, "lowpass", 800 * p, 0.3, 0.01);
      // Scattergun: a wide, dark blast, a deep punch, and the pump racking a moment later.
      case "shotScattergun":
        this.burst(into, 0.02, "highpass", 2200, 0.6, 0.0005);
        this.crunch(into, 0.2, "lowpass", 3200 * p, 1.4, 0.001);
        this.body(into, 120 * p, 36 * p, 0.34, 1.1);
        this.body(into, 250 * p, 110 * p, 0.14, 0.6);
        this.burst(into, 0.6, "lowpass", 600 * p, 0.45, 0.02);
        this.clank(into, 520 * p, 0.06, 0.18, 0.32);
        return this.clank(into, 410 * p, 0.07, 0.16, 0.42);
      // Spike driver: rails charging and letting go, a heavy thunk, and the spike ringing as it flies.
      case "shotSpikeDriver":
        this.glide(into, 3200 * p, 420 * p, 0.12, "sawtooth", 0.12);
        this.body(into, 210 * p, 55 * p, 0.2, 1.1);
        this.burst(into, 0.025, "highpass", 3500, 0.7, 0.0005);
        this.clank(into, 1350 * p, 0.45, 0.16);
        return this.burst(into, 0.35, "lowpass", 900 * p, 0.25, 0.01);
      // A round landing: a dull thud into whatever it hit, a short metal ping, and grit pattering off it.
      case "impact":
        this.body(into, 180 * p, 70 * p, 0.09, 0.7);
        this.crunch(into, 0.06, "bandpass", (1600 + r() * 900) * p, 0.9);
        this.clank(into, (1100 + r() * 700) * p, 0.12, 0.22, 0.004);
        return this.burst(into, 0.18, "lowpass", 2400 * p, 0.25, 0.02);
      // A blast: a crack, a long low punch, and a rumble that rolls on and on.
      case "explosion":
        this.burst(into, 0.02, "highpass", 2000, 0.8, 0.0005);
        this.crunch(into, 0.25, "lowpass", 2600, 1.1);
        this.body(into, 95 * p, 26 * p, 1.1, 1.4);
        this.burst(into, 2.2, "lowpass", 380 * p, 0.9, 0.03);
        return this.crunch(into, 1.3, "lowpass", 700 * p, 1, 0.04);
      case "smash": this.clank(into, (280 + r() * 120) * p, 0.3, 0.45); this.body(into, 160 * p, 50 * p, 0.25, 0.8); this.crunch(into, 0.35, "bandpass", 700 * p, 1.1, 0.01); return this.burst(into, 0.6, "lowpass", 500, 0.3, 0.05);
      case "hitMarker": this.tone(into, 1500, 0.05, "triangle", 0.3); return this.tone(into, 2250, 0.04, "sine", 0.15);
      case "hurt": this.clank(into, 170 * p, 0.35, 0.5); this.body(into, 130 * p, 40 * p, 0.3, 1.1); return this.crunch(into, 0.12, "lowpass", 1200, 0.6);
      case "dash": this.body(into, 70 * p, 120 * p, 0.25, 0.5); return this.sweep(into, 350 * p, 1800 * p, 0.3, 0.8);
      // A foot coming down: soft and deep, felt more than heard, so it never sounds like a shot. Grit under the
      // sole, and now and then the servos hissing or the leg's metal creaking. Lower `p` is heavier.
      case "step":
        this.body(into, 92 * p, 40 * p, 0.24, 0.8, 0.006);
        this.body(into, 210 * p, 110 * p, 0.12, 0.55, 0.006);
        this.burst(into, 0.16, "lowpass", (800 + r() * 400) * p, 0.6, 0.008);
        if (r() < 0.35) this.burst(into, 0.18, "bandpass", (2000 + r() * 900) * p, 0.06, 0.05, 0.04);
        if (r() < 0.25) this.clank(into, (120 + r() * 50) * p, 0.3, 0.07, 0.05);
        return 0.35;
      // A foot coming down in shallow water: a soft deep thump under a dark slosh, and now and then a low bubble.
      // Kept low and dull, like the dry step, so wading sounds heavy rather than tinny.
      case "wade":
        this.body(into, 74 * p, 38 * p, 0.22, 0.5, 0.012);
        this.sweep(into, 820 * p, 260 * p, 0.34, 0.7);
        this.burst(into, 0.4, "lowpass", 620 * p, 0.3, 0.03);
        if (r() < 0.4) this.glide(into, (230 + r() * 60) * p, (400 + r() * 80) * p, 0.06, "sine", 0.08, 0.12 + r() * 0.08);
        return 0.45;
      // Something big hitting the water: a deep whump, the slap of the water, the slosh falling back and the spray
      // raining down. A shot plays it quieter and higher (`p`), as a plip.
      case "splash":
        this.body(into, 88 * p, 30 * p, 0.4, 1, 0.004);
        this.burst(into, 0.25, "lowpass", 1800 * p, 0.75, 0.004);
        this.sweep(into, 1200 * p, 300 * p, 0.6, 0.8);
        this.burst(into, 0.9, "lowpass", 700 * p, 0.35, 0.06, 0.1);
        this.glide(into, 260 * p, 470 * p, 0.07, "sine", 0.1, 0.25);
        return this.glide(into, 310 * p, 520 * p, 0.06, "sine", 0.07, 0.4) + 0.5;
      // A tree giving way: the trunk cracking, then a long low groan as it leans, with a splinter snapping now and
      // then. The crash is "treeLand", played where it comes down. All low, so it sounds big rather than squeaky.
      case "treeFall":
        this.crunch(into, 0.12, "bandpass", 900 * p, 1.1, 0.001);
        this.body(into, 130 * p, 60 * p, 0.2, 0.7);
        this.creak(into, 120 * p, 78 * p, 1.3, 0.5, 0.08);
        this.crunch(into, 0.08, "bandpass", 1300 * p, 0.6, 0.002, 0.5);
        return this.crunch(into, 0.1, "bandpass", 700 * p, 0.7, 0.002, 1.05) + 0.1;
      // A tree hitting the ground: a deep whump you feel, branches crunching, needles hissing and a rolling rumble.
      case "treeLand":
        this.body(into, 78 * p, 26 * p, 0.85, 1.4, 0.004);
        this.body(into, 170 * p, 70 * p, 0.3, 0.6, 0.004);
        this.crunch(into, 0.45, "lowpass", 1500 * p, 1.1, 0.004);
        this.burst(into, 0.7, "bandpass", 2400 * p, 0.18, 0.02, 0.05);
        return this.burst(into, 1.4, "lowpass", 320 * p, 0.8, 0.03);
      case "grenadeThrow": this.clank(into, 640, 0.05, 0.15); return this.sweep(into, 1300, 500, 0.2, 0.6);
      case "countdown": return this.tone(into, 660, 0.14, "sine", 0.6);
      case "go": this.tone(into, 990, 0.4, "sine", 0.6); return this.tone(into, 495, 0.4, "triangle", 0.3);
      case "pickup": this.tone(into, 880, 0.06, "triangle", 0.5); return this.tone(into, 1320, 0.12, "triangle", 0.4, 0.05) + 0.05;
      case "repair": this.clank(into, (560 + r() * 140) * p, 0.1, 0.25); return this.burst(into, 0.1, "bandpass", 3000, 1.5);
      case "loot": this.clank(into, (700 + r() * 300) * p, 0.06, 0.12); return this.burst(into, 0.08, "bandpass", 1800, 1.4);
      case "swap": this.clank(into, 430, 0.1, 0.3); this.body(into, 200, 90, 0.08, 0.3); return this.burst(into, 0.12, "bandpass", 2400, 0.5);
      // Plates locking forward, then an engine roaring up under the charge.
      case "ram": this.clank(into, 190 * p, 0.25, 0.6); this.sweep(into, 260, 1300, 0.6, 0.8); this.body(into, 60, 110, 0.6, 0.6); return this.roar(into, 70, 160, 0.7, 0.9);
      // A hydraulic kick: the hiss of a piston letting go, a clunk, and a rising whoosh.
      case "pounce": this.burst(into, 0.15, "bandpass", 2600, 0.5, 0.01); this.clank(into, 380 * p, 0.12, 0.35); this.body(into, 120, 60, 0.18, 0.7); return this.sweep(into, 500, 2200, 0.4, 0.8);
      // Landing hard: a crack, steel ringing, grit flying and a deep thud that rolls.
      case "slam": this.burst(into, 0.015, "highpass", 2200, 0.7, 0.0005); this.clank(into, 150 * p, 0.45, 0.5); this.body(into, 140 * p, 32 * p, 0.6, 1.4); this.crunch(into, 0.4, "lowpass", 1300, 1.1); return this.burst(into, 1.2, "lowpass", 400, 0.6, 0.03);
      // A mortar tube going off: the crack of the charge, the tube ringing, a hollow thoonk and a cough of grit.
      // Rail Shot charging: capacitors whining up through the whole charge, so the target hears it coming.
      case "railCharge": this.glide(into, 220 * p, 1900 * p, 1.2, "sawtooth", 0.18, 0, true); return this.glide(into, 440 * p, 3800 * p, 1.2, "sine", 0.1, 0, true);
      // The rail letting go: a hard crack, a deep thump, and a bright zap that rings off down the line.
      case "railShot":
        this.burst(into, 0.012, "highpass", 3200, 0.9, 0.0004);
        this.body(into, 170 * p, 40 * p, 0.35, 1.3);
        this.glide(into, 5200 * p, 900 * p, 0.25, "square", 0.12);
        return this.burst(into, 0.9, "lowpass", 700 * p, 0.4, 0.01);
      case "mortar": this.burst(into, 0.015, "highpass", 2200, 0.8, 0.0005); this.clank(into, 230 * p, 0.45, 0.5); this.body(into, 240 * p, 50 * p, 0.5, 1.3); return this.crunch(into, 0.5, "lowpass", 1200, 1.1, 0.004);
      // A shell coming down: a whistle falling in pitch and swelling as it nears, over the rush of air.
      case "shellIncoming": this.sweep(into, 2600, 900, 0.6, 0.6); return this.glide(into, 1700, 650, 0.6, "sine", 0.45, 0, true);
      // Decoys projected out: a soft, slightly out-of-tune shimmer rising, with a breath of air.
      case "decoy": this.glide(into, 700, 1400, 0.45, "triangle", 0.22, 0, true); this.glide(into, 712, 1428, 0.45, "triangle", 0.18, 0, true); return this.sweep(into, 1500, 4000, 0.4, 0.5);
      // A decoy bursting: an electric crackle and a blip dropping away.
      case "fizz": this.crunch(into, 0.22, "highpass", 3000, 0.7); this.burst(into, 0.08, "bandpass", 4500, 1.2); return this.glide(into, 1600, 260, 0.22, "square", 0.12);
      // Menus and HUD: short and quiet, metal switches rather than app chimes, so they belong to the same machines.
      // Hovering: the faintest tick of a contact closing.
      case "uiHover": return this.tone(into, 2600 * p, 0.025, "triangle", 0.25);
      // A press: a chunky toggle switch, a sharp clack with a little weight behind it.
      case "uiClick":
        this.burst(into, 0.012, "highpass", 3200, 0.5, 0.0005);
        this.body(into, 240 * p, 120 * p, 0.05, 0.35);
        return this.clank(into, 980 * p, 0.05, 0.12);
      // Picking a mech: a latch dropping home, then a short blip that says it took.
      case "uiPick":
        this.clank(into, 520 * p, 0.09, 0.22);
        this.body(into, 170 * p, 80 * p, 0.1, 0.55);
        return this.tone(into, 1320 * p, 0.09, "triangle", 0.22, 0.05);
      // Something sliding in: a short rising breath of air.
      case "uiWhoosh": return this.sweep(into, 380 * p, 2200 * p, 0.22, 0.6);
      case "jets": return 0;
    }
  }

  // Struck metal: a few out-of-tune partials (a bar or plate, not a bell) ringing down together.
  private clank(into: AudioNode, frequency: number, seconds: number, level: number, d = 0): number {
    for (const [ratio, share] of [[1, 1], [2.32, 0.6], [4.25, 0.35], [6.63, 0.2]] as const) {
      this.tone(into, frequency * ratio, seconds / ratio ** 0.3, "triangle", level * share, d);
    }
    return seconds + d;
  }

  // Filtered noise driven through the grit curve: gunpowder crack, gravel, a crunching blast.
  private crunch(into: AudioNode, seconds: number, type: BiquadFilterType, frequency: number, level: number, attack = 0.002, d = 0): number {
    const shaper = new WaveShaperNode(this.ctx!, { curve: this.grit! });
    const quiet = new GainNode(this.ctx!, { gain: 0.5 }); // the curve is loud; this keeps the layers in balance
    shaper.connect(quiet).connect(into);
    return this.burst(shaper, seconds, type, frequency, level, attack, d);
  }

  // Wood under strain: a buzzing low tone sliding down, stuttering (a fast wobble in its loudness, the grain
  // catching and slipping), roughened and kept in the low mids.
  private creak(into: AudioNode, from: number, to: number, seconds: number, level: number, d = 0): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime + d;
    const osc = new OscillatorNode(ctx, { type: "sawtooth", frequency: from });
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const filter = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 420, Q: 2.5 });
    const shaper = new WaveShaperNode(ctx, { curve: this.grit! });
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + seconds * 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    const stutter = new GainNode(ctx, { gain: 0.6 });
    const wobble = new OscillatorNode(ctx, { type: "square", frequency: 13 });
    const depth = new GainNode(ctx, { gain: 0.4 });
    wobble.connect(depth).connect(stutter.gain);
    osc.connect(filter).connect(shaper).connect(stutter).connect(env).connect(into);
    for (const o of [osc, wobble]) { o.start(t); o.stop(t + seconds + 0.02); }
    return seconds + d;
  }

  // An engine: a buzzing low tone sliding up, darkened and roughened.
  private roar(into: AudioNode, from: number, to: number, seconds: number, level: number): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = new OscillatorNode(ctx, { type: "sawtooth", frequency: from });
    osc.frequency.exponentialRampToValueAtTime(to, t + seconds * 0.7);
    const filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 900, Q: 1 });
    const shaper = new WaveShaperNode(ctx, { curve: this.grit! });
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level * 0.5, t + 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(filter).connect(shaper).connect(env).connect(into);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
    return seconds;
  }

  // A burst of filtered noise that fades out, with an optional soft start. Cracks, grit, rumbles, hisses.
  private burst(into: AudioNode, seconds: number, type: BiquadFilterType, frequency: number, level: number, attack = 0.002, d = 0): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime + d;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = seconds > 0.9; // the noise buffer is a second long
    const filter = new BiquadFilterNode(ctx, { type, frequency, Q: 0.9 });
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    source.connect(filter).connect(env).connect(into);
    source.start(t, Math.random() * 0.5);
    source.stop(t + seconds + 0.05);
    return seconds + d;
  }

  // The weight of a sound: a sine falling from one pitch to another, with a short soft start so it thuds, not clicks.
  private body(into: AudioNode, from: number, to: number, seconds: number, level: number, attack = 0.002): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = new OscillatorNode(ctx, { type: "sine", frequency: from });
    osc.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(env).connect(into);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
    return seconds;
  }

  private tone(into: AudioNode, frequency: number, seconds: number, type: OscillatorType, level: number, d = 0): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime + d;
    const osc = new OscillatorNode(ctx, { type, frequency });
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(env).connect(into);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
    return seconds + d;
  }

  // A tone sliding from one pitch to another: a whistle or a blip. With `swell` it grows to full then cuts off at the
  // end, like something arriving; otherwise it starts full and dies away.
  private glide(into: AudioNode, from: number, to: number, seconds: number, type: OscillatorType, level: number, d = 0, swell = false): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime + d;
    const osc = new OscillatorNode(ctx, { type, frequency: from });
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    if (swell) {
      env.gain.exponentialRampToValueAtTime(level, t + seconds * 0.9);
    } else {
      env.gain.exponentialRampToValueAtTime(level, t + 0.003);
    }
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(env).connect(into);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
    return seconds + d;
  }

  // Noise swept through a moving filter: a whoosh.
  private sweep(into: AudioNode, from: number, to: number, seconds: number, level = 1): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = new BiquadFilterNode(ctx, { type: "bandpass", frequency: from, Q: 2 });
    filter.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + seconds * 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    source.connect(filter).connect(env).connect(into);
    source.start(t, Math.random() * 0.5, seconds + 0.05);
    return seconds;
  }
}

// A made-up impulse response for an open yard ringed with sheet metal and stacked junk: a few hard early slaps off
// nearby walls in the first tenth of a second, then a tail that darkens as it fades. Stereo, each side its own noise,
// so the echo is wide. Built once at start.
export function yardImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      // The tail darkens with time: each sample leans more on the one before as it fades.
      const lean = Math.min(0.92, 0.35 + t * 0.9);
      smooth = smooth * lean + (Math.random() * 2 - 1) * (1 - lean);
      data[i] = smooth * Math.exp(-t * (6 / seconds)) * 2.2;
    }
    // Kept faint: loud early slaps made everything sound like the inside of a tin can (Joseph's playtest).
    for (const [at, level] of [[0.011, 0.2], [0.027, 0.12], [0.041, 0.12], [0.067, 0.08], [0.093, 0.06]] as const) {
      const i = Math.floor((at + channel * 0.004) * rate);
      if (i < length) data[i] = (data[i] ?? 0) + (channel === 0 ? level : -level);
    }
  }
  return buffer;
}
