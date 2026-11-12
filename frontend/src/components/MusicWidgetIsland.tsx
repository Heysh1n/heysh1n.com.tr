import React, { useEffect, useRef, useState } from 'react';

interface MusicWidgetIslandProps {
  discordId?: string;
  username?: string;
  apiKey?: string;
  ytmusicUrl?: string | null;
  preferredProvider?: 'ytmusic' | 'lastfm';
  backendUrl?: string;
}

type SpotifyResponse = {
  isPlaying?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  albumArt?: string | null;
  trackUrl?: string | null;
};

type TrackData = {
  name: string;
  artist: string;
  cover: string;
  badge: string;
  isPlaying: boolean;
  url?: string;
};

const AUDIO_SRC = '/assets/audio/ambient.mp3';
const DEFAULT_COVER = '/assets/bg/music_thumbnail.svg';
const POLL_INTERVAL_MS = 15000;
const FETCH_TIMEOUT_MS = 8000;

const IDLE_TRACK: TrackData = {
  name: 'Not Playing',
  artist: 'Spotify — Offline',
  cover: DEFAULT_COVER,
  badge: 'OFFLINE',
  isPlaying: false,
};

export default function MusicWidgetIsland({ backendUrl }: MusicWidgetIslandProps) {
  const [trackData, setTrackData] = useState<TrackData>({
    name: 'Connecting...',
    artist: 'Spotify Web API',
    cover: DEFAULT_COVER,
    badge: 'SYNCING',
    isPlaying: false,
  });

  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(AUDIO_SRC);
    audio.loop = true;
    audioRef.current = audio;

    const handleEnded = () => setIsAudioPlaying(false);
    const handlePause = () => setIsAudioPlaying(false);
    const handlePlay = () => setIsAudioPlaying(true);

    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlay);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlay);
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const rawBase =
      backendUrl ||
      import.meta.env.PUBLIC_BACKEND_URL ||
      (import.meta.env.PROD ? 'https://api.heysh1n.com.tr' : 'http://localhost:3000');
    const endpoint = `${rawBase.replace(/\/+$/, '')}/api/spotify/now-playing`;

    const fetchSpotifyNowPlaying = async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const res = await fetch(endpoint, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });

        if (!res.ok) {
          if (isMounted) setTrackData(IDLE_TRACK);
          return;
        }

        const data: SpotifyResponse = await res.json();
        if (!isMounted) return;

        if (data.title) {
          setTrackData({
            name: data.title,
            artist: data.artist || 'Unknown Artist',
            cover: data.albumArt || DEFAULT_COVER,
            badge: data.isPlaying ? 'NOW PLAYING' : 'RECENTLY PLAYED',
            isPlaying: Boolean(data.isPlaying),
            url: data.trackUrl || undefined,
          });
        } else {
          setTrackData(IDLE_TRACK);
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

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isAudioPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(console.warn);
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    const nextMuted = !audioRef.current.muted;
    audioRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const restartTrack = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    if (!isAudioPlaying) {
      audioRef.current.play().catch(console.warn);
    }
  };

  return (
    <div className="player_card_inner">
      <div className="player_top_actions">
        <div className="player_provider_tag">
          <span
            className="player_badge_yt"
            style={{
              background: 'rgba(29, 185, 84, 0.14)',
              borderColor: 'rgba(29, 185, 84, 0.4)',
              color: '#1ed760',
              boxShadow: '0 0 10px rgba(29, 185, 84, 0.18)',
            }}
          >
            <svg className="badge_icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
            Spotify
          </span>
        </div>

        <button
          type="button"
          onClick={toggleMute}
          className="volume_btn"
          title={isMuted ? 'Unmute' : 'Mute'}
          aria-label="Volume toggle"
        >
          <img
            src={isMuted ? '/assets/svg/v_off.svg' : '/assets/svg/v_max.svg'}
            alt={isMuted ? 'Volume Mute' : 'Volume Max'}
            className="svg hero_volume-image"
          />
        </button>
      </div>

      <a
        href={trackData.url || '#'}
        target={trackData.url ? '_blank' : undefined}
        rel={trackData.url ? 'noopener noreferrer' : undefined}
        className="player_cover_link"
        title={`${trackData.name} — ${trackData.artist}`}
        style={{ cursor: trackData.url ? 'pointer' : 'default' }}
        onClick={(e) => {
          if (!trackData.url) e.preventDefault();
        }}
      >
        <img
          src={trackData.cover}
          alt={trackData.name}
          className="hero_player-image"
          onError={(e) => {
            e.currentTarget.src = DEFAULT_COVER;
          }}
        />
      </a>

      <div className="player_view">
        <div className="player_meta">
          <span className="player_title" title={trackData.name}>
            {trackData.name}
          </span>
          <span className="player_artist" title={trackData.artist}>
            {trackData.artist}
          </span>
        </div>

        <div className="player_status_row">
          {trackData.isPlaying ? (
            <span
              className="player_status_badge player_status_live"
              style={{
                color: '#1ed760',
                background: 'rgba(29, 185, 84, 0.14)',
                border: '1px solid rgba(29, 185, 84, 0.4)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: '#1ed760',
                  boxShadow: '0 0 8px #1ed760',
                  animation: 'pulse 1.5s infinite',
                }}
              />
              {trackData.badge}
            </span>
          ) : (
            <span
              className="player_status_badge"
              style={{
                color: '#a1a1aa',
                background: 'rgba(161, 161, 170, 0.12)',
                border: '1px solid rgba(161, 161, 170, 0.3)',
              }}
            >
              {trackData.badge}
            </span>
          )}
        </div>

        <div className="player_ui">
          <img
            src="/assets/svg/line+timestamp.svg"
            alt=""
            className="svg player_timeline"
          />

          <div className="player_controls">
            <button
              type="button"
              className="player_control_btn"
              aria-label="Previous track"
              onClick={restartTrack}
              title="Restart"
            >
              <img src="/assets/svg/s_back.svg" alt="back" className="svg" />
            </button>

            <button
              type="button"
              className="player_control_btn"
              onClick={togglePlay}
              aria-label={isAudioPlaying ? 'Pause' : 'Play'}
              title={isAudioPlaying ? 'Pause' : 'Play'}
            >
              <img
                src={isAudioPlaying ? '/assets/svg/pause.svg' : '/assets/svg/play.svg'}
                alt={isAudioPlaying ? 'pause' : 'play'}
                className="svg"
              />
            </button>

            <button
              type="button"
              className="player_control_btn"
              aria-label="Next track"
              onClick={restartTrack}
              title="Next track"
            >
              <img src="/assets/svg/s_forward.svg" alt="forward" className="svg" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
