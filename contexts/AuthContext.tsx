import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, UserProfile, PublicBeatmap } from '../lib/supabase';
import { dbHelper } from '../constants';
import { Beatmap } from '../types';
import { uploadAudioToStorage, deleteAudioFromStorage, isStorageUrl } from '../lib/audioStorage';

// Real-time event callbacks
interface RealtimeCallbacks {
  onBeatmapInsert?: (beatmap: PublicBeatmap) => void;
  onBeatmapUpdate?: (beatmap: PublicBeatmap) => void;
  onBeatmapDelete?: (beatmapId: string) => void;
  onProfileUpdate?: (profile: UserProfile) => void;
  onRatingChange?: (beatmapId: string, rating: number, ratingCount: number) => void;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  loading: boolean;
  isConfigured: boolean;
  isGuest: boolean;
  signUp: (email: string, password: string, username: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  updateUsername: (username: string) => Promise<{ error: any }>;
  syncBeatmaps: () => Promise<void>;
  downloadBeatmap: (beatmap: PublicBeatmap) => Promise<void>;
  uploadBeatmap: (beatmap: Beatmap, isPublic: boolean, options?: { skipAudio?: boolean, onProgress?: (stage: string, percent: number) => void }) => Promise<{ error: any, data: PublicBeatmap | null }>;
  rateBeatmap: (beatmapId: string, rating: number) => Promise<{ error: any }>;
  getPublicBeatmaps: (search?: string) => Promise<PublicBeatmap[]>;
  getPublicBeatmap: (beatmapId: string) => Promise<PublicBeatmap | null>;
  getUserBeatmaps: () => Promise<PublicBeatmap[]>;
  getDownloadedBeatmaps: () => Promise<PublicBeatmap[]>;
  deleteBeatmap: (beatmapId: string) => Promise<{ error: any }>;
  getAllUserBeatmaps: () => Promise<Beatmap[]>;
  getUserBeatmapsDigest: () => Promise<{ id: string; updated_at: string }[]>;
  getBeatmapById: (id: string) => Promise<Beatmap | null>;
  // Real-time subscription management
  subscribeToRealtime: (callbacks: RealtimeCallbacks) => () => void;
  isRealtimeConnected: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const userRef = useRef<User | null>(null);
  
  // Real-time subscription management
  const channelsRef = useRef<{ channel: any; callbacks: RealtimeCallbacks }[]>([]);
  const realtimeCallbacksRef = useRef<RealtimeCallbacks>({});

  const isConfigured = isSupabaseConfigured;
  const isGuest = !isConfigured || !user;

  // Keep userRef in sync
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Sync beatmaps function - Deprecated for logged in users as we fetch directly
  const syncBeatmaps = useCallback(async () => {
    // No-op: We no longer sync to local storage for logged-in users.
    // They fetch directly from the server.
    return;
  }, []);

  const getAllUserBeatmaps = async (): Promise<Beatmap[]> => {
    if (!supabase || !userRef.current) return [];

    try {
      const { data, error } = await supabase
        .from('public_beatmaps')
        .select('*')
        .eq('user_id', userRef.current.id);

      if (error) {
        console.error('Error fetching user beatmaps:', error);
        return [];
      }

      if (!data) return [];

      return data.map(m => ({
        id: m.id,
        name: m.name,
        artist: m.artist,
        duration: m.duration,
        difficulty: m.difficulty,
        notes: m.notes,
        events: m.events,
        audioData: m.audio_data, // Map snake_case to camelCase
        bpm: m.bpm,
        isPublic: m.is_public
      }));
    } catch (err) {
      console.error('Exception in getAllUserBeatmaps:', err);
      return [];
    }
  };

  // Lightweight digest: only IDs and timestamps for change detection
  // Returns ~100 bytes per beatmap instead of ~10KB+
  const getUserBeatmapsDigest = async (): Promise<{ id: string; updated_at: string }[]> => {
    if (!supabase || !userRef.current) return [];

    try {
      const { data, error } = await supabase
        .from('public_beatmaps')
        .select('id, updated_at')
        .eq('user_id', userRef.current.id);

      if (error) {
        console.error('Error fetching beatmap digest:', error);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('Exception in getUserBeatmapsDigest:', err);
      return [];
    }
  };

  // Fetch a single beatmap by ID (full data including notes, events, audio)
  const getBeatmapById = async (id: string): Promise<Beatmap | null> => {
    if (!supabase || !userRef.current) return null;

    try {
      const { data, error } = await supabase
        .from('public_beatmaps')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) return null;

      return {
        id: data.id,
        name: data.name,
        artist: data.artist,
        duration: data.duration,
        difficulty: data.difficulty,
        notes: data.notes,
        events: data.events,
        audioData: data.audio_data,
        bpm: data.bpm,
        isPublic: data.is_public
      };
    } catch (err) {
      console.error('Exception in getBeatmapById:', err);
      return null;
    }
  };

  // Track if we've already fetched the profile to prevent race conditions
  const profileFetchInProgressRef = useRef<string | null>(null);
  const isInitializedRef = useRef(false);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }

