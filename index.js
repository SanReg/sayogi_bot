require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
const NepaliDate = require('nepali-date-converter').default;

const app = express();
app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is missing in .env");
    process.exit(1);
}
const bot = new Telegraf(token);

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = 'gemma-4-31b-it'; // Recommended fast & smart model

// In-memory storage for chat history
const chatHistories = {};
const REMINDERS_FILE = path.join(__dirname, 'reminders.json');
const WEBSITES_FILE = path.join(__dirname, 'websites.json');

// We will define system instructions dynamically per request to ensure accurate time.

const tools = [{
    functionDeclarations: [
        {
            name: 'schedule_reminder',
            description: 'Schedules a reminder message to be sent to the user at a specific future time.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    task: {
                        type: 'STRING',
                        description: 'The task or message to remind the user about.'
                    },
                    time: {
                        type: 'STRING',
                        description: 'The precise future time to send the reminder. MUST be an ISO 8601 string WITH the Nepal timezone offset (+05:45), e.g., "2026-08-30T09:00:00+05:45". Do NOT use "Z" or UTC.'
                    }
                },
                required: ['task', 'time']
            }
        },
        {
            name: 'delete_reminder',
            description: 'Deletes a scheduled reminder by its ID.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    id: { type: 'STRING', description: 'The ID of the reminder to delete.' }
                },
                required: ['id']
            }
        },
        {
            name: 'modify_reminder',
            description: 'Modifies an existing reminder task or time.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    id: { type: 'STRING', description: 'The ID of the reminder to modify.' },
                    task: { type: 'STRING', description: 'The updated task description.' },
                    time: { type: 'STRING', description: 'The updated ISO 8601 time with +05:45 offset.' }
                },
                required: ['id', 'task', 'time']
            }
        },
        {
            name: 'create_webpage',
            description: 'Creates an HTML webpage and hosts it on the server. Use this when the user asks you to create a website, HTML page, or web UI.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    foldername: { type: 'STRING', description: 'A short, URL-friendly folder name for the project (e.g., "my-portfolio", "calculator").' },
                    html: { type: 'STRING', description: 'The complete HTML source code for the page, including inline CSS/JS if needed.' }
                },
                required: ['foldername', 'html']
            }
        },
        {
            name: 'list_webpages',
            description: 'Lists all the webpages/sites currently hosted on the server.',
            parameters: {
                type: 'OBJECT',
                properties: {},
                required: []
            }
        },
        {
            name: 'delete_webpage',
            description: 'Deletes a webpage that the user has created.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    foldername: { type: 'STRING', description: 'The folder name of the site to delete.' }
                },
                required: ['foldername']
            }
        },
        {
            name: 'modify_webpage',
            description: 'Modifies the HTML of an existing webpage that the user created.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    foldername: { type: 'STRING', description: 'The folder name of the site to modify.' },
                    html: { type: 'STRING', description: 'The completely updated HTML source code for the page.' }
                },
                required: ['foldername', 'html']
            }
        }
    ]
}];

const activeJobs = {};

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

// Load existing reminders from file
function loadReminders() {
    if (fs.existsSync(REMINDERS_FILE)) {
        try {
            const data = fs.readFileSync(REMINDERS_FILE, 'utf8');
            let reminders = JSON.parse(data);
            let loadedCount = 0;
            let modified = false;
            reminders.forEach(r => {
                if (!r.id) {
                    r.id = generateId();
                    modified = true;
                }
                const date = new Date(r.time);
                if (date.getTime() > Date.now()) {
                    scheduleReminder(r.chatId, r.task, date, r.id, false);
                    loadedCount++;
                }
            });
            if (modified) fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
            console.log(`Loaded ${loadedCount} pending reminders.`);
        } catch (error) {
            console.error("Error loading reminders:", error);
        }
    }
}

