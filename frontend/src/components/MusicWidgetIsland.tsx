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
const POLL_INTERVAL_MS = 6000;
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
  if (ms == null || Number.isNaN(ms) || ms < 0) return '--:--';
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
  const [coverFailed, setCoverFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    setCoverFailed(false);
  }, [trackData.cover]);

  useEffect(() => {
    const audio = new Audio();
    audio.loop = true;
    audio.preload = 'none';
    audioRef.current = audio;

    const handlePlay = () => setIsAudioPlaying(true);
    const handlePause = () => setIsAudioPlaying(false);
    const handleEnded = () => setIsAudioPlaying(false);
    const handleError = () => setIsAudioPlaying(false);

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
        const res = await fetch(endpoint, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        }).catch(() => null);

        let data: SpotifyResponse | null = null;
        if (res && res.ok) {
          data = (await res.json().catch(() => null)) as SpotifyResponse | null;
        }

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
              if (
                localData &&
                (localData.title || localData.isPlaying !== undefined) &&
                !localData.error
              ) {
                data = localData;
              }
            }
          } catch {
            // Local dev server unreachable
          }
        }

        if (!isMounted) return;

        if (data && data.title) {
          setTrackData({
            name: data.title,
            artist: data.artist || 'Unknown Artist',
            cover: data.albumArt || DEFAULT_COVER,
            badge: data.isPlaying ? 'NOW PLAYING' : 'RECENT',
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
              : IDLE_TRACK,
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

  useEffect(() => {
    if (!trackData.isPlaying || !trackData.durationMs) return;

    const interval = window.setInterval(() => {
      setTrackData((prev) => {
        if (!prev.isPlaying || !prev.durationMs || prev.progressMs == null) return prev;
        return {
          ...prev,
          progressMs: Math.min(prev.progressMs + 1000, prev.durationMs),
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
      : 0;

  const isLive = trackData.isPlaying || isAudioPlaying;
  const badgeText = isAudioPlaying && !trackData.isPlaying ? 'PREVIEW' : trackData.badge;

  const previewLabel = !hasPreview
    ? 'Preview unavailable for this track'
    : isAudioPlaying
      ? 'Pause 30s preview'
      : 'Play 30s preview';

  const volumeLabel = !hasPreview
    ? 'Preview unavailable for this track'
    : isAudioPlaying
      ? 'Mute preview'
      : 'Unmute preview';

  const restartLabel = hasPreview ? 'Restart 30s preview' : 'Preview unavailable for this track';
  const resolvedCover = coverFailed ? DEFAULT_COVER : trackData.cover;
  const progressStyle = { '--progress': `${progressPercent}%` } as React.CSSProperties;

  return (
    <article className="module module-player">
      <div className="player-widget">
        <header className="module-head">
          <span className="module-label">player.sh</span>
          <span className="player-status-badge" data-live={isLive ? 'true' : 'false'}>
            {isLive ? (
              <span className="player-eq" aria-hidden="true">
                <span className="player-eq-bar" />
                <span className="player-eq-bar" />
                <span className="player-eq-bar" />
              </span>
            ) : (
              <span className="player-status-dot" aria-hidden="true" />
            )}
            <span>{badgeText}</span>
          </span>
        </header>

        <div className="module-body">
          <div className="player-track">
            <a
              href={trackData.url || '#'}
              target={trackData.url ? '_blank' : undefined}
              rel={trackData.url ? 'noopener noreferrer' : undefined}
              className="player-cover-link"
              data-clickable={trackData.url ? 'true' : 'false'}
              title={
                trackData.url
                  ? `Open "${trackData.name}" on Spotify`
                  : `${trackData.name}, ${trackData.artist}`
              }
              onClick={(e) => {
                if (!trackData.url) e.preventDefault();
              }}
            >
              <img
                src={resolvedCover}
                alt={trackData.name}
                className="player-cover-img"
                onError={() => setCoverFailed(true)}
              />
            </a>

            <div className="player-meta">
              {trackData.url ? (
                <a
                  href={trackData.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="player-title-link"
                  title={trackData.name}
                >
                  {trackData.name}
                </a>
              ) : (
                <span className="player-title" title={trackData.name}>
                  {trackData.name}
                </span>
              )}
              <span className="player-artist" title={trackData.artist}>
                {trackData.artist}
              </span>
              <span className="player-hint">
                {hasPreview ? '30s preview available' : 'live metadata'}
              </span>
            </div>
          </div>

          <div className="player-progress">
            <div className="player-progress-track">
              <div className="player-progress-fill" style={progressStyle} />
            </div>
            <div className="player-progress-times">
              <span>{formatTime(trackData.progressMs)}</span>
              <span>{formatTime(trackData.durationMs)}</span>
            </div>
          </div>
        </div>

        <footer className="module-foot player-foot">
          <div className="player-controls">
            <button
              type="button"
              className="player-btn"
              aria-label={restartLabel}
              onClick={restartTrack}
              disabled={!hasPreview}
              title={restartLabel}
            >
              <svg className="player-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="19 20 9 12 19 4 19 20" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="5" y1="19" x2="5" y2="5" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className="player-btn player-btn-primary"
              data-playing={isAudioPlaying ? 'true' : 'false'}
              onClick={toggleAudio}
              disabled={!hasPreview}
              aria-label={previewLabel}
              title={previewLabel}
            >
              {isAudioPlaying ? (
                <svg className="player-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg className="player-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="6 4 20 12 6 20 6 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            <button
              type="button"
              className="player-btn"
              aria-label={restartLabel}
              onClick={restartTrack}
              disabled={!hasPreview}
              title={restartLabel}
            >
              <svg className="player-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 4 15 12 5 20 5 4" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="19" y1="5" x2="19" y2="19" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className="player-btn"
              onClick={toggleAudio}
              disabled={!hasPreview}
              data-active={isAudioPlaying ? 'true' : 'false'}
              title={volumeLabel}
              aria-label={volumeLabel}
            >
              {isAudioPlaying ? (
                <svg className="player-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" strokeLinecap="round" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="player-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="23" y1="9" x2="17" y2="15" strokeLinecap="round" />
                  <line x1="17" y1="9" x2="23" y2="15" strokeLinecap="round" />
                </svg>
              )}
            </button>
          </div>

          <span className="player-source">
            <span
              className="player-source-dot"
              data-live={trackData.isPlaying ? 'true' : 'false'}
              aria-hidden="true"
            />
            <span>SPOTIFY</span>
          </span>
        </footer>
      </div>
    </article>
  );
}