    // Listen for auth changes - this is the primary way to get the initial session
    // The INITIAL_SESSION event fires when the client finishes loading from storage
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Handle initial session
      if (event === 'INITIAL_SESSION') {
        if (session?.user) {
          setSession(session);
          setUser(session.user);
          await fetchProfile(session.user.id, session.user);
        } else {
          setSession(null);
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
        isInitializedRef.current = true;
        return;
      }
      
      // Handle subsequent auth changes
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        await fetchProfile(session.user.id, session.user);
        if (event === 'SIGNED_IN') {
          await syncBeatmaps();
        }
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [isConfigured, syncBeatmaps]);

  const fetchProfile = async (userId: string, currentUser?: User) => {
    if (!supabase) return;

    // Prevent duplicate concurrent fetches for the same user
    if (profileFetchInProgressRef.current === userId) {
      console.log('[Auth] Profile fetch already in progress for:', userId);
      return;
    }
    profileFetchInProgressRef.current = userId;

    // Use the passed currentUser or fallback to state (which might be stale)
    const activeUser = currentUser || user;

    try {
      // Create a promise with timeout
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Profile query timeout after 5s')), 5000);
      });
      
      const queryPromise = supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();

      const { data, error } = await Promise.race([queryPromise, timeoutPromise])
        .finally(() => clearTimeout(timeoutId));