function saveReminder(chatId, task, time, id) {
    let reminders = [];
    if (fs.existsSync(REMINDERS_FILE)) {
        try {
            reminders = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
        } catch (e) { }
    }
    const idx = reminders.findIndex(r => r.id === id);
    if (idx >= 0) {
        reminders[idx] = { id, chatId, task, time: time.toISOString() };
    } else {
        reminders.push({ id, chatId, task, time: time.toISOString() });
    }
    
    // Sort chronologically
    reminders.sort((a, b) => new Date(a.time) - new Date(b.time));
    if (reminders.length > 200) reminders = reminders.slice(-200);
    
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

function deleteReminder(id) {
    if (activeJobs[id]) {
        activeJobs[id].cancel();
        delete activeJobs[id];
    }
    if (fs.existsSync(REMINDERS_FILE)) {
        let reminders = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
        reminders = reminders.filter(r => r.id !== id);
        fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
    }
}

function scheduleReminder(chatId, task, date, id = null, save = true) {
    if (!id) id = generateId();
    if (activeJobs[id]) {
        activeJobs[id].cancel(); // Cancel if updating
    }
    
    const job = schedule.scheduleJob(date, function() {
        bot.telegram.sendMessage(chatId, `🔔 <b>Reminder:</b>\n${task}`, { parse_mode: 'HTML' });
        delete activeJobs[id];
    });
    
    if (job) activeJobs[id] = job;
    
    if (save) {
        saveReminder(chatId, task, date, id);
    }
    return id;
}

function getUserRemindersContext(chatId) {
    if (!fs.existsSync(REMINDERS_FILE)) return "ACTIVE REMINDERS: None.\nPAST REMINDERS: None.";
    try {
        const data = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
        const userReminders = data.filter(r => r.chatId === chatId);
        
        const now = Date.now();
        const active = userReminders.filter(r => new Date(r.time).getTime() > now);
        const past = userReminders.filter(r => new Date(r.time).getTime() <= now).slice(-15); // Last 15 past

        const formatReminder = (r, i) => {
            const d = new Date(r.time);
            const npDate = new NepaliDate(d).format('DD MMMM YYYY');
            const timeStr = d.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' });
            return `${i + 1}. [ID: ${r.id}] "${r.task}" (${npDate} at ${timeStr})`;
        };

        const activeStr = active.length > 0 ? active.map(formatReminder).join('\n') : "None.";
        const pastStr = past.length > 0 ? past.map(formatReminder).join('\n') : "None.";

        return `ACTIVE REMINDERS SCHEDULED FOR THIS USER:\n${activeStr}\n\nRECENTLY COMPLETED/PAST REMINDERS FOR THIS USER:\n${pastStr}`;
    } catch (e) {
        return "ACTIVE REMINDERS: None.\nPAST REMINDERS: None.";
    }
}


bot.start((ctx) => {
    ctx.reply("Hello! I am your personal assistant. I can chat with you, answer questions, and set reminders for you. What can I do for you today?");
});

bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    if (!chatHistories[chatId]) {
        chatHistories[chatId] = [];
    }

    // Add user message to history
    chatHistories[chatId].push({ role: 'user', parts: [{ text: text }] });
    
    // Validate and merge history to safely alternate user/model
    let merged = [];
    for (const msg of chatHistories[chatId]) {
        const role = msg.role === 'function' ? 'user' : msg.role;
        // Deep copy parts to prevent mutating old references
        const parts = msg.parts.map(p => ({ ...p }));
        
        if (merged.length === 0) {
            if (role === 'user') merged.push({ role, parts });
        } else {
            const last = merged[merged.length - 1];
            if (last.role === role) {
                last.parts.push(...parts);
            } else {
                merged.push({ role, parts });
            }
        }
    }

    // Strip dangling function calls or responses
    for (let i = 0; i < merged.length; i++) {
        const msg = merged[i];
        if (msg.role === 'user') {
            const prevHadCall = i > 0 && merged[i-1].role === 'model' && merged[i-1].parts.some(p => p.functionCall);
            if (!prevHadCall) {
                msg.parts = msg.parts.filter(p => !p.functionResponse);
            }
        } else if (msg.role === 'model') {
            const nextHasResp = i < merged.length - 1 && merged[i+1].role === 'user' && merged[i+1].parts.some(p => p.functionResponse);
            if (!nextHasResp) {
                msg.parts = msg.parts.filter(p => !p.functionCall);
            }
        }
    }

    merged = merged.filter(msg => msg.parts.length > 0);

    // Re-merge in case filtering created consecutive roles
    let finalHistory = [];
    for (const msg of merged) {
        if (finalHistory.length === 0) {
            if (msg.role === 'user') finalHistory.push(msg);
        } else {
            const last = finalHistory[finalHistory.length - 1];
            if (last.role === msg.role) {
                last.parts.push(...msg.parts);
            } else {
                finalHistory.push(msg);
            }
        }
    }

    // Keep history manageable (last 20)
    if (finalHistory.length > 20) {
        finalHistory = finalHistory.slice(-20);
        while (finalHistory.length > 0 && finalHistory[0].role !== 'user') {
            finalHistory.shift();
        }
        if (finalHistory.length > 0 && finalHistory[0].role === 'user') {
            finalHistory[0].parts = finalHistory[0].parts.filter(p => !p.functionResponse);
            if (finalHistory[0].parts.length === 0) {
                finalHistory.shift();
                if (finalHistory.length > 0 && finalHistory[0].role === 'model') finalHistory.shift();
            }
        }
    }
    chatHistories[chatId] = finalHistory;

    // Send typing action
    ctx.sendChatAction('typing');

    const userRemindersContext = getUserRemindersContext(chatId);

    const dynamicSystemInstruction = `You are a helpful and highly capable personal assistant Telegram Bot.
Your goal is to assist the user with their daily tasks, answer questions, and schedule reminders.
You are powered by Gemini.

IMPORTANT FORMATTING INSTRUCTION: You MUST format your responses beautifully using HTML tags supported by Telegram. Use <b>bold text</b> for emphasis or task names, <i>italic</i> for subtle notes, and <u>underline</u> if needed. NEVER use Markdown (like ** or #). NEVER use asterisks (*) or hyphens (-) for bullet points. When listing reminders or creating lists, ONLY use emojis (like 📅, ⏰, ✨) as bullet points.
IMPORTANT FOR LINKS: When you send a URL (like a generated webpage link), you MUST format it as an HTML hyperlink like \`<a href="https://example.com/">Click Here</a>\` or just raw text. Do NOT put links inside \`<code>\` blocks or backticks, as that makes them unclickable in Telegram.

When the user asks you to remind them of something, use the schedule_reminder tool.
When the user asks you to modify/change an existing reminder, use the modify_reminder tool.
When the user asks you to cancel/delete a reminder, use the delete_reminder tool.
When the user asks you to create an HTML page, website, or web app, use the create_webpage tool and give them the generated link.
When the user asks to see all sites/webpages they have created, use the list_webpages tool and MAKE SURE to include the clickable link for each website in your response.
When the user asks to delete or remove a website they created, use the delete_webpage tool.
When the user asks to modify, update, or change an existing website they created, use the modify_webpage tool.

${userRemindersContext}
(Use this information to confidently tell the user what active reminders they have coming up, OR what past reminders they've recently completed, if they ask.)

CRITICAL TIME CONTEXT:
- The current precise Gregorian date and time is: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu', timeZoneName: 'short' })} (Nepal Time, UTC+5:45).
- The EXACT current Nepali date (Bikram Sambat) is: ${new NepaliDate(new Date()).format('DD MMMM YYYY')}. Use this as your reference point for "today".
- When using the schedule_reminder tool, you MUST provide the time in ISO 8601 format WITH the +05:45 offset (e.g. "YYYY-MM-DDTHH:mm:ss+05:45"). Do NOT use "Z" or UTC.
- All relative time references like "bholi bihana" (tomorrow morning) or "aaja rati" (tonight) must be calculated based on this current Nepal Time and Date.
- The user may write in Nepali language (Romanized or Devanagari). You must understand and reply appropriately (you can reply in English unless they ask for Nepali).
- The user may provide dates in the Nepali calendar (Bikram Sambat / B.S.). Accurately convert B.S. inputs to the corresponding Gregorian date before calling the schedule_reminder tool.
- VERY IMPORTANT: When you talk to the user and mention any dates or times, ALWAYS convert the date to the Nepali Calendar (B.S.) and the time to Nepali Time WITHOUT seconds (e.g. "3:45 PM"). Do not show Gregorian (A.D.) dates. 
- NATURAL DATES: If a reminder is scheduled for the same date as today, simply say "today at [time]". If it's scheduled for tomorrow, say "tomorrow at [time]". Only use the full Nepali Date (e.g. "15 Bhadra 2083") for dates further in the future or past.

Be concise, friendly, and act like a real personal assistant.
`;

    try {
        let response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: chatHistories[chatId],
            config: {
                systemInstruction: dynamicSystemInstruction,
                tools: tools,
                temperature: 0.7,
            }
        });

        let handledTool = false;
        
        // Handle tool calls
        if (response.functionCalls && response.functionCalls.length > 0) {
            // Push the exact model turn into history (preserves thought_signature, text, etc)
            if (response.candidates && response.candidates[0] && response.candidates[0].content) {
                chatHistories[chatId].push(response.candidates[0].content);
            }
            
            let functionResponseParts = [];

            for (const call of response.functionCalls) {
                if (call.name === 'schedule_reminder') {
                    const args = call.args;
                    const date = new Date(args.time);
                    
                    if (date.getTime() > Date.now()) {
                        const id = scheduleReminder(chatId, args.task, date, null, true);
                        functionResponseParts.push({ functionResponse: { name: call.name, response: { success: true, scheduledFor: date.toISOString(), id: id } } });
                    } else {
                        functionResponseParts.push({ functionResponse: { name: call.name, response: { success: false, error: "Cannot schedule in the past." } } });
                    }
                    handledTool = true;
                } else if (call.name === 'delete_reminder') {
                    const args = call.args;
                    deleteReminder(args.id);
                    functionResponseParts.push({ functionResponse: { name: call.name, response: { success: true } } });
                    handledTool = true;
                } else if (call.name === 'modify_reminder') {
                    const args = call.args;
                    const date = new Date(args.time);
                    if (date.getTime() > Date.now()) {
                        scheduleReminder(chatId, args.task, date, args.id, true);
                        functionResponseParts.push({ functionResponse: { name: call.name, response: { success: true, scheduledFor: date.toISOString() } } });
                    } else {
                        functionResponseParts.push({ functionResponse: { name: call.name, response: { success: false, error: "Cannot schedule in the past." } } });
                    }
                    handledTool = true;
                } else if (call.name === 'create_webpage' || call.name === 'modify_webpage') {
                    const args = call.args;
                    try {
                        let websites = [];
                        if (fs.existsSync(WEBSITES_FILE)) {
                            try { websites = JSON.parse(fs.readFileSync(WEBSITES_FILE, 'utf8')); } catch(e){}
                        }
                        
                        const existingSite = websites.find(w => w.foldername === args.foldername);
                        if (existingSite && existingSite.chatId !== chatId) {
                            throw new Error("Folder name already taken by another user. Please choose a different name.");
                        }

                        const folderPath = path.join(publicDir, args.foldername);
                        if (!fs.existsSync(folderPath)) {
                            fs.mkdirSync(folderPath, { recursive: true });
                        }
                        fs.writeFileSync(path.join(folderPath, 'index.html'), args.html, 'utf8');
                        
                        const cleanBaseUrl = BASE_URL.replace(/\/$/, '');
                        const url = `${cleanBaseUrl}/${args.foldername}/`;
                        
                        websites = websites.filter(w => w.foldername !== args.foldername);
                        websites.push({ chatId, foldername: args.foldername, url });
                        fs.writeFileSync(WEBSITES_FILE, JSON.stringify(websites, null, 2));

                        functionResponseParts.push({ functionResponse: { name: call.name, response: { success: true, url: url } } });
                    } catch (err) {
                        functionResponseParts.push({ functionResponse: { name: call.name, response: { success: false, error: err.message } } });
                    }
                    handledTool = true;
                } else if (call.name === 'delete_webpage') {
                    const args = call.args;
                    try {
                        let websites = [];
                        if (fs.existsSync(WEBSITES_FILE)) {
                            try { websites = JSON.parse(fs.readFileSync(WEBSITES_FILE, 'utf8')); } catch(e){}
                        }
                        const existingSite = websites.find(w => w.foldername === args.foldername);
                        if (!existingSite || existingSite.chatId !== chatId) {
                            throw new Error("Website not found or you don't have permission to delete it.");
                        }
                        
                        const folderPath = path.join(publicDir, args.foldername);
                        if (fs.existsSync(folderPath)) {
                            fs.rmSync(folderPath, { recursive: true, force: true });
                        }
                        
                        websites = websites.filter(w => w.foldername !== args.foldername);
                        fs.writeFileSync(WEBSITES_FILE, JSON.stringify(websites, null, 2));
                        
                        functionResponseParts.push({ functionResponse: { name: call.name, response: { success: true } } });
                    } catch (err) {
                        functionResponseParts.push({ functionResponse: { name: call.name, response: { success: false, error: err.message } } });
                    }
                    handledTool = true;
                } else if (call.name === 'list_webpages') {
                    try {
                        let userSites = [];
                        if (fs.existsSync(WEBSITES_FILE)) {
                            const websites = JSON.parse(fs.readFileSync(WEBSITES_FILE, 'utf8'));
                            userSites = websites.filter(w => w.chatId === chatId).map(w => ({
                                name: w.foldername,
                                url: w.url
                            }));
                        }
                        functionResponseParts.push({ functionResponse: { name: call.name, response: { success: true, sites: userSites } } });
                    } catch (err) {
                        functionResponseParts.push({ functionResponse: { name: call.name, response: { success: false, error: err.message } } });
                    }
                    handledTool = true;
                }
            }
            
            // Push all function responses in one turn. In GenAI SDK, function responses belong to the 'user' role.
            chatHistories[chatId].push({ role: 'user', parts: functionResponseParts });
            
            // Get the AI's natural language confirmation
            let followupResponse;
            try {
                followupResponse = await ai.models.generateContent({
                    model: MODEL_NAME,
                    contents: chatHistories[chatId],
                    config: {
                        systemInstruction: dynamicSystemInstruction,
                        temperature: 0.7,
                    }
                });
            } catch (e) {
                // If API rejects the history structure, pop the function call & response to prevent permanent corruption
                chatHistories[chatId].pop();
                chatHistories[chatId].pop();
                throw e; // rethrow to be caught by main error handler
            }
            
            const finalReply = followupResponse.text;
            if (finalReply) {
                // Strip markdown bold/headers and accidental asterisk bullets
                let cleanReply = finalReply.replace(/\*\*/g, '').replace(/#/g, '').replace(/^\s*\*\s+/gm, '📅 ');
                try {
                    await ctx.reply(cleanReply, { parse_mode: 'HTML' });
                } catch (e) {
                    await ctx.reply(cleanReply); // fallback to plain text if HTML fails
                }
                chatHistories[chatId].push({ role: 'model', parts: [{ text: finalReply }] });
            }
        } else if (response.text) {
            let reply = response.text;
            let cleanReply = reply.replace(/\*\*/g, '').replace(/#/g, '').replace(/^\s*\*\s+/gm, '📅 ');
            try {
                await ctx.reply(cleanReply, { parse_mode: 'HTML' });
            } catch (e) {
                await ctx.reply(cleanReply);
            }
            chatHistories[chatId].push({ role: 'model', parts: [{ text: reply }] });
        } else {
            await ctx.reply("I processed your request, but I don't have anything to say.").catch(e => console.error("Reply error:", e));
        }
        
    } catch (error) {
        console.error('Error generating content:', error);
        await ctx.reply("Sorry, I encountered an error while processing your request.").catch(e => console.error("Reply error:", e));
    }
});

// Load persisted reminders on boot
loadReminders();

// Start the bot
bot.telegram.setMyCommands([
    { command: 'reminder', description: 'Show upcoming reminders' },
    { command: 'websites', description: 'Show created websites' }
]).then(() => {
    console.log('Bot commands menu updated.');
}).catch(console.error);

const startBot = () => {
    bot.launch().then(() => {
        console.log('Bot is polling for messages...');
    }).catch(err => {
        console.error("Failed to launch bot:", err.message);
        console.log("Retrying in 5 seconds...");
        setTimeout(startBot, 5000);
    });
};
startBot();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Express server for health check and serving generated webpages
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

app.use(express.static('public'));

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

app.listen(PORT, () => {
    console.log(`Express Server is running on port ${PORT}`);
    console.log(`Webpages will be served at ${BASE_URL}`);
});
