import React, { useEffect, useRef, useState } from 'react';

interface MusicWidgetIslandProps {
  username?: string;
  apiKey?: string;
  ytmusicUrl?: string | null;
  preferredProvider?: 'ytmusic' | 'lastfm';
  backendUrl?: string;
}

interface TrackInfo {
  name: string;
  artist: string;
  albumArt?: string;
  url?: string;
  isNowPlaying: boolean;
  provider: 'ytmusic' | 'lastfm';
}

const DEFAULT_TRACK: TrackInfo = {
  name: 'Night walking',
  artist: 'Deniz Başat',
  albumArt: 'https://i.ytimg.com/vi/9jzn-Qbzp1E/maxresdefault.jpg',
  url: 'https://music.youtube.com/playlist?list=PLNO1aFmqup12F_YoKruso0_8kbWsH9Uze',
  isNowPlaying: false,
  provider: 'ytmusic',
};

const AUDIO_SRC = '/assets/audio/ambient.mp3';

export default function MusicWidgetIsland({
  username,
  apiKey,
  ytmusicUrl,
  preferredProvider = 'ytmusic',
  backendUrl = 'http://localhost:3000',
}: MusicWidgetIslandProps) {
  const [track, setTrack] = useState<TrackInfo>(DEFAULT_TRACK);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize HTML5 Audio element
  useEffect(() => {
    const audio = new Audio(AUDIO_SRC);
    audio.loop = true;
    audioRef.current = audio;

    const handleEnded = () => setIsPlaying(false);
    const handlePause = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);

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

  // Fetch track metadata and album art
  useEffect(() => {
    let isSubscribed = true;

    const fetchMetadata = async () => {
      // 1. Try backend /api/ytmusic
      try {
        const effectiveBackend =
          typeof window !== 'undefined' &&
          window.location.hostname !== 'localhost' &&
          backendUrl.includes('localhost')
            ? window.location.origin
            : backendUrl;

        const endpoints = [`${effectiveBackend}/api/ytmusic`, '/api/ytmusic'];
        for (const ep of endpoints) {
          try {
            const res = await fetch(ep);
            if (res.ok) {
              const data = await res.json();
              if (data.success && data.track && data.track.name) {
                if (isSubscribed) {
                  setTrack({
                    name: data.track.name,
                    artist: data.track.artist || 'YouTube Music',
                    albumArt: data.track.albumArt || DEFAULT_TRACK.albumArt,
                    url: data.track.url || ytmusicUrl || DEFAULT_TRACK.url,
                    isNowPlaying: data.track.isNowPlaying ?? false,
                    provider: 'ytmusic',
                  });
                }
                return;
              }
            }
          } catch {
            // continue
          }
        }
      } catch {
        // ignore
      }

      // 2. Direct oEmbed if ytmusicUrl provided
      if (ytmusicUrl && ytmusicUrl.trim().length > 0) {
        try {
          const res = await fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(ytmusicUrl.trim())}&format=json`
          );
          if (res.ok) {
            const data = await res.json();
            let title = data.title || DEFAULT_TRACK.name;
            let artist = data.author_name || DEFAULT_TRACK.artist;
            if (title.includes(' - ')) {
              const parts = title.split(' - ');
              artist = parts[0].trim();
              title = parts.slice(1).join(' - ').replace(/\s*\(Official.*?\)/gi, '').trim();
            }

            let albumArt = data.thumbnail_url;
            if (albumArt && albumArt.includes('hqdefault.jpg')) {
              albumArt = albumArt.replace('hqdefault.jpg', 'maxresdefault.jpg');
            }

            if (isSubscribed) {
              setTrack({
                name: title,
                artist,
                albumArt: albumArt || DEFAULT_TRACK.albumArt,
                url: ytmusicUrl.trim(),
                isNowPlaying: false,
                provider: 'ytmusic',
              });
            }
          }
        } catch {
          // ignore
        }
      }
    };

    fetchMetadata();
    const interval = setInterval(fetchMetadata, 30_000);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [ytmusicUrl, backendUrl]);

  // Controls
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch((err) => {
        console.warn('Audio playback error:', err);
      });
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
    if (!isPlaying) {
      audioRef.current.play().catch(console.warn);
    }
  };

  return (
    <div className="player_card_inner">
      <div className="player_top_actions">
        <div className="player_provider_tag">
          <span className="player_badge_yt">
            <svg className="badge_icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
              <circle cx="12" cy="12" r="10" fill="#FF0000" />
              <polygon points="10,8 16,12 10,16" fill="#FFFFFF" />
            </svg>
            YT Music
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
        href={track.url || 'https://music.youtube.com'}
        target="_blank"
        rel="noreferrer"
        className="player_cover_link"
        title={`Open in YouTube Music: ${track.name} — ${track.artist}`}
      >
        <img
          src={track.albumArt || DEFAULT_TRACK.albumArt}
          alt={track.name}
          className="hero_player-image"
          onError={(e) => {
            const currentSrc = e.currentTarget.src;
            if (currentSrc.includes('maxresdefault.jpg')) {
              e.currentTarget.src = currentSrc.replace('maxresdefault.jpg', 'hqdefault.jpg');
            } else {
              e.currentTarget.src = '/assets/bg/music_thumbnail.svg';
            }
          }}
        />
      </a>

      <div className="player_view">
        <div className="player_meta">
          <span className="player_title" title={track.name}>
            {track.name}
          </span>
          <span className="player_artist" title={track.artist}>
            {track.artist}
          </span>
        </div>

        <div className="player_status_row">
          {isPlaying ? (
            <span className="player_status_badge player_status_live">
              ● Playing
            </span>
          ) : (
            <span className="player_status_badge player_status_recent">
              Featured Track
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
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              <img
                src={isPlaying ? '/assets/svg/pause.svg' : '/assets/svg/play.svg'}
                alt={isPlaying ? 'pause' : 'play'}
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
