#!/bin/bash
echo "🔵 开始一键部署 Cloudflare Worker..."

if ! command -v node &> /dev/null
then
    echo "❗ 请先安装 Node.js 和 npm。"
    exit
fi

if ! command -v wrangler &> /dev/null
then
    echo "📦 正在安装 wrangler..."
    npm install -g wrangler
fi

echo "🌐 正在登录 Cloudflare..."
wrangler login

echo "🚀 正在发布到 Cloudflare..."
npm install
npm run deploy

echo "✅ 部署完成！你的 Worker 已上线！"
