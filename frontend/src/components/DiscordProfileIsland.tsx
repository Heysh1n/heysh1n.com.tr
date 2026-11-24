import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Activity,
  DiscordClan,
  DiscordStatus,
  LanyardData,
  LanyardResponse,
} from '../types/lanyard';

interface DiscordProfileIslandProps {
  discordId?: string;
  username?: string;
  displayName?: string;
  fallbackTag?: string;
  fallbackAvatar?: string;
  fallbackStatus?: DiscordStatus;
  backendUrl?: string;
}

interface DiscordProfileMeta {
  id?: string | null;
  username?: string | null;
  global_name?: string | null;
  avatar?: string | null;
  banner?: string | null;
  accent_color?: number | null;
  banner_color?: string | null;
  theme_colors?: number[] | null;
  primary_guild?: DiscordClan | null;
  clan?: DiscordClan | null;
}

interface BackendDiscordProfileResponse {
  success?: boolean;
  presence?: LanyardData | null;
  profile?: DiscordProfileMeta | null;
}

const DEFAULT_DISCORD_ID = '995737379417640961';
const LANYARD_WS_URL = 'wss://api.lanyard.rest/socket';
const LANYARD_REST_URL = 'https://api.lanyard.rest/v1/users/';
const DCDN_PROFILE_URL = 'https://dcdn.dstn.to/profile/';
const PROD_BACKEND_URL = 'https://api.heysh1n.com.tr';
const FALLBACK_POLL_MS = 25_000;
const CUSTOM_EMOJI_TOKEN_RE = /<(a?):([a-zA-Z0-9_]+):(\d{17,22})>/g;

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

function resolveBackendBase(propUrl?: string): string | null {
  const raw = (
    propUrl ||
    (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_BACKEND_URL) ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');

  const isLocalBackend = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw);

  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    const isLocalPage = host === 'localhost' || host === '127.0.0.1';
    if (!isLocalPage && (!raw || isLocalBackend)) {
      if (host === 'heysh1n.com.tr' || host.endsWith('.heysh1n.com.tr')) {
        return PROD_BACKEND_URL;
      }
      return null;
    }
  }

  return raw || null;
}

function toDiscordProxyUrl(directUrl: string, backendBase: string | null): string | null {
  if (!backendBase) return null;

  try {
    const parsed = new URL(directUrl);
    if (parsed.hostname === 'cdn.discordapp.com') {
      return `${backendBase}/api/discord/cdn${parsed.pathname}${parsed.search}`;
    }
    if (parsed.hostname === 'media.discordapp.net' && parsed.pathname.startsWith('/external/')) {
      return `${backendBase}/api/discord/cdn/media${parsed.pathname}`;
    }
  } catch {
    return null;
  }

  return null;
}

function buildDiscordAssetCandidates(
  directUrls: Array<string | null | undefined>,
  backendBase: string | null,
): string[] {
  const cleanDirect: string[] = [];
  for (const url of directUrls) {
    if (url && !cleanDirect.includes(url)) {
      cleanDirect.push(url);
    }
  }

  const ordered: string[] = [];
  const pushUnique = (url: string | null | undefined) => {
    if (url && !ordered.includes(url)) {
      ordered.push(url);
    }
  };

  for (const url of cleanDirect) {
    pushUnique(toDiscordProxyUrl(url, backendBase));
  }
  for (const url of cleanDirect) {
    pushUnique(url);
  }

  return ordered;
}

function buildEmojiCandidates(
  emojiId: string,
  animated: boolean,
  backendBase: string | null,
): string[] {
  const directUrls = animated
    ? [
        `https://cdn.discordapp.com/emojis/${emojiId}.gif?size=48`,
        `https://cdn.discordapp.com/emojis/${emojiId}.webp?size=48&animated=true`,
        `https://cdn.discordapp.com/emojis/${emojiId}.png?size=48`,
      ]
    : [
        `https://cdn.discordapp.com/emojis/${emojiId}.png?size=48`,
        `https://cdn.discordapp.com/emojis/${emojiId}.webp?size=48`,
      ];

  return buildDiscordAssetCandidates(directUrls, backendBase);
}

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

