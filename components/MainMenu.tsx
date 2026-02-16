import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Beatmap, GameSettings, Theme, KeyMode } from '../types';
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
    <div className="flex-1 flex items-center justify-between relative overflow-hidden bg-gradient-to-br from-gray-900 via-indigo-950 to-black p-10">
      {/* Decorative background elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[800px] h-[800px] bg-pink-600 rounded-full mix-blend-screen filter blur-[150px] opacity-20 animate-pulse"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[800px] h-[800px] bg-blue-600 rounded-full mix-blend-screen filter blur-[150px] opacity-20 animate-pulse" style={{ animationDelay: '2s' }}></div>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        mode={authMode}
        onSwitchMode={(mode) => setAuthMode(mode)}
      />

      {/* User Account Section - Top Right */}
      <div className="absolute top-4 right-4 z-50">
        {user ? (
          <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md rounded-full px-4 py-2 border border-white/10">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center font-bold text-sm">
              {profile?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
            <span className="text-white font-bold">{profile?.username || 'User'}</span>
            <button
              onClick={signOut}
              className="text-gray-400 hover:text-pink-400 text-sm font-bold transition-colors"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => { setShowAuthModal(true); setAuthMode('login'); }}
              className="px-4 py-2 bg-pink-600/80 hover:bg-pink-500 rounded-full font-bold text-sm transition-colors border border-pink-400/50"
            >
              Sign In
            </button>
            <button
              onClick={() => { setShowAuthModal(true); setAuthMode('register'); }}
              className="px-4 py-2 bg-gray-800/80 hover:bg-gray-700 rounded-full font-bold text-sm transition-colors border border-gray-600"
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
      <div className="z-10 flex flex-col items-center justify-center w-1/2 h-full">
        {!showSettings ? (
          <div className="flex flex-col items-center gap-8 relative">
            {/* Osu-like Big Button */}
            <div
              className={`relative w-80 h-80 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shadow-[0_0_50px_rgba(236,72,153,0.5)] transform transition-transform duration-300 border-4 border-white/20 ${selectedMap ? 'cursor-pointer group-hover:scale-105 group-hover:shadow-[0_0_80px_rgba(236,72,153,0.8)]' : 'opacity-50 cursor-not-allowed'
                }`}
              onClick={handlePlayClick}
            >
              <div className="absolute inset-2 rounded-full border-2 border-dashed border-white/30 animate-[spin_10s_linear_infinite]"></div>
              <h1 className="text-6xl font-black text-white tracking-tighter drop-shadow-lg z-10 italic">
                RUSHEB
              </h1>
              {selectedMap && (
                <div className="absolute -bottom-4 bg-gray-900 text-pink-400 font-bold px-6 py-2 rounded-full border-2 border-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-4 group-hover:translate-y-0">
                  CLICK TO PLAY
                </div>
              )}
            </div>

            <p className="text-gray-400 italic mt-4">
              {selectedMap ? (
                <>Selected: <span className="text-white font-bold">{selectedMap.name}</span></>
              ) : (
                <span className="text-yellow-400">No beatmap selected. Create or import one!</span>
              )}
            </p>

            {/* Real-time connection indicator */}
            {isConfigured && !isGuest && (
              <div className="flex items-center gap-2 mt-2">
                <div className={`w-2 h-2 rounded-full ${isRealtimeConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`}></div>
                <span className={`text-xs ${isRealtimeConnected ? 'text-green-400' : 'text-gray-500'}`}>
                  {isRealtimeConnected ? 'Real-time sync active' : 'Connecting...'}
                </span>
              </div>
            )}

            <div className="flex gap-4 mt-4">
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
                className={`py-3 px-8 backdrop-blur-sm rounded-full font-bold transition-all border ${isGuest
                  ? 'bg-gray-700/50 border-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600/80 hover:bg-green-500 border-green-400 shadow-[0_0_15px_rgba(34,197,94,0.5)]'
                  }`}
                title={isGuest ? 'Sign in to create levels' : ''}
              >
                + NEW LEVEL
              </button>
              <button
                onClick={handleEditClick}
                disabled={!selectedMap || isGuest}
                className={`py-3 px-8 backdrop-blur-sm rounded-full font-bold transition-all border ${isGuest
                  ? 'bg-gray-700/50 border-gray-600 text-gray-400 cursor-not-allowed'
                  : selectedMap
                    ? 'bg-blue-600/80 hover:bg-blue-500 border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.5)]'
                    : 'bg-gray-700/50 border-gray-600 text-gray-400 cursor-not-allowed'
                  }`}
                title={isGuest ? 'Sign in to edit levels' : ''}
              >
                EDIT LEVEL
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowSettings(true); }}
                className="py-3 px-8 bg-gray-800/80 hover:bg-gray-700 backdrop-blur-sm rounded-full font-bold transition-all border border-gray-600"
              >
                SETTINGS
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 w-full max-w-md bg-black/60 backdrop-blur-md p-8 rounded-3xl border border-white/10 shadow-2xl overflow-y-auto max-h-[80vh] custom-scrollbar">
            <h2 className="text-3xl font-black mb-6 text-pink-400 border-b border-white/10 pb-4 flex justify-between">
              <span>Settings</span>
              <button onClick={() => setShowSettings(false)} className="text-white hover:text-pink-400">×</button>
            </h2>

            <label className="flex items-center justify-between cursor-pointer group bg-white/5 p-4 rounded-xl hover:bg-white/10 transition-colors">
              <span className="font-bold text-gray-200">Practice Mode (Turtle Speed)</span>
              <input
                type="checkbox"
                checked={settings.practiceMode}
                onChange={(e) => updateSetting('practiceMode', e.target.checked)}
                className="w-6 h-6 accent-pink-500"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group bg-white/5 p-4 rounded-xl hover:bg-white/10 transition-colors">
              <span className="font-bold text-gray-200">Invisible Mode (Trust your soul)</span>
              <input
                type="checkbox"
                checked={settings.invisibleMode}
                onChange={(e) => updateSetting('invisibleMode', e.target.checked)}
                className="w-6 h-6 accent-pink-500"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group bg-white/5 p-4 rounded-xl hover:bg-white/10 transition-colors">
              <span className="font-bold text-gray-200">Crazy Keyboard (Visual Flair)</span>
              <input
                type="checkbox"
                checked={settings.crazyKeyboardMode}
                onChange={(e) => updateSetting('crazyKeyboardMode', e.target.checked)}
                className="w-6 h-6 accent-pink-500"
              />
            </label>

            <div className="flex flex-col gap-2 mt-2 bg-white/5 p-4 rounded-xl">
              <span className="font-bold text-gray-200">Visual Theme</span>
              <select
                value={settings.theme}
                onChange={(e) => updateSetting('theme', e.target.value as Theme)}
                className="bg-gray-900 text-white p-3 rounded-lg outline-none border border-gray-700 focus:border-pink-500 font-bold cursor-pointer"
              >
                <option value={Theme.SPACE}>Outer Space</option>
                <option value={Theme.CITY}>Neon City</option>
                <option value={Theme.BREAD_BUTTER}>Bread & Butter (Secret)</option>
              </select>
            </div>

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

            <div className="flex flex-col gap-4 mt-2 bg-white/5 p-4 rounded-xl">
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
              <div className="flex flex-col gap-2 mt-2 bg-white/5 p-4 rounded-xl">
                <span className="font-bold text-gray-200 border-b border-gray-700 pb-2">Account</span>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="New username"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="flex-1 bg-gray-900 text-white p-3 rounded-lg outline-none border border-gray-700 focus:border-pink-500 font-bold"
                  />
                  <button
                    onClick={handleChangeUsername}
                    disabled={!newUsername.trim() || newUsername === profile?.username}
                    className={`px-4 py-3 rounded-lg font-bold transition-all ${!newUsername.trim() || newUsername === profile?.username
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-pink-600 hover:bg-pink-500 text-white'
                      }`}
                  >
                    Update
                  </button>
                </div>
                {usernameError && (
                  <p className="text-red-400 text-sm">{usernameError}</p>
                )}
                {usernameSuccess && (
                  <p className="text-green-400 text-sm">{usernameSuccess}</p>
                )}
              </div>
            )}

            <button
              onClick={() => setShowSettings(false)}
              className="mt-4 py-4 px-4 bg-gray-700 hover:bg-gray-600 rounded-xl font-black transition-all border border-gray-500 text-lg"
            >
              BACK TO MENU
            </button>
          </div>
        )}
      </div>

      {/* Right Side: Song List */}
      <div className="z-10 flex flex-col w-1/2 max-w-lg h-full justify-center">
        <div className="bg-black/40 backdrop-blur-md rounded-3xl border border-white/10 p-6 flex flex-col h-[80vh] shadow-2xl">
          {/* Tab Buttons */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => {
                setActiveTab('your_beatmaps');
                loadMapsFull();
              }}
              className={`flex-1 py-2 px-4 rounded-xl font-bold transition-all ${activeTab === 'your_beatmaps'
                ? 'bg-pink-600 text-white shadow-[0_0_15px_rgba(236,72,153,0.5)]'
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
              className={`flex-1 py-2 px-4 rounded-xl font-bold transition-all ${activeTab === 'public_beatmaps'
                ? 'bg-pink-600 text-white shadow-[0_0_15px_rgba(236,72,153,0.5)]'
                : 'bg-gray-800/80 text-gray-400 hover:bg-gray-700/80'
                }`}
            >
              Public Beatmaps
            </button>
          </div>

          {activeTab === 'your_beatmaps' && (
            <>
              <div className="flex justify-between items-end mb-4 border-b border-white/10 pb-4">
                <h2 className="text-xl font-black text-white italic tracking-wider">YOUR BEATMAPS</h2>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                {savedMaps.length === 0 ? (
                  <div className="text-center text-gray-400 py-8">
                    <p className="text-lg mb-2">No beatmaps yet!</p>
                    <p className="text-sm">Create a new level or import one to get started.</p>
                  </div>
                ) : (
                  savedMaps.map((map) => {
                    const isSelected = map.id === selectedMapId;
                    return (
                      <div
                        key={map.id}
                        onClick={() => setSelectedMapId(map.id)}
                        className={`relative p-4 cursor-pointer transition-all transform skew-x-[-5deg] border-l-8 ${isSelected ? 'bg-gradient-to-r from-pink-900/80 to-purple-900/40 border-pink-500 scale-105 ml-4 shadow-lg' : 'bg-gray-800/80 border-gray-600 hover:bg-gray-700/80'}`}
                      >
                        <div className="transform skew-x-[5deg] flex justify-between items-center">
                          <div>
                            <h3 className={`font-black text-lg truncate w-64 ${isSelected ? 'text-white' : 'text-gray-300'}`}>{map.name}</h3>
                            <p className="text-sm text-gray-400">{map.artist} • {(map.duration / 1000).toFixed(1)}s</p>
                            {map.difficulty && (
                              <span className={`text-xs font-bold px-2 py-0.5 rounded mt-1 inline-block ${map.difficulty <= 3 ? 'bg-green-500/20 text-green-400' :
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
                            className="text-gray-500 hover:text-red-500 p-2 transition-colors"
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

              <div className="mt-4 text-center text-gray-500 text-sm italic border-t border-white/10 pt-4">
                Beatmaps are safely stored in your browser's database.
              </div>
            </>
          )}

          {activeTab === 'public_beatmaps' && (
            <>
              <div className="flex justify-between items-end mb-4 border-b border-white/10 pb-4">
                <h2 className="text-xl font-black text-white italic tracking-wider">PUBLIC BEATMAPS</h2>
                {isConfigured && (
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1 text-sm focus:border-pink-500 focus:outline-none"
                  />
                )}
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                {!isConfigured ? (
                  <div className="text-center text-gray-400 py-8">
                    <p className="text-lg mb-2">Supabase Not Configured</p>
                    <p className="text-sm">Add your Supabase credentials to .env.local to enable public beatmaps.</p>
                  </div>
                ) : publicBeatmaps.length === 0 ? (
                  <div className="text-center text-gray-400 py-8">
                    <p className="text-lg mb-2">No public beatmaps found</p>
                    <p className="text-sm">Be the first to publish a beatmap!</p>
                  </div>
                ) : (
                  publicBeatmaps.map((map) => (
                    <div
                      key={map.id}
                      className="relative p-4 bg-gray-800/80 border-l-8 border-purple-500 hover:bg-gray-700/80 transition-all group"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-black text-lg text-white">{map.name}</h3>
                          <p className="text-sm text-gray-400">{map.artist} • {(map.duration / 1000).toFixed(1)}s</p>
                          <p className="text-xs text-gray-500 mt-1">by {map.user?.username || 'Unknown'}</p>
                          <div className="flex gap-2 mt-2 items-center">
                            {map.difficulty && (
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${map.difficulty <= 3 ? 'bg-green-500/20 text-green-400' :
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
                                className={`flex items-center gap-1 ${isGuest ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:underline'}`}
                                title={isGuest ? 'Sign in to rate' : 'Click to rate'}
                              >
                                ⭐ {map.rating?.toFixed(1) || '0.0'} ({map.rating_count || 0})
                              </button>

                              {/* Rating Popup on Click */}
                              {!isGuest && openRatingMapId === map.id && (
                                <div className="absolute bottom-full left-0 mb-2 flex bg-gray-900 border border-gray-700 rounded-lg p-2 gap-1 shadow-xl z-50">
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
                                      className="w-6 h-6 flex items-center justify-center hover:scale-125 transition-transform text-gray-500 hover:text-yellow-400 font-bold text-xs"
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
                        <div className="flex flex-col gap-2">
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
                            className="px-3 py-1 bg-pink-600 hover:bg-pink-500 rounded-lg text-sm font-bold transition-colors"
                          >
                            Play
                          </button>
                          {!isGuest && (
                            <button
                              onClick={() => downloadBeatmap(map)}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-bold transition-colors"
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

              <div className="mt-4 text-center text-gray-500 text-sm italic border-t border-white/10 pt-4">
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
