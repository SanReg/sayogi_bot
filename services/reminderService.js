const schedule = require('node-schedule');
const NepaliDate = require('nepali-date-converter').default;
const Reminder = require('../models/Reminder');

const activeJobs = {};
let botInstance = null;

const initReminders = (bot) => {
    botInstance = bot;
};

function scheduleReminderJob(chatId, task, date, id, recurrence = 'none') {
    if (activeJobs[id]) {
        activeJobs[id].cancel();
    }
    
    let jobOptions = date;
    if (recurrence !== 'none') {
        const timeStr = date.toLocaleTimeString('en-US', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
        const [hh, mm] = timeStr.split(':').map(Number);
        
        let rule = `${mm} ${hh} * * *`; // daily
        if (recurrence === 'hourly') {
            rule = `${mm} * * * *`;
        } else if (recurrence === 'weekly') {
            const dowStr = date.toLocaleDateString('en-US', { timeZone: 'Asia/Kathmandu', weekday: 'short' });
            rule = `${mm} ${hh} * * ${dowStr}`;
        } else if (recurrence === 'monthly') {
            const domStr = date.toLocaleDateString('en-US', { timeZone: 'Asia/Kathmandu', day: 'numeric' });
            rule = `${mm} ${hh} ${domStr} * *`;
        }
        
        jobOptions = { rule, tz: 'Asia/Kathmandu' };
    }
    
    const job = schedule.scheduleJob(jobOptions, function() {
        let msg = `🔔 <b>Reminder:</b>\n${task}`;
        if (recurrence !== 'none') msg += `\n<i>(Repeats ${recurrence})</i>`;
        if (botInstance) {
            botInstance.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(console.error);
        }
        if (recurrence === 'none') {
            delete activeJobs[id];
        }
    });
    if (job) activeJobs[id] = job;
}

async function loadReminders() {
    try {
        const reminders = await Reminder.find();
        let loadedCount = 0;
        reminders.forEach(r => {
            const date = new Date(r.time);
            if (r.recurrence !== 'none' || date.getTime() > Date.now()) {
                scheduleReminderJob(r.chatId, r.task, date, r.id, r.recurrence);
                loadedCount++;
            }
        });
        console.log(`Loaded ${loadedCount} pending reminders from MongoDB.`);
    } catch (error) {
        console.error("Error loading reminders:", error);
    }
}

async function saveReminder(chatId, task, date, id, recurrence = 'none') {
    await Reminder.findOneAndUpdate(
        { id },
        { chatId, task, time: date, recurrence },
        { upsert: true, returnDocument: 'after' }
    );
    scheduleReminderJob(chatId, task, date, id, recurrence);
}

async function deleteReminder(id) {
    if (activeJobs[id]) {
        activeJobs[id].cancel();
        delete activeJobs[id];
    }
    await Reminder.deleteOne({ id });
}

async function getUserRemindersContext(chatId) {
    try {
        const reminders = await Reminder.find({ chatId }).sort({ time: 1 });
        const now = Date.now();
        const active = reminders.filter(r => (r.recurrence && r.recurrence !== 'none') || new Date(r.time).getTime() > now);
        const past = reminders.filter(r => (!r.recurrence || r.recurrence === 'none') && new Date(r.time).getTime() <= now).slice(-15);

        const formatReminder = (r, i) => {
            const d = new Date(r.time);
            const npDate = new NepaliDate(d).format('DD MMMM YYYY');
            const timeStr = d.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' });
            let text = `${i + 1}. [ID: ${r.id}] "${r.task}" (${npDate} at ${timeStr})`;
            if (r.recurrence && r.recurrence !== 'none') text += ` [Repeats: ${r.recurrence}]`;
            return text;
        };

        const activeStr = active.length > 0 ? active.map(formatReminder).join('\n') : "None.";
        const pastStr = past.length > 0 ? past.map(formatReminder).join('\n') : "None.";

        return `ACTIVE REMINDERS SCHEDULED FOR THIS USER:\n${activeStr}\n\nRECENTLY COMPLETED/PAST REMINDERS FOR THIS USER:\n${pastStr}`;
    } catch (e) {
        return "ACTIVE REMINDERS: None.\nPAST REMINDERS: None.";
    }
}

module.exports = {
    initReminders,
    scheduleReminderJob,
    loadReminders,
    saveReminder,
    deleteReminder,
    getUserRemindersContext,
    activeJobs
};