function normalizeDcdnPayload(json: any): DiscordProfileMeta | null {
  const userObj = json?.user || json?.user_profile;
  if (!userObj) return null;

  return {
    id: userObj.id ?? null,
    username: userObj.username ?? null,
    global_name: userObj.global_name ?? null,
    avatar: userObj.avatar ?? null,
    banner: userObj.banner ?? json?.user_profile?.banner ?? null,
    accent_color: userObj.accent_color ?? json?.user_profile?.accent_color ?? null,
    banner_color: userObj.banner_color ?? json?.user_profile?.banner_color ?? null,
    theme_colors: Array.isArray(json?.user_profile?.theme_colors)
      ? json.user_profile.theme_colors
      : null,
    primary_guild: userObj.primary_guild ?? null,
    clan: userObj.clan ?? null,
  };
}

interface FallbackImageProps {
  candidates: string[];
  fallbackSrc?: string;
  alt: string;
  className?: string;
  title?: string;
  ariaHidden?: boolean;
  decoding?: 'async' | 'auto' | 'sync';
  loading?: 'eager' | 'lazy';
  onExhausted?: () => void;
}

function FallbackImage({
  candidates,
  fallbackSrc,
  alt,
  className,
  title,
  ariaHidden,
  decoding = 'async',
  loading,
  onExhausted,
}: FallbackImageProps) {
  const candidatesKey = candidates.join('|');
  const [state, setState] = useState(() => ({ key: candidatesKey, index: 0 }));
  const imgRef = useRef<HTMLImageElement | null>(null);
  const onExhaustedRef = useRef(onExhausted);
  onExhaustedRef.current = onExhausted;

  const index = state.key === candidatesKey ? state.index : 0;
  const activeSrc = index < candidates.length ? candidates[index] : fallbackSrc || null;

  const advance = () => {
    setState((prev) => {
      const currentIndex = prev.key === candidatesKey ? prev.index : 0;
      if (currentIndex >= candidates.length) return prev;
      return { key: candidatesKey, index: currentIndex + 1 };
    });
  };

  useEffect(() => {
    if (candidates.length > 0 && index >= candidates.length && !fallbackSrc) {
      onExhaustedRef.current?.();
    }
  }, [candidatesKey, index, candidates.length, fallbackSrc]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !activeSrc) return;
    if (img.complete && img.naturalWidth === 0 && index < candidates.length) {
      advance();
    }
  }, [activeSrc, candidatesKey, index, candidates.length]);

  if (!activeSrc) return null;

  return (
    <img
      ref={imgRef}
      src={activeSrc}
      alt={alt}
      title={title}
      aria-hidden={ariaHidden || undefined}
      className={className}
      decoding={decoding}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={advance}
    />
  );
}

function renderCustomStatusText(state: string, backendBase: string | null): React.ReactNode {
  CUSTOM_EMOJI_TOKEN_RE.lastIndex = 0;
  if (!CUSTOM_EMOJI_TOKEN_RE.test(state)) {
    return state;
  }

  CUSTOM_EMOJI_TOKEN_RE.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CUSTOM_EMOJI_TOKEN_RE.exec(state)) !== null) {
    if (match.index > lastIndex) {
      parts.push(state.slice(lastIndex, match.index));
    }

    const [, animatedFlag, emojiName, emojiId] = match;
    const candidates = buildEmojiCandidates(emojiId, animatedFlag === 'a', backendBase);
    parts.push(
      <FallbackImage
        key={`${emojiId}-${match.index}`}
        candidates={candidates}
        alt={`:${emojiName}:`}
        title={`:${emojiName}:`}
        className="discord-inline-emoji"
      />,
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < state.length) {
    parts.push(state.slice(lastIndex));
  }

  return parts;
}

