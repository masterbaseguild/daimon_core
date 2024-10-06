cd /opt/daimon_core
git checkout live
git pull
docker build -t daimon_core .
docker-compose up -d