#!/bin/bash
# Revisa empresas que vencen en 3 días o ya vencieron y envía SMS
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd /home/ec2-user/trackMonk/backend
node check-expiry.js >> /home/ec2-user/trackMonk/backend/expiry.log 2>&1
echo " - $(date)" >> /home/ec2-user/trackMonk/backend/expiry.log
