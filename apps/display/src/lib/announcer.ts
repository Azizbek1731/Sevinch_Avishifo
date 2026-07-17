/**
 * Sequential announcement queue for queue-call events: a soft WebAudio chime
 * followed by a SpeechSynthesis phrase. Overlapping calls are spoken one by
 * one. Written against APIs available on smart-TV browsers; every step
 * degrades gracefully when an API is missing or fails.
 */

interface Announcement {
  ticketNumber: string;
  room: string | null;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/** "A-013" → "A 13" so speech engines skip the dash and leading zeros. */
function speakableTicketNumber(ticketNumber: string): string {
  return ticketNumber.replace(/-/g, ' ').replace(/\b0+(\d)/g, '$1');
}

function normalizeLang(lang: string): string {
  return lang.toLowerCase().replace('_', '-');
}

/** Prefer an Uzbek-capable voice, then Russian; null → engine default. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const find = (prefix: string): SpeechSynthesisVoice | null =>
    voices.find((voice) => normalizeLang(voice.lang).startsWith(prefix)) ?? null;
  return find('uz') ?? find('ru');
}

/** Some TV browsers never fire utterance onend — never wedge the queue. */
const SPEECH_SAFETY_TIMEOUT_MS = 15_000;
const CHIME_SAFETY_TIMEOUT_MS = 1500;

export class Announcer {
  private readonly queue: Announcement[] = [];
  private busy = false;
  private audioContext: AudioContext | null = null;

  constructor() {
    // Kick off async voice loading early (Chrome/WebOS populate the list lazily).
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
  }

  announce(ticketNumber: string, room: string | null): void {
    const cleanRoom = room !== null && room.trim().length > 0 ? room.trim() : null;
    this.queue.push({ ticketNumber, room: cleanRoom });
    if (!this.busy) {
      void this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    const next = this.queue.shift();
    if (next === undefined) {
      this.busy = false;
      return;
    }
    this.busy = true;
    try {
      await this.playChime();
      await this.speak(next);
    } catch {
      // Audio failures must never break the board.
    }
    await this.processNext();
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.audioContext !== null) return this.audioContext;
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (Ctor === undefined) return null;
    try {
      this.audioContext = new Ctor();
    } catch {
      return null;
    }
    return this.audioContext;
  }

  /** Soft two-tone chime via a sine oscillator — no audio files. */
  private playChime(): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.getAudioContext();
      if (ctx === null) {
        resolve();
        return;
      }
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
      let done = false;
      const finish = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      try {
        const now = ctx.currentTime;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.45);
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.9);
        gain.connect(ctx.destination);

        const oscillator = ctx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, now); // A5
        oscillator.frequency.setValueAtTime(659.25, now + 0.4); // E5
        oscillator.connect(gain);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
          finish();
        };
        oscillator.start(now);
        oscillator.stop(now + 0.95);
      } catch {
        finish();
        return;
      }
      window.setTimeout(finish, CHIME_SAFETY_TIMEOUT_MS);
    });
  }

  private speak(announcement: Announcement): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve();
        return;
      }
      const synth = window.speechSynthesis;
      const voice = pickVoice(synth.getVoices());
      const number = speakableTicketNumber(announcement.ticketNumber);
      const room = announcement.room;

      let text: string;
      let lang: string;
      if (voice !== null && normalizeLang(voice.lang).startsWith('ru')) {
        // No Uzbek-capable voice on this device → announce in Russian.
        text =
          room !== null
            ? `Пациент ${number}, пройдите в кабинет ${room}`
            : `Пациент ${number}, пройдите на приём`;
        lang = voice.lang;
      } else {
        // Uzbek voice found, or no matching voice at all → Uzbek text with the
        // engine default voice (better than staying silent).
        text = `Bemor ${number}, ${room !== null ? `${room}-xonaga` : 'qabulga'} marhamat`;
        lang = voice !== null ? voice.lang : 'uz-UZ';
      }

      const utterance = new SpeechSynthesisUtterance(text);
      if (voice !== null) utterance.voice = voice;
      utterance.lang = lang;
      utterance.rate = 0.9;

      let done = false;
      let timer = 0;
      const finish = (): void => {
        if (!done) {
          done = true;
          window.clearTimeout(timer);
          resolve();
        }
      };
      timer = window.setTimeout(finish, SPEECH_SAFETY_TIMEOUT_MS);
      utterance.onend = finish;
      utterance.onerror = finish;
      try {
        synth.speak(utterance);
      } catch {
        finish();
      }
    });
  }
}
