const mongoose = require('mongoose');

const connectDB = async () => {
    const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://devsantoshregmi_db_user:kjOHgbF33Xbp8g61@santoshcluster.7d2oj0l.mongodb.net/tgBot";
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err);
    }
};

module.exports = connectDB;
