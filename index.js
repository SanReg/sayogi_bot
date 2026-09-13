require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const connectDB = require('./config/db');
const bot = require('./bot/index');
const reminderService = require('./services/reminderService');

const app = express();
app.use(express.json());

const startBot = () => {
    bot.launch().then(() => console.log('Bot is polling for messages...'))
    .catch(err => {
        console.error("Failed to launch bot:", err.message);
        setTimeout(startBot, 5000);
    });
};

process.once('SIGINT', () => { bot.stop('SIGINT'); mongoose.disconnect(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); mongoose.disconnect(); });

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

app.use(express.static('public'));

app.use('/api/admin', require('./routes/admin'));

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_panel.html'));
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

const init = async () => {
    // 1. Wait for DB Connection
    await connectDB();
    
    // 2. Wait for Reminders to Load
    await reminderService.loadReminders();
    
    // 3. Start Bot only after DB is ready
    startBot();
    
    // 4. Start Express Server
    app.listen(PORT, () => {
        console.log(`Express Server is running on port ${PORT}`);
        console.log(`Webpages will be served at ${BASE_URL}`);
    });
};

init();
