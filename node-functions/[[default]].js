/**
 * Web 服务器入口 - Express + Socket.io
 *
 *  启动方式: node server/index.js
 *  默认端口: 3000  (可通过 PORT 环境变量覆盖)
 */

import path from 'path';
import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';

// ---------- 初始化 Proto & 游戏配置 (共享只读资源) ----------
import { loadProto } from '../src/proto/index.js';
import gameConfig from '../src/gameConfig/index.js';

// ---------- 数据库 ----------
import db from '../server/database/index.js';

// ---------- BotManager ----------
import { botManager } from '../server/bot-manager/index.js';

// ---------- 路由 ----------
import apiRoutes from '../server/routes/index.js';

// ---------- 工具 ----------
import { maskAccountsPublic } from '../server/account-utils/index.js';

const PORT = process.env.PORT || 3000;

// 1. 加载 Proto 定义 (所有 Bot 实例共享)
await loadProto();
console.log('[Server] Proto 定义已加载');

// 2. 加载游戏配置
gameConfig.loadConfigs();

// 3. 初始化数据库
await db.initDatabase();
db.ensureDefaultAdmin();

// 4. 创建 Express 应用
const app = express();
app.use(express.json());

// CORS (开发模式下允许 Vite 开发服务器跨域)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// API 路由
app.use('/api', apiRoutes);

// 静态文件 - 前端打包产物
const distPath = path.join(process.cwd(), 'web', 'dist');
import fs from 'fs';
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA fallback
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
            res.sendFile(path.join(distPath, 'index.html'));
        }
    });
} else {
    console.log('[Server] 前端未构建, 请运行 npm run build:web');
}

// 5. 创建 HTTP 服务器 & Socket.io
const server = http.createServer(app);
const io = new SocketServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});

// 让路由可以广播 socket 事件
app.locals.io = io;

// ============================================================
//  Socket.io 事件桥接
// ============================================================

io.on('connection', (socket) => {
    console.log(`[Socket.io] 客户端连接: ${socket.id}`);

    // 客户端连接后立即推送当前所有账号状态
    socket.emit('accounts:list', maskAccountsPublic(botManager.listAccounts()));

    // 客户端可以请求特定账号的日志
    socket.on('logs:subscribe', (uin) => {
        socket.join(`logs:${uin}`);
        // 推送历史日志
        const logs = botManager.getBotLogs(uin, 200);
        socket.emit('logs:history', { uin, logs });
    });

    socket.on('logs:unsubscribe', (uin) => {
        socket.leave(`logs:${uin}`);
    });

    socket.on('disconnect', () => {
        // console.log(`[Socket.io] 客户端断开: ${socket.id}`);
    });
});

// BotManager 事件 → Socket.io 广播
botManager.on('botLog', (entry) => {
    // 发送到订阅了该用户日志的 room
    io.to(`logs:${entry.userId}`).emit('bot:log', entry);
    // 也广播给所有连接（用于仪表盘概览日志）
    io.emit('bot:log:all', entry);
});

botManager.on('botStatusChange', (data) => {
    io.emit('bot:statusChange', data);
});

botManager.on('botStateUpdate', (data) => {
    io.emit('bot:stateUpdate', data);
});

botManager.on('qrExpired', (data) => {
    io.emit('qr:expired', data);
});

botManager.on('qrScanned', (data) => {
    io.emit('qr:scanned', data);
});

botManager.on('qrError', (data) => {
    io.emit('qr:error', data);
});

botManager.on('qrCancelled', (data) => {
    io.emit('qr:cancelled', data);
});

botManager.on('botError', (data) => {
    io.emit('bot:error', data);
});

// 6. 自动启动之前配置了 auto_start 的 Bot
await botManager.autoStartBots();

// 7. 启动 HTTP 服务器 (仅在非云函数环境)
if (process.env.CLOUD_ENV !== 'true') {
    server.listen(PORT, () => {
        console.log('');
        console.log('=========================================');
        console.log(`  QQ Farm Bot Web 管理平台`);
        console.log(`  http://localhost:${PORT}`);
        console.log('=========================================');
        console.log('');
    });

    // 8. 优雅退出
    const gracefulShutdown = () => {
        console.log('\n[Server] 正在关闭...');
        botManager.shutdown();
        db.closeDatabase();
        // 先关闭所有 Socket.io 连接
        io.close(() => {
            server.close(() => {
                console.log('[Server] 已关闭');
                process.exit(0);
            });
        });
        // Windows 下 SIGINT 不可靠，强制 2 秒后退出
        setTimeout(() => process.exit(0), 2000);
    };
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
}

export default app; // 必须导出实例
