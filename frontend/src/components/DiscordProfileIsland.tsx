import React, { useEffect, useRef, useState } from 'react';
import type { Activity, DiscordStatus, LanyardData, LanyardResponse } from '../types/lanyard';

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
const DCDN_PROFILE_URL = 'https://dcdn.dstn.to/profile/';

function parseDiscordAssetUrl(raw?: string | null, applicationId?: string | null): string | null {
  if (!raw) return null;

  if (raw.startsWith('mp:external/')) {
    return `https://media.discordapp.net/external/${raw.replace(/^mp:external\//, '')}`;
  }
  if (raw.startsWith('external/')) {
    return `https://media.discordapp.net/external/${raw.replace(/^external\//, '')}`;
  }
  if (raw.startsWith('mp:')) {
    return `https://media.discordapp.net/${raw.replace(/^mp:\/?/, '')}`;
  }
  if (raw.startsWith('spotify:')) {
    return `https://i.scdn.co/image/${raw.replace('spotify:', '')}`;
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  if (applicationId) {
    return `https://cdn.discordapp.com/app-assets/${applicationId}/${raw}.png`;
  }

  return null;
}

function getDirectExternalFallbackUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/\/https?\/(.+)$/);
  if (match) {
    const protocol = raw.includes('/https/') ? 'https' : 'http';
    const assetPath = match[1].replace(/%40/g, '@');
    return `${protocol}://${assetPath}`;
  }
  return null;
}

