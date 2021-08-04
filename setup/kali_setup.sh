#!/usr/bin/env bash
[ "$UID" -eq 0 ] || exec sudo bash "$0" "$@"
wget -qO- https://archive.kali.org/archive-key.asc  | apt-key add
apt-get update
apt-get upgrade
