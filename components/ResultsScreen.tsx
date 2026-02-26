import React from 'react';
import { ScoreDetails } from '../types';

interface ResultsProps {
  score: ScoreDetails;
  onRetry: () => void;
  onMenu: () => void;
}

const ResultsScreen: React.FC<ResultsProps> = ({ score, onRetry, onMenu }) => {
  let rank = 'F';
  if (score.score > 0) {
    const totalPossible = (score.perfect + score.good + score.miss) * 100;
    const ratio = score.score / Math.max(1, totalPossible);
    if (ratio > 0.9) rank = 'S';
    else if (ratio > 0.8) rank = 'A';
    else if (ratio > 0.6) rank = 'B';
    else if (ratio > 0.4) rank = 'C';
    else rank = 'D';
  }

  // If you hit a mine, automatic bad rank visual
  const isShame = score.minesHit > 0;

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 p-4 md:p-8 relative overflow-auto h-full">

      {/* Animated background decorations */}
      <div className="absolute top-[-10%] left-[-10%] w-48 md:w-96 h-48 md:h-96 bg-pink-600 rounded-full mix-blend-multiply filter blur-[60px] md:blur-[100px] opacity-30 animate-float"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-48 md:w-96 h-48 md:h-96 bg-blue-600 rounded-full mix-blend-multiply filter blur-[60px] md:blur-[100px] opacity-30 animate-float" style={{ animationDelay: '2s' }}></div>
      <div className="absolute top-[40%] right-[30%] w-32 md:w-64 h-32 md:h-64 bg-purple-600 rounded-full mix-blend-multiply filter blur-[50px] md:blur-[80px] opacity-20 animate-float" style={{ animationDelay: '4s' }}></div>

      {/* Celebration particles for good ranks */}
      {rank === 'S' && [...Array(20)].map((_, i) => (
        <div
          key={i}
          className="particle hidden md:block"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            background: i % 4 === 0 ? '#fbbf24' : i % 4 === 1 ? '#ec4899' : i % 4 === 2 ? '#a855f7' : '#3b82f6',
            animationDelay: `${i * 0.2}s`,
            width: `${4 + Math.random() * 6}px`,
            height: `${4 + Math.random() * 6}px`,
          }}
        />
      ))}

      <div className={`z-10 w-full max-w-2xl bg-black/60 backdrop-blur-lg rounded-2xl md:rounded-3xl p-4 md:p-10 border-2 animate-bounce-in gradient-border ${isShame ? 'border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.3)]' : 'border-pink-500 shadow-[0_0_50px_rgba(236,72,153,0.3)]'} flex flex-col items-center mx-4`}>

        <h1 className="text-2xl md:text-4xl font-black mb-1 md:mb-2 text-white italic tracking-widest animate-text-glow">RESULTS</h1>
        {isShame && <p className="text-red-500 font-bold animate-bounce mb-2 md:mb-4 text-sm md:text-base">TOTAL SHAME (Hit a mine)</p>}

        <div className={`text-5xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 to-orange-500 my-3 md:my-6 drop-shadow-lg animate-bounce-in ${rank === 'S' ? 'neon-text' : ''}`}>
          {rank}
        </div>

        <div className="text-3xl md:text-6xl font-mono text-white mb-4 md:mb-8 tracking-tighter animate-slide-in-up">
          {score.score.toLocaleString()}
        </div>

        <div className="grid grid-cols-2 gap-x-4 md:gap-x-12 gap-y-2 md:gap-y-4 w-full max-w-md text-sm md:text-lg bg-white/5 p-3 md:p-6 rounded-xl md:rounded-2xl border border-white/10 animate-fade-in-scale">
          <div className="flex justify-between text-yellow-400 transition-all duration-300 hover:scale-105">
            <span>Perfect (+100):</span>
            <span className="font-bold">{score.perfect}</span>
          </div>
          <div className="flex justify-between text-green-400 transition-all duration-300 hover:scale-105">
            <span>Good (+50):</span>
            <span className="font-bold">{score.good}</span>
          </div>
          <div className="flex justify-between text-gray-500 transition-all duration-300 hover:scale-105">
            <span>Miss (-30):</span>
            <span className="font-bold">{score.miss}</span>
          </div>
          <div className="flex justify-between text-red-500 transition-all duration-300 hover:scale-105">
            <span>Mines:</span>
            <span className="font-bold">{score.minesHit}</span>
          </div>
          <div className="col-span-2 flex justify-between text-pink-400 mt-1 md:mt-2 pt-1 md:pt-2 border-t border-white/10 transition-all duration-300 hover:scale-105">
            <span>Max Combo:</span>
            <span className="font-bold">{score.maxCombo}</span>
          </div>
        </div>

        <div className="flex gap-2 md:gap-4 mt-6 md:mt-10 w-full max-w-md animate-slide-in-up delay-400">
          <button
            onClick={onRetry}
            className="flex-1 py-2 md:py-4 px-3 md:px-6 bg-pink-600 hover:bg-pink-500 rounded-xl font-bold transition-all duration-300 transform hover:scale-105 shadow-[0_0_15px_rgba(236,72,153,0.4)] hover:shadow-[0_0_25px_rgba(236,72,153,0.6)] ripple-btn hover-glow text-sm md:text-base"
          >
            RETRY
          </button>
          <button
            onClick={onMenu}
            className="flex-1 py-2 md:py-4 px-3 md:px-6 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-all duration-300 border border-gray-500 hover:scale-105 ripple-btn hover-lift text-sm md:text-base"
          >
            MAIN MENU
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResultsScreen;
