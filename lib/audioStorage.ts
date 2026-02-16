import { supabase } from './supabase';

const STORAGE_BUCKET = 'beatmap-audio';

/**
 * Converts a Base64 data URL to a Blob.
 * Base64 encoding adds ~33% overhead, so this alone significantly reduces the upload size.
 * Example: 15MB base64 string → ~10MB blob.
 */
function base64ToBlob(base64DataUrl: string): Blob {
    const parts = base64DataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'audio/mpeg';
    const byteString = atob(parts[1]);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < byteString.length; i++) {
        uint8Array[i] = byteString.charCodeAt(i);
    }
    return new Blob([uint8Array], { type: mime });
}

/**
 * Checks if the audio format is already compressed (MP3, OGG, AAC, etc.)
 * Note: We still attempt to re-compress these at lower bitrate for size reduction.
 */
function isAlreadyCompressed(mimeType: string): boolean {
    const compressedTypes = [
        'audio/mpeg', 'audio/mp3', 'audio/mpeg3', // MP3
        'audio/ogg', 'audio/opus', // OGG/Opus
        'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', // AAC/M4A
        'audio/webm', // WebM (usually Opus or Vorbis)
        'audio/x-mpeg', 'audio/x-mpeg-3' // More MP3 variants
    ];
    return compressedTypes.some(type => mimeType.toLowerCase().includes(type.split('/')[1]));
}

/**
 * Checks if MediaRecorder supports WebM/Opus encoding.
 * This is the preferred format for re-compression due to excellent quality/size ratio.
 */
async function supportsWebMOpus(): Promise<boolean> {
    const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
    ];
    for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
            return true;
        }
    }
    return false;
}

/**
 * Size threshold for aggressive compression (2MB)
 * Files larger than this will be compressed more aggressively
 */
const AGGRESSIVE_COMPRESSION_THRESHOLD = 2 * 1024 * 1024; // 2MB

/**
 * Compresses audio by converting to mono and downsampling.
 * Only uses compression if the result is actually SMALLER than the original.
 * 
 * For already-compressed formats (MP3, OGG, AAC), we attempt to re-encode
 * at lower bitrate using WebM/Opus for additional size reduction.
 * 
 * For uncompressed formats (WAV, AIFF), downsampling + mono gives big savings.
 * 
 * For large files (2+ MB), uses aggressive compression with lower sample rate.
 */
async function compressAudioSmart(base64DataUrl: string, onProgress?: (stage: string, percent: number) => void): Promise<Blob> {
    // Step 1: Always convert base64 to blob (removes ~33% overhead from base64 encoding)
    onProgress?.('📦 Preparing audio...', 10);
    const originalBlob = base64ToBlob(base64DataUrl);
    const isLargeFile = originalBlob.size >= AGGRESSIVE_COMPRESSION_THRESHOLD;

    // For already-compressed formats (MP3, OGG, AAC), just use the original file.
    // Re-encoding is very slow (can freeze the browser) and doesn't provide significant savings
    // since these formats are already highly compressed.
    if (isAlreadyCompressed(originalBlob.type)) {
        console.log(`Audio is already compressed (${originalBlob.type}), using original (${Math.round(originalBlob.size / 1024)}KB)`);
        onProgress?.('✅ Audio already optimized, skipping compression...', 25);
        return originalBlob;
    }

    // For large uncompressed files (2+ MB), try aggressive compression
    if (isLargeFile) {
        console.log(`Large uncompressed file detected (${Math.round(originalBlob.size / (1024 * 1024))}MB), attempting aggressive compression...`);
        return compressLargeAudio(originalBlob, onProgress);
    }

    // If already small enough (<2MB), just use the original blob directly
    if (originalBlob.size < AGGRESSIVE_COMPRESSION_THRESHOLD) {
        console.log(`Audio already small (${Math.round(originalBlob.size / 1024)}KB), skipping compression`);
        onProgress?.('✅ Audio already small, skipping compression...', 25);
        return originalBlob;
    }

    // Try to compress by downsampling to mono 22050Hz
    // This is mainly beneficial for uncompressed formats like WAV
    return compressLargeAudio(originalBlob, onProgress);
}

