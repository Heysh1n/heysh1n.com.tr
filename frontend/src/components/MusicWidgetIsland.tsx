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
  artist: 'Spotify — Standby',
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
              ? { ...IDLE_TRACK, artist: 'Spotify — Paused', previewUrl: data?.previewUrl || null }
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

  return (
    <div
      className="player_card_inner"
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        textAlign: 'center',
        height: '100%',
        width: '100%',
        flex: 1,
        position: 'relative',
      }}
    >
      {/* ── Top Zone: Album cover artwork, track title, and artist name ── */}
      <div className="player_zone_top">
        <button
          type="button"
          onClick={toggleAudio}
          disabled={!hasPreview}
          className="volume_btn"
          title={
            !hasPreview
              ? 'Preview unavailable for this track'
              : isAudioPlaying
                ? 'Выключить звук превью'
                : 'Слушать 30-сек превью трека'
          }
          aria-label={
            !hasPreview
              ? 'Preview unavailable for this track'
              : isAudioPlaying
                ? 'Выключить звук превью'
                : 'Слушать 30-сек превью трека'
          }
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            opacity: hasPreview ? (isAudioPlaying ? 1 : 0.75) : 0.35,
            cursor: hasPreview ? 'pointer' : 'not-allowed',
            transition: 'opacity 0.2s ease, transform 0.2s ease',
            background: 'none',
            border: 'none',
            padding: '0.2rem',
          }}
        >
          <img
            src={isAudioPlaying ? '/assets/svg/v_max.svg' : '/assets/svg/v_off.svg'}
            alt={isAudioPlaying ? 'Volume Active' : 'Volume Mute'}
            className="svg hero_volume-image"
            style={{ width: '1.35rem', height: '1.35rem' }}
          />
        </button>

        <a
          href={trackData.url || '#'}
          target={trackData.url ? '_blank' : undefined}
          rel={trackData.url ? 'noopener noreferrer' : undefined}
          className="player_cover_link"
          title={trackData.url ? `Открыть «${trackData.name}» в Spotify` : `${trackData.name} — ${trackData.artist}`}
          style={{
            cursor: trackData.url ? 'pointer' : 'default',
            display: 'block',
            margin: '0 auto 0.6rem',
            textDecoration: 'none',
          }}
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

        <div
          className="player_meta"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
            gap: '0.15rem',
          }}
        >
          <span
            className="player_title"
            title={trackData.name}
            style={{
              fontSize: '1.05rem',
              fontWeight: 600,
              color: '#ffffff',
              maxWidth: '240px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textShadow: '0 0 10px rgba(196, 140, 255, 0.4)',
            }}
          >
            {trackData.name}
          </span>
          <span
            className="player_artist"
            title={trackData.artist}
            style={{
              fontSize: '0.82rem',
              color: '#C48CFF',
              opacity: 0.85,
              maxWidth: '240px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {trackData.artist}
          </span>
        </div>
      </div>

      {/* ── Middle Zone: Audio visualizer / status indicator, progress bar with timestamps, and controls ── */}
      <div className="player_zone_middle">
        <div className="player_status_row" style={{ margin: '0.1rem 0' }}>
          {trackData.isPlaying || isAudioPlaying ? (
            <span
              className="player_status_badge player_status_live"
              style={{
                color: '#4ade80',
                background: 'rgba(34, 197, 94, 0.12)',
                border: '1px solid rgba(74, 222, 128, 0.35)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.68rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                padding: '0.2rem 0.65rem',
                borderRadius: '9999px',
                boxShadow: '0 0 10px rgba(74, 222, 128, 0.2)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'flex-end',
                  gap: '2px',
                  height: '10px',
                }}
                aria-hidden="true"
              >
                <span className="visualizer_bar bar_1" />
                <span className="visualizer_bar bar_2" />
                <span className="visualizer_bar bar_3" />
              </span>
              {isAudioPlaying && !trackData.isPlaying ? 'PREVIEW PLAYING' : trackData.badge}
            </span>
          ) : (
            <span
              className="player_status_badge"
              style={{
                color: '#a1a1aa',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '0.68rem',
                fontWeight: 500,
                letterSpacing: '0.05em',
                padding: '0.2rem 0.65rem',
                borderRadius: '9999px',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#71717a',
                }}
              />
              {trackData.badge}
            </span>
          )}
        </div>

        {/* Dynamic Progress Bar with elapsed / total duration */}
        {progressPercent != null ? (
          <div
            style={{
              width: '100%',
              maxWidth: '240px',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
              margin: '0.15rem 0',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '3px',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '9999px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #a855f7, #c084fc)',
                  borderRadius: '9999px',
                  transition: 'width 0.3s ease',
                  boxShadow: '0 0 8px rgba(168, 85, 247, 0.4)',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.7rem',
                color: '#a1a1aa',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span>{formatTime(trackData.progressMs)}</span>
              <span>{formatTime(trackData.durationMs)}</span>
            </div>
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: '240px', margin: '0.15rem 0' }}>
            <img
              src="/assets/svg/line+timestamp.svg"
              alt=""
              className="svg player_timeline"
              style={{ width: '100%', opacity: 0.5 }}
            />
          </div>
        )}

        {/* Playback Controls */}
        <div className="player_ui" style={{ marginTop: '0.2rem' }}>
          <div
            className="player_controls"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1.25rem',
            }}
          >
            <button
              type="button"
              className="player_control_btn"
              aria-label="Restart track"
              onClick={restartTrack}
              disabled={!hasPreview}
              title={hasPreview ? 'Перезапустить 30-сек превью' : 'Preview unavailable for this track'}
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(196, 140, 255, 0.2)',
                borderRadius: '8px',
                padding: '0.45rem',
                cursor: hasPreview ? 'pointer' : 'not-allowed',
                opacity: hasPreview ? 0.85 : 0.35,
                transition: 'opacity 0.2s ease, background 0.2s ease, transform 0.15s ease',
              }}
            >
              <img src="/assets/svg/s_back.svg" alt="back" className="svg" style={{ width: '14px', height: '14px' }} />
            </button>

            <button
              type="button"
              className="player_control_btn"
              onClick={toggleAudio}
              disabled={!hasPreview}
              aria-label={
                !hasPreview
                  ? 'Preview unavailable for this track'
                  : isAudioPlaying
                    ? 'Пауза'
                    : 'Воспроизведение 30-сек превью'
              }
              title={
                !hasPreview
                  ? 'Preview unavailable for this track'
                  : isAudioPlaying
                    ? 'Пауза'
                    : 'Слушать 30-сек превью'
              }
              style={{
                background: hasPreview
                  ? isAudioPlaying
                    ? 'rgba(168, 85, 247, 0.25)'
                    : 'rgba(168, 85, 247, 0.15)'
                  : 'rgba(255, 255, 255, 0.04)',
                border: hasPreview
                  ? isAudioPlaying
                    ? '1px solid rgba(196, 140, 255, 0.6)'
                    : '1px solid rgba(196, 140, 255, 0.4)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: hasPreview && isAudioPlaying
                  ? '0 0 16px rgba(168, 85, 247, 0.45)'
                  : hasPreview
                    ? '0 0 12px rgba(168, 85, 247, 0.25)'
                    : 'none',
                borderRadius: '50%',
                padding: '0.65rem',
                cursor: hasPreview ? 'pointer' : 'not-allowed',
                opacity: hasPreview ? 1 : 0.35,
                transition: 'transform 0.15s ease, background 0.2s ease, box-shadow 0.2s ease',
              }}
            >
              <img
                src={isAudioPlaying ? '/assets/svg/pause.svg' : '/assets/svg/play.svg'}
                alt={isAudioPlaying ? 'pause' : 'play'}
                className="svg"
                style={{ width: '16px', height: '16px' }}
              />
            </button>

            <button
              type="button"
              className="player_control_btn"
              aria-label="Next track"
              onClick={restartTrack}
              disabled={!hasPreview}
              title={hasPreview ? 'Перезапустить 30-сек превью' : 'Preview unavailable for this track'}
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(196, 140, 255, 0.2)',
                borderRadius: '8px',
                padding: '0.45rem',
                cursor: hasPreview ? 'pointer' : 'not-allowed',
                opacity: hasPreview ? 0.85 : 0.35,
                transition: 'opacity 0.2s ease, background 0.2s ease, transform 0.15s ease',
              }}
            >
              <img src="/assets/svg/s_forward.svg" alt="forward" className="svg" style={{ width: '14px', height: '14px' }} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Bottom Zone: Source prefix badge (● SPOTIFY) ── */}
      <div className="player_zone_bottom">
        <span
          className="player_source_badge"
          style={{
            background: 'rgba(18, 5, 24, 0.55)',
            border: '1px solid rgba(196, 140, 255, 0.25)',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
            color: '#e4e4e7',
            padding: '0.22rem 0.65rem',
            borderRadius: '9999px',
            fontSize: '0.68rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            textTransform: 'uppercase',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: '#1ed760',
              boxShadow: trackData.isPlaying ? '0 0 8px rgba(30, 215, 96, 0.8)' : 'none',
              animation: trackData.isPlaying ? 'pulse-dot 2s infinite' : 'none',
            }}
          />
          SPOTIFY
        </span>
      </div>
    </div>
  );
}
