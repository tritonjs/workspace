#!/usr/bin/env bash

echo "I: starting pm2"
pm2 start --no-daemon --name workspace index.js
