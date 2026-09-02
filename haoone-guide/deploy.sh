#!/bin/bash
set -euo pipefail

# 项目配置
PROJECT_NAME="haocut-doc"
SERVERS=("124.221.98.226")
host="guide.haoai.pro"
port=7474
SSH_PORT=22  # SSH端口，如果不是22请修改
PROJECT_DIR="/Users/xiewenhao/Documents/dev/www/$PROJECT_NAME"
REMOTE_DIR="/root/www/$PROJECT_NAME"

echo "🚀 开始部署"

# 1. 构建项目
echo "📦 正在构建项目..."
pnpm build

# 2. 同步文件到服务器并部署
for ip in "${SERVERS[@]}"; do
    echo ""
    echo "========================================"
    echo "📡 正在部署到服务器: $ip"
    echo "========================================"
    
    # 2.1 同步文件
    echo "📤 正在同步文件到 $ip..."
    rsync -avz --delete \
        --exclude '.git' \
        --exclude 'node_modules' \
        --exclude '.env' \
        --exclude '.env.*' \
        --exclude '.next' \
        --exclude '.source' \
        --exclude '.pnpm-store' \
        --exclude 'content/docs/.vitepress/cache' \
        -e "ssh -p ${SSH_PORT}" \
        "$PROJECT_DIR" root@$ip:/root/www
    
    # 2.2 连接服务器执行命令
    echo "🔧 正在 $ip 上安装依赖和重启服务..."
    ssh -p ${SSH_PORT} root@$ip "PROJECT_NAME='$PROJECT_NAME' REMOTE_DIR='$REMOTE_DIR' PORT='$port' bash -s" << 'EOF'
        set -e
        source /etc/profile >/dev/null 2>&1 || true
        source ~/.bash_profile >/dev/null 2>&1 || true
        source ~/.bashrc >/dev/null 2>&1 || true

        echo "🔎 程序路径:"
        command -v node
        node -v
        command -v pnpm
        pnpm -v
        command -v pm2

        cd "$REMOTE_DIR"
        echo "🧹 清理项目内生成缓存..."
        rm -rf .next .source .pnpm-store

        echo "📦 安装依赖..."
        CI=true pnpm install --frozen-lockfile --prod --ignore-scripts

        echo "🔄 管理 PM2 服务..."
        if pm2 show "$PROJECT_NAME" > /dev/null 2>&1; then
            echo "重启现有服务..."
            PORT="$PORT" pm2 restart "$PROJECT_NAME" --update-env
        else
            echo "启动新服务..."
            PORT="$PORT" pm2 start pnpm --name "$PROJECT_NAME" -- start
        fi
        pm2 save
        echo "✅ 远端部署完成！"
EOF

    echo "✅ $ip 部署成功"
done

# 3. 健康检查验证
echo ""
echo "========================================"
echo "🔍 正在进行健康检查..."
echo "========================================"
sleep 5  # 等待服务启动

# 检查所有服务器的健康接口
for ip in "${SERVERS[@]}"; do
    echo ""
    echo "🔍 检查服务器 $ip 的健康状态..."
    HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://${ip}:${port}/)
    
    if [ "$HEALTH_CHECK" = "200" ]; then
        echo "✅ $ip 健康检查通过！服务运行正常"
    else
        echo "⚠️  $ip 健康检查失败,HTTP状态码: $HEALTH_CHECK"
        echo "📋 正在获取详细信息..."
        curl -s http://${ip}:${port}/ | head -5
        exit 1
    fi
done

echo ""
echo "🎉 所有服务器部署流程完成！"
