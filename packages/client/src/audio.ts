// Every sound in the game, played through Web Audio. There are no sound files yet, so each sound is built from
// noise and tones on the spot, as a grey-box placeholder with the right weight and timing. Art hook: give a sound a
// `file` in data/audio.json and that recording plays instead, at the same volume, in the same places.
// Sounds from the world come from where they happen, so you can hear which way a fight is.

export type SoundName =
  | "shot" | "impact" | "explosion" | "smash" | "hitMarker" | "hurt"
  | "dash" | "jets" | "step" | "grenadeThrow" | "countdown" | "go" | "pickup" | "swap" | "loot" | "repair"
  | "ram" | "pounce" | "slam";

export interface AudioConfig {
  master: number;
  maxVoices: number; // more than this many at once and the newest are skipped, so a big fight does not turn to mush
  hearingMeters: number;
  sounds: Record<SoundName, { volume: number; file: string | null }>;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private grit: Float32Array<ArrayBuffer> | null = null; // the distortion curve that roughens shots, roars and crunches
  private files = new Map<SoundName, AudioBuffer>();
  private voices = 0;
  private jets: { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  muted = false;

  constructor(private config: AudioConfig) {}

  // Browsers only allow sound after the player has clicked something, so this is called from the click that locks the mouse.
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    const compressor = ctx.createDynamicsCompressor();
    compressor.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = this.config.master;
    this.out.connect(compressor);
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
    const l = this.ctx?.listener;
    if (!l) return;
    l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
    l.forwardX.value = forwardX; l.forwardY.value = forwardY; l.forwardZ.value = forwardZ;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  }

  // Plays a sound. With a position it comes from that spot in the world, without one it plays in your head (UI sounds).
  // `pitch` scales a made-up sound's tones, so one footstep can be a heavy mech's stomp or a light one's step.
  play(name: SoundName, at?: { x: number; y: number; z: number }, loudness = 1, pitch = 1): void {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out || this.muted || this.voices >= this.config.maxVoices) return;
    const volume = this.config.sounds[name].volume * loudness;
    if (volume <= 0) return;

    let destination: AudioNode = out;
    if (at) {
      const panner = new PannerNode(ctx, {
        panningModel: "equalpower", distanceModel: "inverse", refDistance: 8, rolloffFactor: 1.2,
        maxDistance: this.config.hearingMeters, positionX: at.x, positionY: at.y, positionZ: at.z,
      });
      panner.connect(out);
      destination = panner;
    }
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(destination);