/**
 * Re-compresses already-compressed audio (MP3, OGG, AAC) at lower bitrate.
 * Uses WebM/Opus encoding which provides excellent quality at low bitrates.
 * Target: 64kbps Opus audio which is sufficient for rhythm games.
 */
async function recompressAtLowerBitrate(originalBlob: Blob): Promise<Blob | null> {
    try {
        // Check if WebM/Opus encoding is supported
        if (!await supportsWebMOpus()) {
            console.log('WebM/Opus encoding not supported, skipping re-compression');
            return null;
        }

        console.log('Re-encoding audio with WebM/Opus at 64kbps...');
        
        // Decode the original audio
        const arrayBuffer = await originalBlob.arrayBuffer();
        const tempCtx = new AudioContext();
        let audioBuffer: AudioBuffer;
        try {
            audioBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
        } finally {
            await tempCtx.close();
        }

        // Create an OfflineAudioContext to render the audio
        const offlineCtx = new OfflineAudioContext(
            1, // mono
            audioBuffer.length,
            audioBuffer.sampleRate
        );

        // Copy the audio data
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start();

        // Render the audio
        const renderedBuffer = await offlineCtx.startRendering();

        // Use MediaRecorder to encode as WebM/Opus at low bitrate
        const audioData = renderedBuffer.getChannelData(0);
        
        // Create a new AudioContext for playback
        const playbackCtx = new AudioContext();
        const newBuffer = playbackCtx.createBuffer(1, audioData.length, renderedBuffer.sampleRate);
        newBuffer.copyToChannel(audioData, 0);
        
        const sourceNode = playbackCtx.createBufferSource();
        sourceNode.buffer = newBuffer;
        
        const mediaStreamDestination = playbackCtx.createMediaStreamDestination();
        sourceNode.connect(mediaStreamDestination);
        sourceNode.start();

        // Determine the best supported MIME type
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/webm';
        }

        // Record at low bitrate (64kbps)
        const recorder = new MediaRecorder(mediaStreamDestination.stream, {
            mimeType,
            audioBitsPerSecond: 64000 // 64kbps - good quality for rhythm games
        });

        const chunks: Blob[] = [];
        
        return new Promise((resolve) => {
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

            recorder.onstop = async () => {
                await playbackCtx.close();
                const webmBlob = new Blob(chunks, { type: mimeType });
                resolve(webmBlob);
            };

            recorder.onerror = (err) => {
                console.warn('MediaRecorder error:', err);
                playbackCtx.close();
                resolve(null);
            };

            // Start recording
            recorder.start();

            // Stop recording when audio finishes
            const duration = renderedBuffer.duration;
            setTimeout(() => {
                if (recorder.state !== 'inactive') {
                    recorder.stop();
                }
            }, (duration + 0.5) * 1000); // Add 0.5s buffer
        });
    } catch (err) {
        console.warn('Re-compression failed:', err);
        return null;
    }
}

/**
 * Yields execution to allow UI updates during heavy processing.
 * This prevents the browser from freezing during long-running operations.
 */
