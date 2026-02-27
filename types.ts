export enum NoteType {
  CLICK = 'CLICK',
  HOLD = 'HOLD',
  MINE = 'MINE',
  HOLD_CLICK = 'HOLD_CLICK'
  // Release is logically the end of a HOLD note, handled by holdDuration
}

export interface Note {
  id: string;
  time: number; // in milliseconds
  type: NoteType;
  holdDuration?: number; // only for HOLD notes
  lane: number; // visually 0-3 just for aesthetics, mechanically any key works
  speedMultiplier?: number; // Individual speed modifier (1.0 = normal)
  requireRelease?: boolean; // If false, the player doesn't need to release exactly at the end.
  mutationType?: NoteType; // New: What it turns into when hit
  mutationCount?: number; // New: How many notes are spawned
}

export enum EasingType {
  LINEAR = 'LINEAR',
  EASE_IN = 'EASE_IN',
  EASE_OUT = 'EASE_OUT',
  EASE_IN_OUT = 'EASE_IN_OUT',
  EASE_OUT_BACK = 'EASE_OUT_BACK',
  ELASTIC = 'ELASTIC',
  BOUNCE = 'BOUNCE'
}

export enum EventType {
  CAMERA_ZOOM = 'CAMERA_ZOOM',
  CAMERA_ROTATION = 'CAMERA_ROTATION',
  NOTES_OPACITY = 'NOTES_OPACITY',
  NOTES_SPEED = 'NOTES_SPEED',
  TEXT_EFFECT = 'TEXT_EFFECT'
}

export interface GameEvent {
  id: string;
  time: number;
  type: EventType;
  duration: number;
  value: number; // Target value (e.g. 1.5 for zoom, 45 for rotation, 0 for opacity)
  easing: EasingType;
  // Text Effect Properties
  text?: string;
  appearance?: 'GRADUAL' | 'VISIBLE' | 'LEFT_CENTER' | 'RIGHT_CENTER';
  animDuration?: number;
  font?: string;
  fontSize?: number;
  color?: string;
  isItalic?: boolean;
  isBold?: boolean;
  borderWidth?: number;
  borderColor?: string;
  shadowColor?: string;
  shadowBlur?: number;
  glowColor?: string;
  glowBlur?: number;
}

export interface Beatmap {
  id: string;
  name: string;
  artist: string;
  notes: Note[];
  events?: GameEvent[]; // Array of visual events
  duration: number; // total duration in ms
  audioUrl?: string; // Local audio URL for playtest (generated at runtime)
  audioData?: string; // Base64 audio data to be saved directly in JSON
  bpm?: number; // Beats per minute to help in the editor
  difficulty?: number; // Difficulty rating (1-3: Easy, 4-6: Medium, 7-8: Hard, 9-10: Expert)
  isPublic?: boolean; // Whether the beatmap is published publicly
}

export enum GameState {
  MENU = 'MENU',
  PLAYING = 'PLAYING',
  EDITOR = 'EDITOR',
  RESULTS = 'RESULTS'
}

export enum KeyMode {
  ALL_KEYS = 'ALL_KEYS',
  FOUR_KEYS = 'FOUR_KEYS'
}

export interface GameSettings {
  scrollSpeed: number; // Multiplier
  practiceMode: boolean; // Slows down time and disables speed effects
  crazyKeyboardMode: boolean; // Visual flair - shows pressed keys falling
  stupidlyCrazyEffects: boolean; // Extra visual effects for everything
  autoPlay: boolean; // Automatically plays the beatmap perfectly without user input
  masterVolume: number; // 0.0 to 1.0
  sfxVolume: number; // 0.0 to 1.0
  musicVolume: number; // 0.0 to 1.0
  keyMode: KeyMode;
  keyBindings: string[]; // Array of 4 key codes for FOUR_KEYS mode (default: ['A', 'S', 'K', 'L'])
}

export interface ScoreDetails {
  perfect: number;
  good: number;
  miss: number;
  minesHit: number;
  maxCombo: number;
  score: number;
}