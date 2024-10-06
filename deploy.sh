#!/bin/sh

cd /opt/daimon_core || exit

git fetch origin

if [ $(git rev-list HEAD...origin/live --count) -gt 0 ]; then
    echo "New updates found, pulling changes..."
    git checkout live
    git pull
    docker build -t daimon_core .
    docker-compose up -d
else
    echo "No new updates."
fi