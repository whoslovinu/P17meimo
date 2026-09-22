echo "=== port 3000 listeners ==="
sudo -n ss -lntp 2>/dev/null | grep -E ":3000\b" || echo "(ss output empty)"
echo "---"
sudo -n ss -lnt 2>/dev/null | grep -E ":3000\b"
echo "---"
echo "=== all next processes ==="
pgrep -af "next-server|next start" | head -5
echo "DONE"
