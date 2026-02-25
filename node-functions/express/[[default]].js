import express from 'express';
import {loadConfigs} from "../src/gameConfig";

console.log("加载游戏配置", loadConfigs);
const app = express();
app.get('/api', (req, res) => {
    res.json({message: 'Express API'});
});
export default app; // 必须导出实例
