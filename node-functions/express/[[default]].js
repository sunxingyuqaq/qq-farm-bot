import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import gameConfig from "./gameConfig";

// ---------- 数据库 ----------
import db from './database';

// ---------- BotManager ----------
import {botManager} from './bot-manager';

// ---------- 路由 ----------
import apiRoutes from './routes';
import {loadProto} from "./proto";
import { maskAccountsPublic } from './account-utils';

// 初始化配置
async function initialize() {
    // 1. 加载 Proto 定义 (所有 Bot 实例共享)
    console.log('当前目录地址是', __dirname);
    await loadProto();
    console.log('[Server] Proto 定义已加载');

    // 2. 加载游戏配置
    gameConfig.loadConfigs();

    // 3. 初始化数据库
    await db.initDatabase();
    db.ensureDefaultAdmin();

    // 4. 自动启动之前配置了 auto_start 的 Bot
    await botManager.autoStartBots();
}

// 初始化
initialize().catch(err => {
    console.error('[Server] 初始化失败:', err);
    process.exit(1);
});

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

// 创建 HTTP 服务器（Socket.io 需要）
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

export default app; // 必须导出实例