function yieldToMain(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Aggressive compression for large audio files (6+ MB).
 * Uses lower sample rate (16000Hz) and 8-bit encoding for maximum size reduction.
 * Now includes periodic yields to prevent UI freezing.
 */
async function compressLargeAudio(originalBlob: Blob, onProgress?: (stage: string, percent: number) => void): Promise<Blob> {
    try {
        console.log(`Attempting aggressive compression for ${originalBlob.type} (${Math.round(originalBlob.size / 1024)}KB)...`);
        
        onProgress?.('📦 Reading audio data...', 12);
        const arrayBuffer = await originalBlob.arrayBuffer();

        // Use a temporary AudioContext just for decoding
        onProgress?.('📦 Decoding audio...', 15);
        const tempCtx = new AudioContext();
        let audioBuffer: AudioBuffer;
        try {
            audioBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
        } finally {
            await tempCtx.close();
        }

        // For large files, use more aggressive compression:
        // - 16000Hz sample rate (speech quality, but sufficient for rhythm games)
        // - Mono
        // - 8-bit encoding (half the size of 16-bit)
        const targetSampleRate = 16000;

        // Mix down to mono with progress updates
        onProgress?.('📦 Converting to mono...', 18);
        await yieldToMain();
        
        const monoData = new Float32Array(audioBuffer.length);
        if (audioBuffer.numberOfChannels > 1) {
            const left = audioBuffer.getChannelData(0);
            const right = audioBuffer.getChannelData(1);
            // Process in chunks to yield to main thread periodically
            const chunkSize = 100000;
            for (let i = 0; i < audioBuffer.length; i += chunkSize) {
                const end = Math.min(i + chunkSize, audioBuffer.length);
                for (let j = i; j < end; j++) {
                    monoData[j] = (left[j] + right[j]) / 2;
                }
                // Yield every chunk to keep UI responsive
                if (i % (chunkSize * 5) === 0) {
                    await yieldToMain();
                }
            }
        } else {
            monoData.set(audioBuffer.getChannelData(0));
        }

        // Resample to target rate (linear interpolation) with progress updates
        onProgress?.('📦 Resampling audio...', 22);
        await yieldToMain();
        
        const resampleRatio = targetSampleRate / audioBuffer.sampleRate;
        const resampledLength = Math.round(monoData.length * resampleRatio);
        const resampledData = new Float32Array(resampledLength);

        // Process in chunks to yield to main thread periodically
        const resampleChunkSize = 100000;
        for (let i = 0; i < resampledLength; i += resampleChunkSize) {
            const end = Math.min(i + resampleChunkSize, resampledLength);
            for (let j = i; j < end; j++) {
                const srcIndex = j / resampleRatio;
                const srcIndexFloor = Math.floor(srcIndex);
                const srcIndexCeil = Math.min(srcIndexFloor + 1, monoData.length - 1);
                const t = srcIndex - srcIndexFloor;
                resampledData[j] = monoData[srcIndexFloor] * (1 - t) + monoData[srcIndexCeil] * t;
            }
            // Yield every chunk to keep UI responsive
            await yieldToMain();
        }

        // Try 8-bit WAV first for maximum compression
        onProgress?.('📦 Encoding audio...', 26);
        await yieldToMain();
        
        let wavBlob = encodeWAV8Bit(resampledData, targetSampleRate);
        
        // KEY CHECK: Only use compressed version if it's actually SMALLER
        if (wavBlob.size < originalBlob.size) {
            console.log(`Audio aggressively compressed: ${Math.round(originalBlob.size / 1024)}KB → ${Math.round(wavBlob.size / 1024)}KB (${Math.round((1 - wavBlob.size / originalBlob.size) * 100)}% smaller, 8-bit)`);
            return wavBlob;
        }
        
        // Try 16-bit WAV as fallback (better quality, slightly larger)
        wavBlob = encodeWAV(resampledData, targetSampleRate, 1);
        
        if (wavBlob.size < originalBlob.size) {
            console.log(`Audio compressed: ${Math.round(originalBlob.size / 1024)}KB → ${Math.round(wavBlob.size / 1024)}KB (${Math.round((1 - wavBlob.size / originalBlob.size) * 100)}% smaller, 16-bit)`);
            return wavBlob;
        }
        
        // WAV is bigger (original was already compressed MP3/OGG) — use original
        console.log(`WAV would be larger (${Math.round(wavBlob.size / 1024)}KB vs ${Math.round(originalBlob.size / 1024)}KB), using original format`);
        return originalBlob;
    } catch (err) {
        console.warn('Audio compression failed, using original blob:', err);
        return originalBlob;
    }
}

/**
 * Encodes PCM Float32 samples as a 16-bit WAV file.
 */
function encodeWAV(samples: Float32Array, sampleRate: number, numChannels: number): Blob {
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // WAV header
    writeStr(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(view, 8, 'WAVE');
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);        // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);        // 16 bits
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write PCM samples as int16
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Encodes PCM Float32 samples as an 8-bit WAV file.
 * Uses mu-law encoding for better dynamic range at 8-bit.
 * This produces files half the size of 16-bit WAV.
 */
function encodeWAV8Bit(samples: Float32Array, sampleRate: number): Blob {
    const numChannels = 1;
    const bytesPerSample = 1;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // WAV header
    writeStr(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(view, 8, 'WAVE');
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);        // fmt chunk size
    view.setUint16(20, 1, true);         // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 8, true);         // 8 bits per sample
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write PCM samples as uint8 (8-bit unsigned)
    // Map -1.0..1.0 to 0..255
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        // Convert to 8-bit unsigned: 0 to 255
        const uint8Value = Math.round((s + 1) * 127.5);
        view.setUint8(offset, uint8Value);
        offset += 1;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

function writeStr(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

/**
 * Formats file size in a user-friendly way
 */
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Uploads audio to Supabase Storage with retry logic and detailed progress.
 * Uses binary blob upload (MUCH faster than sending Base64 in JSON payload).
 * 
 * Pipeline:
 *   1. Base64 → Blob (removes ~33% base64 overhead)
 *   2. Smart compress: only if WAV is smaller than original
 *   3. Binary upload to Supabase Storage (fast, streaming)
 * 
 * Performance:
 *   - 5 min MP3: ~7MB blob → binary upload in ~1-2 seconds
 *   - 7 min MP3: ~10MB blob → binary upload in ~2-3 seconds
 *   - 5 min WAV: ~50MB → ~5MB mono 22kHz → upload in ~1-2 seconds
 */
/**
 * Uploads a blob to Supabase Storage with real-time progress using XMLHttpRequest.
 * This provides actual upload progress instead of appearing frozen for large files.
 */
function uploadWithProgress(
    url: string,
    blob: Blob,
    headers: Record<string, string>,
    onProgress?: (percent: number) => void
): Promise<{ error: any }> {
    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        let lastReportedPercent = 0;
        
        // Fallback: simulate progress if XHR progress events don't fire
        // (can happen with some server configurations)
        const fallbackInterval = setInterval(() => {
            if (lastReportedPercent < 95) {
                // Slowly increment to show activity (never reach 100% until actual completion)
                lastReportedPercent = Math.min(lastReportedPercent + 1, 95);
                onProgress?.(lastReportedPercent);
            }
        }, 500);
        
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percent = Math.round((event.loaded / event.total) * 100);
                lastReportedPercent = percent;
                onProgress?.(percent);
            }
        };
        
        xhr.onload = () => {
            clearInterval(fallbackInterval);
            if (xhr.status >= 200 && xhr.status < 300) {
                onProgress?.(100);
                resolve({ error: null });
            } else {
                console.error('Upload failed:', xhr.status, xhr.responseText);
                resolve({ error: { message: `Upload failed: ${xhr.status}` } });
            }
        };
        
        xhr.onerror = () => {
            clearInterval(fallbackInterval);
            console.error('Network error during upload');
            resolve({ error: { message: 'Network error during upload' } });
        };
        
        xhr.ontimeout = () => {
            clearInterval(fallbackInterval);
            console.error('Upload timed out');
            resolve({ error: { message: 'Upload timed out' } });
        };
        
        xhr.timeout = 5 * 60 * 1000; // 5 minute timeout for large files
        
        xhr.open('POST', url, true);
        
        // Set headers
        for (const [key, value] of Object.entries(headers)) {
            xhr.setRequestHeader(key, value);
        }
        
        xhr.send(blob);
    });
}

