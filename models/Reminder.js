const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
    id: String,
    chatId: Number,
    task: String,
    time: Date,
    recurrence: { type: String, enum: ['none', 'hourly', 'daily', 'weekly', 'monthly'], default: 'none' }
});

module.exports = mongoose.model('Reminder', reminderSchema);
