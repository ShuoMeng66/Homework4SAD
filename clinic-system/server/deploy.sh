#!/usr/bin/env bash
# 部署脚本：在 Ubuntu 服务器上以 systemd 运行后端（端口 5100）
set -e
APP_DIR="/opt/clinic-system/server"
SERVICE="clinic-api.service"

echo "==> 创建应用目录 $APP_DIR"
mkdir -p "$APP_DIR"

echo "==> 安装到 $APP_DIR"
cp -f app.py schema.sql "$APP_DIR/"

echo "==> 写入 systemd 服务"
cat > /etc/systemd/system/$SERVICE <<EOF
[Unit]
Description=Clinic Management System API
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/python3 -m uvicorn app:app --host 127.0.0.1 --port 5100 --workers 1
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/clinic-api.log
StandardError=append:/var/log/clinic-api.log

[Install]
WantedBy=multi-user.target
EOF

echo "==> 启动服务"
systemctl daemon-reload
systemctl enable $SERVICE
systemctl restart $SERVICE
sleep 2
systemctl is-active $SERVICE && echo "服务已启动" || { echo "服务启动失败"; tail -30 /var/log/clinic-api.log; exit 1; }

echo "==> 健康检查"
curl -s http://127.0.0.1:5100/api/health

echo ""
echo "==> 完成。后端监听 127.0.0.1:5100，由 nginx 反向代理对外提供。"
