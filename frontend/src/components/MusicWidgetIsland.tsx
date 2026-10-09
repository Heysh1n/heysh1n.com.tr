import React, { useEffect, useRef, useState } from 'react';

interface MusicWidgetIslandProps {
  discordId?: string;
  username?: string;
  apiKey?: string;
  ytmusicUrl?: string | null;
  preferredProvider?: 'ytmusic' | 'lastfm';
  backendUrl?: string;
}

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

export default function MusicWidgetIsland({
  discordId,
  username,
  apiKey,
  ytmusicUrl,
  backendUrl,
}: MusicWidgetIslandProps) {
  const [trackData, setTrackData] = useState<TrackData>({
    name: 'Loading...',
    artist: 'Connecting to cascade...',
    cover: DEFAULT_COVER,
    badge: 'SEARCHING',
    isPlaying: false,
  });

  const lanyardTrackRef = useRef<TrackData | null>(null);
  const lastFmTrackRef = useRef<TrackData | null>(null);
  const apiTrackRef = useRef<TrackData | null>(null);
  const staticTrackRef = useRef<TrackData | null>(null);

  const resolveCascade = () => {
    if (lanyardTrackRef.current?.isPlaying) {
      setTrackData(lanyardTrackRef.current);
      return;
    }
    if (lastFmTrackRef.current?.isPlaying) {
      setTrackData(lastFmTrackRef.current);
      return;
    }
    if (apiTrackRef.current?.isPlaying) {
      setTrackData(apiTrackRef.current);
      return;
    }
    if (staticTrackRef.current) {
      setTrackData(staticTrackRef.current);
      return;
    }
    setTrackData({
      name: 'No active tracking',
      artist: 'Waiting for activity...',
      cover: DEFAULT_COVER,
      badge: 'IDLE',
      isPlaying: false,
    });
  };

  // Ambient Audio
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

  // 1. Lanyard WebSocket (Core)
  useEffect(() => {
    if (!discordId) return;
    let ws: WebSocket;
    let heartbeatInterval: number;
    let reconnectTimeout: number;
    let isSubscribed = true;

    const connect = () => {
      ws = new WebSocket('wss://api.lanyard.rest/socket');

      ws.onmessage = (event) => {
        if (!isSubscribed) return;
        const msg = JSON.parse(event.data);
        const { op, d, t } = msg;

        if (op === 1) {
          heartbeatInterval = window.setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 3 }));
            }
          }, d.heartbeat_interval);

          ws.send(JSON.stringify({
            op: 2,
            d: { subscribe_to_id: discordId }
          }));
        }

        if (t === 'INIT_STATE' || t === 'PRESENCE_UPDATE') {
          const activities = t === 'INIT_STATE' ? d[discordId]?.activities : d.activities;
          if (!activities) return;

          const musicActivity = activities.find((a: any) => 
            ['YouTube Music', 'Spotify', 'PreMiD'].includes(a.name)
          );

          if (musicActivity) {
            let cover = DEFAULT_COVER;
            const imageId = musicActivity.assets?.large_image;
            if (imageId) {
                if (imageId.startsWith('spotify:')) {
                    cover = `https://i.scdn.co/image/${imageId.replace('spotify:', '')}`;
                } else if (imageId.startsWith('mp:external/')) {
                    cover = `https://media.discordapp.net/external/${imageId.replace('mp:external/', '')}`;
                } else if (musicActivity.application_id) {
                    cover = `https://cdn.discordapp.com/app-assets/${musicActivity.application_id}/${imageId}.png`;
                }
            }

            lanyardTrackRef.current = {
              name: musicActivity.details || musicActivity.name || 'Unknown',
              artist: musicActivity.state || 'Unknown Artist',
              cover,
              badge: 'LIVE (RPC)',
              isPlaying: true,
            };
          } else {
            lanyardTrackRef.current = null;
          }
          resolveCascade();
        }
      };

      ws.onclose = () => {
        clearInterval(heartbeatInterval);
        if (isSubscribed) {
          reconnectTimeout = window.setTimeout(connect, 5000);
        }
      };
    };

    connect();

    return () => {
      isSubscribed = false;
      clearInterval(heartbeatInterval);
      clearTimeout(reconnectTimeout);
      if (ws) ws.close();
      lanyardTrackRef.current = null;
      resolveCascade();
    };
  }, [discordId]);

  // 2, 3, 4. Fallback Polling (Last.fm -> Backend API -> Static oEmbed)
  useEffect(() => {
    let isSubscribed = true;

    const fetchFallbacks = async () => {
      if (lanyardTrackRef.current?.isPlaying) {
        if (isSubscribed) resolveCascade();
        return;
      }

      // 2. Last.fm
      let lfmPlaying = false;
      if (username && apiKey) {
        try {
          const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${username}&api_key=${apiKey}&format=json&limit=1`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            const track = data?.recenttracks?.track?.[0];
            if (track) {
              const isPlaying = track['@attr']?.nowplaying === 'true';
              if (isPlaying) {
                lfmPlaying = true;
                lastFmTrackRef.current = {
                  name: track.name,
                  artist: track.artist?.['#text'] || 'Unknown',
                  cover: track.image?.[3]?.['#text'] || DEFAULT_COVER,
                  badge: 'LIVE (LFM)',
                  isPlaying: true,
                };
              } else {
                lastFmTrackRef.current = null;
              }
            }
          }
        } catch (e) {
          console.error('Last.fm fetch error', e);
        }
      }

      if (lfmPlaying && isSubscribed) {
        resolveCascade();
        return;
      }

      // 3. Backend YT-Music API
      let apiPlaying = false;
      const baseBackend = backendUrl ? backendUrl.replace(/\/+$/, '') : 'http://localhost:3000';
      try {
        const res = await fetch(`${baseBackend}/api/ytmusic`);
        if (res.ok) {
          const data = await res.json();
          if (data?.success && data?.track?.isNowPlaying) {
             apiPlaying = true;
             apiTrackRef.current = {
               name: data.track.name,
               artist: data.track.artist || 'Unknown',
               cover: data.track.albumArt || DEFAULT_COVER,
               badge: 'LIVE (API)',
               isPlaying: true,
             };
          } else {
             apiTrackRef.current = null;
          }
        }
      } catch (e) {
        console.error('API fetch error', e);
      }

      if (apiPlaying && isSubscribed) {
        resolveCascade();
        return;
      }

      // 4. Static Oembed
      if (ytmusicUrl && !staticTrackRef.current) {
        try {
          const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(ytmusicUrl)}&format=json`);
          if (res.ok) {
            const data = await res.json();
            
            let title = data.title || 'Unknown';
            let artist = data.author_name || 'Unknown Artist';
            if (title.includes(' - ')) {
              const parts = title.split(' - ');
              artist = parts[0].trim();
              title = parts.slice(1).join(' - ').replace(/\s*\(Official.*?\)/gi, '').trim();
            }

            let albumArt = data.thumbnail_url;
            if (albumArt && albumArt.includes('hqdefault.jpg')) {
              albumArt = albumArt.replace('hqdefault.jpg', 'maxresdefault.jpg');
            }

            staticTrackRef.current = {
               name: title,
               artist,
               cover: albumArt || DEFAULT_COVER,
               badge: 'STATIC',
               isPlaying: false,
               url: ytmusicUrl
            };
          }
        } catch (e) {
          console.error('oEmbed fetch error', e);
        }
      }

      if (isSubscribed) {
        resolveCascade();
      }
    };

    fetchFallbacks();
    const interval = setInterval(fetchFallbacks, 10000);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
      lastFmTrackRef.current = null;
      apiTrackRef.current = null;
    };
  }, [username, apiKey, backendUrl, ytmusicUrl]);

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
          <span className="player_badge_yt" style={{ background: 'rgba(196, 140, 255, 0.12)', borderColor: 'rgba(196, 140, 255, 0.35)', color: '#c48cff', boxShadow: '0 0 10px rgba(196, 140, 255, 0.15)' }}>
            <svg className="badge_icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
               <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
            Tracker
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
        target="_blank"
        rel="noreferrer"
        className="player_cover_link"
        title={`${trackData.name} — ${trackData.artist}`}
        style={{ cursor: trackData.url ? 'pointer' : 'default' }}
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
            <span className="player_status_badge player_status_live">
              ● {trackData.badge}
            </span>
          ) : (
            <span className="player_status_badge" style={{ color: '#a1a1aa', background: 'rgba(161, 161, 170, 0.12)', border: '1px solid rgba(161, 161, 170, 0.3)' }}>
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
