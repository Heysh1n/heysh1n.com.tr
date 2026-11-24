import React, { useEffect, useRef, useState } from 'react';

interface MusicWidgetIslandProps {
  backendUrl?: string;
}

type SpotifyResponse = {
  isPlaying?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  albumArt?: string | null;
  trackUrl?: string | null;
  previewUrl?: string | null;
  progressMs?: number | null;
  durationMs?: number | null;
  error?: string;
};

type TrackData = {
  name: string;
  artist: string;
  cover: string;
  badge: string;
  isPlaying: boolean;
  url?: string | null;
  previewUrl?: string | null;
  progressMs?: number | null;
  durationMs?: number | null;
};

const DEFAULT_COVER = '/assets/bg/music_thumbnail.svg';
const POLL_INTERVAL_MS = 6000; // Poll every 6 seconds (within 5-10s window)
const FETCH_TIMEOUT_MS = 6000;

const IDLE_TRACK: TrackData = {
  name: 'Not Playing',
  artist: 'Spotify standby',
  cover: DEFAULT_COVER,
  badge: 'STANDBY',
  isPlaying: false,
  url: null,
  previewUrl: null,
  progressMs: null,
  durationMs: null,
};

const formatTime = (ms: number | null | undefined): string => {
  if (ms == null || isNaN(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export default function MusicWidgetIsland({ backendUrl }: MusicWidgetIslandProps) {
  const [trackData, setTrackData] = useState<TrackData>({
    name: 'Connecting...',
    artist: 'Spotify Web API',
    cover: DEFAULT_COVER,
    badge: 'SYNCING',
    isPlaying: false,
    url: null,
    previewUrl: null,
    progressMs: null,
    durationMs: null,
  });

  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [userWantsAudio, setUserWantsAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentPreviewRef = useRef<string | null>(null);

  // Managed single HTMLAudioElement for real 30-second track preview
  useEffect(() => {
    const audio = new Audio();
    audio.loop = true;
    audio.preload = 'none';
    audioRef.current = audio;

    const handlePlay = () => setIsAudioPlaying(true);
    const handlePause = () => setIsAudioPlaying(false);
    const handleEnded = () => setIsAudioPlaying(false);
    const handleError = () => {
      setIsAudioPlaying(false);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
    };
  }, []);

  // When previewUrl changes, update audio source and resume if user previously enabled audio
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const nextUrl = trackData.previewUrl || '';
    if (currentPreviewRef.current !== nextUrl) {
      currentPreviewRef.current = nextUrl;

      if (nextUrl) {
        audio.src = nextUrl;
        audio.loop = true;
        audio.currentTime = 0;
        if (userWantsAudio) {
          audio.play().catch((err) => {
            console.warn('Autoplay prevented or playback error:', err);
            setIsAudioPlaying(false);
          });
        }
      } else {
        audio.pause();
        audio.removeAttribute('src');
        setIsAudioPlaying(false);
      }
    }
  }, [trackData.previewUrl, userWantsAudio]);

  // Actively poll ${backendUrl}/api/spotify/now-playing every 6 seconds
  useEffect(() => {
    let isMounted = true;

    const rawBase =
      backendUrl ||
      (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_BACKEND_URL) ||
      'http://127.0.0.1:3000';
    const cleanBase = String(rawBase).replace(/\/+$/, '');
    const endpoint = `${cleanBase}/api/spotify/now-playing`;

    const fetchSpotifyNowPlaying = async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        let res = await fetch(endpoint, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        }).catch(() => null);

        let data: SpotifyResponse | null = null;
        if (res && res.ok) {
          data = (await res.json().catch(() => null)) as SpotifyResponse | null;
        }

        // Fallback: If primary remote host fails or lacks configured Spotify credentials, try local dev server
        if (
          (!data || data.error || (!data.title && !data.isPlaying)) &&
          cleanBase !== 'http://127.0.0.1:3000' &&
          cleanBase !== 'http://localhost:3000'
        ) {
          try {
            const localRes = await fetch('http://127.0.0.1:3000/api/spotify/now-playing', {
              signal: AbortSignal.timeout(2500),
              headers: { Accept: 'application/json' },
            });
            if (localRes.ok) {
              const localData: SpotifyResponse = await localRes.json();
              if (localData && (localData.title || localData.isPlaying !== undefined) && !localData.error) {
                data = localData;
              }
            }
          } catch {
            // Local dev server not reachable
          }
        }

        if (!isMounted) return;

        if (data && data.title) {
          setTrackData({
            name: data.title,
            artist: data.artist || 'Unknown Artist',
            cover: data.albumArt || DEFAULT_COVER,
            badge: data.isPlaying ? 'NOW PLAYING' : 'RECENTLY PLAYED',
            isPlaying: Boolean(data.isPlaying),
            url: data.trackUrl || null,
            previewUrl: data.previewUrl || null,
            progressMs: data.progressMs ?? null,
            durationMs: data.durationMs ?? null,
          });
        } else if (data && data.isPlaying === false && !data.error) {
          setTrackData((prev) =>
            prev.name !== 'Connecting...'
              ? { ...IDLE_TRACK, artist: 'Spotify paused', previewUrl: data?.previewUrl || null }
              : IDLE_TRACK
          );
        } else {
          setTrackData((prev) => (prev.badge === 'SYNCING' ? IDLE_TRACK : prev));
        }
      } catch {
        if (isMounted) {
          setTrackData((prev) => (prev.badge === 'SYNCING' ? IDLE_TRACK : prev));
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    fetchSpotifyNowPlaying();
    const intervalId = window.setInterval(fetchSpotifyNowPlaying, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [backendUrl]);

  // Smooth local second-by-second progress advancement while playing
  useEffect(() => {
    if (!trackData.isPlaying || !trackData.durationMs) return;

    const interval = window.setInterval(() => {
      setTrackData((prev) => {
        if (!prev.isPlaying || !prev.durationMs || prev.progressMs == null) return prev;
        const nextProgress = prev.progressMs + 1000;
        return {
          ...prev,
          progressMs: Math.min(nextProgress, prev.durationMs),
        };
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [trackData.isPlaying, trackData.durationMs]);

  const hasPreview = Boolean(trackData.previewUrl);

  const toggleAudio = () => {
    const audio = audioRef.current;
    if (!audio || !hasPreview) return;

    if (isAudioPlaying) {
      setUserWantsAudio(false);
      audio.pause();
    } else {
      setUserWantsAudio(true);
      if (audio.src !== trackData.previewUrl) {
        audio.src = trackData.previewUrl!;
        audio.loop = true;
      }
      audio.play().catch((err) => {
        console.warn('Playback error:', err);
        setIsAudioPlaying(false);
        setUserWantsAudio(false);
      });
    }
  };

  const restartTrack = () => {
    const audio = audioRef.current;
    if (!audio || !hasPreview) return;
    audio.currentTime = 0;
    if (!isAudioPlaying) {
      setUserWantsAudio(true);
      audio.play().catch((err) => {
        console.warn('Playback error:', err);
        setIsAudioPlaying(false);
        setUserWantsAudio(false);
      });
    }
  };

  const progressPercent =
    trackData.durationMs && trackData.progressMs != null
      ? Math.min(100, Math.max(0, (trackData.progressMs / trackData.durationMs) * 100))
      : null;

  const previewLabel = !hasPreview
    ? 'Preview unavailable for this track'
    : isAudioPlaying
      ? 'Pause 30s preview'
      : 'Play 30s preview';

  const volumeLabel = !hasPreview
    ? 'Preview unavailable for this track'
    : isAudioPlaying
      ? 'Mute preview'
      : 'Play 30s preview';

  const restartLabel = hasPreview ? 'Restart 30s preview' : 'Preview unavailable for this track';

  return (
    <div className="player_card_inner">
      <div className="player_zone_top">
        <button
          type="button"
          onClick={toggleAudio}
          disabled={!hasPreview}
          className="volume_btn"
          data-active={isAudioPlaying ? 'true' : 'false'}
          title={volumeLabel}
          aria-label={volumeLabel}
        >
          <img
            src={isAudioPlaying ? '/assets/svg/v_max.svg' : '/assets/svg/v_off.svg'}
            alt={isAudioPlaying ? 'Volume active' : 'Volume muted'}
            className="hero_volume-image"
          />
        </button>

        <a
          href={trackData.url || '#'}
          target={trackData.url ? '_blank' : undefined}
          rel={trackData.url ? 'noopener noreferrer' : undefined}
          className="player_cover_link"
          data-clickable={trackData.url ? 'true' : 'false'}
          title={trackData.url ? `Open "${trackData.name}" on Spotify` : `${trackData.name}, ${trackData.artist}`}
          onClick={(e) => {
            if (!trackData.url) e.preventDefault();
          }}
        >
          <img
            src={trackData.cover}
            alt={trackData.name}
            className="hero_player-image"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = DEFAULT_COVER;
            }}
          />
        </a>

        <div className="player_meta">
          <span className="player_title" title={trackData.name}>
            {trackData.name}
          </span>
          <span className="player_artist" title={trackData.artist}>
            {trackData.artist}
          </span>
        </div>
      </div>

      <div className="player_zone_middle">
        <div className="player_status_row">
          {trackData.isPlaying || isAudioPlaying ? (
            <span className="player_status_badge player_status_live">
              <span className="player_visualizer" aria-hidden="true">
                <span className="visualizer_bar bar_1" />
                <span className="visualizer_bar bar_2" />
                <span className="visualizer_bar bar_3" />
              </span>
              {isAudioPlaying && !trackData.isPlaying ? 'PREVIEW PLAYING' : trackData.badge}
            </span>
          ) : (
            <span className="player_status_badge">
              <span className="player_status_dot" aria-hidden="true" />
              {trackData.badge}
            </span>
          )}
        </div>

        {progressPercent != null ? (
          <div className="player_progress_wrap">
            <div className="player_progress_track">
              <div className="player_progress_fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="player_progress_times">
              <span>{formatTime(trackData.progressMs)}</span>
              <span>{formatTime(trackData.durationMs)}</span>
            </div>
          </div>
        ) : (
          <div className="player_timeline_wrap">
            <img
              src="/assets/svg/line+timestamp.svg"
              alt=""
              aria-hidden="true"
              className="player_timeline"
            />
          </div>
        )}

        <div className="player_ui">
          <div className="player_controls">
            <button
              type="button"
              className="player_control_btn"
              aria-label={restartLabel}
              onClick={restartTrack}
              disabled={!hasPreview}
              title={restartLabel}
            >
              <img src="/assets/svg/s_back.svg" alt="" aria-hidden="true" className="player_control_icon" />
            </button>

            <button
              type="button"
              className="player_control_btn player_control_btn_primary"
              data-playing={isAudioPlaying ? 'true' : 'false'}
              onClick={toggleAudio}
              disabled={!hasPreview}
              aria-label={previewLabel}
              title={previewLabel}
            >
              <img
                src={isAudioPlaying ? '/assets/svg/pause.svg' : '/assets/svg/play.svg'}
                alt=""
                aria-hidden="true"
                className="player_control_icon_primary"
              />
            </button>

            <button
              type="button"
              className="player_control_btn"
              aria-label={restartLabel}
              onClick={restartTrack}
              disabled={!hasPreview}
              title={restartLabel}
            >
              <img src="/assets/svg/s_forward.svg" alt="" aria-hidden="true" className="player_control_icon" />
            </button>
          </div>
        </div>
      </div>

      <div className="player_zone_bottom">
        <span className="player_source_badge">
          <span className="player_source_dot" data-live={trackData.isPlaying ? 'true' : 'false'} aria-hidden="true" />
          SPOTIFY
        </span>
      </div>
    </div>
  );
}
