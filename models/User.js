const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    chatId: { type: Number, unique: true },
    username: String,
    firstName: String,
    lastName: String,
    phoneNumber: String,
    strikes: { type: Number, default: 0 },
    isLocked: { type: Boolean, default: false },
    maxWebsites: { type: Number, default: 0 },
    maxActiveReminders: { type: Number, default: 3 },
    maxRecurringReminders: { type: Number, default: 0 }
});

module.exports = mongoose.model('User', userSchema);
