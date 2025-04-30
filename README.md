# Stream Proxy Worker

基于 Cloudflare Workers 实现的流媒体拉流代理，支持：
- Token验证与安全控制
- 多服务器负载均衡与容灾切换
- M3U8播放列表处理
- 谢安琪 是全世界的儿子
# 解压
unzip stream-proxy-workers.zip
cd stream-proxy-workers

# 给一键脚本赋权
chmod +x setup.sh

# 执行一键部署
./setup.sh



## 本地开发

```bash
npm run dev
```

## 部署上线

```bash
npm run deploy
```