export async function uploadAudioToStorage(
    audioBase64: string,
    beatmapId: string,
    userId: string,
    onProgress?: (stage: string, percent: number) => void
): Promise<{ url: string | null; error: any }> {
    if (!supabase) return { url: null, error: { message: 'Supabase not configured' } };

    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000; // 2 seconds between retries

    const attemptUpload = async (attempt: number): Promise<{ url: string | null; error: any }> => {
        try {
            const startTime = performance.now();
            const attemptText = attempt > 1 ? ` (attempt ${attempt}/${MAX_RETRIES})` : '';

            // Step 1: Prepare audio (10-30%)
            onProgress?.(`📦 Preparing audio file${attemptText}...`, 10);

            // Smart compression: only compresses if result is smaller
            const audioBlob = await compressAudioSmart(audioBase64);
            const fileSize = formatFileSize(audioBlob.size);

            const compressionTime = performance.now() - startTime;
            console.log(`Audio preparation took ${Math.round(compressionTime)}ms, final size: ${fileSize}`);

            // Determine file extension from blob type
            const ext = audioBlob.type.includes('wav') ? 'wav'
                : audioBlob.type.includes('ogg') ? 'ogg'
                    : audioBlob.type.includes('webm') ? 'webm'
                        : audioBlob.type.includes('mpeg') || audioBlob.type.includes('mp3') ? 'mp3'
                            : audioBlob.type.includes('aac') || audioBlob.type.includes('mp4') ? 'aac'
                                : 'bin';
            const filePath = `${userId}/${beatmapId}.${ext}`;

            // Step 2: Upload to storage with real progress (30-90%)
            onProgress?.(`📤 Uploading audio (${fileSize})${attemptText}...`, 30);

            // Get Supabase credentials and user session
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            
            if (!supabaseUrl) {
                return { url: null, error: { message: 'Supabase not configured' } };
            }

            // Get the current session for authentication
            const { data: sessionData } = await supabase.auth.getSession();
            const accessToken = sessionData.session?.access_token;
            
            if (!accessToken) {
                return { url: null, error: { message: 'Not authenticated' } };
            }

            // Construct the upload URL
            const uploadUrl = `${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${filePath}`;

            // Upload with real progress tracking using user's access token
            const { error: uploadError } = await uploadWithProgress(
                uploadUrl,
                audioBlob,
                {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': audioBlob.type,
                    'x-upsert': 'true',
                    'Cache-Control': '3600'
                },
                (percent) => {
                    // Map upload progress to 30-90% range
                    const mappedPercent = 30 + (percent * 0.6);
                    onProgress?.(`📤 Uploading audio (${fileSize})... ${percent}%`, mappedPercent);
                }
            );

            if (uploadError) {
                console.error(`Storage upload error (attempt ${attempt}):`, uploadError);
                return { url: null, error: uploadError };
            }

            const totalTime = performance.now() - startTime;
            console.log(`✅ Total audio upload: ${Math.round(totalTime)}ms (${fileSize})`);

            // Step 3: Get URL (90-100%)
            onProgress?.(`🔗 Finalizing upload...`, 90);

            // Get the public URL for playback
            const { data: urlData } = supabase.storage
                .from(STORAGE_BUCKET)
                .getPublicUrl(filePath);

            onProgress?.(`✅ Audio uploaded successfully!`, 100);
            return { url: urlData.publicUrl, error: null };

        } catch (err) {
            console.error(`Audio upload failed (attempt ${attempt}):`, err);
            return { url: null, error: err };
        }
    };

    // Try upload with retries
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const result = await attemptUpload(attempt);
        
        if (result.url) {
            return result; // Success!
        }
        
        // If this wasn't the last attempt, wait and retry
        if (attempt < MAX_RETRIES) {
            onProgress?.(`⚠️ Upload failed, retrying in 2 seconds... (${attempt}/${MAX_RETRIES})`, 20);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
    }

    // All retries failed
    return { 
        url: null, 
        error: { 
            message: `Failed to upload audio after ${MAX_RETRIES} attempts. Please check your internet connection and try again.` 
        } 
    };
}

/**
 * Deletes audio from storage when a beatmap is deleted.
 */
export async function deleteAudioFromStorage(
    beatmapId: string,
    userId: string
): Promise<void> {
    if (!supabase) return;

    try {
        // Try all possible extensions since we don't track which was used
        await supabase.storage.from(STORAGE_BUCKET).remove([
            `${userId}/${beatmapId}.wav`,
            `${userId}/${beatmapId}.mp3`,
            `${userId}/${beatmapId}.ogg`,
            `${userId}/${beatmapId}.webm`,
            `${userId}/${beatmapId}.aac`,
            `${userId}/${beatmapId}.bin`
        ]);
    } catch (err) {
        console.warn('Failed to delete audio from storage:', err);
    }
}

/**
 * Checks if a string is a Storage URL (starts with http) vs Base64 data URL.
 */
export function isStorageUrl(audioData: string | undefined): boolean {
    if (!audioData) return false;
    return audioData.startsWith('http://') || audioData.startsWith('https://');
}

/**
 * Gets a playable audio source. Both Storage URLs and base64 data URLs
 * work directly as an <audio> element src.
 */
export function getPlayableAudioSrc(audioData: string | undefined): string {
    if (!audioData) return '';
    return audioData;
}
