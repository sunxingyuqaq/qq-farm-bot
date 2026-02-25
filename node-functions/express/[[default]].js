import express from 'express';

import {SocketServer} from "socket.io";
import gameConfig, {loadConfigs} from "../src/gameConfig";

// ---------- 数据库 ----------
import db from './database';

// ---------- BotManager ----------
import {botManager} from '../src/bot-manager';

// ---------- 路由 ----------
import apiRoutes from '../src/routes';
import {loadProto} from "../src/proto";

console.log("加载游戏配置", loadConfigs, SocketServer, gameConfig);
console.log("加载游戏配置", db, botManager, apiRoutes);

async function main() {
    // 1. 加载 Proto 定义 (所有 Bot 实例共享)
    await loadProto();
    console.log('[Server] Proto 定义已加载');

    // 2. 加载游戏配置
    gameConfig.loadConfigs();

    // 3. 初始化数据库
    await db.initDatabase();
    db.ensureDefaultAdmin();
}

main().catch(err => {
    console.error('[Server] 启动失败:', err);
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

const io = new SocketServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});

// 让路由可以广播 socket 事件
app.locals.io = io;

export default app; // 必须导出实例
