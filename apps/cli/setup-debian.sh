#!/bin/bash
# BurnData CLI — Setup script for Debian 13 (trixie)
# Run as root or with sudo

set -e

echo "=== BurnData CLI Setup for Debian 13 ==="

# 1. Install Node.js 20 LTS
if ! command -v node &> /dev/null; then
    echo "[1/4] Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "[1/4] Node.js already installed: $(node --version)"
fi

# 2. Install pnpm
if ! command -v pnpm &> /dev/null; then
    echo "[2/4] Installing pnpm..."
    npm install -g pnpm
else
    echo "[2/4] pnpm already installed: $(pnpm --version)"
fi

# 3. Install dependencies
echo "[3/4] Installing dependencies..."
cd "$(dirname "$0")"
pnpm install

# 4. Setup systemd service
echo "[4/4] Setting up systemd service..."

CLI_DIR=$(pwd)
CLI_USER=${SUDO_USER:-$(whoami)}

cat > /etc/systemd/system/burndata.service << EOF
[Unit]
Description=BurnData CLI - Discord Message Deletion
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${CLI_USER}
WorkingDirectory=${CLI_DIR}
ExecStart=$(which node) --import tsx src/index.ts
Restart=on-failure
RestartSec=60
StandardOutput=append:${CLI_DIR}/burndata-service.log
StandardError=append:${CLI_DIR}/burndata-service.log

# Graceful shutdown
KillSignal=SIGTERM
TimeoutStopSec=30

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${CLI_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit config.yaml with your Discord token and targets"
echo "  2. Test manually:  cd ${CLI_DIR} && npx tsx src/index.ts"
echo "  3. Start service:  sudo systemctl start burndata"
echo "  4. Enable on boot: sudo systemctl enable burndata"
echo "  5. Check logs:     journalctl -u burndata -f"
echo "  6. Stop service:   sudo systemctl stop burndata"
echo ""