    this.voices++;
    const length = this.files.has(name) ? this.playFile(name, gain) : this.synth(name, gain, pitch);
    window.setTimeout(() => { this.voices--; gain.disconnect(); }, length * 1000 + 50);
  }

  // The jet thrusters hiss for as long as they are on, so they are one held sound rather than repeated ones.
  setJets(on: boolean): void {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out || !this.noise) return;
    if (!this.jets) {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 900, Q: 0.7 });
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(out);
      source.start();
      this.jets = { source, gain, filter };
    }
    const target = on ? this.config.sounds.jets.volume : 0;
    this.jets.gain.gain.setTargetAtTime(target, ctx.currentTime, on ? 0.03 : 0.08);
  }

  private playFile(name: SoundName, into: AudioNode): number {
    const source = this.ctx!.createBufferSource();
    source.buffer = this.files.get(name)!;
    source.connect(into);
    source.start();
    return source.buffer.duration;
  }

  // ---- the placeholder sounds
  // Each is a few layers: a click so the hit reads even on laptop speakers (which drop everything under ~150 Hz),
  // metal (clank), grit (crunch, roar) and a body (thump). Tuned by ear on headphones and laptop speakers, roughly.

  private synth(name: SoundName, into: AudioNode, p: number): number {
    switch (name) {
      case "shot": this.click(into, 0.7); this.thump(into, 240, 70, 0.1, 0.7); this.burst(into, 0.05, "highpass", 4200, 0.5); return this.crunch(into, 0.13, "bandpass", 1300, 1.1);
      case "impact": this.clank(into, 1150, 0.07, 0.35); return this.burst(into, 0.06, "highpass", 2800, 0.7);
      case "explosion": this.click(into, 1); this.burst(into, 0.18, "lowpass", 3000, 1.1); this.thump(into, 130, 28, 1.0, 1.2); return this.crunch(into, 1.2, "lowpass", 650, 1.4, 0.03);
      case "smash": this.clank(into, 330, 0.25, 0.5); this.thump(into, 170, 60, 0.2, 0.7); return this.crunch(into, 0.32, "bandpass", 750, 1.3, 0.01);
      case "hitMarker": return this.tone(into, 1700, 0.05, "square", 0.25);
      case "hurt": this.clank(into, 190, 0.3, 0.6); return this.thump(into, 150, 50, 0.25, 1);
      case "dash": this.thump(into, 90, 160, 0.2, 0.4); return this.sweep(into, 500, 2600, 0.25);
      // A foot coming down: a stamp of metal on ground, grit under it and a ring from the leg. Lower `p` is heavier.
      case "step": this.click(into, 0.45); this.thump(into, 230 * p, 75 * p, 0.15, 0.8); this.clank(into, 260 * p, 0.13, 0.5); return this.crunch(into, 0.1, "bandpass", 1000 * p, 0.9);
      case "grenadeThrow": return this.sweep(into, 1400, 600, 0.15);
      case "countdown": return this.tone(into, 660, 0.12, "sine", 0.6);
      case "go": return this.tone(into, 990, 0.35, "sine", 0.7);
      case "pickup": this.tone(into, 880, 0.06, "triangle", 0.5); return this.tone(into, 1320, 0.12, "triangle", 0.4);
      case "repair": this.clank(into, 620, 0.08, 0.3); return this.burst(into, 0.09, "bandpass", 3400, 3);
      case "loot": return this.burst(into, 0.07, "bandpass", 2200, 2.5);
      case "swap": this.clank(into, 480, 0.1, 0.35); return this.burst(into, 0.12, "bandpass", 3000, 0.7);
      // Plates locking forward, then an engine roaring up under the charge.
      case "ram": this.clank(into, 210, 0.2, 0.7); this.sweep(into, 300, 1600, 0.6); return this.roar(into, 85, 180, 0.7, 0.9);
      // A hydraulic kick: the hiss of a piston letting go, a clunk, and a rising whoosh.
      case "pounce": this.burst(into, 0.12, "highpass", 3200, 0.8); this.clank(into, 420, 0.12, 0.4); return this.sweep(into, 600, 2800, 0.35);
      // Landing hard: a crack, steel ringing, grit flying and a deep thud.
      case "slam": this.click(into, 1); this.clank(into, 160, 0.4, 0.6); this.thump(into, 190, 38, 0.5, 1.2); return this.crunch(into, 0.36, "lowpass", 1500, 1.3);
      case "jets": return 0;
    }
  }

  // A few milliseconds of bright noise: the attack that tells your ear something hit, even on tiny speakers.
  private click(into: AudioNode, level: number): number {
    return this.burst(into, 0.012, "highpass", 3000, level, 0.0005);
  }

  // Struck metal: a few out-of-tune partials (a bar or plate, not a bell) ringing down together.
  private clank(into: AudioNode, frequency: number, seconds: number, level: number): number {
    for (const [ratio, share] of [[1, 1], [2.32, 0.6], [4.25, 0.35], [6.63, 0.2]] as const) {
      this.tone(into, frequency * ratio, seconds / ratio ** 0.3, "triangle", level * share);
    }
    return seconds;
  }

  // Filtered noise driven through the grit curve: gunpowder crack, gravel, a crunching blast.
  private crunch(into: AudioNode, seconds: number, type: BiquadFilterType, frequency: number, level: number, attack = 0.002): number {
    const shaper = new WaveShaperNode(this.ctx!, { curve: this.grit! });
    const quiet = new GainNode(this.ctx!, { gain: 0.5 }); // the curve is loud; this keeps the layers in balance
    shaper.connect(quiet).connect(into);
    return this.burst(shaper, seconds, type, frequency, level, attack);
  }

  // An engine: a buzzing low tone sliding up, darkened and roughened.
  private roar(into: AudioNode, from: number, to: number, seconds: number, level: number): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = new OscillatorNode(ctx, { type: "sawtooth", frequency: from });
    osc.frequency.exponentialRampToValueAtTime(to, t + seconds * 0.7);
    const filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 1100, Q: 1 });
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

  // A burst of filtered noise that fades out, with an optional soft start. Shots, crunches, blasts.
  private burst(into: AudioNode, seconds: number, type: BiquadFilterType, frequency: number, level: number, attack = 0.002): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = new BiquadFilterNode(ctx, { type, frequency, Q: 0.9 });
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    source.connect(filter).connect(env).connect(into);
    source.start(t, Math.random() * 0.5, seconds + 0.05);
    return seconds;
  }

  // A falling low tone: the weight under a footstep, a blast, a hit.
  private thump(into: AudioNode, from: number, to: number, seconds: number, level: number): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = new OscillatorNode(ctx, { type: "sine", frequency: from });
    osc.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(env).connect(into);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
    return seconds;
  }

  private tone(into: AudioNode, frequency: number, seconds: number, type: OscillatorType, level: number): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = new OscillatorNode(ctx, { type, frequency });
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(env).connect(into);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
    return seconds;
  }

  // Noise swept through a moving filter: a whoosh.
  private sweep(into: AudioNode, from: number, to: number, seconds: number): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = new BiquadFilterNode(ctx, { type: "bandpass", frequency: from, Q: 2 });
    filter.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + seconds * 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    source.connect(filter).connect(env).connect(into);
    source.start(t, Math.random() * 0.5, seconds + 0.05);
    return seconds;
  }
}