export default function DiscordProfileIsland({
  discordId = DEFAULT_DISCORD_ID,
  username = 'heysh1n',
  displayName = 'Heysh1n',
  fallbackTag = 'HEYSH1N',
  fallbackAvatar = '/assets/bg/image.png',
  fallbackStatus = 'online',
  backendUrl,
}: DiscordProfileIslandProps) {
  const [data, setData] = useState<LanyardData | null>(null);
  const [profileMeta, setProfileMeta] = useState<DiscordProfileMeta | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [bannerExhausted, setBannerExhausted] = useState(false);
  const [backendProxyEnabled, setBackendProxyEnabled] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const wsConnectedRef = useRef(false);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const backendBase = useMemo(() => resolveBackendBase(backendUrl), [backendUrl]);
  const activeProxyBase = backendProxyEnabled ? backendBase : null;

  useEffect(() => {
    setBackendProxyEnabled(Boolean(backendBase));
  }, [backendBase]);

  useEffect(() => {
    let active = true;

    const fetchBackend = async () => {
      if (!backendBase) return false;
      try {
        const res = await fetch(
          `${backendBase}/api/discord/profile?id=${encodeURIComponent(discordId)}`,
          { headers: { Accept: 'application/json' } },
        );
        if (!active) return false;
        if (res.status === 404) {
          setBackendProxyEnabled(false);
          return false;
        }
        if (!res.ok) return false;
        const json = (await res.json()) as BackendDiscordProfileResponse;
        if (!active) return false;
        setBackendProxyEnabled(true);
        if (json.presence?.discord_user) {
          setData((prev) => prev ?? json.presence ?? null);
        }
        if (json.profile) {
          setProfileMeta(json.profile);
        }
        return Boolean(json.presence || json.profile);
      } catch {
        if (active) {
          setBackendProxyEnabled(false);
        }
        return false;
      }
    };

    const fetchDirectPresence = async () => {
      try {
        const res = await fetch(`${LANYARD_REST_URL}${discordId}`);
        if (!res.ok) return;
        const json: LanyardResponse = await res.json();
        if (!active) return;
        if (json.success && json.data) {
          setData((prev) => prev ?? json.data ?? null);
        }
      } catch {
        // silent fallback
      }
    };

    const fetchDirectProfile = async () => {
      try {
        const res = await fetch(`${DCDN_PROFILE_URL}${discordId}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        const normalized = normalizeDcdnPayload(json);
        if (normalized) {
          setProfileMeta((prev) => prev ?? normalized);
        }
      } catch {
        // silent fallback
      }
    };

    const loadAll = async () => {
      await Promise.all([fetchBackend(), fetchDirectPresence(), fetchDirectProfile()]);
    };

    loadAll();

    pollTimerRef.current = setInterval(() => {
      if (!active || wsConnectedRef.current) return;
      if (backendBase) {
        fetch(`${backendBase}/api/discord/profile?id=${encodeURIComponent(discordId)}`, {
          headers: { Accept: 'application/json' },
        })
          .then((res) => (res.ok ? (res.json() as Promise<BackendDiscordProfileResponse>) : null))
          .then((json) => {
            if (!active || !json) return;
            if (json.presence?.discord_user) setData(json.presence);
            if (json.profile) setProfileMeta(json.profile);
          })
          .catch(() => {});
      } else {
        fetch(`${LANYARD_REST_URL}${discordId}`)
          .then((res) => (res.ok ? (res.json() as Promise<LanyardResponse>) : null))
          .then((json) => {
            if (active && json?.success && json.data) setData(json.data);
          })
          .catch(() => {});
      }
    }, FALLBACK_POLL_MS);

    return () => {
      active = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [discordId, backendBase]);

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
                wsConnectedRef.current = true;
                setData(d);
              }
            }
          } catch {
            // ignore malformed websocket message
          }
        };

        ws.onclose = () => {
          wsConnectedRef.current = false;
          if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
          if (!unmounted) {
            reconnectTimerRef.current = setTimeout(connectWs, 5000);
          }
        };

        ws.onerror = () => {
          wsConnectedRef.current = false;
          ws.close();
        };
      } catch {
        wsConnectedRef.current = false;
        if (!unmounted) {
          reconnectTimerRef.current = setTimeout(connectWs, 5000);
        }
      }
    };

    connectWs();

    return () => {
      unmounted = true;
      wsConnectedRef.current = false;
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

  const userId = discordUser?.id || profileMeta?.id || discordId;
  const resolvedAvatarHash = discordUser?.avatar ?? profileMeta?.avatar ?? null;
  const resolvedDisplayName = discordUser?.global_name || profileMeta?.global_name || displayName;
  const resolvedUsername = discordUser?.username || profileMeta?.username || username;

  const avatarCandidates = useMemo(() => {
    if (!userId || !resolvedAvatarHash) return [];
    const isAnimated = resolvedAvatarHash.startsWith('a_');
    const directUrls = isAnimated
      ? [
          `https://cdn.discordapp.com/avatars/${userId}/${resolvedAvatarHash}.gif?size=256`,
          `https://cdn.discordapp.com/avatars/${userId}/${resolvedAvatarHash}.png?size=256`,
        ]
      : [`https://cdn.discordapp.com/avatars/${userId}/${resolvedAvatarHash}.png?size=256`];
    return buildDiscordAssetCandidates(directUrls, activeProxyBase);
  }, [userId, resolvedAvatarHash, activeProxyBase]);

  const resolvedBanner = discordUser?.banner || profileMeta?.banner || null;
  const resolvedAccentColor = discordUser?.accent_color ?? profileMeta?.accent_color;
  const resolvedThemeColor = profileMeta?.theme_colors?.find(
    (color) => typeof color === 'number' && color > 0,
  );

  const bannerCandidates = useMemo(() => {
    if (!userId || !resolvedBanner) return [];
    const isAnimated = resolvedBanner.startsWith('a_');
    const directUrls = isAnimated
      ? [
          `https://cdn.discordapp.com/banners/${userId}/${resolvedBanner}.gif?size=512`,
          `https://cdn.discordapp.com/banners/${userId}/${resolvedBanner}.png?size=512`,
        ]
      : [`https://cdn.discordapp.com/banners/${userId}/${resolvedBanner}.png?size=512`];
    return buildDiscordAssetCandidates(directUrls, activeProxyBase);
  }, [userId, resolvedBanner, activeProxyBase]);

  const bannerCandidatesKey = bannerCandidates.join('|');
  useEffect(() => {
    setBannerExhausted(false);
  }, [bannerCandidatesKey]);

  const accentColorHex =
    normalizeHexColor(discordUser?.banner_color) ||
    normalizeHexColor(profileMeta?.banner_color) ||
    normalizeHexColor(resolvedAccentColor) ||
    normalizeHexColor(resolvedThemeColor);

  const hasBannerImage = bannerCandidates.length > 0 && !bannerExhausted;
  const hasAccentTint = !hasBannerImage && Boolean(accentColorHex);

  const clan =
    discordUser?.primary_guild ||
    discordUser?.clan ||
    profileMeta?.primary_guild ||
    profileMeta?.clan;
  const clanTag = clan?.identity_enabled !== false && clan?.tag ? clan.tag : fallbackTag;
  const clanBadgeCandidates = useMemo(() => {
    if (clan?.identity_enabled === false || !clan?.badge || !clan?.identity_guild_id) {
      return [];
    }
    return buildDiscordAssetCandidates(
      [`https://cdn.discordapp.com/clan-badges/${clan.identity_guild_id}/${clan.badge}.png?size=32`],
      activeProxyBase,
    );
  }, [clan?.identity_enabled, clan?.badge, clan?.identity_guild_id, activeProxyBase]);

  const customEmojiCandidates = useMemo(() => {
    if (!customStatus?.emoji?.id) return [];
    return buildEmojiCandidates(
      customStatus.emoji.id,
      Boolean(customStatus.emoji.animated),
      activeProxyBase,
    );
  }, [customStatus?.emoji?.id, customStatus?.emoji?.animated, activeProxyBase]);

  const rawLarge = gameActivity?.assets?.large_image;
  const rawSmall = gameActivity?.assets?.small_image;
  const largeImgUrl = parseDiscordAssetUrl(rawLarge, gameActivity?.application_id);
  const smallImgUrl = parseDiscordAssetUrl(rawSmall, gameActivity?.application_id);

  const mainRawAsset = largeImgUrl ? rawLarge : rawSmall;
  const mainDirectUrl = largeImgUrl || smallImgUrl;
  const mainAlt =
    (largeImgUrl ? gameActivity?.assets?.large_text : gameActivity?.assets?.small_text) ||
    gameActivity?.name ||
    'Activity';

  const secondaryRawAsset = largeImgUrl ? rawSmall : null;
  const secondaryDirectUrl = largeImgUrl ? smallImgUrl : null;
  const secondaryTitle = gameActivity?.assets?.small_text || '';

  const mainAssetCandidates = useMemo(
    () =>
      buildDiscordAssetCandidates(
        [mainDirectUrl, getDirectExternalFallbackUrl(mainRawAsset)],
        activeProxyBase,
      ),
    [mainDirectUrl, mainRawAsset, activeProxyBase],
  );

  const secondaryAssetCandidates = useMemo(
    () =>
      buildDiscordAssetCandidates(
        [secondaryDirectUrl, getDirectExternalFallbackUrl(secondaryRawAsset)],
        activeProxyBase,
      ),
    [secondaryDirectUrl, secondaryRawAsset, activeProxyBase],
  );

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard?.writeText(resolvedUsername);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
  };

  const statusLabel = STATUS_TEXT[status];
  const activityVerb = gameActivity ? (ACTIVITY_VERB[gameActivity.type] ?? 'Playing') : null;
  const cardStyle = accentColorHex
    ? ({ '--discord-accent': accentColorHex } as React.CSSProperties)
    : undefined;
  const hasCustomStatusContent = Boolean(customStatus && (customStatus.emoji || customStatus.state));

  return (
    <article
      className="module module-discord"
      data-has-banner={hasBannerImage ? 'true' : 'false'}
      data-has-accent={hasAccentTint ? 'true' : 'false'}
      style={cardStyle}
    >
      {hasBannerImage ? (
        <FallbackImage
          candidates={bannerCandidates}
          alt=""
          ariaHidden
          className="discord-banner-img"
          decoding="async"
          onExhausted={() => setBannerExhausted(true)}
        />
      ) : hasAccentTint ? (
        <>
          <div aria-hidden="true" className="discord-banner-tint" />
          <div className="discord-banner-scrim" aria-hidden="true" />
        </>
      ) : null}

      <div className="discord-widget">
        <header className="module-head">
          <span className="module-label">discord.status</span>
        </header>

        <div className="module-body">
          <div className="discord-profile">
            <div className="discord-avatar-wrap">
              <FallbackImage
                candidates={avatarCandidates}
                fallbackSrc={fallbackAvatar}
                alt={resolvedDisplayName}
                className="discord-avatar-img"
                decoding="async"
              />
              <span
                className="discord-avatar-status"
                data-status={status}
                title={statusLabel}
                aria-label={`Discord status: ${statusLabel}`}
              />
            </div>

            <div className="discord-user-meta">
              <div className="discord-name-row">
                <span className="discord-display-name">{resolvedDisplayName}</span>
                {clanTag && (
                  <span className="discord-guild-tag" title={`Guild: ${clanTag}`}>
                    {clanBadgeCandidates.length > 0 && (
                      <FallbackImage
                        candidates={clanBadgeCandidates}
                        alt=""
                        ariaHidden
                        className="discord-guild-icon"
                        loading="lazy"
                      />
                    )}
                    <span>{clanTag}</span>
                  </span>
                )}

                <div className="discord-devices">
                  {data?.active_on_discord_desktop && (
                    <span className="discord-device" title="Desktop">
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    </span>
                  )}
                  {data?.active_on_discord_mobile && (
                    <span className="discord-device" title="Mobile">
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                        <line x1="12" y1="18" x2="12.01" y2="18" />
                      </svg>
                    </span>
                  )}
                  {data?.active_on_discord_web && (
                    <span className="discord-device" title="Web">
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    </span>
                  )}
                </div>
              </div>

              <div className="discord-handle-row">
                <span className="discord-handle">@{resolvedUsername}</span>
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

              {hasCustomStatusContent && customStatus && (
                <div className="discord-custom-status">
                  {customStatus.emoji &&
                    (customStatus.emoji.id ? (
                      <FallbackImage
                        candidates={customEmojiCandidates}
                        alt={customStatus.emoji.name}
                        title={`:${customStatus.emoji.name}:`}
                        className="discord-emoji-img"
                      />
                    ) : (
                      <span className="discord-emoji-unicode" aria-hidden="true">
                        {customStatus.emoji.name}
                      </span>
                    ))}
                  {customStatus.state && (
                    <span className="discord-custom-text">
                      {renderCustomStatusText(customStatus.state, activeProxyBase)}
                    </span>
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
                  {mainAssetCandidates.length > 0 && (
                    <div className="discord-app-media">
                      <FallbackImage
                        candidates={mainAssetCandidates}
                        alt={mainAlt}
                        title={mainAlt}
                        className="discord-app-large"
                        loading="lazy"
                      />
                      {secondaryAssetCandidates.length > 0 && (
                        <FallbackImage
                          candidates={secondaryAssetCandidates}
                          alt={secondaryTitle}
                          title={secondaryTitle}
                          className="discord-app-small"
                          loading="lazy"
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
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
