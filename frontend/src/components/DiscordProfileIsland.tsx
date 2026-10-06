import React, { useEffect, useRef, useState } from 'react';
import type { Activity, DiscordStatus, DiscordUser, LanyardData, LanyardResponse } from '../types/lanyard';

interface DiscordProfileIslandProps {
  discordId?: string;
  username?: string;
  displayName?: string;
  fallbackTag?: string;
  fallbackAvatar?: string;
  fallbackStatus?: DiscordStatus;
}

const DEFAULT_DISCORD_ID = '995737379417640961';
const LANYARD_WS_URL = 'wss://api.lanyard.rest/socket';
const LANYARD_REST_URL = 'https://api.lanyard.rest/v1/users/';

function parseDiscordAssetUrl(raw?: string | null, applicationId?: string | null): string | null {
  if (!raw) return null;

  // Discord Media Proxy for external rich presence assets (JetBrains, VS Code, etc.)
  if (raw.startsWith('mp:external/')) {
    return `https://media.discordapp.net/external/${raw.replace(/^mp:external\//, '')}`;
  }
  if (raw.startsWith('external/')) {
    return `https://media.discordapp.net/external/${raw.replace(/^external\//, '')}`;
  }
  if (raw.startsWith('mp:')) {
    return `https://media.discordapp.net/${raw.replace(/^mp:\/?/, '')}`;
  }

  // Spotify album art
  if (raw.startsWith('spotify:')) {
    return `https://i.scdn.co/image/${raw.replace('spotify:', '')}`;
  }

  // Direct HTTP / HTTPS URLs
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }

  // Discord Application Asset ID uploaded to Discord Developer Portal
  if (applicationId) {
    return `https://cdn.discordapp.com/app-assets/${applicationId}/${raw}.png`;
  }

  return null;
}

/**
 * Fallback URL extractor in case Discord media proxy is unreachable or blocked.
 * Restores protocol and replaces %40 with @ for CDN endpoints (e.g. jsdelivr).
 */
function getDirectExternalFallbackUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/\/https?\/(.+)$/);
  if (match) {
    const isHttps = raw.includes('/https/');
    const protocol = isHttps ? 'https' : 'http';
    const path = match[1].replace(/%40/g, '@');
    return `${protocol}://${path}`;
  }
  return null;
}

const STATUS_TEXT: Record<DiscordStatus, string> = {
  online: 'ONLINE',
  idle: 'IDLE',
  dnd: 'DND',
  offline: 'OFFLINE',
};

