import configPromise from '@payload-config'
import { getPayload } from 'payload'

interface YTMusicPayload {
  name: string
  artist: string
  albumArt?: string
  url?: string
  isNowPlaying?: boolean
  updatedAt?: number
}

// In-memory store for real-time pushed track (e.g. from webhook, companion app, or browser extension)
let liveTrack: YTMusicPayload | null = null

// Cache for parsed oEmbed data from HomePage.ytmusic_url
let cachedOembed: {
  url: string
  data: YTMusicPayload
  timestamp: number
} | null = null

const parseOEmbedTitle = (title: string, author: string) => {
  // Common YouTube format: "Artist - Title" or "Artist - Title (Official Music Video)"
  let cleanTitle = title.replace(/\s*\(Official.*?\)/gi, '').replace(/\s*\[Official.*?\]/gi, '').trim()
  if (cleanTitle.includes(' - ')) {
    const parts = cleanTitle.split(' - ')
    return {
      artist: parts[0].trim(),
      name: parts.slice(1).join(' - ').trim(),
    }
  }
  return {
    artist: author || 'YouTube Music',
    name: cleanTitle,
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export const OPTIONS = async () => {
  return new Response(null, { headers: corsHeaders, status: 204 })
}

export const GET = async () => {
  // 1. If we have a live track updated within the last 10 minutes, return it
  if (liveTrack && Date.now() - (liveTrack.updatedAt || 0) < 10 * 60 * 1000) {
    return Response.json(
      {
        success: true,
        source: 'ytmusic_live',
        track: liveTrack,
      },
      { headers: corsHeaders }
    )
  }

  // 2. Otherwise, check Payload CMS HomePage global for ytmusic_url
  try {
    const payload = await getPayload({
      config: configPromise,
    })

    const homePage = await payload.findGlobal({
      slug: 'home-page',
    })

    const ytmusicUrl = (homePage as any)?.ytmusic_url?.trim()

    if (ytmusicUrl) {
      // Check cache (valid for 5 minutes)
      if (cachedOembed && cachedOembed.url === ytmusicUrl && Date.now() - cachedOembed.timestamp < 5 * 60 * 1000) {
        return Response.json(
          {
            success: true,
            source: 'ytmusic_config',
            track: cachedOembed.data,
          },
          { headers: corsHeaders }
        )
      }

      // Fetch from YouTube oEmbed
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(ytmusicUrl)}&format=json`
      )

      if (oembedRes.ok) {
        const oembed = await oembedRes.json()
        const { artist, name } = parseOEmbedTitle(oembed.title || '', oembed.author_name || '')

        // Try getting high-res thumbnail
        let albumArt = oembed.thumbnail_url
        if (albumArt && albumArt.includes('hqdefault.jpg')) {
          albumArt = albumArt.replace('hqdefault.jpg', 'maxresdefault.jpg')
        }

        const trackData: YTMusicPayload = {
          name,
          artist,
          albumArt,
          url: ytmusicUrl,
          isNowPlaying: false,
          updatedAt: Date.now(),
        }

        cachedOembed = {
          url: ytmusicUrl,
          data: trackData,
          timestamp: Date.now(),
        }

        return Response.json(
          {
            success: true,
            source: 'ytmusic_config',
            track: trackData,
          },
          { headers: corsHeaders }
        )
      }
    }
  } catch (error) {
    console.warn('Error fetching YT Music from payload config:', error)
  }

  return Response.json(
    {
      success: false,
      message: 'No active YouTube Music track found',
    },
    { headers: corsHeaders }
  )
}

// POST endpoint to accept real-time scrobbles/updates from YTMDesktop or scripts
export const POST = async (request: Request) => {
  try {
    const body = await request.json()

    if (!body || (!body.title && !body.name)) {
      return Response.json(
        { success: false, error: 'Track title is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    liveTrack = {
      name: (body.title || body.name || '').trim(),
      artist: (body.artist || '').trim(),
      albumArt: body.albumArt || body.thumbnail || body.image,
      url: body.url || 'https://music.youtube.com',
      isNowPlaying: body.isPlaying ?? body.isNowPlaying ?? true,
      updatedAt: Date.now(),
    }

    return Response.json(
      {
        success: true,
        message: 'YouTube Music track updated',
        track: liveTrack,
      },
      { headers: corsHeaders }
    )
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders })
  }
}
