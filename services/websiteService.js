const fs = require('fs');
const path = require('path');
const Website = require('../models/Website');

const User = require('../models/User');

const getPublicDir = () => {
    const publicDir = path.join(__dirname, '..', 'public');
    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
    }
    return publicDir;
};

const getBaseUrl = () => {
    const PORT = process.env.PORT || 3000;
    return process.env.BASE_URL || `http://localhost:${PORT}`;
};

const createWebpage = async (chatId, foldername, html) => {
    const existingSite = await Website.findOne({ foldername });
    if (existingSite && existingSite.chatId !== chatId) {
        throw new Error("Folder name already taken by another user. Please choose a different name.");
    }

    if (!existingSite) {
        const user = await User.findOne({ chatId });
        const currentCount = await Website.countDocuments({ chatId });
        const max = user ? user.maxWebsites : 0;
        
        if (currentCount >= max) {
            throw new Error(`Website limit reached. Your account is allowed to create ${max} websites.`);
        }
    }
    
    const folderPath = path.join(getPublicDir(), foldername);
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
    fs.writeFileSync(path.join(folderPath, 'index.html'), html, 'utf8');
    
    const cleanBaseUrl = getBaseUrl().replace(/\/$/, '');
    const url = `${cleanBaseUrl}/${foldername}/`;
    
    if (!existingSite) {
        await Website.create({ chatId, foldername, url });
    }
    
    return url;
};

const deleteWebpage = async (chatId, foldername) => {
    const existingSite = await Website.findOne({ foldername });
    if (!existingSite || existingSite.chatId !== chatId) {
        throw new Error("Website not found or you don't have permission to delete it.");
    }
    
    const folderPath = path.join(getPublicDir(), foldername);
    if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
    }
    
    await Website.deleteOne({ foldername });
};

const listWebpages = async (chatId) => {
    const websites = await Website.find({ chatId });
    const cleanBaseUrl = getBaseUrl().replace(/\/$/, '');
    return websites.map(w => ({ name: w.foldername, url: `${cleanBaseUrl}/${w.foldername}/` }));
};

const modifyWebpage = async (chatId, currentFoldername, html, newFoldername) => {
    const existingSite = await Website.findOne({ foldername: currentFoldername });
    if (!existingSite || existingSite.chatId !== chatId) {
        throw new Error("Website not found or you don't have permission to modify it.");
    }
    
    let targetFoldername = currentFoldername;
    let url = existingSite.url;
    
    if (newFoldername && newFoldername !== currentFoldername) {
        const checkConflict = await Website.findOne({ foldername: newFoldername });
        if (checkConflict) {
            throw new Error(`The folder name '${newFoldername}' is already taken. Please try another name.`);
        }
        
        const oldFolderPath = path.join(getPublicDir(), currentFoldername);
        const newFolderPath = path.join(getPublicDir(), newFoldername);
        
        if (fs.existsSync(oldFolderPath)) {
            fs.renameSync(oldFolderPath, newFolderPath);
        } else {
            fs.mkdirSync(newFolderPath, { recursive: true });
        }
        
        const cleanBaseUrl = getBaseUrl().replace(/\/$/, '');
        url = `${cleanBaseUrl}/${newFoldername}/`;
        
        existingSite.foldername = newFoldername;
        existingSite.url = url;
        await existingSite.save();
        
        targetFoldername = newFoldername;
    }
    
    if (html) {
        const folderPath = path.join(getPublicDir(), targetFoldername);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        fs.writeFileSync(path.join(folderPath, 'index.html'), html, 'utf8');
    }
    
    return url;
};

const readWebpage = async (chatId, foldername) => {
    const existingSite = await Website.findOne({ foldername });
    if (!existingSite || existingSite.chatId !== chatId) {
        throw new Error("Website not found or you don't have permission to read it.");
    }
    const folderPath = path.join(getPublicDir(), foldername);
    const indexPath = path.join(folderPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        return fs.readFileSync(indexPath, 'utf8');
    }
    throw new Error("HTML file not found on disk.");
};

module.exports = {
    createWebpage,
    deleteWebpage,
    listWebpages,
    modifyWebpage,
    readWebpage
};
