import { Beatmap, NoteType, KeyMode } from './types';

export const HIT_WINDOWS = {
  PERFECT: 90,
  GOOD: 150,
  MISS: 200
};

export const SCORES = {
  PERFECT: 100,
  GOOD: 50,
  MISS: -30,
  MINE: -100 // Total shame
};

export const DEFAULT_KEY_BINDINGS = ['A', 'S', 'K', 'L'];

export const DEFAULT_SETTINGS = {
  scrollSpeed: 1,
  practiceMode: false,
  crazyKeyboardMode: false,
  stupidlyCrazyEffects: false,
  masterVolume: 1.0,
  sfxVolume: 0.8,
  musicVolume: 0.8,
  keyMode: KeyMode.ALL_KEYS,
  keyBindings: DEFAULT_KEY_BINDINGS
};

export const createBlankMap = (): Beatmap => ({
  id: generateUUID(),
  name: 'New Level',
  artist: 'Unknown',
  duration: 60000,
  bpm: 120,
  difficulty: 1,
  notes: [],
  events: []
});

// Default values for beatmap fields
export const DEFAULT_BEATMAP_VALUES = {
  name: 'Untitled',
  artist: 'Unknown',
  duration: 60000,
  bpm: 120,
  difficulty: 1,
  notes: [],
  events: [],
  isPublic: false
};

// UUID v4 pattern validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUUID = (id: string): boolean => UUID_REGEX.test(id);

// UUID v4 generator that works in non-secure contexts (HTTP)
// crypto.randomUUID() requires HTTPS, so we use crypto.getRandomValues() instead
export const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: manual UUID v4 using crypto.getRandomValues (works in HTTP)
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Set version (4) and variant (RFC4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// Normalize a beatmap by filling missing fields with default values
export const normalizeBeatmap = (partial: Partial<Beatmap>): Beatmap => {
  // Always ensure a valid UUID - old IDs like "custom_blank_*" are not valid UUIDs
  const id = (partial.id && isValidUUID(partial.id)) ? partial.id : generateUUID();

  return {
    id,
    name: partial.name ?? DEFAULT_BEATMAP_VALUES.name,
    artist: partial.artist ?? DEFAULT_BEATMAP_VALUES.artist,
    duration: partial.duration ?? DEFAULT_BEATMAP_VALUES.duration,
    bpm: partial.bpm ?? DEFAULT_BEATMAP_VALUES.bpm,
    difficulty: partial.difficulty ?? DEFAULT_BEATMAP_VALUES.difficulty,
    notes: partial.notes ?? DEFAULT_BEATMAP_VALUES.notes,
    events: partial.events ?? DEFAULT_BEATMAP_VALUES.events,
    isPublic: partial.isPublic ?? DEFAULT_BEATMAP_VALUES.isPublic,
    // Handle audio fields - prefer audioUrl over audioData for runtime
    audioUrl: partial.audioUrl || partial.audioData || undefined,
    audioData: partial.audioData || partial.audioUrl || undefined,
  };
};

// Helper for IndexedDB to bypass 5MB localStorage limit (due to Base64 audio string)
export const dbHelper = {
  async getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('RushebDB', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('beatmaps')) {
          db.createObjectStore('beatmaps', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getMaps(): Promise<Beatmap[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('beatmaps', 'readonly');
        const store = tx.objectStore('beatmaps');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error("IndexedDB not available", e);
      return [];
    }
  },

  async saveMap(map: Beatmap): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('beatmaps', 'readwrite');
      const store = tx.objectStore('beatmaps');
      const request = store.put(map);
      // Wait for transaction to complete, not just the request
      // This ensures data is actually persisted before resolving
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || request.error);
      tx.onabort = () => reject(new Error('Transaction aborted'));
      request.onerror = (e) => {
        e.stopPropagation();
        reject(request.error);
      };
    });
  },

  async deleteMap(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('beatmaps', 'readwrite');
      const store = tx.objectStore('beatmaps');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};