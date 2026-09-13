const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const User = require('../models/User');
const Reminder = require('../models/Reminder');
const Website = require('../models/Website');
const reminderService = require('../services/reminderService');
const websiteService = require('../services/websiteService');

// Auth middleware
const auth = (req, res, next) => {
    const pwd = process.env.ADMIN_PASSWORD;
    if (!pwd) return res.status(500).json({ error: "ADMIN_PASSWORD not set in .env" });
    
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
    
    const token = authHeader.replace('Bearer ', '');
    if (token !== pwd) return res.status(401).json({ error: "Invalid password" });
    
    next();
};

router.use(auth);

// Get all users with stats
router.get('/users', async (req, res) => {
    try {
        const users = await User.find().lean();
        const stats = await Promise.all(users.map(async (u) => {
            const remindersCount = await Reminder.countDocuments({ chatId: u.chatId });
            const websitesCount = await Website.countDocuments({ chatId: u.chatId });
            return { ...u, remindersCount, websitesCount };
        }));
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Update user limits & status
router.post('/users/:chatId/update', async (req, res) => {
    try {
        const { maxWebsites, maxActiveReminders, maxRecurringReminders, strikes, isLocked } = req.body;
        const user = await User.findOneAndUpdate(
            { chatId: req.params.chatId },
            { maxWebsites, maxActiveReminders, maxRecurringReminders, strikes, isLocked },
            { returnDocument: 'after' }
        );
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get user details (reminders & websites)
router.get('/users/:chatId/details', async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const user = await User.findOne({ chatId }).lean();
        const remindersRaw = await Reminder.find({ chatId }).lean();
        const websites = await Website.find({ chatId }).lean();
        
        const NepaliDate = require('nepali-date-converter').default;
        const reminders = remindersRaw.map(r => {
            const d = new Date(r.time);
            const npDate = new NepaliDate(d).format('DD MMMM YYYY');
            const timeStr = d.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' });
            return {
                ...r,
                formattedTime: `${npDate} at ${timeStr}`
            };
        });

        res.json({ user, reminders, websites });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Send custom message to user
router.post('/users/:chatId/message', async (req, res) => {
    try {
        const { message } = req.body;
        const bot = require('../bot/index');
        await bot.telegram.sendMessage(req.params.chatId, message, { parse_mode: 'HTML' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Add a new reminder for user
router.post('/users/:chatId/reminders', async (req, res) => {
    try {
        const { task, time, bsDate, timeString, recurrence } = req.body;
        const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
        
        let date;
        if (bsDate && timeString) {
            const NepaliDate = require('nepali-date-converter').default;
            const np = new NepaliDate(bsDate); // YYYY-MM-DD
            date = np.toJsDate(); 
            const [hours, minutes] = timeString.split(':');
            date.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        } else {
            date = new Date(time);
        }

        await reminderService.saveReminder(req.params.chatId, task, date, id, recurrence || 'none');
        
        // Format back to Nepali Date for instant response
        const NepaliDate = require('nepali-date-converter').default;
        const npDateStr = new NepaliDate(date).format('DD MMMM YYYY');
        const timeStr = date.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' });

        res.json({ success: true, reminder: { id, chatId: req.params.chatId, task, time: date, formattedTime: `${npDateStr} at ${timeStr}`, recurrence: recurrence || 'none' } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete reminder
router.delete('/reminders/:id', async (req, res) => {
    try {
        await reminderService.deleteReminder(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete website
router.delete('/websites/:foldername', async (req, res) => {
    try {
        const site = await Website.findOne({ foldername: req.params.foldername });
        if (site) {
            await websiteService.deleteWebpage(site.chatId, req.params.foldername);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get dashboard stats
router.get('/stats', async (req, res) => {
    try {
        const users = await User.countDocuments();
        const websites = await Website.countDocuments();
        const reminders = await Reminder.countDocuments();
        res.json({ users, websites, reminders });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
