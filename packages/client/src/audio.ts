// Every sound in the game, played through Web Audio. There are no sound files yet, so each sound is built from
// noise and tones on the spot, as a grey-box placeholder with the right weight and timing. Art hook: give a sound a
// `file` in data/audio.json and that recording plays instead, at the same volume, in the same places.
// Sounds from the world come from where they happen, so you can hear which way a fight is.

export type SoundName =
  | "shot" | "impact" | "explosion" | "smash" | "hitMarker" | "hurt"
  | "dash" | "jets" | "step" | "grenadeThrow" | "countdown" | "go" | "pickup" | "swap";

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
  play(name: SoundName, at?: { x: number; y: number; z: number }, loudness = 1): void {
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
    const length = this.files.has(name) ? this.playFile(name, gain) : this.synth(name, gain);
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

  private synth(name: SoundName, into: AudioNode): number {
    switch (name) {
      case "shot": this.thump(into, 140, 55, 0.09, 0.6); return this.burst(into, 0.11, "bandpass", 1600, 1.2);
      case "impact": return this.burst(into, 0.06, "highpass", 2500, 0.8);
      case "explosion": this.thump(into, 70, 28, 0.9, 1); return this.burst(into, 1.1, "lowpass", 500, 1, 0.35);
      case "smash": this.burst(into, 0.3, "bandpass", 700, 1.6, 0.15); return this.thump(into, 160, 60, 0.18, 0.6);
      case "hitMarker": return this.tone(into, 1700, 0.05, "square", 0.25);
      case "hurt": return this.thump(into, 90, 40, 0.25, 1);
      case "dash": return this.sweep(into, 500, 2600, 0.25);
      case "step": return this.thump(into, 75, 35, 0.12, 0.9);
      case "grenadeThrow": return this.sweep(into, 1400, 600, 0.15);
      case "countdown": return this.tone(into, 660, 0.12, "sine", 0.6);
      case "go": return this.tone(into, 990, 0.35, "sine", 0.7);
      case "pickup": this.tone(into, 880, 0.06, "triangle", 0.5); return this.tone(into, 1320, 0.12, "triangle", 0.4);
      case "swap": this.thump(into, 300, 120, 0.08, 0.6); return this.burst(into, 0.12, "bandpass", 3000, 0.7);
      case "jets": return 0;
    }
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
