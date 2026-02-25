import express from 'express';
const app = express();
app.get('/api', (req, res) => {
    res.json({ message: 'Express API' });
});
export default app; // 必须导出实例
