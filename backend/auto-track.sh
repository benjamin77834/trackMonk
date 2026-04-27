#!/bin/bash
# Auto-track: envía push a todos los dispositivos
curl -s -X POST http://localhost:3001/api/auto-track \
  -H "Content-Type: application/json" \
  -d '{"key":"trackmonk-auto-2026"}' \
  >> /home/ec2-user/trackMonk/backend/auto-track.log 2>&1
echo " - $(date)" >> /home/ec2-user/trackMonk/backend/auto-track.log
