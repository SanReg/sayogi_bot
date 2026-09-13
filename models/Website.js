const mongoose = require('mongoose');

const websiteSchema = new mongoose.Schema({
    chatId: { type: Number, required: true },
    foldername: { type: String, required: true, unique: true },
    url: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Website', websiteSchema);
