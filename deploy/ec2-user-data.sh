#!/bin/bash
# EC2 "user data": runs once, as root, on the server's first boot (Ubuntu 24.04).
# Installs Docker, adds 2 GB of swap (building the images on a 2 GB server needs it) and
# clones the repo. It contains no secrets: the .env file is created by hand on the server.
set -euxo pipefail

fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu

sudo -u ubuntu git clone https://github.com/goldentree831120-ui/defi-portfolio-tracker.git /home/ubuntu/app
echo "bootstrap finished" > /home/ubuntu/BOOTSTRAP_DONE
