export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name?: string | null;
  avatar_decoration_data?: {
    asset: string;
    sku_id?: string;
  } | null;
  clan?: {
    identity_guild_id?: string;
    identity_enabled?: boolean;
    tag?: string;
    badge?: string;
  } | null;
  bot?: boolean;
}

export interface ActivityTimestamps {
  start?: number;
  end?: number;
}

export interface ActivityParty {
  id?: string;
  size?: [number, number];
}

export interface ActivityAssets {
  large_image?: string;
  large_text?: string;
  small_image?: string;
  small_text?: string;
}

export interface ActivityEmoji {
  name: string;
  id?: string;
  animated?: boolean;
}

export interface Activity {
  id?: string;
  name: string;
  type: number; // 0: Playing, 1: Streaming, 2: Listening, 3: Watching, 4: Custom, 5: Competing
  state?: string;
  details?: string;
  created_at?: number;
  timestamps?: ActivityTimestamps;
  assets?: ActivityAssets;
  party?: ActivityParty;
  emoji?: ActivityEmoji;
  application_id?: string;
  sync_id?: string;
  session_id?: string;
  flags?: number;
}

export interface SpotifyTrack {
  track_id: string;
  timestamps: {
    start: number;
    end: number;
  };
  song: string;
  artist: string;
  album: string;
  album_art_url: string;
}

export type DiscordStatus = 'online' | 'idle' | 'dnd' | 'offline';

export interface LanyardData {
  discord_user: DiscordUser;
  discord_status: DiscordStatus;
  active_on_discord_desktop?: boolean;
  active_on_discord_mobile?: boolean;
  active_on_discord_web?: boolean;
  activities: Activity[];
  listening_to_spotify?: boolean;
  spotify?: SpotifyTrack | null;
  kv?: Record<string, string>;
}

export interface LanyardResponse {
  success: boolean;
  data?: LanyardData;
  error?: {
    message: string;
    code: string;
  };
}