      if (error) {
        console.error('[Auth] Error fetching profile:', error.code, error.message);
        
        // Profile doesn't exist or not found, try to create it
        // PGRST116 is "The result contains 0 rows"
        if (error.code === 'PGRST116') {
          // Generate username from email or use a unique fallback
          const baseUsername = activeUser?.email?.split('@')[0] || 'user';
          const uniqueUsername = `${baseUsername}_${Date.now().toString(36)}`;
          
          // Create profile with unique username
          const { error: insertError } = await supabase
            .from('user_profiles')
            .insert({
              id: userId,
              email: activeUser?.email || '',
              username: uniqueUsername
            });

          if (insertError) {
            console.error('[Auth] Error creating profile:', insertError);
            
            // If username conflict, try with more unique name
            if (insertError.code === '23505') {
              const { error: retryInsertError } = await supabase
                .from('user_profiles')
                .insert({
                  id: userId,
                  email: activeUser?.email || '',
                  username: `${baseUsername}_${Math.random().toString(36).substring(2, 8)}`
                });
              
              if (retryInsertError) {
                console.error('[Auth] Retry insert also failed:', retryInsertError);
              }
            }
          }

          // Fetch again regardless of insert result (it might have failed because it already exists)
          const { data: newProfile, error: retryError } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', userId)
            .single();

          if (retryError) {
            console.error('[Auth] Error fetching profile after insert:', retryError);
          } else if (newProfile) {
            setProfile(newProfile);
          }
        } else {
          // For other errors, try to fetch again after a short delay
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const { data: retryData, error: retryError2 } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', userId)
            .single();
            
          if (retryData) {
            setProfile(retryData);
          } else if (retryError2) {
            console.error('[Auth] Retry also failed:', retryError2);
          }
        }
      } else {
        setProfile(data);
      }
    } catch (err) {
      console.error('[Auth] Exception in fetchProfile:', err);
    } finally {
      profileFetchInProgressRef.current = null;
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, username: string) => {
    if (!supabase) return { error: { message: 'Supabase not configured' } };

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) return { error };

    // Create profile
    if (data.user) {
      await supabase.from('user_profiles').insert({
        id: data.user.id,
        email,
        username
      });
    }

    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    if (!supabase) return { error: { message: 'Supabase not configured' } };

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    return { error };
  };

  const signOut = async () => {
    if (!supabase) {
      // Even without supabase, clear local state
      setUser(null);
      setProfile(null);
      setSession(null);
      return;
    }

    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    } finally {
      // Always clear local state regardless of API result
      setUser(null);
      setProfile(null);
      setSession(null);
      // Clear local refs if needed
      userRef.current = null;
    }
  };

  const updateUsername = async (username: string) => {
    if (!supabase || !user) return { error: { message: 'Not authenticated' } };

    // Check if username is already taken by another user
    const { data: existingUser } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('username', username)
      .neq('id', user.id)
      .maybeSingle();

    if (existingUser) {
      return { error: { message: 'Username is already taken' } };
    }

    const { error } = await supabase
      .from('user_profiles')
      .update({ username, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (!error) {
      setProfile(prev => prev ? { ...prev, username } : null);
    }

    return { error };
  };

  const downloadBeatmap = async (beatmap: PublicBeatmap) => {
    if (!supabase || !user) return;

    // Fetch full beatmap data including notes, events, and audio
    const fullBeatmap = await getPublicBeatmap(beatmap.id);
    if (!fullBeatmap) return;

    // Create a downloadable JSON file with all beatmap data
    // Set isPublic to false so imported beatmaps are private by default
    const beatmapData = {
      id: fullBeatmap.id,
      name: fullBeatmap.name,
      artist: fullBeatmap.artist,
      duration: fullBeatmap.duration,
      difficulty: fullBeatmap.difficulty,
      notes: fullBeatmap.notes || [],
      events: fullBeatmap.events || [],
      audioData: fullBeatmap.audio_data,
      bpm: fullBeatmap.bpm,
      isPublic: false // Always set to false for downloaded beatmaps
    };

    const jsonString = JSON.stringify(beatmapData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Create a temporary anchor element to trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fullBeatmap.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Record download
    await supabase.from('user_beatmap_downloads').insert({
      user_id: user.id,
      beatmap_id: fullBeatmap.id
    });

    // Increment download count
    await supabase.rpc('increment_download_count', { beatmap_id: fullBeatmap.id });
  };

  const uploadBeatmap = async (beatmap: Beatmap, isPublic: boolean, options?: { skipAudio?: boolean, onProgress?: (stage: string, percent: number) => void }) => {
    if (!supabase || !user) return { error: { message: 'Not authenticated' }, data: null };

    // Helper function to add timeout to promises (2 minutes for large files)
    const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
        promise.then(
          (result) => { clearTimeout(timeout); resolve(result); },
          (error) => { clearTimeout(timeout); reject(error); }
        );
      });
    };

    // Helper for retrying failed operations
    const withRetry = async <T,>(
      operation: () => Promise<T>,
      maxRetries: number = 3,
      delayMs: number = 2000
    ): Promise<T> => {
      let lastError: any;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await operation();
        } catch (err) {
          lastError = err;
          if (attempt < maxRetries) {
            options?.onProgress?.(`⚠️ Connection issue, retrying... (${attempt}/${maxRetries})`, 50);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }
      throw lastError;
    };

    try {
      // Step 1: Upload audio to Storage if needed (fast binary upload)
      let audioUrl: string | undefined = undefined;

      // Check if audio is already a storage URL (already uploaded)
      const audioAlreadyUploaded = beatmap.audioData && isStorageUrl(beatmap.audioData);

      if (options?.skipAudio && audioAlreadyUploaded) {
        // Audio wasn't modified and is already uploaded - just preserve the URL
        audioUrl = beatmap.audioData;
        options?.onProgress?.('✅ Audio unchanged, skipping upload...', 80);
      } else if (beatmap.audioData) {
        // Audio needs to be uploaded (either new or modified)
        if (!isStorageUrl(beatmap.audioData)) {
          options?.onProgress?.('🎵 Step 1 of 2: Processing audio file...', 5);
          const { url, error: audioError } = await uploadAudioToStorage(
            beatmap.audioData,
            beatmap.id,
            user.id,
            (stage, percent) => {
              // Map audio progress to 5-80% range
              const mappedPercent = 5 + (percent * 0.75);
              options?.onProgress?.(stage, mappedPercent);
            }
          );

          if (audioError) {
            console.error('Audio storage upload failed:', audioError);
            // Don't fallback to base64 - it's too slow for database
            // Just save without audio and let user know
            options?.onProgress?.('⚠️ Audio upload failed, saving without audio...', 80);
          } else {
            audioUrl = url || undefined;
          }
        } else {
          // Already a storage URL, keep it
          audioUrl = beatmap.audioData;
          options?.onProgress?.('✅ Audio already uploaded, skipping...', 80);
        }
      } else {
        options?.onProgress?.('⏭️ No audio to upload...', 80);
      }

      // Step 2: Save beatmap metadata to database (80-100%)
      options?.onProgress?.('💾 Step 2 of 2: Saving beatmap info...', 85);

      const upsertPayload: any = {
        id: beatmap.id,
        user_id: user.id,
        name: beatmap.name,
        artist: beatmap.artist,
        duration: beatmap.duration,
        difficulty: beatmap.difficulty || 1,
        notes: beatmap.notes,
        events: beatmap.events || [],
        bpm: beatmap.bpm,
        is_public: isPublic,
        updated_at: new Date().toISOString()
      };

      // Only include audio_data if we have a storage URL (not base64)
      // Base64 in database is too slow and causes timeouts
      if (audioUrl && isStorageUrl(audioUrl)) {
        upsertPayload.audio_data = audioUrl;
      } else if (audioUrl) {
        console.warn('Audio is not a storage URL, not including in database payload');
      }

      // Log payload size for debugging
      const payloadSize = JSON.stringify(upsertPayload).length;
      console.log(`Database payload size: ${(payloadSize / 1024).toFixed(1)}KB`);

      // Direct database operation with timeout
      options?.onProgress?.('💾 Saving to database...', 87);
      
      try {
        console.log('Starting database upsert...');
        const startTime = Date.now();
        
        const { data, error } = await supabase
          .from('public_beatmaps')
          .upsert(upsertPayload, {
            onConflict: 'id',
            ignoreDuplicates: false
          })
          .select()
          .single();
        
        console.log(`Database upsert completed in ${Date.now() - startTime}ms`);
        
        if (error) {
          console.error('Database error:', error);
          options?.onProgress?.('❌ Failed to save beatmap', 100);
          return { error, data: null };
        }

        options?.onProgress?.('🎉 Beatmap saved successfully!', 100);
        return { error: null, data };
      } catch (err: any) {
        console.error('Database operation error:', err);
        options?.onProgress?.('❌ Save failed - please try again', 100);
        return { error: { message: err.message || 'Database operation failed' }, data: null };
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      options?.onProgress?.('❌ Save failed - please try again', 100);
      return { error: { message: err.message || 'An unexpected error occurred. Please check your connection and try again.' }, data: null };
    }
  };

  const rateBeatmap = async (beatmapId: string, rating: number) => {
    if (!supabase || !user) return { error: { message: 'Not authenticated' } };

    const { error } = await supabase
      .from('beatmap_ratings')
      .upsert({
        beatmap_id: beatmapId,
        user_id: user.id,
        rating
      }, {
        onConflict: 'beatmap_id,user_id'
      });

    return { error };
  };

  const getPublicBeatmaps = async (search?: string) => {
    if (!supabase) return [];

    try {
      // Exclude large fields (audio_data, notes) for faster loading
      // Only fetch essential fields for the list view
      let query = supabase
        .from('public_beatmaps')
        .select('id, user_id, name, artist, duration, difficulty, bpm, is_public, rating, rating_count, download_count, created_at, updated_at, user:user_profiles(username)')
        .eq('is_public', true)
        .order('rating', { ascending: false })
        .limit(50); // Limit results for faster loading

      if (search) {
        query = query.or(`name.ilike.%${search}%,artist.ilike.%${search}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching public beatmaps:', error);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('Exception in getPublicBeatmaps:', err);
      return [];
    }
  };

  const getPublicBeatmap = async (beatmapId: string): Promise<PublicBeatmap | null> => {
    if (!supabase) return null;

    try {
      // Fetch full beatmap data including notes and audio_data
      const { data, error } = await supabase
        .from('public_beatmaps')
        .select('*, user:user_profiles(username)')
        .eq('id', beatmapId)
        .single();

      if (error) {
        console.error('Error fetching beatmap:', error);
        return null;
      }

      return data as PublicBeatmap;
    } catch (err) {
      console.error('Exception in getPublicBeatmap:', err);
      return null;
    }
  };

  const getUserBeatmaps = async () => {
    if (!supabase || !user) return [];

    const { data } = await supabase
      .from('public_beatmaps')
      .select('*')
      .eq('user_id', user.id);

    return data || [];
  };

  const getDownloadedBeatmaps = async (): Promise<PublicBeatmap[]> => {
    if (!supabase || !user) return [];

    const { data } = await supabase
      .from('user_beatmap_downloads')
      .select('beatmap_id, public_beatmaps(*, user:user_profiles(username))')
      .eq('user_id', user.id);

    if (!data) return [];

    // Flatten the nested structure
    const beatmaps: PublicBeatmap[] = [];
    for (const item of data) {
      const beatmap = item.public_beatmaps;
      if (beatmap && !Array.isArray(beatmap)) {
        beatmaps.push(beatmap as unknown as PublicBeatmap);
      }
    }

    return beatmaps;
  };

  const deleteBeatmap = async (beatmapId: string) => {
    // 1. Delete locally
    await dbHelper.deleteMap(beatmapId);

    // 2. If authenticated, try to delete from server
    if (supabase && user) {
      // First check if we own it or if it's a download
      const { error: deleteError } = await supabase
        .from('public_beatmaps')
        .delete()
        .eq('id', beatmapId)
        .eq('user_id', user.id);

      if (deleteError) {
        // If we couldn't delete from public_beatmaps, it might be a downloaded map record
        // In that case, we just remove the download record
        await supabase
          .from('user_beatmap_downloads')
          .delete()
          .eq('beatmap_id', beatmapId)
          .eq('user_id', user.id);
      } else {
        // Successfully deleted from DB, also clean up audio from Storage
        await deleteAudioFromStorage(beatmapId, user.id);
      }
    }

    return { error: null };
  };

  // ============================================
  // Real-time Subscription Management
  // ============================================
  
  // Convert database record to PublicBeatmap format
  const dbToPublicBeatmap = useCallback((record: any): PublicBeatmap => ({
    id: record.id,
    user_id: record.user_id,
    name: record.name,
    artist: record.artist,
    duration: record.duration,
    difficulty: record.difficulty,
    notes: record.notes,
    events: record.events,
    audio_data: record.audio_data,
    bpm: record.bpm,
    is_public: record.is_public,
    rating: record.rating,
    rating_count: record.rating_count,
    download_count: record.download_count,
    created_at: record.created_at,
    updated_at: record.updated_at,
    user: record.user
  }), []);

  // Subscribe to real-time updates
  const subscribeToRealtime = useCallback((callbacks: RealtimeCallbacks): (() => void) => {
    if (!supabase || !isSupabaseConfigured) {
      return () => {};
    }

    // Store callbacks
    realtimeCallbacksRef.current = callbacks;
    
    // Create a unique subscription ID for this subscriber
    const subscriptionId = Date.now().toString();
    
    // User's beatmaps channel
    const userBeatmapsChannel = user ? supabase
      .channel(`user_beatmaps:${user.id}:${subscriptionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'public_beatmaps',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          console.log(`[Realtime] User beatmap ${eventType}:`, newRecord || oldRecord);

          switch (eventType) {
            case 'INSERT':
              if (newRecord && callbacks.onBeatmapInsert) {
                callbacks.onBeatmapInsert(dbToPublicBeatmap(newRecord));
              }
              break;
            case 'UPDATE':
              if (newRecord && callbacks.onBeatmapUpdate) {
                callbacks.onBeatmapUpdate(dbToPublicBeatmap(newRecord));
              }
              break;
            case 'DELETE':
              if (oldRecord && callbacks.onBeatmapDelete) {
                callbacks.onBeatmapDelete(oldRecord.id);
              }
              break;
          }
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] User beatmaps channel status:`, status);
        setIsRealtimeConnected(status === 'SUBSCRIBED');
      }) : null;

    // Public beatmaps channel (for browse page)
    const publicBeatmapsChannel = supabase
      .channel(`public_beatmaps:${subscriptionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'public_beatmaps',
          filter: 'is_public=eq.true'
        },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          console.log(`[Realtime] Public beatmap ${eventType}:`, newRecord || oldRecord);

          switch (eventType) {
            case 'INSERT':
              if (newRecord && callbacks.onBeatmapInsert) {
                callbacks.onBeatmapInsert(dbToPublicBeatmap(newRecord));
              }
              break;
            case 'UPDATE':
              if (newRecord && callbacks.onBeatmapUpdate) {
                if (newRecord.is_public) {
                  callbacks.onBeatmapUpdate(dbToPublicBeatmap(newRecord));
                } else if (callbacks.onBeatmapDelete) {
                  // Was made private, treat as delete
                  callbacks.onBeatmapDelete(newRecord.id);
                }
              }
              break;
            case 'DELETE':
              if (oldRecord && callbacks.onBeatmapDelete) {
                callbacks.onBeatmapDelete(oldRecord.id);
              }
              break;
          }
        }
      )
      .subscribe();

    // User profile channel
    const userProfileChannel = user ? supabase
      .channel(`user_profile:${user.id}:${subscriptionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_profiles',
          filter: `id=eq.${user.id}`
        },
        (payload) => {
          const { new: newRecord } = payload;
          console.log(`[Realtime] Profile update:`, newRecord);
          if (newRecord && callbacks.onProfileUpdate) {
            callbacks.onProfileUpdate(newRecord as UserProfile);
          }
        }
      )
      .subscribe() : null;

    // Rating changes channel
    const ratingChannel = supabase
      .channel(`beatmap_ratings:${subscriptionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'beatmap_ratings'
        },
        async (payload) => {
          const { new: newRecord, old: oldRecord } = payload;
          const beatmapId = (newRecord as any)?.beatmap_id || (oldRecord as any)?.beatmap_id;
          
          if (beatmapId && callbacks.onRatingChange) {
            // Fetch the updated rating from the beatmap
            const { data } = await supabase
              .from('public_beatmaps')
              .select('rating, rating_count')
              .eq('id', beatmapId)
              .single();
            
            if (data) {
              console.log(`[Realtime] Rating change for ${beatmapId}:`, data.rating);
              callbacks.onRatingChange(beatmapId, data.rating, data.rating_count);
            }
          }
        }
      )
      .subscribe();

    // Store channels for cleanup
    const channels = [
      { channel: userBeatmapsChannel, callbacks },
      { channel: publicBeatmapsChannel, callbacks },
      { channel: userProfileChannel, callbacks },
      { channel: ratingChannel, callbacks }
    ].filter(c => c.channel !== null) as { channel: any; callbacks: RealtimeCallbacks }[];
    
    channelsRef.current = [...channelsRef.current, ...channels];

    // Return unsubscribe function
    return () => {
      channels.forEach(({ channel }) => {
        if (channel && supabase) {
          supabase.removeChannel(channel);
        }
      });
      channelsRef.current = channelsRef.current.filter(
        c => !channels.includes(c)
      );
      
      if (channelsRef.current.length === 0) {
        setIsRealtimeConnected(false);
      }
    };
  }, [user, dbToPublicBeatmap]);

  // Cleanup real-time subscriptions on unmount
  useEffect(() => {
    return () => {
      channelsRef.current.forEach(({ channel }) => {
        if (channel && supabase) {
          supabase.removeChannel(channel);
        }
      });
      channelsRef.current = [];
      setIsRealtimeConnected(false);
    };
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      session,
      loading,
      isConfigured,
      isGuest,
      signUp,
      signIn,
      signOut,
      updateUsername,
      syncBeatmaps,
      downloadBeatmap,
      uploadBeatmap,
      rateBeatmap,
      getPublicBeatmaps,
      getPublicBeatmap,
      getUserBeatmaps,
      getDownloadedBeatmaps,
      deleteBeatmap,
      getAllUserBeatmaps,
      getUserBeatmapsDigest,
      getBeatmapById,
      subscribeToRealtime,
      isRealtimeConnected
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
