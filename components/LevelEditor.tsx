import React, { useState, useRef, useEffect, MouseEvent, ChangeEvent, useCallback } from 'react';
import { Beatmap, Note, NoteType, GameEvent, EventType, EasingType, GameSettings } from '../types';
import { dbHelper, generateUUID } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { isStorageUrl } from '../lib/audioStorage';

interface LevelEditorProps {
  initialMap: Beatmap;
  settings: GameSettings;
  onExit: () => void;
  onPlaytest: (map: Beatmap) => void;
}

const LevelEditor: React.FC<LevelEditorProps> = ({ initialMap, settings, onExit, onPlaytest }) => {
  const { user, isGuest, uploadBeatmap, isConfigured } = useAuth();
  const { error: toastError, info: toastInfo } = useToast();
  const [map, setMap] = useState<Beatmap>({
    ...initialMap,
    id: initialMap.id || generateUUID(),
    notes: [...initialMap.notes],
    events: initialMap.events ? [...initialMap.events] : [],
    bpm: initialMap.bpm || 120,
    isPublic: initialMap.isPublic || false
  });

  const [editorMode, setEditorMode] = useState<'NOTES' | 'EVENTS'>('NOTES');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [uploadPercent, setUploadPercent] = useState<number>(0);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [currentNoteTool, setCurrentNoteTool] = useState<NoteType>(NoteType.CLICK);
  const [currentEventTool, setCurrentEventTool] = useState<EventType>(EventType.CAMERA_ZOOM);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [audioUrl, setAudioUrl] = useState<string | null>(initialMap.audioData || initialMap.audioUrl || null);

  // Track the ORIGINAL audio data to detect changes
  // This is used to determine if audio needs to be re-uploaded
  const originalAudioRef = useRef<string | null>(initialMap.audioData || initialMap.audioUrl || null);

  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editingEvent, setEditingEvent] = useState<GameEvent | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const mapRef = useRef(map);
  const hoveredItemRef = useRef<{ type: 'NOTE', id: string } | { type: 'EVENT', id: string } | null>(null);

  useEffect(() => {
    mapRef.current = map;
  }, [map]);

  const [pixelsPerMs, setPixelsPerMs] = useState(0.25);
  const bpm = map.bpm || 120;
  const beatMs = 60000 / bpm;
  const snapMs = beatMs / 4;

  const timelineHeight = map.duration * pixelsPerMs;

  const updateMapMeta = (key: keyof Beatmap, value: string | number) => {
    setMap(prev => ({ ...prev, [key]: value }));
  };

  const getPosInfo = useCallback((clientX: number, clientY: number) => {
    if (!trackRef.current) return null;
    const rect = trackRef.current.getBoundingClientRect();
    let relativeX = clientX - rect.left;
    relativeX = Math.max(0, Math.min(relativeX, rect.width - 0.1));
    const contentY = clientY - rect.top;
    const scrollY = scrollRef.current ? scrollRef.current.scrollTop : 0;
    const actualTime = (contentY) / pixelsPerMs;
    const laneWidth = rect.width / 4;
    const lane = Math.floor(relativeX / laneWidth);
    const snappedTime = Math.max(0, Math.round(actualTime / snapMs) * snapMs);
    return { time: snappedTime, lane };
  }, [snapMs, pixelsPerMs]);

  const [mousePos, setMousePos] = useState<{ time: number, lane: number } | null>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const info = getPosInfo(e.clientX, e.clientY);
    setMousePos(info);
    if (!info) {
      hoveredItemRef.current = null;
      return;
    }
    if (editorMode === 'NOTES') {
      const note = mapRef.current.notes.find(n => {
        const isAtStart = Math.abs(n.time - info.time) < 60 && n.lane === info.lane;
        if (n.type === NoteType.HOLD && n.holdDuration) {
          return (isAtStart || (info.time > n.time && info.time < n.time + n.holdDuration && n.lane === info.lane));
        }
        return isAtStart;
      });
      hoveredItemRef.current = note ? { type: 'NOTE', id: note.id } : null;
    } else {
      const ev = (mapRef.current.events || []).find(ev => Math.abs(ev.time - info.time) < 60);
      hoveredItemRef.current = ev ? { type: 'EVENT', id: ev.id } : null;
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'z' || e.key === 'Z') {
        setEditorMode(prev => prev === 'NOTES' ? 'EVENTS' : 'NOTES');
      } else if (e.key === '1') setCurrentNoteTool(NoteType.CLICK);
      else if (e.key === '2') setCurrentNoteTool(NoteType.HOLD);
      else if (e.key === '3') setCurrentNoteTool(NoteType.HOLD_CLICK);
      else if (e.key === '4') setCurrentNoteTool(NoteType.MINE);
      else if (e.key === 'q' || e.key === 'Q') setCurrentEventTool(EventType.CAMERA_ZOOM);
      else if (e.key === 'w' || e.key === 'W') setCurrentEventTool(EventType.CAMERA_ROTATION);
      else if (e.key === 'e' || e.key === 'E') setCurrentEventTool(EventType.NOTES_OPACITY);
      else if (e.key === 'r' || e.key === 'R') setCurrentEventTool(EventType.NOTES_SPEED);
      else if (e.key === 't' || e.key === 'T') setCurrentEventTool(EventType.TEXT_EFFECT);
      else if (e.key === 's' || e.key === 'S') {
        if (e.ctrlKey) { e.preventDefault(); dbHelper.saveMap(mapRef.current); }
      } else if (e.key === 'p' || e.key === 'P') {
        onPlaytest(mapRef.current);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (hoveredItemRef.current) {
          const hovered = hoveredItemRef.current;
          setMap(prev => {
            if (hovered.type === 'NOTE') {
              return { ...prev, notes: prev.notes.filter(n => n.id !== hovered.id) };
            } else {
              return { ...prev, events: (prev.events || []).filter(ev => ev.id !== hovered.id) };
            }
          });
          hoveredItemRef.current = null;
        }
      } else if (e.key === 'd' || e.key === 'D') {
        if (e.ctrlKey && hoveredItemRef.current) {
          e.preventDefault();
          const hovered = hoveredItemRef.current;
          setMap(prev => {
            if (hovered.type === 'NOTE') {
              const note = prev.notes.find(n => n.id === hovered.id);
              if (note) {
                const newNote = { ...note, id: `note_copy_${Date.now()}` };
                return { ...prev, notes: [...prev.notes, newNote].sort((a, b) => a.time - b.time) };
              }
            } else {
              const ev = (prev.events || []).find(e => e.id === hovered.id);
              if (ev) {
                const newEv = { ...ev, id: `event_copy_${Date.now()}` };
                return { ...prev, events: [...(prev.events || []), newEv].sort((a, b) => a.time - b.time) };
              }
            }
            return prev;
          });
        }
      }

      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (!hoveredItemRef.current) return;
        e.preventDefault();
        const timeShift = e.key === 'ArrowUp' ? -snapMs : snapMs;
        const hovered = hoveredItemRef.current;
        setMap(prev => {
          if (hovered.type === 'NOTE') {
            const noteIndex = prev.notes.findIndex(n => n.id === hovered.id);
            if (noteIndex >= 0) {
              const newNotes = [...prev.notes];
              const note = newNotes[noteIndex];
              const newTime = Math.max(0, note.time + timeShift);
              newNotes[noteIndex] = { ...note, time: newTime };
              return { ...prev, notes: newNotes.sort((a, b) => a.time - b.time) };
            }
          } else {
            const evIndex = (prev.events || []).findIndex(ev => ev.id === hovered.id);
            if (evIndex >= 0) {
              const newEvents = [...(prev.events || [])];
              const ev = newEvents[evIndex];
              const newTime = Math.max(0, ev.time + timeShift);
              newEvents[evIndex] = { ...ev, time: newTime };
              return { ...prev, events: newEvents.sort((a, b) => a.time - b.time) };
            }
          }
          return prev;
        });
      }

      // Shift + Left/Right to adjust BPM
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const bpmChange = e.key === 'ArrowLeft' ? -1 : 1;
        setMap(prev => {
          const newBpm = Math.max(1, prev.bpm + bpmChange);
          return { ...prev, bpm: newBpm };
        });
        // Calculate new BPM from current state for notification
        const currentBpm = map.bpm;
        const newBpm = Math.max(1, currentBpm + bpmChange);
        showPlaybackNotification(newBpm);
      }

      // Shift + -/+ to adjust playback speed
      if (e.shiftKey && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        setPlaybackSpeed(prev => {
          const newSpeed = Math.max(0.01, prev - 0.01);
          const roundedSpeed = Math.round(newSpeed * 100) / 100;
          showPlaybackNotification(undefined, roundedSpeed);
          return roundedSpeed;
        });
      }
      if (e.shiftKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setPlaybackSpeed(prev => {
          const newSpeed = prev + 0.01;
          const roundedSpeed = Math.round(newSpeed * 100) / 100;
          showPlaybackNotification(undefined, roundedSpeed);
          return roundedSpeed;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setPixelsPerMs(prev => Math.max(0.05, Math.min(2.0, prev * delta)));
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [snapMs, isPlaying, editorMode, pixelsPerMs]);

  const handleTimelineClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const info = getPosInfo(e.clientX, e.clientY);
    if (!info) return;

    if (editorMode === 'NOTES') {
      const existingNoteIndex = map.notes.findIndex(n =>
        Math.abs(n.time - info.time) < 40 && n.lane === info.lane
      );
      if (existingNoteIndex >= 0) {
        setMap(prev => ({ ...prev, notes: prev.notes.filter((_, i) => i !== existingNoteIndex) }));
      } else {
        const newNote: Note = {
          id: `note_${Date.now()}_${Math.random()}`,
          time: info.time,
          type: currentNoteTool,
          lane: info.lane,
          speedMultiplier: 1.0,
          ...(currentNoteTool === NoteType.HOLD ? { holdDuration: beatMs, requireRelease: true } : {})
        };
        setMap(prev => ({ ...prev, notes: [...prev.notes, newNote].sort((a, b) => a.time - b.time) }));
      }
    } else {
      // EVENT MODE
      const existingEvIndex = (map.events || []).findIndex(ev =>
        Math.abs(ev.time - info.time) < 40 && ev.type === currentEventTool
      );
      if (existingEvIndex >= 0) {
        setMap(prev => ({ ...prev, events: (prev.events || []).filter((_, i) => i !== existingEvIndex) }));
      } else {
        const newEvent: GameEvent = {
          id: `event_${Date.now()}_${Math.random()}`,
          time: info.time,
          type: currentEventTool,
          duration: currentEventTool === EventType.TEXT_EFFECT ? 2000 : 500,
          value:
            currentEventTool === EventType.CAMERA_ZOOM ? 1.2 :
              currentEventTool === EventType.CAMERA_ROTATION ? 45 :
                currentEventTool === EventType.NOTES_SPEED ? 1.0 :
                  currentEventTool === EventType.NOTES_OPACITY ? 1.0 :
                    (currentEventTool === EventType.TEXT_EFFECT ? 1 : 0),
          easing: EasingType.LINEAR,
          ...(currentEventTool === EventType.TEXT_EFFECT ? {
            text: 'MENSAGEM',
            appearance: 'GRADUAL',
            animDuration: 500,
            font: 'Arial',
            fontSize: 40,
            color: '#ffffff',
            isBold: true
          } : {})
        };
        setMap(prev => ({ ...prev, events: [...(prev.events || []), newEvent].sort((a, b) => a.time - b.time) }));
      }
    }
  };

  const handleTimelineContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const info = getPosInfo(e.clientX, e.clientY);
    if (!info) return;

    if (editorMode === 'NOTES') {
      const existingNote = map.notes.find(n => {
        if (n.type === NoteType.HOLD && n.holdDuration) {
          return (Math.abs(n.time - info.time) < 40 || (info.time > n.time && info.time < n.time + n.holdDuration)) && n.lane === info.lane;
        }
        return Math.abs(n.time - info.time) < 40 && n.lane === info.lane;
      });
      if (existingNote) setEditingNote(existingNote);
    } else {
      const eventsAtTime = (map.events || []).filter(ev => Math.abs(ev.time - info.time) < 40);
      // Prioritize the event type that matches the current tool, otherwise take the first one found
      const existingEvent = eventsAtTime.find(ev => ev.type === currentEventTool) || eventsAtTime[0];
      if (existingEvent) setEditingEvent(existingEvent);
    }
  };

  const handleSaveEventProperties = (updatedEvent: GameEvent) => {
    setMap(prev => ({ ...prev, events: (prev.events || []).map(e => e.id === updatedEvent.id ? updatedEvent : e) }));
    setEditingEvent(null);
  };

  const handleSaveNoteProperties = (updatedNote: Note) => {
    setMap(prev => ({ ...prev, notes: prev.notes.map(n => n.id === updatedNote.id ? updatedNote : n) }));
    setEditingNote(null);
  };

  const handleAudioUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64Data = event.target?.result as string;
        if (base64Data) {
          setAudioUrl(base64Data);
          updateMapMeta('audioData', base64Data);
          updateMapMeta('audioUrl', base64Data);
          // Audio changed - will be detected by comparing with originalAudioRef
          const tempAudio = new Audio(base64Data);
          tempAudio.onloadedmetadata = () => updateMapMeta('duration', Math.ceil(tempAudio.duration * 1000));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(map, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${map.name || 'map'}_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportLayout = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const importedMap = JSON.parse(event.target?.result as string) as Beatmap;
          if (importedMap && importedMap.notes) {
            setMap({
              ...importedMap,
              id: generateUUID() // Ensure unique UUID for fresh save
            });
            if (importedMap.audioData || importedMap.audioUrl) {
              setAudioUrl(importedMap.audioData || importedMap.audioUrl || null);
              // Update original audio ref since this is a new import
              originalAudioRef.current = importedMap.audioData || importedMap.audioUrl || null;
            }
          }
        } catch (err) {
          toastError('Invalid JSON file');
        }
      };
      reader.readAsText(file);
    }
  };

  // Helper function to check if audio has changed
  const hasAudioChanged = () => {
    const currentAudio = map.audioData || map.audioUrl;
    const originalAudio = originalAudioRef.current;

    // If both are null/undefined, no change
    if (!currentAudio && !originalAudio) return false;

    // If one is null and other isn't, changed
    if (!currentAudio || !originalAudio) return true;

    // If both are storage URLs and equal, no change
    if (isStorageUrl(currentAudio) && isStorageUrl(originalAudio)) {
      return currentAudio !== originalAudio;
    }

    // If current is base64 (not a URL), it's new/modified audio
    if (!isStorageUrl(currentAudio)) return true;

    // Otherwise, compare directly
    return currentAudio !== originalAudio;
  };

  const handleSaveAndPublish = async () => {
    setIsUploading(true);
    setUploadStatus(null);
    setUploadProgress('💾 Saving to your device...');
    setUploadPercent(5);

    try {
      // Always save locally first
      await dbHelper.saveMap(map);
      setUploadPercent(10);

      // If logged in, always upload to server (isPublic controls visibility in Published Beatmaps)
      if (user && isConfigured && !isGuest) {
        setUploadProgress(map.isPublic ? '🚀 Publishing to server...' : '📤 Saving to server...');

        // Check if audio has actually changed
        const audioChanged = hasAudioChanged();
        console.log('Audio changed:', audioChanged, 'Current:', map.audioData?.substring(0, 50), 'Original:', originalAudioRef.current?.substring(0, 50));

        try {
          // Upload to server - isPublic determines if it shows in Published Beatmaps
          const { error, data } = await uploadBeatmap(map, map.isPublic || false, {
            skipAudio: !audioChanged,
            onProgress: (stage, percent) => {
              setUploadProgress(stage);
              setUploadPercent(percent);
            }
          });

          if (error) {
            setUploadStatus({ type: 'error', message: error.message || 'Failed to save beatmap to server' });
          } else {
            setUploadStatus({ type: 'success', message: map.isPublic ? 'Beatmap saved & published!' : 'Beatmap saved to server!' });
            // Update original audio ref after successful upload
            originalAudioRef.current = map.audioData || map.audioUrl || null;
            // Update the map with the server ID if it's a new upload and ID changed
            if (data && data.id !== map.id) {
              const oldId = map.id;
              const newId = data.id;

              // 1. Delete the old local map (the one with 'custom_...' ID)
              await dbHelper.deleteMap(oldId);

              // 2. Update state with new ID
              setMap(prev => ({ ...prev, id: newId }));

              // 3. Save the map again locally with the new correct ID
              await dbHelper.saveMap({ ...map, id: newId });

              console.log(`Updated map ID from ${oldId} to ${newId}`);
            }
          }
        } catch (err: any) {
          setUploadStatus({ type: 'error', message: err.message || 'Failed to save beatmap to server' });
        }
      } else {
        // Local save only (guest mode or not configured)
        setUploadProgress('✅ Done!');
        setUploadPercent(100);
        setUploadStatus({ type: 'success', message: 'Beatmap saved locally!' });
      }
    } catch (err: any) {
      setUploadStatus({ type: 'error', message: err.message || 'Failed to save beatmap' });
    } finally {
      setIsUploading(false);
      // Clear status after 4 seconds
      setTimeout(() => {
        setUploadStatus(null);
        setUploadProgress('');
        setUploadPercent(0);
      }, 4000);
    }
  };

  const togglePlay = () => {
    const newState = !isPlaying;
    setIsPlaying(newState);
    if (audioRef.current) {
      if (newState) {
        audioRef.current.currentTime = playbackTime / 1000;
        audioRef.current.playbackRate = playbackSpeed;

        // Apply music volume settings
        const master = settings.masterVolume !== undefined ? settings.masterVolume : 1.0;
        const music = settings.musicVolume !== undefined ? settings.musicVolume : 0.8;
        audioRef.current.volume = master * music;

        audioRef.current.play().catch(console.error);
      } else {
        audioRef.current.pause();
      }
    }
  };

  const showPlaybackNotification = (overrideBpm?: number, overrideSpeed?: number) => {
    const seconds = Math.floor(playbackTime / 1000);
    const milliseconds = Math.floor(playbackTime % 1000);
    const timeStr = `${seconds}s ${milliseconds.toString().padStart(3, '0')}ms`;
    const speedPercent = Math.round((overrideSpeed || playbackSpeed) * 100);
    const bpm = overrideBpm !== undefined ? overrideBpm : map.bpm;
    toastInfo(`Playback: ${speedPercent}% | Position: ${timeStr} | BPM: ${bpm}`);
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  useEffect(() => {
    if (isPlaying) {
      playTimerRef.current = setInterval(() => {
        setPlaybackTime(prev => {
          const dt = 16 * playbackSpeed;
          const next = audioRef.current ? audioRef.current.currentTime * 1000 : prev + dt;
          if (next >= map.duration) { setIsPlaying(false); return 0; }
          return next;
        });
      }, 16);
    } else {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    }
    return () => { if (playTimerRef.current) clearInterval(playTimerRef.current); };
  }, [isPlaying, map.duration]);

  const snapPx = snapMs * pixelsPerMs;
  const beatPx = beatMs * pixelsPerMs;

  return (
    <div className="flex w-full h-full bg-[#0a0a15] text-white selection:bg-pink-500 overflow-hidden">
      <div className="w-80 bg-[#111122] p-6 flex flex-col gap-6 border-r border-white/5 shadow-2xl z-20 overflow-y-auto custom-scrollbar">
        <div className="border-b border-white/10 pb-4">
          <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-br from-pink-400 to-purple-500 italic uppercase tracking-tighter mb-4">
            RUSHEB EDITOR
          </h2>
          <div className="flex gap-2 mb-2">
            <button onClick={onExit} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-[10px] font-bold uppercase transition-all">Exit</button>
            <button
              onClick={handleSaveAndPublish}
              disabled={isUploading}
              className="flex-1 py-2 bg-pink-600 hover:bg-pink-500 disabled:bg-pink-800 rounded-lg text-[10px] font-bold uppercase shadow-lg shadow-pink-900/50 transition-all"
            >
              {isUploading ? 'Saving...' : 'Save'}
            </button>
          </div>

          {/* Upload Progress Bar */}
          {isUploading && (
            <div className="mb-2 bg-black/30 rounded-lg p-3 border border-white/5">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-bold text-white/80">{uploadProgress}</span>
                <span className="text-[10px] font-bold text-pink-400">{Math.round(uploadPercent)}%</span>
              </div>
              <div className="h-2 bg-black/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-300 ease-out rounded-full"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            </div>
          )}

          {uploadStatus && (
            <div className={`text-[10px] font-bold p-2 rounded-lg mb-2 ${uploadStatus.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {uploadStatus.message}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={handleExport} className="flex-1 py-1.5 border border-white/10 hover:bg-white/5 rounded-lg text-[8px] font-black uppercase transition-all">Export JSON</button>
            <label className="flex-1 py-1.5 border border-white/10 hover:bg-white/5 rounded-lg text-[8px] font-black uppercase transition-all text-center cursor-pointer">
              Import JSON
              <input type="file" accept=".json" onChange={handleImportLayout} className="hidden" />
            </label>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-black/30 p-4 rounded-xl space-y-3 border border-white/5">
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Metadata</label>
              <div className="text-[8px] bg-sky-500/20 text-sky-400 px-2 py-0.5 rounded-full font-bold">{map.notes.length} Notes</div>
            </div>
            <input placeholder="Map Name" value={map.name} onChange={e => updateMapMeta('name', e.target.value)} className="w-full bg-black/50 p-2 rounded border border-white/10 text-sm focus:border-pink-500 outline-none transition-all" />
            <input placeholder="Artist" value={map.artist} onChange={e => updateMapMeta('artist', e.target.value)} className="w-full bg-black/50 p-2 rounded border border-white/10 text-sm focus:border-pink-500 outline-none transition-all" />
            <input placeholder="BPM" type="number" value={map.bpm} onChange={e => updateMapMeta('bpm', parseInt(e.target.value) || 120)} className="w-full bg-black/50 p-2 rounded border border-white/10 text-sm text-pink-400 font-bold" />
            <div className="flex gap-2 items-center">
              <input
                placeholder="Difficulty"
                type="number"
                min="1"
                max="10"
                value={map.difficulty || ''}
                onChange={e => updateMapMeta('difficulty', parseInt(e.target.value) || 1)}
                className="flex-1 bg-black/50 p-2 rounded border border-white/10 text-sm font-bold focus:border-pink-500 outline-none transition-all"
              />
              <span className={`text-xs font-bold px-2 py-1 rounded ${(map.difficulty || 1) <= 3 ? 'bg-green-500/20 text-green-400' :
                (map.difficulty || 1) <= 6 ? 'bg-yellow-500/20 text-yellow-400' :
                  (map.difficulty || 1) <= 8 ? 'bg-orange-500/20 text-orange-400' :
                    'bg-red-500/20 text-red-400'
                }`}>
                {(map.difficulty || 1) <= 3 ? 'Easy' :
                  (map.difficulty || 1) <= 6 ? 'Medium' :
                    (map.difficulty || 1) <= 8 ? 'Hard' : 'Expert'}
              </span>
            </div>

            {/* Public Toggle - Only for logged in users */}
            {!isGuest && (
              <label className="flex items-center justify-between cursor-pointer group bg-black/30 p-3 rounded-lg border border-white/5">
                <div>
                  <span className="font-bold text-gray-200 text-sm">Publish Publicly</span>
                  <p className="text-[10px] text-gray-500">Make this beatmap visible to all players</p>
                </div>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={map.isPublic || false}
                    onChange={(e) => updateMapMeta('isPublic', e.target.checked)}
                    className="sr-only"
                  />
                  <div className={`w-12 h-6 rounded-full transition-colors ${map.isPublic ? 'bg-pink-600' : 'bg-gray-700'}`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${map.isPublic ? 'translate-x-6' : 'translate-x-0'}`}></div>
                  </div>
                </div>
              </label>
            )}
          </div>

          <div className="bg-black/30 p-4 rounded-xl space-y-3 border border-white/5">
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block">Music</label>
            <div className={`p-3 rounded-xl border-2 border-dashed transition-all flex flex-col items-center gap-2 group ${audioUrl ? 'border-green-500/30 bg-green-500/5' : 'border-white/10 hover:border-pink-500/50 hover:bg-white/5'}`}>
              {audioUrl ? (
                <>
                  <div className="text-[10px] font-bold text-green-400 flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    Music Loaded
                  </div>
                  <button
                    onClick={() => { setAudioUrl(null); updateMapMeta('audioData', ''); updateMapMeta('audioUrl', ''); }}
                    className="text-[8px] uppercase font-black text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove Music
                  </button>
                </>
              ) : (
                <>
                  <div className="text-[10px] font-bold text-gray-500 text-center px-4 leading-tight group-hover:text-gray-300">
                    Drag & drop or click to upload
                  </div>
                  <label className="cursor-pointer bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all">
                    Choose File
                    <input type="file" accept="audio/*" onChange={handleAudioUpload} className="hidden" />
                  </label>
                </>
              )}
            </div>
          </div>

          {/* Timeline Zoom - helpful for small screens */}
          <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Timeline Zoom</label>
              <div className="text-[8px] text-gray-500">Ctrl+wheel also works</div>
            </div>
            <div className="flex justify-between text-[10px] font-mono text-gray-400">
              <span>Zoom Level</span>
              <span className="text-purple-400">{(pixelsPerMs * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="5"
              max="200"
              step="1"
              value={pixelsPerMs * 100}
              onChange={e => setPixelsPerMs(parseFloat(e.target.value) / 100)}
              className="w-full accent-purple-500"
            />
          </div>

          <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-3">
            <div className="flex bg-black/40 p-1 rounded-lg">
              <button
                onClick={() => setEditorMode('NOTES')}
                className={`flex-1 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${editorMode === 'NOTES' ? 'bg-pink-600 text-white' : 'text-gray-500 hover:text-white'}`}
              >
                Notes
              </button>
              <button
                onClick={() => setEditorMode('EVENTS')}
                className={`flex-1 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${editorMode === 'EVENTS' ? 'bg-purple-600 text-white' : 'text-gray-500 hover:text-white'}`}
              >
                Events
              </button>
            </div>

            {editorMode === 'NOTES' ? (
              <>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block">Note Tools</label>
                  <div className="text-[7px] font-bold text-gray-600 uppercase">[1,2,3,4]</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[NoteType.CLICK, NoteType.HOLD, NoteType.HOLD_CLICK, NoteType.MINE].map(type => (
                    <button
                      key={type}
                      onClick={() => setCurrentNoteTool(type)}
                      className={`py-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${currentNoteTool === type ? 'border-pink-500 bg-pink-500/10 scale-105 shadow-lg shadow-pink-500/10' : 'border-white/5 bg-black/20 hover:bg-black/40'}`}
                    >
                      <div className={`w-3 h-3 ${type === NoteType.CLICK ? 'bg-sky-400 rounded-full' : type === NoteType.HOLD ? 'bg-purple-500 w-2 h-4 rounded-sm' : type === NoteType.HOLD_CLICK ? 'bg-teal-400 rotate-45 rounded-sm' : 'bg-red-500 rotate-45'}`}></div>
                      <span className="text-[8px] font-black uppercase">{type.replace('_', ' ')}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block">Event Tools</label>
                  <div className="text-[7px] font-bold text-gray-600 uppercase">[Q,W,E,R]</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[EventType.CAMERA_ZOOM, EventType.CAMERA_ROTATION, EventType.NOTES_OPACITY, EventType.NOTES_SPEED, EventType.TEXT_EFFECT].map(type => (
                    <button
                      key={type}
                      onClick={() => setCurrentEventTool(type)}
                      className={`py-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${currentEventTool === type ? 'border-purple-500 bg-purple-500/10 scale-105 shadow-lg shadow-purple-500/10' : 'border-white/5 bg-black/20 hover:bg-black/40'}`}
                    >
                      <div className="w-3 h-3 bg-white/40 rounded-sm"></div>
                      <span className="text-[8px] font-black uppercase text-center">{type.replace('CAMERA_', '').replace('NOTES_', '').replace('_', ' ')}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button onClick={() => onPlaytest(map)} className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl shadow-blue-900/40">
            ⚡ Playtest [P]
          </button>
        </div>

        <div className="mt-auto bg-black/40 p-4 rounded-2xl border border-white/10 space-y-4">
          <div className="flex justify-between items-center mb-1">
            <div className="text-[8px] text-gray-500 uppercase font-black">BPM: {map.bpm}</div>
            <div className="text-[7px] text-gray-400 uppercase">Space to play/pause</div>
          </div>
          <div>
            <div className="flex justify-between text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">
              <span>Speed</span>
              <span className="text-pink-400">{(playbackSpeed * 100).toFixed(0)}%</span>
            </div>
            <input type="range" min="0" max="100" step="1" value={playbackSpeed * 100} onChange={e => setPlaybackSpeed(parseFloat(e.target.value) / 100)} className="w-full accent-pink-500 h-1.5" />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-[10px] font-mono text-gray-400">
              <span>{(playbackTime / 1000).toFixed(2)}s</span>
              <span className="text-gray-600">/</span>
              <span>{(map.duration / 1000).toFixed(2)}s</span>
            </div>
            <div
              className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden cursor-pointer group relative"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                setPlaybackTime((x / rect.width) * map.duration);
              }}
            >
              <div
                className="h-full bg-pink-500 transition-all duration-100 ease-out"
                style={{ width: `${(playbackTime / map.duration) * 100}%` }}
              ></div>
              <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </div>
          </div>
          <button onClick={togglePlay} className={`w-full py-4 rounded-xl font-black uppercase text-sm tracking-widest shadow-xl transition-all ${isPlaying ? 'bg-yellow-500 text-black shadow-yellow-500/20' : 'bg-green-600 text-white shadow-green-600/20 active:scale-95'}`}>
            {isPlaying ? 'PAUSE' : 'PLAY [SPACE]'}
          </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-y-auto overflow-x-auto bg-[#050510] custom-scrollbar" ref={scrollRef}>
        <div
          ref={trackRef}
          className="w-full relative mx-auto"
          style={{
            height: `${timelineHeight}px`,
            maxWidth: '600px',
            backgroundColor: 'rgba(10, 10, 30, 0.8)',
            backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.02) 1px, transparent 1px)',
            backgroundSize: `100% ${beatPx}px, 100% ${snapPx}px`
          }}
          onClick={handleTimelineClick}
          onContextMenu={handleTimelineContextMenu}
          onMouseMove={handleMouseMove}
        >
          <div className="absolute inset-0 flex pointer-events-none opacity-20">
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                className={`flex-1 border-r border-white/50 last:border-0 transition-colors ${mousePos?.lane === i ? 'bg-white/5' : ''}`}
              ></div>
            ))}
          </div>

          {/* Ghost Note Preview */}
          {!isPlaying && mousePos && !hoveredItemRef.current && (
            <div
              className="absolute z-0 opacity-30 pointer-events-none flex justify-center"
              style={{
                top: `${mousePos.time * pixelsPerMs}px`,
                left: `${mousePos.lane * 25}%`,
                width: '25%'
              }}
            >
              <div className={`w-8 h-8 border-2 border-dashed border-white flex items-center justify-center
                    ${editorMode === 'NOTES' ? (
                  currentNoteTool === NoteType.CLICK ? 'bg-sky-500 rounded-full' :
                    currentNoteTool === NoteType.MINE ? 'bg-red-600 rotate-45' :
                      currentNoteTool === NoteType.HOLD_CLICK ? 'bg-teal-500 rotate-45' :
                        'bg-purple-600 rounded-lg'
                ) : 'bg-purple-500 rounded-sm'}
                `}>
                <span className="text-[10px] font-bold text-white uppercase">{editorMode === 'NOTES' ? '+' : 'EV'}</span>
              </div>
            </div>
          )}

          {map.notes.map((note) => {
            const startY = note.time * pixelsPerMs;
            const left = `${note.lane * 25}%`;
            const width = '25%';
            const hasMutation = !!note.mutationType;
            const speed = note.speedMultiplier || 1.0;
            const isFast = speed > 1;
            const isSlow = speed < 1;

            return (
              <div key={note.id} className="absolute z-10 group" style={{ top: `${startY}px`, left: left, width: width }}>
                {/* HOLD Tail */}
                {note.type === NoteType.HOLD && note.holdDuration && (
                  <div
                    className="absolute left-1/2 -translate-x-1/2 bg-gradient-to-b from-purple-500/60 to-pink-500/20 border-x border-purple-400/40 pointer-events-none"
                    style={{ top: 0, width: '40px', height: `${note.holdDuration * pixelsPerMs}px` }}
                  >
                    {/* End marker */}
                    <div className="absolute bottom-0 left-0 w-full h-[2px] bg-pink-400 shadow-[0_0_10px_#ec4899]"></div>
                  </div>
                )}

                {/* Note Head */}
                <div className="relative flex justify-center">
                  <div className={`
                        relative w-8 h-8 flex items-center justify-center border-2 border-white/30 shadow-2xl transition-transform group-hover:scale-110
                        ${note.type === NoteType.CLICK ? 'bg-sky-500 rounded-full' : ''}
                        ${note.type === NoteType.MINE ? 'bg-red-600 rotate-45' : ''}
                        ${note.type === NoteType.HOLD_CLICK ? 'bg-teal-500 rotate-45 rounded-sm' : ''}
                        ${note.type === NoteType.HOLD ? 'bg-purple-600 rounded-lg shadow-[0_0_15px_rgba(168,85,247,0.5)]' : ''}
                    `}>
                    {note.type === NoteType.MINE && <span className="text-white font-black text-xs -rotate-45">!</span>}
                    {note.type === NoteType.HOLD_CLICK && <div className="w-2 h-2 bg-white rounded-full"></div>}

                    {/* Indicators */}
                    {hasMutation && <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full border border-black shadow-[0_0_10px_#facc15] animate-pulse"></div>}
                    {isFast && <div className="absolute -left-4 text-[10px] text-orange-400 font-bold">{">>"}</div>}
                    {isSlow && <div className="absolute -left-4 text-[10px] text-blue-400 font-bold">{"<<"}</div>}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Render Events */}
          {(map.events || []).map((ev) => {
            const startY = ev.time * pixelsPerMs;
            const evHeight = ev.duration * pixelsPerMs;
            const evColor =
              ev.type === EventType.CAMERA_ZOOM ? '#ec4899' :
                ev.type === EventType.CAMERA_ROTATION ? '#8b5cf6' :
                  ev.type === EventType.NOTES_OPACITY ? '#6366f1' :
                    ev.type === EventType.NOTES_SPEED ? '#f97316' :
                      '#2dd4bf'; // TEXT_EFFECT

            return (
              <div
                key={ev.id}
                className={`absolute left-0 w-full z-10 flex items-center border-t-2 border-dashed pointer-events-none transition-opacity ${editorMode === 'EVENTS' ? 'opacity-100' : 'opacity-30'}`}
                style={{ top: `${startY}px`, height: `${Math.max(evHeight, 20)}px`, borderColor: evColor }}
              >
                <div
                  className="text-[8px] font-black px-1.5 py-0.5 rounded ml-2 shadow-lg"
                  style={{ backgroundColor: evColor, color: '#fff' }}
                >
                  {ev.type === EventType.TEXT_EFFECT ? `TEXT: ${ev.text}` : `${ev.type.replace('CAMERA_', '').replace('NOTES_', '')} (${ev.value})`}
                </div>
              </div>
            );
          })}

          <div
            className="absolute w-full h-1 bg-yellow-300 z-20 pointer-events-none shadow-[0_0_20px_#facc15] flex items-center justify-end"
            style={{ top: `${playbackTime * pixelsPerMs}px` }}
          >
            <div className="mr-2 bg-yellow-300 text-black text-[8px] font-black px-1 rounded">NOW</div>
          </div>
        </div>
      </div>

      {editingNote && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl p-4">
          <div className="bg-[#1a1a2e] p-8 rounded-[40px] border border-white/10 shadow-[0_0_100px_rgba(0,0,0,1)] w-full max-w-sm">
            <div className="text-center mb-8">
              <div className="inline-block px-4 py-1 bg-pink-500/20 text-pink-400 rounded-full text-[10px] font-black uppercase tracking-widest mb-2 border border-pink-500/30">Note Config</div>
              <h3 className="text-3xl font-black text-white italic">PROPERTIES</h3>
            </div>

            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                  <span>Scroll Speed</span>
                  <span className="text-white">{editingNote.speedMultiplier}x</span>
                </div>
                <input type="range" min="0.1" max="4.0" step="0.1" value={editingNote.speedMultiplier || 1.0} onChange={e => setEditingNote({ ...editingNote, speedMultiplier: parseFloat(e.target.value) })} className="w-full accent-pink-500" />
              </div>

              {editingNote.type === NoteType.HOLD && (
                <div>
                  <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                    <span>Hold Duration</span>
                    <span className="text-white">{editingNote.holdDuration}ms</span>
                  </div>
                  <input type="range" min={snapMs} max={5000} step={snapMs} value={editingNote.holdDuration || 500} onChange={e => setEditingNote({ ...editingNote, holdDuration: parseInt(e.target.value) })} className="w-full accent-purple-500" />

                  <div className="mt-4 flex items-center justify-between bg-black/50 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Require Release</span>
                    <input
                      type="checkbox"
                      checked={editingNote.requireRelease !== false}
                      onChange={e => setEditingNote({ ...editingNote, requireRelease: e.target.checked })}
                      className="w-5 h-5 accent-pink-500"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 block">Evolution (Mutation)</label>
                <select
                  className="w-full bg-black border border-white/10 p-4 rounded-2xl text-sm text-white focus:border-pink-500 outline-none"
                  value={editingNote.mutationType || ''}
                  onChange={e => {
                    const val = e.target.value;
                    setEditingNote({
                      ...editingNote,
                      mutationType: val ? val as NoteType : undefined,
                      mutationCount: val ? (editingNote.mutationCount || 1) : undefined
                    });
                  }}
                >
                  <option value="">No Mutation</option>
                  <option value={NoteType.CLICK}>Spawn Clicks</option>
                  <option value={NoteType.HOLD_CLICK}>Spawn Auto-Clicks</option>
                  <option value={NoteType.MINE}>Spawn Mines</option>
                </select>
              </div>

              {editingNote.mutationType && (
                <div>
                  <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                    <span>Quantity</span>
                    <span className="text-white">{editingNote.mutationCount}</span>
                  </div>
                  <input type="range" min="1" max="8" step="1" value={editingNote.mutationCount || 1} onChange={e => setEditingNote({ ...editingNote, mutationCount: parseInt(e.target.value) })} className="w-full accent-yellow-400" />
                </div>
              )}
            </div>

            <div className="flex gap-4 mt-10">
              <button className="flex-1 py-4 bg-gray-800 hover:bg-gray-700 rounded-2xl font-black uppercase text-xs transition-all" onClick={() => setEditingNote(null)}>Cancel</button>
              <button className="flex-1 py-4 bg-pink-600 hover:bg-pink-500 rounded-2xl font-black uppercase text-xs shadow-xl shadow-pink-900/40 transition-all" onClick={() => handleSaveNoteProperties(editingNote)}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {editingEvent && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl p-4">
          <div className="bg-[#1a1a2e] p-8 rounded-[40px] border border-white/10 shadow-[0_0_100px_rgba(0,0,0,1)] w-full max-w-sm">
            <div className="text-center mb-8">
              <div className="inline-block px-4 py-1 bg-purple-500/20 text-purple-400 rounded-full text-[10px] font-black uppercase tracking-widest mb-2 border border-purple-500/30">Event Config</div>
              <select
                className="w-full bg-transparent text-3xl font-black text-center text-white italic outline-none cursor-pointer hover:text-purple-400 transition-colors uppercase"
                value={editingEvent.type}
                onChange={e => setEditingEvent({ ...editingEvent, type: e.target.value as EventType })}
              >
                {Object.values(EventType).map(t => (
                  <option key={t} value={t} className="bg-[#1a1a2e] text-lg font-bold">
                    {t.replace('CAMERA_', '').replace('NOTES_', '').replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                  <span>Target Value</span>
                  <span className="text-white">{editingEvent.value}</span>
                </div>
                <input
                  type="range"
                  min={editingEvent.type === EventType.CAMERA_ZOOM ? 0.1 : (editingEvent.type === EventType.CAMERA_ROTATION ? -180 : (editingEvent.type === EventType.NOTES_SPEED ? 0.1 : 0))}
                  max={editingEvent.type === EventType.CAMERA_ZOOM ? 5.0 : (editingEvent.type === EventType.CAMERA_ROTATION ? 180 : (editingEvent.type === EventType.NOTES_SPEED ? 10.0 : 1))}
                  step={editingEvent.type === EventType.CAMERA_ZOOM ? 0.1 : (editingEvent.type === EventType.CAMERA_ROTATION ? 5 : 0.1)}
                  value={editingEvent.value}
                  onChange={e => setEditingEvent({ ...editingEvent, value: parseFloat(e.target.value) })}
                  className="w-full accent-purple-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                  <span>Duration (ms)</span>
                  <span className="text-white">{editingEvent.duration}ms</span>
                </div>
                <input type="range" min="0" max="5000" step="100" value={editingEvent.duration} onChange={e => setEditingEvent({ ...editingEvent, duration: parseInt(e.target.value) })} className="w-full accent-purple-400" />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 block">Easing</label>
                <select
                  className="w-full bg-black border border-white/10 p-4 rounded-2xl text-sm text-white focus:border-purple-500 outline-none"
                  value={editingEvent.easing}
                  onChange={e => setEditingEvent({ ...editingEvent, easing: e.target.value as EasingType })}
                >
                  {Object.values(EasingType).map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>

              {editingEvent.type === EventType.TEXT_EFFECT && (
                <div className="space-y-4 pt-4 border-t border-white/10">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Text Content</label>
                    <input
                      className="w-full bg-black border border-white/10 p-3 rounded-xl text-sm text-white focus:border-purple-500 outline-none"
                      value={editingEvent.text || ''}
                      onChange={e => setEditingEvent({ ...editingEvent, text: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Appearance</label>
                      <select
                        className="w-full bg-black border border-white/10 p-2 rounded-xl text-[10px] text-white focus:border-purple-500 outline-none"
                        value={editingEvent.appearance || 'VISIBLE'}
                        onChange={e => setEditingEvent({ ...editingEvent, appearance: e.target.value as any })}
                      >
                        <option value="GRADUAL">Gradual</option>
                        <option value="VISIBLE">Visible</option>
                        <option value="LEFT_CENTER">Left to Center</option>
                        <option value="RIGHT_CENTER">Right to Center</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Anim Dur (ms)</label>
                      <input
                        type="number"
                        className="w-full bg-black border border-white/10 p-2 rounded-xl text-[10px] text-white focus:border-purple-500 outline-none"
                        value={editingEvent.animDuration || 0}
                        onChange={e => setEditingEvent({ ...editingEvent, animDuration: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Font</label>
                      <input
                        className="w-full bg-black border border-white/10 p-2 rounded-xl text-[10px] text-white focus:border-purple-500 outline-none"
                        value={editingEvent.font || 'Arial'}
                        onChange={e => setEditingEvent({ ...editingEvent, font: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Font Size</label>
                      <input
                        type="number"
                        className="w-full bg-black border border-white/10 p-2 rounded-xl text-[10px] text-white focus:border-purple-500 outline-none"
                        value={editingEvent.fontSize || 40}
                        onChange={e => setEditingEvent({ ...editingEvent, fontSize: parseInt(e.target.value) || 40 })}
                      />
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={editingEvent.isBold} onChange={e => setEditingEvent({ ...editingEvent, isBold: e.target.checked })} />
                      <span className="text-[10px] font-bold text-gray-400">Bold</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={editingEvent.isItalic} onChange={e => setEditingEvent({ ...editingEvent, isItalic: e.target.checked })} />
                      <span className="text-[10px] font-bold text-gray-400">Italic</span>
                    </label>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Color</label>
                    <input
                      type="color"
                      className="w-full h-8 bg-black border border-white/10 rounded-xl cursor-pointer"
                      value={editingEvent.color || '#ffffff'}
                      onChange={e => setEditingEvent({ ...editingEvent, color: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Border Width</label>
                      <input type="number" className="w-full bg-black border border-white/10 p-2 rounded-xl text-[10px] text-white" value={editingEvent.borderWidth || 0} onChange={e => setEditingEvent({ ...editingEvent, borderWidth: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Border Color</label>
                      <input type="color" className="w-full h-6 rounded-lg overflow-hidden" value={editingEvent.borderColor || '#000000'} onChange={e => setEditingEvent({ ...editingEvent, borderColor: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Shadow/Glow Blur</label>
                      <input type="number" className="w-full bg-black border border-white/10 p-2 rounded-xl text-[10px] text-white" value={editingEvent.shadowBlur || 0} onChange={e => setEditingEvent({ ...editingEvent, shadowBlur: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Shadow/Glow Color</label>
                      <input type="color" className="w-full h-6 rounded-lg overflow-hidden" value={editingEvent.shadowColor || '#000000'} onChange={e => setEditingEvent({ ...editingEvent, shadowColor: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-4 mt-10">
              <button className="flex-1 py-4 bg-gray-800 hover:bg-gray-700 rounded-2xl font-black uppercase text-xs transition-all" onClick={() => setEditingEvent(null)}>Cancel</button>
              <button className="flex-1 py-4 bg-purple-600 hover:bg-purple-500 rounded-2xl font-black uppercase text-xs shadow-xl shadow-purple-900/40 transition-all" onClick={() => handleSaveEventProperties(editingEvent)}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {audioUrl && <audio ref={audioRef} src={audioUrl} className="hidden" preload="auto" />}
    </div>
  );
};

export default LevelEditor;