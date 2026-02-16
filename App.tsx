import React, { useState, useCallback, useEffect } from 'react';
import { GameState, Beatmap, GameSettings, ScoreDetails } from './types';
import { DEFAULT_SETTINGS, createBlankMap } from './constants';
import MainMenu from './components/MainMenu';
import GameCanvas from './components/GameCanvas';
import LevelEditor from './components/LevelEditor';
import ResultsScreen from './components/ResultsScreen';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';

const SETTINGS_STORAGE_KEY = 'rusheb_settings';

const loadSettings = (): GameSettings => {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge with defaults to ensure all properties exist
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return DEFAULT_SETTINGS;
};

const saveSettings = (settings: GameSettings) => {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [currentMap, setCurrentMap] = useState<Beatmap | null>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [lastScore, setLastScore] = useState<ScoreDetails | null>(null);
  const [menuRefreshKey, setMenuRefreshKey] = useState(0);

  // Save settings whenever they change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const handleStartGame = useCallback((map: Beatmap) => {
    setCurrentMap(map);
    setGameState(GameState.PLAYING);
  }, []);

  const handleOpenEditor = useCallback((map?: Beatmap) => {
    if (map) setCurrentMap(map);
    setGameState(GameState.EDITOR);
  }, []);

  const handleGameEnd = useCallback((score: ScoreDetails) => {
    setLastScore(score);
    setGameState(GameState.RESULTS);
  }, []);

  const handleReturnToMenu = useCallback(() => {
    setGameState(GameState.MENU);
    setMenuRefreshKey(prev => prev + 1); // Trigger refresh of MainMenu data
  }, []);

  return (
    <ToastProvider>
      <AuthProvider>
        <div className="w-full h-screen overflow-hidden flex flex-col bg-gray-900 text-white selection:bg-pink-500 selection:text-white">
          {gameState === GameState.MENU && (
            <div key="menu" className="animate-fade-in">
              <MainMenu
                key={menuRefreshKey}
                onStart={handleStartGame}
                onEdit={handleOpenEditor}
                settings={settings}
                onSettingsChange={setSettings}
              />
            </div>
          )}

          {gameState === GameState.PLAYING && currentMap && (
            <div key="playing" className="animate-fade-in">
              <GameCanvas
                beatmap={currentMap}
                settings={settings}
                onEnd={handleGameEnd}
                onAbort={handleReturnToMenu}
              />
            </div>
          )}

          {gameState === GameState.EDITOR && currentMap && (
            <div key="editor" className="animate-fade-in">
              <LevelEditor
                initialMap={currentMap}
                settings={settings}
                onExit={handleReturnToMenu}
                onPlaytest={handleStartGame}
              />
            </div>
          )}

          {gameState === GameState.RESULTS && lastScore && (
            <div key="results" className="animate-fade-in">
              <ResultsScreen
                score={lastScore}
                onRetry={() => setGameState(GameState.PLAYING)}
                onMenu={handleReturnToMenu}
              />
            </div>
          )}
        </div>
      </AuthProvider>
    </ToastProvider>
  );
};

export default App;
