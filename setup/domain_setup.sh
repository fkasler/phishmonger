#!/usr/bin/env bash
# Generates nginx proxy config and performs some basic sanity checks.
# Swag on 'em!

if ! sudo echo &>/dev/null; then echo "Unable to use sudo. Exiting."; exit 2; fi

if [ -z $1 ]; then
	echo "Enter your domain (e.g. phishy.net)"
	read -p "Domain: " fulldomain
else
	fulldomain="$1"
fi

domain="${fulldomain%.*}"
toplevel="${fulldomain##*.}"

# Var definition.

outfile="/etc/nginx/sites-available/$fulldomain.conf" # $domain is derived from arg or prompt.
enablefile="/etc/nginx/sites-enabled/$fulldomain.conf" # ^
certfullchain="/etc/letsencrypt/live/$fulldomain/fullchain.pem"
certkey="/etc/letsencrypt/live/$fulldomain/privkey.pem"
vhostlogpath="/var/log/nginx/vhosts/$fulldomain"

# Check for cert files (should be updated to check for both at once down the road using an exit varible)
if ! sudo test -f "$certfullchain"; then echo "Could not find certfullchain at $certfullchain"; echo "Create this file or change the var in this script and try again."; exit 3; fi
if ! sudo test -f "$certkey"; then echo "Could not find certkey at $certkey"; echo "Create this file or change the var in this script and try again."; exit 4; fi

# heredoc for the NGINX vhost file.
sudo bash -c "cat >$outfile" <<EOF
server {
    listen       0.0.0.0:443;
    server_name ~^(.*)\.*$domain\.$toplevel;

    ssl                  on;
    ssl_certificate      $certfullchain;
    ssl_certificate_key  $certkey;

    ssl_session_timeout  5m;

    ssl_protocols TLSv1.3 TLSv1.2 TLSv1.1;
    ssl_prefer_server_ciphers on;
    ssl_ciphers EECDH+ECDSA+AESGCM:EECDH+aRSA+AESGCM:EECDH+ECDSA+SHA512:EECDH+ECDSA+SHA384:EECDH+ECDSA+SHA256:ECDH+AESGCM:ECDH+AES256:DH+AESGCM:DH+AES256:RSA+AESGCM:!aNULL:!eNULL:!LOW:!RC4:!3DES:!MD5:!EXP:!PSK:!SRP:!DSS;

    access_log      $vhostlogpath/access.log;
    error_log       $vhostlogpath/error.log;

    location / {
        proxy_pass http://127.0.0.1:4005;
        proxy_pass_request_headers on;
#a few headers to allow websocket upgrade
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
#not sure if we need these...
        proxy_set_header Host \$host;
        proxy_ssl_session_reuse off;
    }

}

#
# Might change the redirect for simple targets that actually use HTTP... HAHAHAHA
#

server {
    listen      0.0.0.0:80;
    server_name ~^(.*)\.*$domain.$toplevel;
    add_header Strict-Transport-Security max-age=2592000;
    rewrite ^/.*$ https://$host$request_uri? permanent;
}
EOF

sudo ln -s "$outfile" "/etc/nginx/sites-enabled/$fulldomain.conf"
echo "Creating vhosts directory for nginx logs..."
sudo mkdir -p "$vhostlogpath"
if [ -f $outfile ]; then echo "Wrote nginx config to $outfile"; else echo "Could not find $outfile"; exit 5; fi
echo "Ensure the vhost is correct and symlinked, then run: sudo systemctl restart nginx"
echo "Thanks for playing!"