export default function DiscordProfileIsland({
  discordId = DEFAULT_DISCORD_ID,
  username = 'heysh1n',
  displayName = 'Heysh1n',
  fallbackTag = 'HEYSH1N',
  fallbackAvatar = '/assets/bg/image.png',
  fallbackStatus = 'online',
}: DiscordProfileIslandProps) {
  const [data, setData] = useState<LanyardData | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initial REST fetch
  useEffect(() => {
    let active = true;

    const fetchRest = async () => {
      try {
        const res = await fetch(`${LANYARD_REST_URL}${discordId}`);
        const json: LanyardResponse = await res.json();
        if (!active) return;
        if (json.success && json.data) {
          setData(json.data);
        }
      } catch (err) {
        // silent fallback
      }
    };

    fetchRest();

    return () => {
      active = false;
    };
  }, [discordId]);

  // Real-time WebSocket Gateway
  useEffect(() => {
    let unmounted = false;

    const connectWs = () => {
      if (unmounted) return;

      try {
        const ws = new WebSocket(LANYARD_WS_URL);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            const { op, d, t } = payload;

            if (op === 1) {
              const interval = d.heartbeat_interval || 30000;
              if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
              heartbeatTimerRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ op: 3 }));
                }
              }, interval);

              ws.send(
                JSON.stringify({
                  op: 2,
                  d: { subscribe_to_id: discordId },
                }),
              );
            }

            if (op === 0) {
              if (t === 'INIT_STATE' || t === 'PRESENCE_UPDATE') {
                if (d && d.discord_user) {
                  setData(d);
                }
              }
            }
          } catch (e) {
            // ignore
          }
        };

        ws.onclose = () => {
          if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
          if (!unmounted) {
            reconnectTimerRef.current = setTimeout(connectWs, 5000);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (e) {
        if (!unmounted) {
          reconnectTimerRef.current = setTimeout(connectWs, 5000);
        }
      }
    };

    connectWs();

    return () => {
      unmounted = true;
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [discordId]);

  const discordUser = data?.discord_user;
  const status: DiscordStatus = data?.discord_status || fallbackStatus;
  const activities = data?.activities || [];

  const customStatus = activities.find((a) => a.type === 4);
  const gameActivity = activities.find(
    (a) => a.type === 0 || a.type === 1 || a.type === 3 || a.type === 5,
  );
  const spotify = data?.listening_to_spotify && data?.spotify ? data.spotify : null;

  // Real-time elapsed timer
  useEffect(() => {
    const startTime = gameActivity?.timestamps?.start;
    if (!startTime) {
      setElapsedTime('');
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const diffSec = Math.max(0, Math.floor((now - startTime) / 1000));
      const hours = Math.floor(diffSec / 3600);
      const minutes = Math.floor((diffSec % 3600) / 60);
      const seconds = diffSec % 60;

      if (hours > 0) {
        setElapsedTime(`${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
      } else {
        setElapsedTime(`${minutes}:${String(seconds).padStart(2, '0')}`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [gameActivity?.timestamps?.start]);

  const avatarUrl = discordUser?.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${
        discordUser.avatar.startsWith('a_') ? 'gif' : 'png'
      }?size=160`
    : fallbackAvatar;

  // Discord Guild / Clan support (primary_guild or clan)
  const clan = discordUser?.primary_guild || discordUser?.clan;
  const clanTag = clan?.identity_enabled !== false && clan?.tag ? clan.tag : fallbackTag;
  const clanBadge =
    clan?.identity_enabled !== false && clan?.badge && clan?.identity_guild_id
      ? `https://cdn.discordapp.com/clan-badges/${clan.identity_guild_id}/${clan.badge}.png?size=32`
      : null;

  // Activity images resolution (supports external proxies, CDNs, app assets)
  const rawLarge = gameActivity?.assets?.large_image;
  const rawSmall = gameActivity?.assets?.small_image;

  const largeImgUrl = parseDiscordAssetUrl(rawLarge, gameActivity?.application_id);
  const smallImgUrl = parseDiscordAssetUrl(rawSmall, gameActivity?.application_id);

  // If large image is absent but small is present, promote small to main image
  const mainImgUrl = largeImgUrl || smallImgUrl;
  const mainRawAsset = largeImgUrl ? rawLarge : rawSmall;
  const mainAlt =
    (largeImgUrl ? gameActivity?.assets?.large_text : gameActivity?.assets?.small_text) ||
    gameActivity?.name ||
    'Activity';

  const secondaryImgUrl = largeImgUrl ? smallImgUrl : null;
  const secondaryRawAsset = largeImgUrl ? rawSmall : null;
  const secondaryTitle = gameActivity?.assets?.small_text || '';

  const handleImageError = (
    e: React.SyntheticEvent<HTMLImageElement>,
    rawAsset?: string | null,
  ) => {
    const img = e.currentTarget;
    const fallback = getDirectExternalFallbackUrl(rawAsset);
    if (fallback && img.src !== fallback) {
      img.src = fallback;
      return;
    }
    img.style.display = 'none';
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const textToCopy = discordUser?.username || username;
    navigator.clipboard?.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusLabel = STATUS_TEXT[status];

  return (
    <div className="discord_widget">
      {/* Profile Header */}
      <div className="discord_profile_header">
        <div className="discord_avatar_wrapper">
          <img
            src={avatarUrl}
            alt={discordUser?.global_name || displayName}
            className="discord_avatar_img"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = fallbackAvatar;
            }}
          />
          <span className={`discord_status_badge status_${status}`} title={statusLabel} />
        </div>

        <div className="discord_user_meta">
          <div className="discord_name_row">
            <span className="discord_display_name">
              {discordUser?.global_name || displayName}
            </span>
            {clanTag && (
              <span className="discord_guild_tag" title={`Guild: ${clanTag}`}>
                {clanBadge && (
                  <img
                    src={clanBadge}
                    alt=""
                    className="discord_guild_icon"
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <span className="discord_guild_text">
                  {clanBadge ? clanTag : (clanTag.startsWith('[') ? clanTag : `[${clanTag}]`)}
                </span>
              </span>
            )}

            {/* Active devices badges right next to the name */}
            <div className="discord_devices">
              {data?.active_on_discord_desktop && (
                <span className="discord_device_badge" title="Desktop">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </span>
              )}
              {data?.active_on_discord_mobile && (
                <span className="discord_device_badge" title="Mobile">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                    <line x1="12" y1="18" x2="12.01" y2="18" />
                  </svg>
                </span>
              )}
              {data?.active_on_discord_web && (
                <span className="discord_device_badge" title="Web">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </span>
              )}
            </div>
          </div>

          <div className="discord_handle_row">
            <span className="discord_handle">@{discordUser?.username || username}</span>
            <button
              type="button"
              className="discord_copy_btn"
              onClick={handleCopy}
              title="Copy username"
            >
              {copied ? '✓ Copied' : 'copy'}
            </button>
          </div>

          {customStatus && (
            <div className="discord_custom_status">
              {customStatus.emoji && (
                <span className="discord_custom_status_emoji">
                  {customStatus.emoji.id ? (
                    <img
                      src={`https://cdn.discordapp.com/emojis/${customStatus.emoji.id}.${
                        customStatus.emoji.animated ? 'gif' : 'png'
                      }?size=24`}
                      alt={customStatus.emoji.name}
                      className="discord_emoji_img"
                    />
                  ) : (
                    customStatus.emoji.name
                  )}
                </span>
              )}
              {customStatus.state && (
                <span className="discord_custom_status_text">{customStatus.state}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Activity Section (Game / Spotify / Status) */}
      <div className="discord_activity_box">
        {gameActivity ? (
          <div className="discord_game_activity">
            <div className="discord_activity_label">
              <span className="discord_activity_pulse" />
              <span>
                {gameActivity.type === 1
                  ? 'Streaming'
                  : gameActivity.type === 3
                    ? 'Watching'
                    : gameActivity.type === 5
                      ? 'Competing'
                      : 'Playing'}
              </span>
            </div>
            <div className="discord_activity_content">
              {mainImgUrl && (
                <div className="discord_game_image_wrapper">
                  <img
                    src={mainImgUrl}
                    alt={mainAlt}
                    title={mainAlt}
                    className="discord_game_large_img"
                    loading="lazy"
                    onError={(e) => handleImageError(e, mainRawAsset)}
                  />
                  {secondaryImgUrl && (
                    <img
                      src={secondaryImgUrl}
                      alt={secondaryTitle}
                      title={secondaryTitle}
                      className="discord_game_small_img"
                      loading="lazy"
                      onError={(e) => handleImageError(e, secondaryRawAsset)}
                    />
                  )}
                </div>
              )}
              <div className="discord_game_info">
                <span className="discord_game_name">{gameActivity.name}</span>
                {gameActivity.details && (
                  <span className="discord_game_details">{gameActivity.details}</span>
                )}
                {gameActivity.state && (
                  <span className="discord_game_state">{gameActivity.state}</span>
                )}
                {elapsedTime && <span className="discord_game_timer">{elapsedTime}</span>}
              </div>
            </div>
          </div>
        ) : spotify ? (
          <div className="discord_spotify_activity">
            <div className="discord_activity_label discord_label_spotify">
              <span className="discord_spotify_dot" />
              <span>Spotify</span>
            </div>
            <div className="discord_activity_content">
              <img
                src={spotify.album_art_url}
                alt={spotify.album}
                className="discord_spotify_art"
              />
              <div className="discord_spotify_info">
                <span className="discord_spotify_song">{spotify.song}</span>
                <span className="discord_spotify_artist">by {spotify.artist}</span>
                <span className="discord_spotify_album">{spotify.album}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="discord_idle_activity">
            <div className={`status_beacon_wrap beacon_${status}`}>
              <span className="status_beacon_ring" />
              <span className="status_beacon_dot" />
            </div>
            <span className={`discord_status_text text_${status}`}>{statusLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}
