import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Beatmap, GameSettings, KeyMode } from '../types';
import { createBlankMap, dbHelper, DEFAULT_KEY_BINDINGS } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import AuthModal from './AuthModal';
import { PublicBeatmap } from '../lib/supabase';

interface MainMenuProps {
  onStart: (map: Beatmap) => void;
  onEdit: (map?: Beatmap) => void;
  settings: GameSettings;
  onSettingsChange: (settings: GameSettings) => void;
}

type TabType = 'your_beatmaps' | 'public_beatmaps';

const MainMenu: React.FC<MainMenuProps> = ({ onStart, onEdit, settings, onSettingsChange }) => {
  const {
    user,
    profile,
    isGuest,
    signOut,
    updateUsername,
    getAllUserBeatmaps,
    getPublicBeatmaps,
    getPublicBeatmap,
    downloadBeatmap,
    rateBeatmap,
    isConfigured,
    uploadBeatmap,
    deleteBeatmap,
    subscribeToRealtime,
    isRealtimeConnected
  } = useAuth();
  const { success, error: toastError, info, warning } = useToast();
  const [showSettings, setShowSettings] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('your_beatmaps');
  const [savedMaps, setSavedMaps] = useState<Beatmap[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [publicBeatmaps, setPublicBeatmaps] = useState<PublicBeatmap[]>([]);
  const [isLoadingPublic, setIsLoadingPublic] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loadingBeatmapId, setLoadingBeatmapId] = useState<string | null>(null);
  const [rebindingKeyIndex, setRebindingKeyIndex] = useState<number | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [newUsername, setNewUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState<string | null>(null);
  const [openRatingMapId, setOpenRatingMapId] = useState<string | null>(null);
  const initialLoadDoneRef = useRef(false);

  // Full load: fetches everything (used only on first load or for guest users)
  const loadMapsFull = async () => {
    let maps: Beatmap[] = [];
    if (user && isConfigured) {
      maps = await getAllUserBeatmaps();
    } else {
      maps = await dbHelper.getMaps();
    }

    setSavedMaps(maps);
    if (maps.length > 0 && !selectedMapId) {
      setSelectedMapId(maps[0].id);
    }

    initialLoadDoneRef.current = true;
  };

  const loadPublicBeatmaps = async () => {
    if (isConfigured) {
      const maps = await getPublicBeatmaps(searchQuery);
      setPublicBeatmaps(maps);
    }
  };

  // Convert PublicBeatmap to Beatmap format
  const publicToBeatmap = (pb: PublicBeatmap): Beatmap => ({
    id: pb.id,
    name: pb.name,
    artist: pb.artist,
    duration: pb.duration,
    difficulty: pb.difficulty,
    notes: pb.notes,
    events: pb.events,
    audioData: pb.audio_data,
    bpm: pb.bpm,
    isPublic: pb.is_public
  });

  // Real-time subscription handlers
  const handleBeatmapInsert = useCallback((beatmap: PublicBeatmap) => {
    console.log('[Realtime] Beatmap inserted:', beatmap.id);

    // Check if this is user's beatmap or public beatmap
    const isUserBeatmap = user && beatmap.user_id === user.id;

    if (isUserBeatmap) {
      // Add to user's beatmaps list
      setSavedMaps(prev => {
        const exists = prev.some(m => m.id === beatmap.id);
        if (exists) return prev;
        return [publicToBeatmap(beatmap), ...prev];
      });
    }

    // Also add to public beatmaps if public
    if (beatmap.is_public) {
      setPublicBeatmaps(prev => {
        const exists = prev.some(m => m.id === beatmap.id);
        if (exists) return prev;
        return [beatmap, ...prev];
      });
    }
  }, [user]);

  const handleBeatmapUpdate = useCallback((beatmap: PublicBeatmap) => {
    console.log('[Realtime] Beatmap updated:', beatmap.id);

    const isUserBeatmap = user && beatmap.user_id === user.id;

    if (isUserBeatmap) {
      // Update in user's beatmaps list
      setSavedMaps(prev => prev.map(m =>
        m.id === beatmap.id ? publicToBeatmap(beatmap) : m
      ));
    }

    // Update in public beatmaps list
    if (beatmap.is_public) {
      setPublicBeatmaps(prev => prev.map(m =>
        m.id === beatmap.id ? beatmap : m
      ));
    }
  }, [user]);

  const handleBeatmapDelete = useCallback((beatmapId: string) => {
    console.log('[Realtime] Beatmap deleted:', beatmapId);

    // Remove from user's beatmaps
    setSavedMaps(prev => {
      const filtered = prev.filter(m => m.id !== beatmapId);
      // Update selected map if needed
      if (selectedMapId === beatmapId && filtered.length > 0) {
        setSelectedMapId(filtered[0].id);
      } else if (filtered.length === 0) {
        setSelectedMapId(null);
      }
      return filtered;
    });

    // Remove from public beatmaps
    setPublicBeatmaps(prev => prev.filter(m => m.id !== beatmapId));
  }, [selectedMapId]);

  const handleProfileUpdate = useCallback((updatedProfile: any) => {
    console.log('[Realtime] Profile updated:', updatedProfile);
    // Profile updates are handled by AuthContext
  }, []);

  const handleRatingChange = useCallback((beatmapId: string, rating: number, ratingCount: number) => {
    console.log('[Realtime] Rating changed for:', beatmapId, rating, ratingCount);

    // Update rating in public beatmaps list
    setPublicBeatmaps(prev => prev.map(m =>
      m.id === beatmapId
        ? { ...m, rating, rating_count: ratingCount }
        : m
    ));
  }, []);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!isConfigured) return;

    const unsubscribe = subscribeToRealtime({
      onBeatmapInsert: handleBeatmapInsert,
      onBeatmapUpdate: handleBeatmapUpdate,
      onBeatmapDelete: handleBeatmapDelete,
      onProfileUpdate: handleProfileUpdate,
      onRatingChange: handleRatingChange
    });

    return () => {
      unsubscribe();
    };
  }, [
    isConfigured,
    subscribeToRealtime,
    handleBeatmapInsert,
    handleBeatmapUpdate,
    handleBeatmapDelete,
    handleProfileUpdate,
    handleRatingChange
  ]);

  // Initial load when user changes
  useEffect(() => {
    initialLoadDoneRef.current = false;
    loadMapsFull();
  }, [user]);

  useEffect(() => {
    if (activeTab === 'public_beatmaps') {
      loadPublicBeatmaps();
    }
  }, [activeTab]);

  // Reload public beatmaps when search query changes
  useEffect(() => {
    if (activeTab === 'public_beatmaps') {
      loadPublicBeatmaps();
    }
  }, [searchQuery]);

  const handleDeleteMap = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this level?")) {
      // Optimistic UI update: Remove from list immediately
      const remaining = savedMaps.filter(m => m.id !== id);
      setSavedMaps(remaining);

      if (selectedMapId === id) {
        setSelectedMapId(remaining.length > 0 ? remaining[0].id : null);
      }

      // Perform deletion in background
      deleteBeatmap(id).catch(err => {
        console.error("Failed to delete map:", err);
        toastError("Failed to delete beatmap fully. Please refresh.");
        loadMapsFull(); // Revert state on error
      });
    }
  };

  const updateSetting = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const updateKeyBinding = (index: number, key: string) => {
    const newBindings = [...(settings.keyBindings || DEFAULT_KEY_BINDINGS)];
    newBindings[index] = key.toUpperCase();
    onSettingsChange({ ...settings, keyBindings: newBindings });
    setRebindingKeyIndex(null);
  };

  const handleKeyRebind = useCallback((e: KeyboardEvent) => {
    if (rebindingKeyIndex === null) return;
    if (e.key === 'Escape') {
      setRebindingKeyIndex(null);
      return;
    }
    // Only accept single character keys or specific keys
    if (e.key.length === 1) {
      updateKeyBinding(rebindingKeyIndex, e.key.toUpperCase());
    }
  }, [rebindingKeyIndex, settings.keyBindings]);

  useEffect(() => {
    if (rebindingKeyIndex !== null) {
      window.addEventListener('keydown', handleKeyRebind);
      return () => window.removeEventListener('keydown', handleKeyRebind);
    }
  }, [rebindingKeyIndex, handleKeyRebind]);

  // Close rating popup when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setOpenRatingMapId(null);
    if (openRatingMapId !== null) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [openRatingMapId]);

  const selectedMap = savedMaps.find(m => m.id === selectedMapId);
  const previewAudioSrc = selectedMap?.audioUrl || selectedMap?.audioData || '';

  const handlePlayClick = () => {
    if (selectedMap) {
      onStart(selectedMap);
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedMap) {
      onEdit(selectedMap);
    }
  };

  const handleChangeUsername = async () => {
    if (!newUsername.trim()) return;
    setUsernameError(null);
    setUsernameSuccess(null);

    const { error } = await updateUsername(newUsername.trim());
    if (error) {
      setUsernameError(error.message || 'Failed to update username');
    } else {
      setUsernameSuccess('Username updated successfully!');
      setNewUsername('');
      setTimeout(() => setUsernameSuccess(null), 3000);
    }
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row items-center justify-center lg:justify-between relative overflow-auto bg-gradient-to-br from-gray-900 via-indigo-950 to-black p-4 md:p-6 lg:p-10 h-full">
      {/* Animated decorative background elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[400px] md:w-[600px] lg:w-[800px] h-[400px] md:h-[600px] lg:h-[800px] bg-pink-600 rounded-full mix-blend-screen filter blur-[100px] md:blur-[120px] lg:blur-[150px] opacity-20 animate-float"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] md:w-[600px] lg:w-[800px] h-[400px] md:h-[600px] lg:h-[800px] bg-blue-600 rounded-full mix-blend-screen filter blur-[100px] md:blur-[120px] lg:blur-[150px] opacity-20 animate-float" style={{ animationDelay: '2s' }}></div>
      <div className="absolute top-[30%] right-[20%] w-[200px] md:w-[300px] lg:w-[400px] h-[200px] md:h-[300px] lg:h-[400px] bg-purple-600 rounded-full mix-blend-screen filter blur-[80px] md:blur-[100px] lg:blur-[120px] opacity-15 animate-float" style={{ animationDelay: '4s' }}></div>

      {/* Floating particles */}
      {[...Array(12)].map((_, i) => (
        <div
          key={i}
          className="particle hidden md:block"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            background: i % 3 === 0 ? '#ec4899' : i % 3 === 1 ? '#a855f7' : '#3b82f6',
            animationDelay: `${i * 0.5}s`,
            width: `${3 + Math.random() * 4}px`,
            height: `${3 + Math.random() * 4}px`,
            opacity: 0.4 + Math.random() * 0.4,
          }}
        />
      ))}

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        mode={authMode}
        onSwitchMode={(mode) => setAuthMode(mode)}
      />

      {/* How to Play Modal */}
      {showHowToPlay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-gray-900 border-2 border-purple-500 rounded-3xl p-8 max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto custom-scrollbar shadow-[0_0_50px_rgba(168,85,247,0.3)] animate-bounce-in gradient-border">
            <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
              <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500 animate-text-glow">
                How to Play
              </h2>
              <button
                onClick={() => setShowHowToPlay(false)}
                className="text-white hover:text-pink-400 text-3xl font-bold transition-all duration-300 hover:scale-110 hover:rotate-90"
              >
                ×
              </button>
            </div>

            <div className="space-y-6 text-gray-200">
              {/* Game Overview */}
              <div className="bg-white/5 rounded-xl p-4">
                <h3 className="text-xl font-bold text-pink-400 mb-2">Objective</h3>
                <p className="text-gray-300">
                  Hit the falling notes at the right time as they reach the bottom of the screen.
                  The goal is to achieve the highest score possible by hitting notes accurately and building combos!
                </p>
              </div>

              {/* Controls */}
              <div className="bg-white/5 rounded-xl p-4">
                <h3 className="text-xl font-bold text-blue-400 mb-2">Controls</h3>
                <ul className="space-y-2 text-gray-300">
                  <li className="flex items-center gap-2">
                    <span className="bg-gray-700 px-2 py-1 rounded font-mono text-sm">Any Key</span>
                    <span>Hit notes (in All Keys mode)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="bg-gray-700 px-2 py-1 rounded font-mono text-sm">A S K L</span>
                    <span>Hit notes (in Four Keys mode - customizable)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="bg-gray-700 px-2 py-1 rounded font-mono text-sm">ESC</span>
                    <span>Pause the game</span>
                  </li>
                </ul>
              </div>

              {/* Note Types */}
              <div className="bg-white/5 rounded-xl p-4">
                <h3 className="text-xl font-bold text-green-400 mb-3">Note Types</h3>
                <div className="space-y-3">
                  {/* Click Note - Sky Blue #38bdf8 */}
                  <div className="flex items-start gap-3 bg-black/30 rounded-lg p-3">
                    <div className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center shadow-[0_0_15px_rgba(56,189,248,0.6)]" style={{ background: 'radial-gradient(circle at 30% 30%, #ffffff, #38bdf8 40%, #000000)' }}>
                      <div className="w-8 h-8 rounded-full border-2 border-white/50"></div>
                    </div>
                    <div>
                      <h4 className="font-bold text-sky-400">Click Note</h4>
                      <p className="text-sm text-gray-400">Press any key when this note reaches the hit zone (the white line at the bottom). Timing matters - aim for PERFECT hits!</p>
                    </div>
                  </div>

                  {/* Hold Note - Purple #a855f7 */}
                  <div className="flex items-start gap-3 bg-black/30 rounded-lg p-3">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div className="w-12 h-8 rounded-t-lg shadow-[0_0_15px_rgba(168,85,247,0.6)]" style={{ background: 'radial-gradient(circle at 30% 30%, #ffffff, #a855f7 40%, #000000)' }}></div>
                      <div className="w-6 h-16 bg-gradient-to-b from-purple-500 to-purple-600 shadow-[0_0_10px_rgba(168,85,247,0.4)]"></div>
                      <div className="w-12 h-8 rounded-b-lg bg-purple-600 shadow-[0_0_10px_rgba(168,85,247,0.4)]"></div>
                    </div>
                    <div>
                      <h4 className="font-bold text-purple-400">Hold Note</h4>
                      <p className="text-sm text-gray-400">Press and hold when the note head reaches the hit zone. Keep holding until the tail ends. Look at the end ball color:</p>
                      <ul className="text-sm text-gray-400 mt-1 ml-4 list-disc">
                        <li><span className="text-yellow-400 font-bold">Yellow end</span>: You MUST release at the right moment! Releasing too early or too late breaks your combo.</li>
                        <li><span className="text-white font-bold">White end</span>: Auto-completes when the tail ends. Just keep holding, no need to release precisely.</li>
                      </ul>
                    </div>
                  </div>

                  {/* Mine - Red #ef4444 */}
                  <div className="flex items-start gap-3 bg-black/30 rounded-lg p-3">
                    <div className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center shadow-[0_0_15px_rgba(239,68,68,0.6)]" style={{ background: 'radial-gradient(circle at 30% 30%, #ffffff, #ef4444 40%, #000000)' }}>
                      <span className="text-white font-black text-xl">!</span>
                    </div>
                    <div>
                      <h4 className="font-bold text-red-400">Mine</h4>
                      <p className="text-sm text-gray-400">AVOID these! Do not press any key when a mine reaches the hit zone. Hitting a mine costs you -100 points and breaks your combo! Mines pass through harmlessly if you ignore them.</p>
                    </div>
                  </div>

                  {/* Hold Click Note - Teal #2dd4bf */}
                  <div className="flex items-start gap-3 bg-black/30 rounded-lg p-3">
                    <div className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center shadow-[0_0_15px_rgba(45,212,191,0.6)]" style={{ background: 'radial-gradient(circle at 30% 30%, #ffffff, #2dd4bf 40%, #000000)' }}>
                      <div className="w-8 h-8 rounded-full border-2 border-white/50"></div>
                    </div>
                    <div>
                      <h4 className="font-bold text-teal-400">Hold Click Note</h4>
                      <p className="text-sm text-gray-400">A special note with a unique high-pitched sound. Hit it like a regular click note - just a quick tap! These often appear alongside other notes for multi-hit patterns.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Scoring */}
              <div className="bg-white/5 rounded-xl p-4">
                <h3 className="text-xl font-bold text-yellow-400 mb-2">Scoring</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between bg-black/30 rounded-lg px-3 py-2">
                    <span className="text-yellow-400 font-bold">PERFECT</span>
                    <span className="text-white">+100 pts</span>
                  </div>
                  <div className="flex justify-between bg-black/30 rounded-lg px-3 py-2">
                    <span className="text-green-400 font-bold">GOOD</span>
                    <span className="text-white">+50 pts</span>
                  </div>
                  <div className="flex justify-between bg-black/30 rounded-lg px-3 py-2">
                    <span className="text-gray-400 font-bold">MISS</span>
                    <span className="text-white">-30 pts</span>
                  </div>
                  <div className="flex justify-between bg-black/30 rounded-lg px-3 py-2">
                    <span className="text-red-500 font-bold">MINE HIT</span>
                    <span className="text-white">-100 pts</span>
                  </div>
                </div>
                <p className="text-gray-400 text-sm mt-3">
                  <strong className="text-white">Combo Bonus:</strong> Keep hitting notes consecutively to build your combo multiplier! Missing a note or hitting a mine resets your combo to zero.
                </p>
              </div>

              {/* Timing Windows */}
              <div className="bg-white/5 rounded-xl p-4">
                <h3 className="text-xl font-bold text-cyan-400 mb-2">Timing Windows</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between bg-black/30 rounded-lg px-3 py-2">
                    <span className="text-yellow-400 font-bold">PERFECT</span>
                    <span className="text-white">Within 90ms</span>
                  </div>
                  <div className="flex justify-between bg-black/30 rounded-lg px-3 py-2">
                    <span className="text-green-400 font-bold">GOOD</span>
                    <span className="text-white">Within 150ms</span>
                  </div>
                  <div className="flex justify-between bg-black/30 rounded-lg px-3 py-2">
                    <span className="text-gray-400 font-bold">MISS</span>
                    <span className="text-white">Beyond 200ms</span>
                  </div>
                </div>
              </div>

              {/* Tips */}
              <div className="bg-white/5 rounded-xl p-4">
                <h3 className="text-xl font-bold text-orange-400 mb-2">Tips</h3>
                <ul className="space-y-1 text-sm text-gray-300">
                  <li>- Start with slower songs to get used to the timing</li>
                  <li>- Use Practice Mode in settings to slow down the game</li>
                  <li>- Watch the approach speed - some notes may be faster than others!</li>
                  <li>- For hold notes, check the end ball color to know if you need to release</li>
                  <li>- Yellow end = release precisely, White end = just hold until it ends</li>
                  <li>- Missing a note breaks your combo - accuracy is key!</li>
                  <li>- Create your own beatmaps in the Level Editor!</li>
                </ul>
              </div>
            </div>

            <button
              onClick={() => setShowHowToPlay(false)}
              className="w-full mt-6 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(168,85,247,0.5)] text-white"
            >
              Got it!
            </button>
          </div>
        </div>
      )}

      {/* How to Play Button - Top Left */}
      <div className="absolute top-4 left-4 z-50 animate-slide-in-left">
        <button
          onClick={() => setShowHowToPlay(true)}
          className="px-4 py-2 bg-purple-600/80 hover:bg-purple-500 rounded-full font-bold text-sm transition-all duration-300 border border-purple-400/50 flex items-center gap-2 hover-lift hover-glow ripple-btn"
        >
          <span className="text-lg animate-bounce">?</span>
          How to Play
        </button>
      </div>

      {/* User Account Section - Top Right */}
      <div className="absolute top-4 right-4 z-50 animate-slide-in-right">
        {user ? (
          <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md rounded-full px-4 py-2 border border-white/10 hover:border-pink-500/50 transition-all duration-300 hover-lift">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center font-bold text-sm animate-pulse-glow">
              {profile?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
            <span className="text-white font-bold">{profile?.username || 'User'}</span>
            <button
              onClick={signOut}
              className="text-gray-400 hover:text-pink-400 text-sm font-bold transition-all duration-300 hover:scale-105"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => { setShowAuthModal(true); setAuthMode('login'); }}
              className="px-4 py-2 bg-pink-600/80 hover:bg-pink-500 rounded-full font-bold text-sm transition-all duration-300 border border-pink-400/50 hover-lift hover-glow ripple-btn"
            >
              Sign In
            </button>
            <button
              onClick={() => { setShowAuthModal(true); setAuthMode('register'); }}
              className="px-4 py-2 bg-gray-800/80 hover:bg-gray-700 rounded-full font-bold text-sm transition-all duration-300 border border-gray-600 hover-lift ripple-btn"
            >
              Sign Up
            </button>
          </div>
        )}
      </div>

      {/* Preview Music Logic */}
      {previewAudioSrc && (
        <audio
          src={previewAudioSrc}
          autoPlay
          loop
          ref={(el) => { if (el) el.volume = (settings.masterVolume ?? 1.0) * settings.musicVolume * 0.4; }} // Preview plays a bit quieter
          className="hidden"
        />
      )}

      {/* Left Side: Big Logo & Menu */}
      <div className="z-10 flex flex-col items-center justify-center w-full lg:w-1/2 py-4 lg:py-0">
        {!showSettings ? (
          <div className="flex flex-col items-center gap-4 md:gap-6 lg:gap-8 relative animate-slide-in-left">
            {/* Osu-like Big Button */}
            <div
              className={`relative w-48 h-48 md:w-64 md:h-64 lg:w-80 lg:h-80 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center transform transition-all duration-500 border-4 border-white/20 group ${selectedMap ? 'cursor-pointer animate-rotate-glow hover:scale-110' : 'opacity-50 cursor-not-allowed'
                }`}
              onClick={handlePlayClick}
            >
              {/* Outer spinning ring */}
              <div className="absolute inset-0 rounded-full border-2 border-dashed border-white/30 animate-spin-slow"></div>
              {/* Inner spinning ring (opposite direction) */}
              <div className="absolute inset-2 md:inset-3 lg:inset-4 rounded-full border-2 border-dashed border-white/20" style={{ animation: 'spinSlow 15s linear infinite reverse' }}></div>
              {/* Pulsing inner glow */}
              <div className="absolute inset-4 md:inset-6 lg:inset-8 rounded-full bg-white/5 animate-pulse"></div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-white tracking-tighter drop-shadow-lg z-10 italic animate-text-glow group-hover:scale-110 transition-transform duration-300">
                RUSHEB
              </h1>
              {selectedMap && (
                <div className="absolute -bottom-2 md:-bottom-3 lg:-bottom-4 bg-gray-900 text-pink-400 font-bold px-3 md:px-4 lg:px-6 py-1 md:py-2 rounded-full border-2 border-pink-500 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-4 group-hover:translate-y-0 animate-pulse-glow text-xs md:text-sm lg:text-base">
                  CLICK TO PLAY
                </div>
              )}
            </div>

            <p className="text-gray-400 italic mt-2 md:mt-4 animate-slide-in-up delay-200 text-center px-4">
              {selectedMap ? (
                <>Selected: <span className="text-white font-bold">{selectedMap.name}</span></>
              ) : (
                <span className="text-yellow-400">No beatmap selected. Create or import one!</span>
              )}
            </p>

            {/* Real-time connection indicator */}
            {isConfigured && !isGuest && (
              <div className="flex items-center gap-2 mt-1 md:mt-2">
                <div className={`w-2 h-2 rounded-full ${isRealtimeConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`}></div>
                <span className={`text-xs ${isRealtimeConnected ? 'text-green-400' : 'text-gray-500'}`}>
                  {isRealtimeConnected ? 'Real-time sync active' : 'Connecting...'}
                </span>
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-2 md:gap-3 lg:gap-4 mt-2 md:mt-4 animate-slide-in-up delay-400">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isGuest) {
                    setShowAuthModal(true);
                    setAuthMode('login');
                    return;
                  }
                  onEdit(createBlankMap());
                }}
                className={`py-2 md:py-3 px-4 md:px-6 lg:px-8 backdrop-blur-sm rounded-full font-bold transition-all duration-300 border ripple-btn text-sm md:text-base ${isGuest
                  ? 'bg-gray-700/50 border-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600/80 hover:bg-green-500 border-green-400 shadow-[0_0_15px_rgba(34,197,94,0.5)] hover:shadow-[0_0_25px_rgba(34,197,94,0.7)] hover:scale-105 hover-lift'
                  }`}
                title={isGuest ? 'Sign in to create levels' : ''}
              >
                + NEW LEVEL
              </button>
              <button
                onClick={handleEditClick}
                disabled={!selectedMap || isGuest}
                className={`py-2 md:py-3 px-4 md:px-6 lg:px-8 backdrop-blur-sm rounded-full font-bold transition-all duration-300 border ripple-btn text-sm md:text-base ${isGuest
                  ? 'bg-gray-700/50 border-gray-600 text-gray-400 cursor-not-allowed'
                  : selectedMap
                    ? 'bg-blue-600/80 hover:bg-blue-500 border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.5)] hover:shadow-[0_0_25px_rgba(59,130,246,0.7)] hover:scale-105 hover-lift'
                    : 'bg-gray-700/50 border-gray-600 text-gray-400 cursor-not-allowed'
                  }`}
                title={isGuest ? 'Sign in to edit levels' : ''}
              >
                EDIT LEVEL
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowSettings(true); }}
                className="py-2 md:py-3 px-4 md:px-6 lg:px-8 bg-gray-800/80 hover:bg-gray-700 backdrop-blur-sm rounded-full font-bold transition-all duration-300 border border-gray-600 hover:border-gray-500 hover:scale-105 ripple-btn hover-lift text-sm md:text-base"
              >
                SETTINGS
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 md:gap-4 w-full max-w-md bg-black/60 backdrop-blur-md p-4 md:p-6 lg:p-8 rounded-3xl border border-white/10 shadow-2xl overflow-y-auto max-h-[80vh] custom-scrollbar animate-fade-in-scale gradient-border mx-4">
            <h2 className="text-xl md:text-2xl lg:text-3xl font-black mb-2 md:mb-4 lg:mb-6 text-pink-400 border-b border-white/10 pb-2 md:pb-4 flex justify-between">
              <span className="animate-text-glow">Settings</span>
              <button onClick={() => setShowSettings(false)} className="text-white hover:text-pink-400 transition-all duration-300 hover:scale-110 hover:rotate-90 text-xl md:text-2xl">×</button>
            </h2>

            <label className="flex items-center justify-between cursor-pointer group bg-white/5 p-3 md:p-4 rounded-xl hover:bg-white/10 transition-all duration-300 border border-transparent hover:border-pink-500/30 hover-lift">
              <span className="font-bold text-gray-200 text-sm md:text-base">Practice Mode (Turtle Speed)</span>
              <input
                type="checkbox"
                checked={settings.practiceMode}
                onChange={(e) => updateSetting('practiceMode', e.target.checked)}
                className="w-6 h-6 accent-pink-500 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group bg-white/5 p-4 rounded-xl hover:bg-white/10 transition-all duration-300 border border-transparent hover:border-pink-500/30 hover-lift">
              <span className="font-bold text-gray-200">Crazy Keyboard (Visual Flair)</span>
              <input
                type="checkbox"
                checked={settings.crazyKeyboardMode}
                onChange={(e) => updateSetting('crazyKeyboardMode', e.target.checked)}
                className="w-6 h-6 accent-pink-500 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group bg-white/5 p-4 rounded-xl hover:bg-white/10 transition-all duration-300 border border-transparent hover:border-pink-500/30 hover-lift">
              <span className="font-bold text-gray-200">Stupidly Crazy Effects</span>
              <input
                type="checkbox"
                checked={settings.stupidlyCrazyEffects}
                onChange={(e) => updateSetting('stupidlyCrazyEffects', e.target.checked)}
                className="w-6 h-6 accent-pink-500"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group bg-white/5 p-4 rounded-xl hover:bg-white/10 transition-all duration-300 border border-transparent hover:border-pink-500/30 hover-lift">
              <span className="font-bold text-gray-200">Auto Play</span>
              <input
                type="checkbox"
                checked={settings.autoPlay}
                onChange={(e) => updateSetting('autoPlay', e.target.checked)}
                className="w-6 h-6 accent-pink-500"
              />
            </label>

            <div className="flex flex-col gap-2 mt-2 bg-white/5 p-4 rounded-xl">
              <span className="font-bold text-gray-200">Key Mode</span>
              <select
                value={settings.keyMode || KeyMode.ALL_KEYS}
                onChange={(e) => updateSetting('keyMode', e.target.value as KeyMode)}
                className="bg-gray-900 text-white p-3 rounded-lg outline-none border border-gray-700 focus:border-pink-500 font-bold cursor-pointer"
              >
                <option value={KeyMode.ALL_KEYS}>All Keys (Any key works)</option>
                <option value={KeyMode.FOUR_KEYS}>Four Keys (Custom bindings)</option>
              </select>
            </div>

            {(settings.keyMode === KeyMode.FOUR_KEYS) && (
              <div className="flex flex-col gap-3 mt-2 bg-white/5 p-4 rounded-xl">
                <span className="font-bold text-gray-200">Key Bindings (Click to change)</span>
                <div className="flex gap-2 justify-center">
                  {(settings.keyBindings || DEFAULT_KEY_BINDINGS).map((key, index) => (
                    <button
                      key={index}
                      onClick={() => setRebindingKeyIndex(index)}
                      className={`w-14 h-14 rounded-lg font-black text-xl transition-all ${rebindingKeyIndex === index
                        ? 'bg-pink-500 text-white animate-pulse'
                        : 'bg-gray-800 text-white hover:bg-gray-700 border-2 border-gray-600 hover:border-pink-400'
                        }`}
                    >
                      {rebindingKeyIndex === index ? '...' : key}
                    </button>
                  ))}
                </div>
                <p className="text-gray-400 text-sm text-center">
                  {rebindingKeyIndex !== null ? 'Press any key to bind...' : 'Default: A S K L'}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-4 mt-2 bg-white/5 p-4 rounded-xl border border-transparent hover:border-white/10 transition-all duration-300">
              <span className="font-bold text-gray-200 border-b border-gray-700 pb-2">Audio Volumes</span>

              <label className="flex flex-col gap-2 group">
                <div className="flex justify-between">
                  <span className="font-bold text-gray-300">Master Volume</span>
                  <span className="text-white font-bold">{Math.round((settings.masterVolume ?? 1.0) * 100)}%</span>
                </div>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={settings.masterVolume ?? 1.0}
                  onChange={(e) => updateSetting('masterVolume', parseFloat(e.target.value))}
                  className="w-full accent-white cursor-pointer"
                />
              </label>

              <label className="flex flex-col gap-2 group">
                <div className="flex justify-between">
                  <span className="font-bold text-gray-300">SFX Volume</span>
                  <span className="text-pink-400 font-bold">{Math.round(settings.sfxVolume * 100)}%</span>
                </div>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={settings.sfxVolume}
                  onChange={(e) => updateSetting('sfxVolume', parseFloat(e.target.value))}
                  className="w-full accent-pink-500 cursor-pointer"
                />
              </label>

              <label className="flex flex-col gap-2 group">
                <div className="flex justify-between">
                  <span className="font-bold text-gray-300">Music Volume</span>
                  <span className="text-blue-400 font-bold">{Math.round(settings.musicVolume * 100)}%</span>
                </div>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={settings.musicVolume}
                  onChange={(e) => updateSetting('musicVolume', parseFloat(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </label>
            </div>

            {/* Account Settings - Only for logged in users */}
            {user && (
              <div className="flex flex-col gap-2 mt-2 bg-white/5 p-4 rounded-xl border border-transparent hover:border-white/10 transition-all duration-300">
                <span className="font-bold text-gray-200 border-b border-gray-700 pb-2">Account</span>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="New username"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="flex-1 bg-gray-900 text-white p-3 rounded-lg outline-none border border-gray-700 focus:border-pink-500 font-bold transition-all duration-300 focus:ring-2 focus:ring-pink-500/30"
                  />
                  <button
                    onClick={handleChangeUsername}
                    disabled={!newUsername.trim() || newUsername === profile?.username}
                    className={`px-4 py-3 rounded-lg font-bold transition-all duration-300 ripple-btn ${!newUsername.trim() || newUsername === profile?.username
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-pink-600 hover:bg-pink-500 text-white hover:scale-105 hover-glow'
                      }`}
                  >
                    Update
                  </button>
                </div>
                {usernameError && (
                  <p className="text-red-400 text-sm animate-shake">{usernameError}</p>
                )}
                {usernameSuccess && (
                  <p className="text-green-400 text-sm animate-slide-in-up">{usernameSuccess}</p>
                )}
              </div>
            )}

            <button
              onClick={() => setShowSettings(false)}
              className="mt-4 py-4 px-4 bg-gray-700 hover:bg-gray-600 rounded-xl font-black transition-all duration-300 border border-gray-500 text-lg hover:scale-[1.02] ripple-btn hover-lift"
            >
              BACK TO MENU
            </button>
          </div>
        )}
      </div>

      {/* Right Side: Song List */}
      <div className="z-10 flex flex-col w-full lg:w-1/2 max-w-lg py-4 lg:py-0 animate-slide-in-right">
        <div className="bg-black/40 backdrop-blur-md rounded-3xl border border-white/10 p-4 md:p-6 flex flex-col h-[50vh] md:h-[60vh] lg:h-[80vh] shadow-2xl gradient-border animate-fade-in mx-4 lg:mx-0">
          {/* Tab Buttons */}
          <div className="flex gap-2 mb-3 md:mb-4">
            <button
              onClick={() => {
                setActiveTab('your_beatmaps');
                loadMapsFull();
              }}
              className={`flex-1 py-1.5 md:py-2 px-2 md:px-4 rounded-xl font-bold transition-all duration-300 ripple-btn text-sm md:text-base ${activeTab === 'your_beatmaps'
                ? 'bg-pink-600 text-white shadow-[0_0_15px_rgba(236,72,153,0.5)] animate-pulse-glow'
                : 'bg-gray-800/80 text-gray-400 hover:bg-gray-700/80'
                }`}
            >
              Your Beatmaps
            </button>
            <button
              onClick={() => {
                setActiveTab('public_beatmaps');
                loadPublicBeatmaps();
              }}
              className={`flex-1 py-1.5 md:py-2 px-2 md:px-4 rounded-xl font-bold transition-all duration-300 ripple-btn text-sm md:text-base ${activeTab === 'public_beatmaps'
                ? 'bg-pink-600 text-white shadow-[0_0_15px_rgba(236,72,153,0.5)] animate-pulse-glow'
                : 'bg-gray-800/80 text-gray-400 hover:bg-gray-700/80'
                }`}
            >
              Public Beatmaps
            </button>
          </div>

          {activeTab === 'your_beatmaps' && (
            <>
              <div className="flex justify-between items-end mb-2 md:mb-4 border-b border-white/10 pb-2 md:pb-4">
                <h2 className="text-base md:text-xl font-black text-white italic tracking-wider animate-text-glow">YOUR BEATMAPS</h2>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-2 md:space-y-3 custom-scrollbar">
                {savedMaps.length === 0 ? (
                  <div className="text-center text-gray-400 py-4 md:py-8 animate-fade-in">
                    <p className="text-sm md:text-lg mb-1 md:mb-2">No beatmaps yet!</p>
                    <p className="text-xs md:text-sm">Create a new level or import one to get started.</p>
                  </div>
                ) : (
                  savedMaps.map((map, index) => {
                    const isSelected = map.id === selectedMapId;
                    return (
                      <div
                        key={map.id}
                        onClick={() => setSelectedMapId(map.id)}
                        className={`relative p-2 md:p-4 cursor-pointer transition-all duration-300 transform skew-x-[-5deg] border-l-8 card-shine ${isSelected ? 'bg-gradient-to-r from-pink-900/80 to-purple-900/40 border-pink-500 scale-105 ml-2 md:ml-4 shadow-lg animate-pulse-glow' : 'bg-gray-800/80 border-gray-600 hover:bg-gray-700/80 hover:scale-102'}`}
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <div className="transform skew-x-[5deg] flex justify-between items-center">
                          <div className="flex-1 min-w-0">
                            <h3 className={`font-black text-sm md:text-lg truncate transition-all duration-300 ${isSelected ? 'text-white' : 'text-gray-300'}`}>{map.name}</h3>
                            <p className="text-xs md:text-sm text-gray-400">{map.artist} • {(map.duration / 1000).toFixed(1)}s</p>
                            {map.difficulty && (
                              <span className={`text-xs font-bold px-1.5 md:px-2 py-0.5 rounded mt-0.5 md:mt-1 inline-block transition-all duration-300 ${map.difficulty <= 3 ? 'bg-green-500/20 text-green-400' :
                                map.difficulty <= 6 ? 'bg-yellow-500/20 text-yellow-400' :
                                  map.difficulty <= 8 ? 'bg-orange-500/20 text-orange-400' :
                                    'bg-red-500/20 text-red-400'
                                }`}>
                                {map.difficulty <= 3 ? 'Easy' :
                                  map.difficulty <= 6 ? 'Medium' :
                                    map.difficulty <= 8 ? 'Hard' : 'Expert'} ({map.difficulty})
                              </span>
                            )}
                          </div>
                          <button
                            onClick={(e) => handleDeleteMap(e, map.id)}
                            className="text-gray-500 hover:text-red-500 p-1 md:p-2 transition-all duration-300 hover:scale-125 hover:rotate-12"
                            title="Delete Map"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-2 md:mt-4 text-center text-gray-500 text-xs md:text-sm italic border-t border-white/10 pt-2 md:pt-4 animate-slide-in-up">
                Beatmaps are safely stored in your browser's database.
              </div>
            </>
          )}

          {activeTab === 'public_beatmaps' && (
            <>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-2 md:gap-0 mb-2 md:mb-4 border-b border-white/10 pb-2 md:pb-4">
                <h2 className="text-base md:text-xl font-black text-white italic tracking-wider animate-text-glow">PUBLIC BEATMAPS</h2>
                {isConfigured && (
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 md:px-3 py-1 text-xs md:text-sm focus:border-pink-500 focus:outline-none transition-all duration-300 focus:ring-2 focus:ring-pink-500/30 w-full md:w-auto"
                  />
                )}
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-2 md:space-y-3 custom-scrollbar">
                {!isConfigured ? (
                  <div className="text-center text-gray-400 py-4 md:py-8 animate-fade-in">
                    <p className="text-sm md:text-lg mb-1 md:mb-2">Supabase Not Configured</p>
                    <p className="text-xs md:text-sm">Add your Supabase credentials to .env.local to enable public beatmaps.</p>
                  </div>
                ) : publicBeatmaps.length === 0 ? (
                  <div className="text-center text-gray-400 py-4 md:py-8 animate-fade-in">
                    <p className="text-sm md:text-lg mb-1 md:mb-2">No public beatmaps found</p>
                    <p className="text-xs md:text-sm">Be the first to publish a beatmap!</p>
                  </div>
                ) : (
                  publicBeatmaps.map((map, index) => (
                    <div
                      key={map.id}
                      className="relative p-2 md:p-4 bg-gray-800/80 border-l-8 border-purple-500 hover:bg-gray-700/80 transition-all duration-300 group card-shine hover-lift"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex flex-col md:flex-row justify-between items-start gap-2 md:gap-0">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-black text-sm md:text-lg text-white group-hover:text-pink-400 transition-colors duration-300 truncate">{map.name}</h3>
                          <p className="text-xs md:text-sm text-gray-400">{map.artist} • {(map.duration / 1000).toFixed(1)}s</p>
                          <p className="text-xs text-gray-500 mt-0.5 md:mt-1">by {map.user?.username || 'Unknown'}</p>
                          <div className="flex flex-wrap gap-1 md:gap-2 mt-1 md:mt-2 items-center">
                            {map.difficulty && (
                              <span className={`text-xs font-bold px-1.5 md:px-2 py-0.5 rounded transition-all duration-300 ${map.difficulty <= 3 ? 'bg-green-500/20 text-green-400' :
                                map.difficulty <= 6 ? 'bg-yellow-500/20 text-yellow-400' :
                                  map.difficulty <= 8 ? 'bg-orange-500/20 text-orange-400' :
                                    'bg-red-500/20 text-red-400'
                                }`}>
                                {map.difficulty <= 3 ? 'Easy' :
                                  map.difficulty <= 6 ? 'Medium' :
                                    map.difficulty <= 8 ? 'Hard' : 'Expert'}
                              </span>
                            )}
                            <span className="text-xs text-yellow-400 flex items-center gap-1 relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isGuest) {
                                    setOpenRatingMapId(openRatingMapId === map.id ? null : map.id);
                                  }
                                }}
                                className={`flex items-center gap-1 transition-all duration-300 ${isGuest ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:underline hover:scale-105'}`}
                                title={isGuest ? 'Sign in to rate' : 'Click to rate'}
                              >
                                ⭐ {map.rating?.toFixed(1) || '0.0'} ({map.rating_count || 0})
                              </button>

                              {/* Rating Popup on Click */}
                              {!isGuest && openRatingMapId === map.id && (
                                <div className="absolute bottom-full left-0 mb-2 flex bg-gray-900 border border-gray-700 rounded-lg p-2 gap-1 shadow-xl z-50 animate-bounce-in">
                                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(star => (
                                    <button
                                      key={star}
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        const { error } = await rateBeatmap(map.id, star);
                                        if (error) {
                                          toastError('Error rating: ' + error.message);
                                        } else {
                                          success(`Rated ${star}/10!`);
                                          setOpenRatingMapId(null);
                                          loadPublicBeatmaps();
                                        }
                                      }}
                                      className="w-5 md:w-6 h-5 md:h-6 flex items-center justify-center hover:scale-125 transition-transform duration-200 text-gray-500 hover:text-yellow-400 font-bold text-xs"
                                      title={`Rate ${star} stars`}
                                    >
                                      {star}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="flex md:flex-col gap-1 md:gap-2 self-end md:self-start">
                          <button
                            onClick={async () => {
                              // Fetch full beatmap data including notes and audio
                              const fullBeatmap = await getPublicBeatmap(map.id);
                              if (fullBeatmap) {
                                onStart({
                                  id: fullBeatmap.id,
                                  name: fullBeatmap.name,
                                  artist: fullBeatmap.artist,
                                  duration: fullBeatmap.duration,
                                  difficulty: fullBeatmap.difficulty,
                                  notes: fullBeatmap.notes || [],
                                  events: fullBeatmap.events || [],
                                  audioData: fullBeatmap.audio_data,
                                  bpm: fullBeatmap.bpm
                                });
                              } else {
                                toastError('Failed to load beatmap');
                              }
                            }}
                            className="px-2 md:px-3 py-0.5 md:py-1 bg-pink-600 hover:bg-pink-500 rounded-lg text-xs md:text-sm font-bold transition-all duration-300 hover:scale-105 hover-glow ripple-btn"
                          >
                            Play
                          </button>
                          {!isGuest && (
                            <button
                              onClick={() => downloadBeatmap(map)}
                              className="px-2 md:px-3 py-0.5 md:py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs md:text-sm font-bold transition-all duration-300 hover:scale-105 ripple-btn"
                            >
                              Download
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-2 md:mt-4 text-center text-gray-500 text-xs md:text-sm italic border-t border-white/10 pt-2 md:pt-4 animate-slide-in-up">
                {isGuest ? 'Sign in to download and rate beatmaps.' : 'Click Play to play online or Download to save locally.'}
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
};

export default MainMenu;
