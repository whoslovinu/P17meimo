#!/usr/bin/env bash
# Full process tree for repark-h5
echo "--- ps -ef --forest ---"
ps -ef --forest | head -40
echo
echo "--- all node/next processes ---"
ps -ef | awk '/node|next/ && !/awk/ && !/grep/'
echo
echo "--- parent process of next-server 545886 ---"
ps -o pid,ppid,cmd -p 545874 545885 545886 2>/dev/null