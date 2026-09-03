import { encodeWav } from "./wavEncoder";

export interface StemInput {
  name: string;
  url: string;
}

interface Channel {
  name: string;
  buffer: AudioBuffer;
  gainNode: GainNode;
  analyser: AnalyserNode;
  source: AudioBufferSourceNode | null;
  volume: number; // 0..1.2, user-facing fader value
  muted: boolean;
  solo: boolean;
}

const METER_SAMPLE_SIZE = 512;

/**
 * Plays several audio stems in perfect sync using the Web Audio API
 * (rather than juggling multiple <audio> elements, which drift). Every
 * stem gets its own gain node (volume/mute/solo) and analyser node
 * (live level metering). Because AudioBufferSourceNodes are one-shot,
 * play()/seek() recreate them under the hood — from the outside it
 * behaves like a normal transport.
 */
export class MultiStemPlayer {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private channels = new Map<string, Channel>();
  private startCtxTime = 0;
  private pausedAt = 0;
  private playing = false;
  private meterBuffer = new Uint8Array(METER_SAMPLE_SIZE);
  private onEndedCallback: (() => void) | null = null;

  duration = 0;

  constructor() {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
  }

  get isPlaying() {
    return this.playing;
  }

  get stemNames() {
    return Array.from(this.channels.keys());
  }

  onEnded(cb: (() => void) | null) {
    this.onEndedCallback = cb;
  }

  async loadStems(stems: StemInput[]): Promise<void> {
    const loaded = await Promise.all(
      stems.map(async (stem) => {
        const res = await fetch(stem.url);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(arrayBuffer);
        return { stem, buffer };
      })
    );

    for (const { stem, buffer } of loaded) {
      const gainNode = this.ctx.createGain();
      gainNode.gain.value = 1;
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = METER_SAMPLE_SIZE * 2;
      gainNode.connect(analyser);
      analyser.connect(this.masterGain);

      this.channels.set(stem.name, {
        name: stem.name,
        buffer,
        gainNode,
        analyser,
        source: null,
        volume: 1,
        muted: false,
        solo: false,
      });
      this.duration = Math.max(this.duration, buffer.duration);
    }
  }

  setMasterVolume(value: number) {
    this.masterGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
  }

  private anySolo(): boolean {
    for (const ch of this.channels.values()) if (ch.solo) return true;
    return false;
  }

  private applyGain(channel: Channel) {
    const soloActive = this.anySolo();
    const effective = channel.muted ? 0 : soloActive && !channel.solo ? 0 : channel.volume;
    channel.gainNode.gain.setTargetAtTime(effective, this.ctx.currentTime, 0.015);
  }

  setVolume(name: string, value: number) {
    const ch = this.channels.get(name);
    if (!ch) return;
    ch.volume = value;
    this.applyGain(ch);
  }

  toggleMute(name: string) {
    const ch = this.channels.get(name);
    if (!ch) return;
    ch.muted = !ch.muted;
    this.applyGain(ch);
  }

  toggleSolo(name: string) {
    const ch = this.channels.get(name);
    if (!ch) return;
    ch.solo = !ch.solo;
    for (const other of this.channels.values()) this.applyGain(other);
  }

  getBuffer(name: string): AudioBuffer | null {
    return this.channels.get(name)?.buffer ?? null;
  }

  getChannelState(name: string) {
    const ch = this.channels.get(name);
    if (!ch) return null;
    return { volume: ch.volume, muted: ch.muted, solo: ch.solo };
  }

  private startSourcesAt(offset: number) {
    for (const ch of this.channels.values()) {
      const source = this.ctx.createBufferSource();
      source.buffer = ch.buffer;
      source.connect(ch.gainNode);
      const startOffset = Math.min(offset, ch.buffer.duration);
      source.start(0, startOffset);
      ch.source = source;
    }
    // Use the longest-running channel to detect natural end-of-track.
    let longest: Channel | null = null;
    for (const ch of this.channels.values()) {
      if (!longest || ch.buffer.duration > longest.buffer.duration) longest = ch;
    }
    if (longest?.source) {
      longest.source.onended = () => {
        if (this.playing) {
          this.playing = false;
          this.pausedAt = 0;
          this.onEndedCallback?.();
        }
      };
    }
  }

  private stopSources() {
    for (const ch of this.channels.values()) {
      if (ch.source) {
        ch.source.onended = null;
        try {
          ch.source.stop();
        } catch {
          // already stopped
        }
        ch.source.disconnect();
        ch.source = null;
      }
    }
  }

  async play() {
    if (this.playing) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.pausedAt >= this.duration) this.pausedAt = 0;
    this.startSourcesAt(this.pausedAt);
    this.startCtxTime = this.ctx.currentTime - this.pausedAt;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.getCurrentTime();
    this.stopSources();
    this.playing = false;
  }

  seek(time: number) {
    const clamped = Math.max(0, Math.min(time, this.duration));
    this.pausedAt = clamped;
    if (this.playing) {
      this.stopSources();
      this.startSourcesAt(clamped);
      this.startCtxTime = this.ctx.currentTime - clamped;
    }
  }

  getCurrentTime(): number {
    if (!this.playing) return this.pausedAt;
    return Math.min(this.ctx.currentTime - this.startCtxTime, this.duration);
  }

  /** RMS level in the 0..1 range, suitable for driving a meter bar. */
  getMeterLevel(name: string): number {
    const ch = this.channels.get(name);
    if (!ch) return 0;
    ch.analyser.getByteTimeDomainData(this.meterBuffer);
    let sumSquares = 0;
    for (let i = 0; i < this.meterBuffer.length; i++) {
      const normalized = (this.meterBuffer[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / this.meterBuffer.length);
  }

  /**
   * Renders the current mix (respecting volume/mute/solo) offline and
   * returns a downloadable WAV — a full custom stem mix, exported
   * entirely in the browser with no server round trip.
   */
  async exportMix(): Promise<Blob> {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.ceil(this.duration * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, length, sampleRate);
    const soloActive = this.anySolo();

    for (const ch of this.channels.values()) {
      const effective = ch.muted ? 0 : soloActive && !ch.solo ? 0 : ch.volume;
      if (effective <= 0) continue;
      const source = offlineCtx.createBufferSource();
      source.buffer = ch.buffer;
      const gain = offlineCtx.createGain();
      gain.gain.value = effective;
      source.connect(gain);
      gain.connect(offlineCtx.destination);
      source.start(0);
    }

    const rendered = await offlineCtx.startRendering();
    return encodeWav(rendered);
  }

  destroy() {
    this.stopSources();
    this.channels.clear();
    this.ctx.close();
  }
}
