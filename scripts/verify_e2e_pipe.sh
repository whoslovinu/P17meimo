echo "=== Synthesize one bootstrap + 16 fake events to verify the END-TO-END pipe ==="
# This proves the server-side handler prints what we expect.
# It does NOT prove the browser shipper works (that's already proven by the
# shipper being bundled). It only proves the receiver accepts the format.

SID="battle-trace-fake-$(date +%s)"
NOW=$(date +%s%3N)
T0=$NOW

events_json=$(cat <<EOF
[
{"ts":$T0,"level":"info","msg":"{\\"event\\":\\"session-bootstrap\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"isForceLoad\\":false}"},
{"ts":$((T0+200)),"level":"info","msg":"{\\"event\\":\\"[BattleLayout] render-state\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":false,\\"isStage2Loaded\\":false,\\"isStage3Loaded\\":false,\\"isStage4Loaded\\":false,\\"isAssetLoaded\\":false,\\"isCurrentModelRendered\\":false,\\"isReadyForLiveView\\":false}"},
{"ts":$((T0+800)),"level":"info","msg":"{\\"event\\":\\"[SpineViewer] pixi-init-complete\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":false,\\"isStage2Loaded\\":false,\\"isStage3Loaded\\":false,\\"isStage4Loaded\\":false,\\"isAssetLoaded\\":false,\\"isCurrentModelRendered\\":false,\\"isReadyForLiveView\\":false}"},
{"ts":$((T0+900)),"level":"info","msg":"{\\"event\\":\\"[SpineViewer] bg-mounted\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":false,\\"isStage2Loaded\\":false,\\"isStage3Loaded\\":false,\\"isStage4Loaded\\":false,\\"isAssetLoaded\\":false,\\"isCurrentModelRendered\\":false,\\"isReadyForLiveView\\":false}"},
{"ts":$((T0+1000)),"level":"info","msg":"{\\"event\\":\\"[SpineViewer] character-mounted\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":false,\\"isStage3Loaded\\":false,\\"isStage4Loaded\\":false,\\"isAssetLoaded\\":false,\\"isCurrentModelRendered\\":false,\\"isReadyForLiveView\\":false}"},
{"ts":$((T0+1100)),"level":"info","msg":"{\\"event\\":\\"[SpineViewer] halo-mounted\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":false,\\"isStage3Loaded\\":false,\\"isStage4Loaded\\":false,\\"isAssetLoaded\\":false,\\"isCurrentModelRendered\\":false,\\"isReadyForLiveView\\":false}"},
{"ts":$((T0+2000)),"level":"info","msg":"{\\"event\\":\\"[LoadingScreen] progress=100\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":true,\\"isStage3Loaded\\":true,\\"isStage4Loaded\\":true,\\"isAssetLoaded\\":true,\\"isCurrentModelRendered\\":false,\\"isReadyForLiveView\\":false}"},
{"ts":$((T0+3500)),"level":"info","msg":"{\\"event\\":\\"[LoadingScreen] dismiss-blocked-no-canvas\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":true,\\"isStage3Loaded\\":true,\\"isStage4Loaded\\":true,\\"isAssetLoaded\\":true,\\"isCurrentModelRendered\\":false,\\"isReadyForLiveView\\":false}"},
{"ts":$((T0+4000)),"level":"info","msg":"{\\"event\\":\\"[SpineViewer] stage2-mounted\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":true,\\"isStage3Loaded\\":false,\\"isStage4Loaded\\":false,\\"isAssetLoaded\\":false,\\"isCurrentModelRendered\\":false,\\"isReadyForLiveView\\":false}"},
{"ts":$((T0+4500)),"level":"info","msg":"{\\"event\\":\\"[SpineViewer] stage3-mounted\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":true,\\"isStage3Loaded\\":true,\\"isStage4Loaded\\":false,\\"isAssetLoaded\\":false,\\"isCurrentModelRendered\\":false,\\"isReadyForLiveView\\":false}"},
{"ts":$((T0+5000)),"level":"info","msg":"{\\"event\\":\\"[SpineViewer] stage4-mounted\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":true,\\"isStage3Loaded\\":true,\\"isStage4Loaded\\":true,\\"isAssetLoaded\\":false,\\"isCurrentModelRendered\\":false,\\"isReadyForLiveView\\":false}"},
{"ts":$((T0+8500)),"level":"info","msg":"{\\"event\\":\\"[SpineViewer] afterrender-fired\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":true,\\"isStage3Loaded\\":true,\\"isStage4Loaded\\":true,\\"isAssetLoaded\\":false,\\"isCurrentModelRendered\\":true,\\"isReadyForLiveView\\":false,\\"canvas\\":{\\"exists\\":true,\\"width\\":1080,\\"height\\":1920,\\"clientWidth\\":360,\\"clientHeight\\":640,\\"opacity\\":\\"1\\",\\"display\\":\\"block\\",\\"visibility\\":\\"visible\\"}}"},
{"ts":$((T0+8510)),"level":"info","msg":"{\\"event\\":\\"[BattleLayout] first-visible-frame-ready\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":true,\\"isStage3Loaded\\":true,\\"isStage4Loaded\\":true,\\"isAssetLoaded\\":false,\\"isCurrentModelRendered\\":true,\\"isReadyForLiveView\\":false}"},
{"ts":$((T0+9000)),"level":"info","msg":"{\\"event\\":\\"[LoadingScreen] exit-start\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":true,\\"isStage3Loaded\\":true,\\"isStage4Loaded\\":true,\\"isAssetLoaded\\":true,\\"isCurrentModelRendered\\":true,\\"isReadyForLiveView\\":true}"},
{"ts":$((T0+9480)),"level":"info","msg":"{\\"event\\":\\"[LoadingScreen] gone=true\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":true,\\"isStage3Loaded\\":true,\\"isStage4Loaded\\":true,\\"isAssetLoaded\\":true,\\"isCurrentModelRendered\\":true,\\"isReadyForLiveView\\":true}"},
{"ts":$((T0+9490)),"level":"info","msg":"{\\"event\\":\\"[LoadingScreen] onComplete\\",\\"pathname\\":\\"/battle\\",\\"visibilityState\\":\\"visible\\",\\"battleInit\\":false,\\"isSpineLoaded\\":true,\\"isStage2Loaded\\":true,\\"isStage3Loaded\\":true,\\"isStage4Loaded\\":true,\\"isAssetLoaded\\":true,\\"isCurrentModelRendered\\":true,\\"isReadyForLiveView\\":true}"}
]
EOF
)

PAYLOAD=$(jq -nc --arg sid "$SID" --argjson ev "$events_json" '{sessionId:$sid, origin:"battle-trace", events:$ev}')
echo "Payload bytes: $(echo -n "$PAYLOAD" | wc -c)"
echo "POSTing to /api/diag/client-log ..."
curl -sS -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" http://98.93.252.250/api/diag/client-log
echo
echo "POST complete. Sleeping 3s for pm2 to flush..."
sleep 3
echo
echo "=== tail pm2 for our fake session ==="
sudo -n tail -50 /root/.pm2/logs/repark-h5-out-0.log | grep -E "fake-$NOW" || sudo -n tail -20 /root/.pm2/logs/repark-h5-out-0.log
echo
echo "=== count of fake-session DIAG lines ==="
sudo -n grep -c "fake-$NOW" /root/.pm2/logs/repark-h5-out-0.log
echo "DONE"
