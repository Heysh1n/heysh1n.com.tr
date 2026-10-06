#!/usr/bin/env bash
# Syncs current desktop media player (Spotify, YouTube Music, Browser) to heysh1n.com.tr backend via MPRIS/playerctl

API_URL="${API_URL:-http://localhost:3000/api/ytmusic}"

echo "Starting music sync to $API_URL..."
echo "Listening to MPRIS / playerctl events (press Ctrl+C to stop)..."

if ! command -v playerctl &> /dev/null; then
    echo "Error: playerctl is not installed. Install it with: sudo apt install playerctl (or pacman -S playerctl)"
    exit 1
fi

playerctl metadata --format '{{status}}|{{artist}}|{{title}}|{{mpris:artUrl}}|{{xesam:url}}' --follow 2>/dev/null | while IFS='|' read -r status artist title art_url track_url; do
    if [ -n "$title" ]; then
        is_playing="false"
        if [ "$status" = "Playing" ]; then
            is_playing="true"
        fi

        echo "Syncing: $artist - $title [$status]"
        curl -s -X POST "$API_URL" \
            -H "Content-Type: application/json" \
            -d "{\"title\": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$title"), \"artist\": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$artist"), \"albumArt\": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$art_url"), \"url\": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$track_url"), \"isPlaying\": $is_playing}" > /dev/null
    fi
done
