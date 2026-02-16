import { useEffect, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured, PublicBeatmap, UserProfile } from './supabase';
import { User } from '@supabase/supabase-js';
import { Beatmap } from '../types';

// Real-time subscription configuration
interface SubscriptionConfig {
  onBeatmapInsert?: (beatmap: PublicBeatmap) => void;
  onBeatmapUpdate?: (beatmap: PublicBeatmap) => void;
  onBeatmapDelete?: (beatmapId: string) => void;
  onProfileUpdate?: (profile: UserProfile) => void;
  onRatingChange?: (beatmapId: string, rating: number, ratingCount: number) => void;
}

interface RealtimeChannel {
  unsubscribe: () => void;
}

/**
 * Hook for managing real-time subscriptions to Supabase database changes
 * 
 * This hook sets up PostgreSQL Change Data Capture (CDC) subscriptions
 * to receive real-time updates when data changes in the database.
 */
export function useRealtimeSubscriptions(
  user: User | null,
  config: SubscriptionConfig
) {
  const channelsRef = useRef<RealtimeChannel[]>([]);
  const configRef = useRef(config);

  // Keep config ref updated
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Convert database record to Beatmap format
  const dbToBeatmap = (record: any): Beatmap => ({
    id: record.id,
    name: record.name,
    artist: record.artist,
    duration: record.duration,
    difficulty: record.difficulty,
    notes: record.notes,
    events: record.events,
    audioData: record.audio_data,
    bpm: record.bpm,
    isPublic: record.is_public
  });

  // Convert database record to PublicBeatmap format
  const dbToPublicBeatmap = (record: any): PublicBeatmap => ({
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
    updated_at: record.updated_at
  });

  // Subscribe to user's beatmaps changes
  const subscribeToUserBeatmaps = useCallback(() => {
    if (!supabase || !user || !isSupabaseConfigured) return null;

    const channel = supabase
      .channel(`user_beatmaps:${user.id}`)
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

          switch (eventType) {
            case 'INSERT':
              if (newRecord && configRef.current.onBeatmapInsert) {
                configRef.current.onBeatmapInsert(dbToPublicBeatmap(newRecord));
              }
              break;
            case 'UPDATE':
              if (newRecord && configRef.current.onBeatmapUpdate) {
                configRef.current.onBeatmapUpdate(dbToPublicBeatmap(newRecord));
              }
              break;
            case 'DELETE':
              if (oldRecord && configRef.current.onBeatmapDelete) {
                configRef.current.onBeatmapDelete(oldRecord.id);
              }
              break;
          }
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      }
    };
  }, [user]);

  // Subscribe to public beatmaps changes (for browse page)
  const subscribeToPublicBeatmaps = useCallback(() => {
    if (!supabase || !isSupabaseConfigured) return null;

    const channel = supabase
      .channel('public_beatmaps_changes')
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

          switch (eventType) {
            case 'INSERT':
              if (newRecord && configRef.current.onBeatmapInsert) {
                configRef.current.onBeatmapInsert(dbToPublicBeatmap(newRecord));
              }
              break;
            case 'UPDATE':
              if (newRecord && configRef.current.onBeatmapUpdate) {
                // Check if still public
                if (newRecord.is_public) {
                  configRef.current.onBeatmapUpdate(dbToPublicBeatmap(newRecord));
                } else {
                  // Was made private, treat as delete
                  if (configRef.current.onBeatmapDelete) {
                    configRef.current.onBeatmapDelete(newRecord.id);
                  }
                }
              }
              break;
            case 'DELETE':
              if (oldRecord && configRef.current.onBeatmapDelete) {
                configRef.current.onBeatmapDelete(oldRecord.id);
              }
              break;
          }
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  // Subscribe to user profile changes
  const subscribeToUserProfile = useCallback(() => {
    if (!supabase || !user || !isSupabaseConfigured) return null;

    const channel = supabase
      .channel(`user_profile:${user.id}`)
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
          if (newRecord && configRef.current.onProfileUpdate) {
            configRef.current.onProfileUpdate(newRecord as UserProfile);
          }
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      }
    };
  }, [user]);

  // Subscribe to rating changes on beatmaps
  const subscribeToRatingChanges = useCallback(() => {
    if (!supabase || !isSupabaseConfigured) return null;

    const channel = supabase
      .channel('beatmap_ratings_changes')
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
          
          if (beatmapId && configRef.current.onRatingChange) {
            // Fetch the updated rating from the beatmap
            const { data } = await supabase
              .from('public_beatmaps')
              .select('rating, rating_count')
              .eq('id', beatmapId)
              .single();
            
            if (data) {
              configRef.current.onRatingChange(beatmapId, data.rating, data.rating_count);
            }
          }
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  // Set up all subscriptions when user changes
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // Clean up existing subscriptions
    channelsRef.current.forEach(channel => channel.unsubscribe());
    channelsRef.current = [];

    // Subscribe to user-specific channels
    const userBeatmapsChannel = subscribeToUserBeatmaps();
    if (userBeatmapsChannel) {
      channelsRef.current.push(userBeatmapsChannel);
    }

    const userProfileChannel = subscribeToUserProfile();
    if (userProfileChannel) {
      channelsRef.current.push(userProfileChannel);
    }

    // Subscribe to global channels
    const publicBeatmapsChannel = subscribeToPublicBeatmaps();
    if (publicBeatmapsChannel) {
      channelsRef.current.push(publicBeatmapsChannel);
    }

    const ratingChangesChannel = subscribeToRatingChanges();
    if (ratingChangesChannel) {
      channelsRef.current.push(ratingChangesChannel);
    }

    console.log(`[Realtime] Subscribed to ${channelsRef.current.length} channels`);

    // Cleanup on unmount or user change
    return () => {
      channelsRef.current.forEach(channel => channel.unsubscribe());
      channelsRef.current = [];
    };
  }, [
    user,
    subscribeToUserBeatmaps,
    subscribeToUserProfile,
    subscribeToPublicBeatmaps,
    subscribeToRatingChanges
  ]);

  return {
    // Expose subscription status if needed
    isSubscribed: channelsRef.current.length > 0
  };
}

/**
 * Hook for subscribing to a specific beatmap's changes
 * Useful for collaborative editing scenarios
 */
export function useBeatmapRealtime(
  beatmapId: string | null,
  onUpdate: (beatmap: PublicBeatmap) => void,
  onDelete: () => void
) {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured || !beatmapId) return;

    // Clean up existing subscription
    if (channelRef.current) {
      channelRef.current.unsubscribe();
    }

    const channel = supabase
      .channel(`beatmap:${beatmapId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'public_beatmaps',
          filter: `id=eq.${beatmapId}`
        },
        (payload) => {
          const { new: newRecord } = payload;
          if (newRecord) {
            onUpdate({
              id: newRecord.id,
              user_id: newRecord.user_id,
              name: newRecord.name,
              artist: newRecord.artist,
              duration: newRecord.duration,
              difficulty: newRecord.difficulty,
              notes: newRecord.notes,
              events: newRecord.events,
              audio_data: newRecord.audio_data,
              bpm: newRecord.bpm,
              is_public: newRecord.is_public,
              rating: newRecord.rating,
              rating_count: newRecord.rating_count,
              download_count: newRecord.download_count,
              created_at: newRecord.created_at,
              updated_at: newRecord.updated_at
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'public_beatmaps',
          filter: `id=eq.${beatmapId}`
        },
        () => {
          onDelete();
        }
      )
      .subscribe();

    channelRef.current = {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      }
    };

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [beatmapId, onUpdate, onDelete]);
}

export default useRealtimeSubscriptions;
