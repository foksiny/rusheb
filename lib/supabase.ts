import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Vite environment variables - must use import.meta.env directly
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Check if Supabase is configured
export const isSupabaseConfigured = supabaseUrl !== '' && supabaseAnonKey !== '' &&
  supabaseUrl !== 'your_supabase_project_url' && supabaseAnonKey !== 'your_supabase_anon_key';

// Lazy-initialize Supabase client to ensure localStorage is available
let _supabase: SupabaseClient | null = null;

export const supabase: SupabaseClient | null = new Proxy({} as SupabaseClient, {
  get(target, prop) {
    if (!_supabase && isSupabaseConfigured) {
      _supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          storage: window.localStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true
        }
      });
    }
    if (!_supabase) return null;
    return Reflect.get(_supabase, prop);
  }
});

// Database types
export interface UserProfile {
  id: string;
  email: string;
  username: string;
  created_at: string;
  updated_at: string;
}

export interface PublicBeatmap {
  id: string;
  user_id: string;
  name: string;
  artist: string;
  duration: number;
  difficulty: number;
  notes: any[];
  events?: any[];
  audio_data?: string;
  bpm?: number;
  is_public: boolean;
  rating: number;
  rating_count: number;
  download_count: number;
  created_at: string;
  updated_at: string;
  user?: UserProfile;
}

export interface BeatmapRating {
  id: string;
  beatmap_id: string;
  user_id: string;
  rating: number;
  created_at: string;
}

export interface UserBeatmapDownload {
  id: string;
  user_id: string;
  beatmap_id: string;
  downloaded_at: string;
}

// SQL Schema for Supabase (run this in Supabase SQL Editor)
export const DATABASE_SCHEMA = `
-- Enable Row Level Security
ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- User Profiles Table
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  username TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Public Beatmaps Table
CREATE TABLE IF NOT EXISTS public_beatmaps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  duration INTEGER NOT NULL,
  difficulty INTEGER DEFAULT 1,
  notes JSONB NOT NULL DEFAULT '[]',
  events JSONB DEFAULT '[]',
  audio_data TEXT,
  bpm INTEGER DEFAULT 120,
  is_public BOOLEAN DEFAULT false,
  rating DECIMAL(4,2) DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  download_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- If table already exists, alter the rating column to allow values up to 10.00
-- ALTER TABLE public_beatmaps ALTER COLUMN rating TYPE DECIMAL(4,2);

-- Beatmap Ratings Table
CREATE TABLE IF NOT EXISTS beatmap_ratings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  beatmap_id UUID REFERENCES public_beatmaps(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 10),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(beatmap_id, user_id)
);

-- User Beatmap Downloads Table
CREATE TABLE IF NOT EXISTS user_beatmap_downloads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
  beatmap_id UUID REFERENCES public_beatmaps(id) ON DELETE CASCADE NOT NULL,
  downloaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, beatmap_id)
);

-- Row Level Security Policies
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_beatmaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE beatmap_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_beatmap_downloads ENABLE ROW LEVEL SECURITY;

-- User Profiles Policies
CREATE POLICY "Users can view all profiles" ON user_profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON user_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Public Beatmaps Policies
CREATE POLICY "Anyone can view public beatmaps" ON public_beatmaps FOR SELECT USING (is_public = true OR user_id = auth.uid());
CREATE POLICY "Users can insert own beatmaps" ON public_beatmaps FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own beatmaps" ON public_beatmaps FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own beatmaps" ON public_beatmaps FOR DELETE USING (user_id = auth.uid());

-- Ratings Policies
CREATE POLICY "Anyone can view ratings" ON beatmap_ratings FOR SELECT USING (true);
CREATE POLICY "Users can insert own ratings" ON beatmap_ratings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own ratings" ON beatmap_ratings FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own ratings" ON beatmap_ratings FOR DELETE USING (user_id = auth.uid());

-- Downloads Policies
CREATE POLICY "Users can view own downloads" ON user_beatmap_downloads FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own downloads" ON user_beatmap_downloads FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Functions
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_public_beatmaps_updated_at
  BEFORE UPDATE ON public_beatmaps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to update rating after new rating is added
CREATE OR REPLACE FUNCTION update_beatmap_rating()
RETURNS TRIGGER AS $$
DECLARE
  avg_rating DECIMAL;
  count INTEGER;
  target_beatmap_id UUID;
BEGIN
  -- Get the beatmap_id from either NEW (INSERT/UPDATE) or OLD (DELETE)
  IF TG_OP = 'DELETE' THEN
    target_beatmap_id := OLD.beatmap_id;
  ELSE
    target_beatmap_id := NEW.beatmap_id;
  END IF;
  
  SELECT AVG(rating), COUNT(*) INTO avg_rating, count
  FROM beatmap_ratings
  WHERE beatmap_id = target_beatmap_id;
  
  UPDATE public_beatmaps
  SET rating = COALESCE(avg_rating, 0), rating_count = COALESCE(count, 0)
  WHERE id = target_beatmap_id;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_rating_trigger
  AFTER INSERT OR UPDATE OR DELETE ON beatmap_ratings
  FOR EACH ROW EXECUTE FUNCTION update_beatmap_rating();

-- Function to increment download count
CREATE OR REPLACE FUNCTION increment_download_count(beatmap_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public_beatmaps
  SET download_count = download_count + 1
  WHERE id = beatmap_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STORAGE SETUP (Required for fast audio uploads)
-- ============================================
-- 1. Go to Supabase Dashboard > Storage
-- 2. Create a new bucket called "beatmap-audio"
-- 3. Set it to PUBLIC
-- 4. Add these RLS policies:

-- Storage Policies for beatmap-audio bucket:
-- Policy: Allow authenticated users to upload their own audio
-- Target: INSERT
-- Using: (bucket_id = 'beatmap-audio') AND (auth.uid()::text = (storage.foldername(name))[1])
-- 
-- Policy: Allow authenticated users to update their own audio
-- Target: UPDATE
-- Using: (bucket_id = 'beatmap-audio') AND (auth.uid()::text = (storage.foldername(name))[1])
--
-- Policy: Allow authenticated users to delete their own audio
-- Target: DELETE
-- Using: (bucket_id = 'beatmap-audio') AND (auth.uid()::text = (storage.foldername(name))[1])
--
-- Policy: Allow anyone to read audio files
-- Target: SELECT
-- Using: (bucket_id = 'beatmap-audio')

-- ============================================
-- REALTIME SETUP (Required for real-time sync)
-- ============================================
-- Enable realtime extension (run once)
CREATE EXTENSION IF NOT EXISTS realtime;

-- Enable realtime for each table
-- Run these in Supabase SQL Editor:
ALTER PUBLICATION supabase_realtime ADD TABLE user_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public_beatmaps;
ALTER PUBLICATION supabase_realtime ADD TABLE beatmap_ratings;

-- Or alternatively, you can enable realtime through the Supabase Dashboard:
-- 1. Go to Database > Replication
-- 2. For each table (user_profiles, public_beatmaps, beatmap_ratings):
--    - Click on the table
--    - Enable "Realtime" toggle
`;
