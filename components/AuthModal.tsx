import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'login' | 'register';
  onSwitchMode: (mode: 'login' | 'register') => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, mode, onSwitchMode }) => {
  const { signIn, signUp, isConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'register') {
        const { error } = await signUp(email, password, username);
        if (error) {
          // Handle specific error cases
          if (error.message?.includes('rate limit')) {
            setError('Too many signup attempts. Please wait a few minutes and try again, or use a different email.');
          } else if (error.message?.includes('already registered')) {
            setError('This email is already registered. Try signing in instead.');
          } else {
            setError(error.message || 'Failed to create account');
          }
        } else {
          onClose();
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          // Handle specific error cases
          if (error.message?.includes('rate limit')) {
            setError('Too many login attempts. Please wait a few minutes and try again.');
          } else if (error.message?.includes('Invalid login')) {
            setError('Invalid email or password. Please try again.');
          } else {
            setError(error.message || 'Failed to sign in');
          }
        } else {
          onClose();
        }
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (!isConfigured) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4 overflow-y-auto">
        <div className="bg-gray-900 rounded-2xl p-4 md:p-8 max-w-md w-full border border-white/10 animate-bounce-in gradient-border shadow-2xl">
          <h2 className="text-xl md:text-2xl font-black text-pink-400 mb-3 md:mb-4 animate-text-glow">Supabase Not Configured</h2>
          <p className="text-gray-300 mb-3 md:mb-4 text-sm md:text-base">
            To enable user accounts and online features, you need to:
          </p>
          <ol className="text-gray-400 text-xs md:text-sm list-decimal list-inside space-y-1 md:space-y-2 mb-4 md:mb-6">
            <li>Create a Supabase project at <span className="text-pink-400">supabase.com</span></li>
            <li>Copy your project URL and anon key</li>
            <li>Add them to <code className="bg-gray-800 px-1 md:px-2 py-0.5 md:py-1 rounded text-xs">.env.local</code></li>
            <li>Run the SQL schema in Supabase SQL Editor</li>
          </ol>
          <button
            onClick={onClose}
            className="w-full py-2 md:py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-all duration-300 hover:scale-[1.02] ripple-btn hover-lift text-sm md:text-base"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4 overflow-y-auto">
      <div className="bg-gray-900 rounded-2xl p-4 md:p-8 max-w-md w-full border border-white/10 animate-bounce-in gradient-border shadow-2xl">
        <div className="flex justify-between items-center mb-4 md:mb-6">
          <h2 className="text-xl md:text-2xl font-black text-pink-400 animate-text-glow">
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl md:text-2xl transition-all duration-300 hover:scale-110 hover:rotate-90"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4">
          {mode === 'register' && (
            <div className="animate-slide-in-up">
              <label className="block text-xs md:text-sm font-bold text-gray-300 mb-1 md:mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 md:px-4 py-2 md:py-3 text-white focus:border-pink-500 focus:outline-none transition-all duration-300 focus:ring-2 focus:ring-pink-500/30 text-sm md:text-base"
                placeholder="Your username"
              />
            </div>
          )}

          <div className="animate-slide-in-up delay-100">
            <label className="block text-xs md:text-sm font-bold text-gray-300 mb-1 md:mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 md:px-4 py-2 md:py-3 text-white focus:border-pink-500 focus:outline-none transition-all duration-300 focus:ring-2 focus:ring-pink-500/30 text-sm md:text-base"
              placeholder="your@email.com"
            />
          </div>

          <div className="animate-slide-in-up delay-200">
            <label className="block text-xs md:text-sm font-bold text-gray-300 mb-1 md:mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 md:px-4 py-2 md:py-3 text-white focus:border-pink-500 focus:outline-none transition-all duration-300 focus:ring-2 focus:ring-pink-500/30 text-sm md:text-base"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg px-3 md:px-4 py-2 md:py-3 text-red-400 text-xs md:text-sm animate-shake">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 md:py-3 bg-pink-600 hover:bg-pink-500 disabled:bg-pink-800 rounded-xl font-bold transition-all duration-300 hover:scale-[1.02] ripple-btn hover-glow disabled:scale-100 text-sm md:text-base"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 md:w-4 h-3 md:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                Please wait...
              </span>
            ) : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="mt-4 md:mt-6 text-center text-gray-400 text-xs md:text-sm animate-slide-in-up delay-300">
          {mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <button
                onClick={() => onSwitchMode('register')}
                className="text-pink-400 hover:text-pink-300 font-bold transition-all duration-300 hover:underline"
              >
                Sign Up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => onSwitchMode('login')}
                className="text-pink-400 hover:text-pink-300 font-bold transition-all duration-300 hover:underline"
              >
                Sign In
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