function normalizeHexColor(value?: string | number | null): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 0xffffff) {
    return `#${Math.floor(value).toString(16).padStart(6, '0')}`;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

const STATUS_TEXT: Record<DiscordStatus, string> = {
  online: 'ONLINE',
  idle: 'IDLE',
  dnd: 'DND',
  offline: 'OFFLINE',
};

const ACTIVITY_VERB: Record<number, string> = {
  0: 'Playing',
  1: 'Streaming',
  3: 'Watching',
  5: 'Competing',
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
  const [profileMeta, setProfileMeta] = useState<{
    banner?: string | null;
    accent_color?: number | null;
    banner_color?: string | null;
    theme_colors?: number[] | null;
  } | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const [bannerHidden, setBannerHidden] = useState(false);
  const [avatarFallback, setAvatarFallback] = useState(false);
  const [clanBadgeHidden, setClanBadgeHidden] = useState(false);
  const [mainAssetOverride, setMainAssetOverride] = useState<string | null | undefined>(undefined);
  const [secondaryAssetOverride, setSecondaryAssetOverride] = useState<string | null | undefined>(
    undefined,
  );

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      } catch {
        // silent fallback
      }
    };

    const fetchProfileBanner = async () => {
      try {
        const res = await fetch(`${DCDN_PROFILE_URL}${discordId}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        const userObj = json?.user || json?.user_profile;
        if (userObj) {
          setProfileMeta({
            banner: userObj.banner ?? json?.user_profile?.banner ?? null,
            accent_color: userObj.accent_color ?? json?.user_profile?.accent_color ?? null,
            banner_color: userObj.banner_color ?? json?.user_profile?.banner_color ?? null,
            theme_colors: Array.isArray(json?.user_profile?.theme_colors)
              ? json.user_profile.theme_colors
              : null,
          });
        }
      } catch {
        // silent fallback
      }
    };

    fetchRest();
    fetchProfileBanner();

    return () => {
      active = false;
    };
  }, [discordId]);

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

            if (op === 0 && (t === 'INIT_STATE' || t === 'PRESENCE_UPDATE')) {
              if (d && d.discord_user) {
                setData(d);
              }
            }
          } catch {
            // ignore malformed websocket message
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
      } catch {
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
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [discordId]);

  const discordUser = data?.discord_user;
  const status: DiscordStatus = data?.discord_status || fallbackStatus;
  const activities = data?.activities || [];

  const isSpotifyActivity = (a: Activity) =>
    a.name === 'Spotify' ||
    a.id === 'spotify:1' ||
    (Boolean(a.party?.id) && String(a.party?.id).startsWith('spotify:')) ||
    a.type === 2;

  const customStatus = activities.find((a) => a.type === 4);
  const gameActivity = activities.find(
    (a) =>
      !isSpotifyActivity(a) &&
      (a.type === 0 || a.type === 1 || a.type === 3 || a.type === 5),
  );

  useEffect(() => {
    const startTime = gameActivity?.timestamps?.start;
    if (!startTime) {
      setElapsedTime('');
      return;
    }

    const updateTimer = () => {
      const diffSec = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
      const hours = Math.floor(diffSec / 3600);
      const minutes = Math.floor((diffSec % 3600) / 60);
      const seconds = diffSec % 60;

      if (hours > 0) {
        setElapsedTime(
          `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
        );
      } else {
        setElapsedTime(`${minutes}:${String(seconds).padStart(2, '0')}`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [gameActivity?.timestamps?.start]);

  const computedAvatarUrl = discordUser?.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${
        discordUser.avatar.startsWith('a_') ? 'gif' : 'png'
      }?size=160`
    : fallbackAvatar;

  useEffect(() => {
    setAvatarFallback(false);
  }, [computedAvatarUrl]);

  const avatarUrl = avatarFallback ? fallbackAvatar : computedAvatarUrl;

  const userId = discordUser?.id || discordId;
  const resolvedBanner = discordUser?.banner || profileMeta?.banner;
  const resolvedAccentColor = discordUser?.accent_color ?? profileMeta?.accent_color;
  const resolvedThemeColor = profileMeta?.theme_colors?.find(
    (color) => typeof color === 'number' && color > 0,
  );

  const bannerUrl =
    userId && resolvedBanner
      ? `https://cdn.discordapp.com/banners/${userId}/${resolvedBanner}.${
          resolvedBanner.startsWith('a_') ? 'gif' : 'png'
        }?size=600`
      : null;

  useEffect(() => {
    setBannerHidden(false);
  }, [bannerUrl]);

  const accentColorHex =
    normalizeHexColor(discordUser?.banner_color) ||
    normalizeHexColor(profileMeta?.banner_color) ||
    normalizeHexColor(resolvedAccentColor) ||
    normalizeHexColor(resolvedThemeColor);

  const hasBannerImage = Boolean(bannerUrl && !bannerHidden);
  const hasAccentTint = !hasBannerImage && Boolean(accentColorHex);

  const clan = discordUser?.primary_guild || discordUser?.clan;
  const clanTag = clan?.identity_enabled !== false && clan?.tag ? clan.tag : fallbackTag;
  const clanBadge =
    clan?.identity_enabled !== false && clan?.badge && clan?.identity_guild_id
      ? `https://cdn.discordapp.com/clan-badges/${clan.identity_guild_id}/${clan.badge}.png?size=32`
      : null;

  useEffect(() => {
    setClanBadgeHidden(false);
  }, [clanBadge]);

  const rawLarge = gameActivity?.assets?.large_image;
  const rawSmall = gameActivity?.assets?.small_image;

  const largeImgUrl = parseDiscordAssetUrl(rawLarge, gameActivity?.application_id);
  const smallImgUrl = parseDiscordAssetUrl(rawSmall, gameActivity?.application_id);

  const computedMainUrl = largeImgUrl || smallImgUrl;
  const mainRawAsset = largeImgUrl ? rawLarge : rawSmall;
  const mainAlt =
    (largeImgUrl ? gameActivity?.assets?.large_text : gameActivity?.assets?.small_text) ||
    gameActivity?.name ||
    'Activity';

  const computedSecondaryUrl = largeImgUrl ? smallImgUrl : null;
  const secondaryRawAsset = largeImgUrl ? rawSmall : null;
  const secondaryTitle = gameActivity?.assets?.small_text || '';

  useEffect(() => {
    setMainAssetOverride(undefined);
    setSecondaryAssetOverride(undefined);
  }, [computedMainUrl, computedSecondaryUrl]);

  const mainImgUrl = mainAssetOverride === undefined ? computedMainUrl : mainAssetOverride;
  const secondaryImgUrl =
    secondaryAssetOverride === undefined ? computedSecondaryUrl : secondaryAssetOverride;

  const handleMainImageError = () => {
    const fallback = getDirectExternalFallbackUrl(mainRawAsset);
    if (fallback && mainImgUrl !== fallback) {
      setMainAssetOverride(fallback);
    } else {
      setMainAssetOverride(null);
    }
  };

  const handleSecondaryImageError = () => {
    const fallback = getDirectExternalFallbackUrl(secondaryRawAsset);
    if (fallback && secondaryImgUrl !== fallback) {
      setSecondaryAssetOverride(fallback);
    } else {
      setSecondaryAssetOverride(null);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const textToCopy = discordUser?.username || username;
    navigator.clipboard?.writeText(textToCopy);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
  };

  const statusLabel = STATUS_TEXT[status];
  const activityVerb = gameActivity ? (ACTIVITY_VERB[gameActivity.type] ?? 'Playing') : null;
  const cardStyle = accentColorHex
    ? ({ '--discord-accent': accentColorHex } as React.CSSProperties)
    : undefined;

  return (
    <article
      className="module module-discord"
      data-has-banner={hasBannerImage ? 'true' : 'false'}
      data-has-accent={hasAccentTint ? 'true' : 'false'}
      style={cardStyle}
    >
      {hasBannerImage && bannerUrl ? (
        <img
          src={bannerUrl}
          alt=""
          aria-hidden="true"
          className="discord-banner-img"
          loading="lazy"
          onError={() => setBannerHidden(true)}
        />
      ) : hasAccentTint ? (
        <div aria-hidden="true" className="discord-banner-tint" />
      ) : null}
      {(hasBannerImage || hasAccentTint) && (
        <div className="discord-banner-scrim" aria-hidden="true" />
      )}

      <div className="discord-widget">
        <header className="module-head">
          <span className="module-label">discord.rpc</span>
          <span className="discord-head-status" data-status={status}>
            <span className="status-dot" data-status={status} aria-hidden="true" />
            <span>{statusLabel}</span>
          </span>
        </header>

        <div className="module-body">
          <div className="discord-profile">
            <div className="discord-avatar-wrap">
              <img
                src={avatarUrl}
                alt={discordUser?.global_name || displayName}
                className="discord-avatar-img"
                loading="lazy"
                onError={() => setAvatarFallback(true)}
              />
              <span className="discord-avatar-status" data-status={status} title={statusLabel} />
            </div>

            <div className="discord-user-meta">
              <div className="discord-name-row">
                <span className="discord-display-name">
                  {discordUser?.global_name || displayName}
                </span>
                {clanTag && (
                  <span className="discord-guild-tag" title={`Guild: ${clanTag}`}>
                    {clanBadge && !clanBadgeHidden && (
                      <img
                        src={clanBadge}
                        alt=""
                        className="discord-guild-icon"
                        loading="lazy"
                        onError={() => setClanBadgeHidden(true)}
                      />
                    )}
                    <span>{clanTag}</span>
                  </span>
                )}

                <div className="discord-devices">
                  {data?.active_on_discord_desktop && (
                    <span className="discord-device" title="Desktop">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    </span>
                  )}
                  {data?.active_on_discord_mobile && (
                    <span className="discord-device" title="Mobile">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                        <line x1="12" y1="18" x2="12.01" y2="18" />
                      </svg>
                    </span>
                  )}
                  {data?.active_on_discord_web && (
                    <span className="discord-device" title="Web">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    </span>
                  )}
                </div>
              </div>

              <div className="discord-handle-row">
                <span className="discord-handle">@{discordUser?.username || username}</span>
                <button
                  type="button"
                  className="discord-copy-btn"
                  data-copied={copied ? 'true' : 'false'}
                  onClick={handleCopy}
                  title="Copy username"
                  aria-label="Copy Discord username"
                >
                  {copied ? 'copied' : 'copy'}
                </button>
              </div>

              {customStatus && (
                <div className="discord-custom-status">
                  {customStatus.emoji && (
                    <span>
                      {customStatus.emoji.id ? (
                        <img
                          src={`https://cdn.discordapp.com/emojis/${customStatus.emoji.id}.${
                            customStatus.emoji.animated ? 'gif' : 'png'
                          }?size=24`}
                          alt={customStatus.emoji.name}
                          className="discord-emoji-img"
                        />
                      ) : (
                        customStatus.emoji.name
                      )}
                    </span>
                  )}
                  {customStatus.state && (
                    <span className="discord-custom-text">{customStatus.state}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="discord-activity">
            {gameActivity ? (
              <>
                <div className="discord-activity-head">
                  <span className="discord-activity-verb">
                    <span className="pulse-dot" aria-hidden="true" />
                    <span>{activityVerb}</span>
                  </span>
                  {elapsedTime && <span className="discord-activity-timer">{elapsedTime}</span>}
                </div>
                <div className="discord-activity-row">
                  {mainImgUrl && (
                    <div className="discord-app-media">
                      <img
                        src={mainImgUrl}
                        alt={mainAlt}
                        title={mainAlt}
                        className="discord-app-large"
                        loading="lazy"
                        onError={handleMainImageError}
                      />
                      {secondaryImgUrl && (
                        <img
                          src={secondaryImgUrl}
                          alt={secondaryTitle}
                          title={secondaryTitle}
                          className="discord-app-small"
                          loading="lazy"
                          onError={handleSecondaryImageError}
                        />
                      )}
                    </div>
                  )}
                  <div className="discord-app-info">
                    <span className="discord-app-name">{gameActivity.name}</span>
                    {gameActivity.details && (
                      <span className="discord-app-detail">{gameActivity.details}</span>
                    )}
                    {gameActivity.state && (
                      <span className="discord-app-state">{gameActivity.state}</span>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="discord-idle-row">
                <span className="discord-idle-label">No active session</span>
                <span className="discord-idle-state">{statusLabel}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
