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
    <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 p-8 relative overflow-hidden">
      
      {/* Background decorations */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-pink-600 rounded-full mix-blend-multiply filter blur-[100px] opacity-30"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-blue-600 rounded-full mix-blend-multiply filter blur-[100px] opacity-30"></div>

      <div className={`z-10 w-full max-w-2xl bg-black/60 backdrop-blur-lg rounded-3xl p-10 border-2 ${isShame ? 'border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.3)]' : 'border-pink-500 shadow-[0_0_50px_rgba(236,72,153,0.3)]'} flex flex-col items-center`}>
        
        <h1 className="text-4xl font-black mb-2 text-white italic tracking-widest">RESULTS</h1>
        {isShame && <p className="text-red-500 font-bold animate-bounce mb-4">TOTAL SHAME (Hit a mine)</p>}
        
        <div className="text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 to-orange-500 my-6 drop-shadow-lg">
          {rank}
        </div>

        <div className="text-6xl font-mono text-white mb-8 tracking-tighter">
          {score.score.toLocaleString()}
        </div>

        <div className="grid grid-cols-2 gap-x-12 gap-y-4 w-full max-w-md text-lg bg-white/5 p-6 rounded-2xl border border-white/10">
          <div className="flex justify-between text-yellow-400">
            <span>Perfect (+100):</span>
            <span className="font-bold">{score.perfect}</span>
          </div>
          <div className="flex justify-between text-green-400">
            <span>Good (+50):</span>
            <span className="font-bold">{score.good}</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>Miss (-30):</span>
            <span className="font-bold">{score.miss}</span>
          </div>
          <div className="flex justify-between text-red-500">
            <span>Mines:</span>
            <span className="font-bold">{score.minesHit}</span>
          </div>
          <div className="col-span-2 flex justify-between text-pink-400 mt-2 pt-2 border-t border-white/10">
            <span>Max Combo:</span>
            <span className="font-bold">{score.maxCombo}</span>
          </div>
        </div>

        <div className="flex gap-4 mt-10 w-full max-w-md">
          <button 
            onClick={onRetry}
            className="flex-1 py-4 px-6 bg-pink-600 hover:bg-pink-500 rounded-xl font-bold transition-all transform hover:scale-105 shadow-[0_0_15px_rgba(236,72,153,0.4)]"
          >
            RETRY
          </button>
          <button 
            onClick={onMenu}
            className="flex-1 py-4 px-6 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-all border border-gray-500"
          >
            MAIN MENU
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResultsScreen;
