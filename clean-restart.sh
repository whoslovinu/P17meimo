#!/bin/bash
echo '---PROCS---'
ps -ef | grep next-server | grep -v grep
echo '---KILLING all next-server---'
for p in $(ps -ef | grep next-server | grep -v grep | awk '{print $2}'); do
  echo killing $p
  sudo kill -9 $p 2>&1 || echo "kill $p failed"
done
sleep 3
echo '---PORT NOW---'
sudo ss -tlpn | grep ':3000' || echo 'port 3000 free'
echo '---PM2 CLEAN RESTART---'
pm2 delete all
sleep 2
pm2 start node_modules/.bin/next --name repark-h5 -- start
sleep 6
pm2 status
echo '---FINAL PORT---'
sudo ss -tlpn | grep ':3000'