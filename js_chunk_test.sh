#!/bin/bash
curl -sI http://98.93.252.250/_next/static/chunks/1255-ab54a41c275880be.js 2>&1 | grep -E "Cache-Control|Content-Type"