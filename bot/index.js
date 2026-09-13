const { Telegraf } = require('telegraf');
const NepaliDate = require('nepali-date-converter').default;
const User = require('../models/User');
const Reminder = require('../models/Reminder');
const Website = require('../models/Website');
const reminderService = require('../services/reminderService');
const websiteService = require('../services/websiteService');
const tools = require('./tools');
const { generateWithFallback } = require('./llm');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is missing in .env");
    process.exit(1);
}
const bot = new Telegraf(token);

// Memory storage
const chatHistories = {};

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

reminderService.initReminders(bot);

bot.start(async (ctx) => {
    const chatId = ctx.chat.id;
    let userRecord = await User.findOne({ chatId });
    if (!userRecord) {
        userRecord = await User.create({ 
            chatId, 
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
            strikes: 0, 
            isLocked: false,
            maxWebsites: 0
        });
    }

    if (!userRecord.phoneNumber) {
        return ctx.reply("Hello! I am a strict Reminders and Websites Bot.\nTo use my services, I need your phone number for verification. Please share it using the button below:", {
            reply_markup: {
                keyboard: [[{ text: "📲 Share Phone Number", request_contact: true }]],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        });
    }

    ctx.reply("Hello! I am a strict Reminders and Websites Bot. I ONLY handle scheduling reminders and managing websites. Do NOT ask me general questions. If you ask a general question 3 times, your account will be locked.");
});

bot.on('contact', async (ctx) => {
    const chatId = ctx.chat.id;
    const contact = ctx.message.contact;

    if (contact.user_id !== ctx.from.id) {
        return ctx.reply("Please share your own contact.");
    }

    let userRecord = await User.findOne({ chatId });
    if (!userRecord) {
        userRecord = await User.create({ 
            chatId, 
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
            strikes: 0, 
            isLocked: false,
            maxWebsites: 0
        });
    }

    userRecord.phoneNumber = contact.phone_number;
    await userRecord.save();

    ctx.reply("Thank you! Your phone number has been saved.\nI am a strict Reminders and Websites Bot. I ONLY handle scheduling reminders and managing websites. Do NOT ask me general questions.", {
        reply_markup: { remove_keyboard: true }
    });
});

bot.command('reminder', async (ctx) => {
    const chatId = ctx.chat.id;
    const userRecord = await User.findOne({ chatId });
    if (!userRecord) {
        return ctx.reply("I couldn't find your account details. Please type anything to register.");
    }

    const reminders = await Reminder.find({ chatId }).sort({ time: 1 });
    const now = Date.now();
    const active = reminders.filter(r => (r.recurrence && r.recurrence !== 'none') || new Date(r.time).getTime() > now);
    const recurringCount = active.filter(r => r.recurrence && r.recurrence !== 'none').length;

    let msg = `📊 <b>Reminder Limits:</b>\n`;
    msg += `Active: ${active.length} / ${userRecord.maxActiveReminders}\n`;
    msg += `Recurring: ${recurringCount} / ${userRecord.maxRecurringReminders}\n\n`;

    if (active.length === 0) {
        msg += "You have no active reminders.";
        return ctx.reply(msg, { parse_mode: 'HTML' });
    }

    msg += "📅 <b>Your Active Reminders:</b>\n\n";
    active.forEach((r, i) => {
        const d = new Date(r.time);
        const npDate = new NepaliDate(d).format('DD MMMM YYYY');
        const timeStr = d.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' });
        msg += `${i + 1}. "${r.task}"\n   <i>${npDate} at ${timeStr}</i>`;
        if (r.recurrence && r.recurrence !== 'none') msg += ` <b>[Repeats: ${r.recurrence}]</b>`;
        msg += `\n   <code>ID: ${r.id}</code>\n\n`;
    });

    ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('account', async (ctx) => {
    const chatId = ctx.chat.id;
    const userRecord = await User.findOne({ chatId });
    if (!userRecord) {
        return ctx.reply("I couldn't find your account details. Please type anything to register.");
    }

    const name = [userRecord.firstName, userRecord.lastName].filter(Boolean).join(" ");
    let msg = `👤 <b>Account Details</b>\n`;
    msg += `<b>Name:</b> ${name || 'N/A'}\n`;
    msg += `<b>Username:</b> ${userRecord.username ? '@' + userRecord.username : 'N/A'}\n`;
    msg += `<b>Phone:</b> ${userRecord.phoneNumber || 'Not shared'}\n`;
    msg += `<b>Warnings/Strikes:</b> ${userRecord.strikes}/3\n`;
    msg += `<b>Status:</b> ${userRecord.isLocked ? '⛔ LOCKED' : '✅ Active'}\n\n`;

    const reminders = await Reminder.find({ chatId }).sort({ time: 1 });
    const now = Date.now();
    const active = reminders.filter(r => (r.recurrence && r.recurrence !== 'none') || new Date(r.time).getTime() > now);
    const past = reminders.filter(r => (!r.recurrence || r.recurrence === 'none') && new Date(r.time).getTime() <= now);
    const recurringCount = active.filter(r => r.recurrence && r.recurrence !== 'none').length;
    
    const websitesCount = await Website.countDocuments({ chatId });

    msg += `📊 <b>Statistics</b>\n`;
    msg += `Active Reminders: ${active.length} / ${userRecord.maxActiveReminders}\n`;
    msg += `Recurring Reminders: ${recurringCount} / ${userRecord.maxRecurringReminders}\n`;
    msg += `Completed Reminders: ${past.length}\n`;
    msg += `Websites Created: ${websitesCount} / ${userRecord.maxWebsites}\n`;

    ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('websites', async (ctx) => {
    const chatId = ctx.chat.id;
    const websites = await Website.find({ chatId }).sort({ createdAt: -1 });

    if (websites.length === 0) {
        return ctx.reply("You haven't created any websites yet.");
    }

    const PORT = process.env.PORT || 3000;
    const cleanBaseUrl = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

    let msg = "🌐 <b>Your Created Websites:</b>\n\n";
    websites.forEach((w, i) => {
        const date = new NepaliDate(new Date(w.createdAt)).format('DD MMMM YYYY');
        const liveUrl = `${cleanBaseUrl}/${w.foldername}/`;
        msg += `${i + 1}. <b>${w.foldername}</b>\n`;
        msg += `   🔗 <b>URL:</b> ${liveUrl}\n`;
        msg += `   <i>Created: ${date}</i>\n\n`;
    });

    ctx.reply(msg, { parse_mode: 'HTML', disable_web_page_preview: true });
});

bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    let userRecord = await User.findOne({ chatId });
    if (!userRecord) {
        userRecord = await User.create({ 
            chatId, 
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
            strikes: 0, 
            isLocked: false,
            maxWebsites: 0
        });
    } else {
        if (userRecord.username !== ctx.from.username || userRecord.firstName !== ctx.from.first_name || userRecord.lastName !== ctx.from.last_name) {
            userRecord.username = ctx.from.username;
            userRecord.firstName = ctx.from.first_name;
            userRecord.lastName = ctx.from.last_name;
            await userRecord.save();
        }
    }
    
    if (!userRecord.phoneNumber) {
        return ctx.reply("Hello! To continue using my services, I need your phone number for verification. Please share it using the button below:", {
            reply_markup: {
                keyboard: [[{ text: "📲 Share Phone Number", request_contact: true }]],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        });
    }
    
    if (userRecord.isLocked) {
        return ctx.reply("⛔ Your account has been permanently locked for repeatedly asking general questions. I am restricted to handling reminders and websites only.");
    }

    // Fast-fail token saver: if they mention 'website' but not 'reminder', check permissions first
    const lowerText = text.toLowerCase();
    const websitesCount = await Website.countDocuments({ chatId });
    const maxWebsites = userRecord.maxWebsites || 0;

    if (lowerText.includes('website') && !lowerText.includes('reminder')) {
        const isCreationIntent = /(create|build|make|generate|new)\b/i.test(lowerText);
        const isModifyOrDelete = /(edit|update|modify|change|delete|remove|cancel)\b/i.test(lowerText);
        
        // Only fast-fail if they are explicitly trying to create a NEW website and NOT trying to modify/delete one.
        if (isCreationIntent && !isModifyOrDelete) {
            if (websitesCount >= maxWebsites) {
                return ctx.reply(`⛔ <b>Limit Reached</b>\nYou are allowed a maximum of ${maxWebsites} websites. You cannot create any more right now.`, { parse_mode: 'HTML' });
            }
        }
    }

    const allReminders = await Reminder.find({ chatId });
    const maxActive = userRecord.maxActiveReminders || 0;

    if (!chatHistories[chatId]) {
        chatHistories[chatId] = [];
    }

    const userRemindersContext = await reminderService.getUserRemindersContext(chatId);
    
    const activeNow = Date.now();
    const activeRems = allReminders.filter(r => (r.recurrence && r.recurrence !== 'none') || new Date(r.time).getTime() > activeNow);
    const activeCount = activeRems.length;
    const recurringCount = activeRems.filter(r => r.recurrence && r.recurrence !== 'none').length;
    const maxRecurring = userRecord.maxRecurringReminders || 0;

    const userSites = await websiteService.listWebpages(chatId);
    let userSitesStr = userSites.length > 0 
        ? userSites.map(s => `- Folder: ${s.name} (URL: ${s.url})`).join('\n')
        : "None.";

    const dynamicSystemInstruction = `You are a STRICT and UNCOMPROMISING Reminders and Websites Bot.
Your ONLY purpose is to manage reminders and websites for the user.
YOU MUST NOT answer general questions, chat generally, or provide general information (like coding help, trivia, web searches, math, etc.).

CRITICAL RULE:
If the user asks ANYTHING that is not explicitly about managing their reminders or websites, you MUST call the "flag_general_question" tool immediately. 
Do NOT answer their question. Do NOT be helpful outside of your specific purpose. 

When you use the "flag_general_question" tool, the system will warn the user. After 3 strikes, they will be locked out.

IMPORTANT FORMATTING INSTRUCTION: You MUST format your responses beautifully using HTML tags supported by Telegram. Use <b>bold text</b> for emphasis or task names, <i>italic</i> for subtle notes, and <u>underline</u> if needed. NEVER use Markdown (like ** or #). NEVER use asterisks (*) or hyphens (-) for bullet points. When listing reminders or creating lists, ONLY use emojis (like 📅, ⏰, ✨) as bullet points.
IMPORTANT LANGUAGE RULE: Even if the user speaks in Nepali (Devnagari), you MUST respond in either English or Romanized Nepali (e.g., "ma samjauchu hajurlai"). NEVER write responses in the Devnagari script.
IMPORTANT FOR LINKS: When you send a URL, MUST format it as an HTML hyperlink like <a href="...">Click Here</a>. Do NOT put links inside <code> blocks.
CRITICAL JSON RULE: When calling tools that require HTML code (like create_webpage or modify_webpage), you MUST properly escape the HTML string in the JSON arguments. Replace ALL literal newlines with \n and escape all double quotes. Failure to output valid JSON will crash the system!

${userRemindersContext}

WEBSITE USAGE CONTEXT:
- This user has created ${websitesCount} out of their maximum allowed ${maxWebsites} websites.
- EXISTING WEBSITES FOR THIS USER:
${userSitesStr}
- If the user asks to create a NEW website and they have reached their limit (i.e. ${websitesCount} >= ${maxWebsites}), DO NOT call the create_webpage tool. Instead, apologize and tell them they have reached their maximum website limit.
- HOWEVER, if the user asks to edit, update, or modify an EXISTING website, you are FULLY allowed to use the modify_webpage tool regardless of their limit! (Tip: use read_webpage to see current code first if needed).

REMINDER USAGE CONTEXT:
- This user currently has ${activeCount} active reminders out of their maximum allowed ${maxActive}.
- This user currently has ${recurringCount} recurring reminders out of their maximum allowed ${maxRecurring}.
- If the user asks to schedule a reminder and they have reached their limit for either active or recurring reminders, DO NOT call the schedule_reminder tool. Instead, apologize and tell them they have reached their limit.

CRITICAL TIME CONTEXT:
- The current precise Gregorian date and time is: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu', timeZoneName: 'short' })} (Nepal Time, UTC+5:45).
- The EXACT current Nepali date (Bikram Sambat) is: ${new NepaliDate(new Date()).format('DD MMMM YYYY')}. Use this as your reference point for "today".
- When using the schedule_reminder tool, you MUST provide the time in ISO 8601 format WITH the +05:45 offset.
- When using the schedule_reminder tool, the task description MUST be saved in English or Romanized Nepali. NEVER save it in Devnagari.
- Always convert dates to Nepali Calendar (B.S.) when chatting with the user.

Remember: ANY general chatting or general knowledge question = flag_general_question tool.
`;

    chatHistories[chatId].push({ role: 'user', content: text });
    if (chatHistories[chatId].length > 20) chatHistories[chatId] = chatHistories[chatId].slice(-20);

    const messages = [
        { role: 'system', content: dynamicSystemInstruction },
        ...chatHistories[chatId]
    ];

    ctx.sendChatAction('typing');

    let loadingMsgId = null;
    let loadingInterval = null;
    try {
        const isWebsiteKeyword = /(website|webpage|site|app|html|css|js|color|background|button|font|text|header|footer)\b/i.test(lowerText);
        const mentionsExistingSite = userSites.some(s => new RegExp(`\\b${s.name.toLowerCase()}\\b`, 'i').test(lowerText));
        const isReminderKeyword = /(remind|samjau|time|schedule|alarm|alert|delete|remove|cancel)\b/i.test(lowerText);
        
        let stages = ["🤔 <b>Thinking...</b>", "🔍 <b>Analyzing request...</b>", "⚙️ <b>Processing...</b>", "✨ <b>Finalizing...</b>"];
        
        if (isWebsiteKeyword || mentionsExistingSite) {
            stages = [
                "🚀 <b>Initializing workspace...</b>",
                "🔨 <b>Building components...</b>",
                "🎨 <b>Applying styles...</b>",
                "⚙️ <b>Maximizing performance...</b>",
                "🌐 <b>Preparing deployment...</b>"
            ];
        } else if (isReminderKeyword) {
            stages = [
                "📅 <b>Checking calendar...</b>",
                "⏰ <b>Calculating timezones...</b>",
                "⚙️ <b>Syncing schedule...</b>",
                "📝 <b>Saving reminder...</b>"
            ];
        }

        const m = await ctx.reply(stages[0], { parse_mode: 'HTML' });
        loadingMsgId = m.message_id;
        
        let stageIdx = 1;
        loadingInterval = setInterval(() => {
            if (stageIdx < stages.length) {
                ctx.telegram.editMessageText(chatId, loadingMsgId, undefined, stages[stageIdx], { parse_mode: 'HTML' }).catch(() => {});
                stageIdx++;
            }
        }, 2500);
    } catch (e) {
        console.error("Failed to send loading message", e);
    }

    try {
        let response = await generateWithFallback(messages, tools);
        let message = response.choices[0].message;
        
        chatHistories[chatId].push(message);
        
        let accountLockedNow = false;

        let currentMessage = message;
        let loopCount = 0;

        while (currentMessage.tool_calls && currentMessage.tool_calls.length > 0 && loopCount < 5) {
            loopCount++;
            let accountLockedNow = false;

            for (const toolCall of currentMessage.tool_calls) {
                const callName = toolCall.function.name;
                let rawArgs = toolCall.function.arguments || "{}";
                let args = {};
                let toolResult = {};
                try {
                    // Bulletproof sanitization for weak LLMs: fix missing commas even without spaces (e.g. "val""key")
                    rawArgs = rawArgs.replace(/(["}\]])\s*(?=")/g, '$1,');
                    args = JSON.parse(rawArgs);
                } catch (err) {
                    console.error("JSON Parse Error for tool arguments:", err.message);
                    
                    // CRITICAL FIX: If we leave the malformed JSON string in the assistant's tool_call,
                    // OpenRouter's strict API validation will throw a 400 Bad Request on the NEXT followup call!
                    // We must wipe it to an empty object in the history so the API accepts the payload.
                    toolCall.function.arguments = "{}";

                    chatHistories[chatId].push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({ success: false, error: "Failed to parse tool arguments as valid JSON. Ensure strings are properly escaped (e.g. escaping newlines in HTML). Error: " + err.message })
                    });
                    continue;
                }

                if (callName === 'flag_general_question') {
                    userRecord.strikes += 1;
                    if (userRecord.strikes >= 3) {
                        userRecord.isLocked = true;
                        accountLockedNow = true;
                        toolResult = { success: true, message: "User is now locked out." };
                    } else {
                        toolResult = { success: true, message: `Strike ${userRecord.strikes} recorded. 3 strikes will result in a lock.` };
                    }
                    await userRecord.save();
                } else if (callName === 'schedule_reminder' || callName === 'modify_reminder') {
                    const date = new Date(args.time);
                    if (args.recurrence !== 'none' || date.getTime() > Date.now()) {
                        const maxAct = userRecord.maxActiveReminders || 0;
                        const maxRec = userRecord.maxRecurringReminders || 0;
                        const currentReminders = await Reminder.find({ chatId });
                        const otherReminders = callName === 'modify_reminder' ? currentReminders.filter(r => r.id !== args.id) : currentReminders;
                        const aNow = Date.now();
                        const currAct = otherReminders.filter(r => (r.recurrence && r.recurrence !== 'none') || new Date(r.time).getTime() > aNow).length;
                        const currRec = otherReminders.filter(r => r.recurrence && r.recurrence !== 'none').length;
                        
                        let isAllowed = true;
                        let errMsg = '';
                        if (currAct >= maxAct) {
                            isAllowed = false;
                            errMsg = `Cannot schedule: Active reminders limit reached (${maxAct}).`;
                        }
                        if (args.recurrence && args.recurrence !== 'none' && currRec >= maxRec) {
                            isAllowed = false;
                            errMsg = `Cannot schedule: Recurring reminders limit reached (${maxRec}).`;
                        }
                        
                        if (!isAllowed) {
                            toolResult = { success: false, error: errMsg };
                        } else {
                            const remId = callName === 'modify_reminder' ? args.id : generateId();
                            await reminderService.saveReminder(chatId, args.task, date, remId, args.recurrence);
                            toolResult = { success: true, scheduledFor: date.toISOString(), id: remId, recurrence: args.recurrence || 'none' };
                        }
                    } else {
                        toolResult = { success: false, error: "Cannot schedule a non-recurring reminder in the past." };
                    }
                } else if (callName === 'delete_reminder') {
                    await reminderService.deleteReminder(args.id);
                    toolResult = { success: true };
                } else if (callName === 'create_webpage') {
                    try {
                        const url = await websiteService.createWebpage(chatId, args.foldername, args.html);
                        toolResult = { success: true, url: url };
                    } catch (err) {
                        toolResult = { success: false, error: err.message };
                    }
                } else if (callName === 'modify_webpage') {
                    try {
                        const url = await websiteService.modifyWebpage(chatId, args.foldername, args.html, args.new_foldername);
                        toolResult = { success: true, url: url };
                    } catch (err) {
                        toolResult = { success: false, error: err.message };
                    }
                } else if (callName === 'delete_webpage') {
                    try {
                        await websiteService.deleteWebpage(chatId, args.foldername);
                        toolResult = { success: true };
                    } catch (err) {
                        toolResult = { success: false, error: err.message };
                    }
                } else if (callName === 'list_webpages') {
                    try {
                        const userSites = await websiteService.listWebpages(chatId);
                        toolResult = { success: true, sites: userSites };
                    } catch (err) {
                        toolResult = { success: false, error: err.message };
                    }
                } else if (callName === 'read_webpage') {
                    try {
                        const html = await websiteService.readWebpage(chatId, args.foldername);
                        toolResult = { success: true, html: html };
                    } catch (err) {
                        toolResult = { success: false, error: err.message };
                    }
                }
                
                chatHistories[chatId].push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(toolResult)
                });
            }
            
            if (accountLockedNow) {
                return ctx.reply("⛔ <b>ACCOUNT LOCKED</b>\nYou have asked a general question 3 times. Your account is now permanently locked from using this bot.", { parse_mode: 'HTML' });
            }

            const followupMessages = [
                { role: 'system', content: dynamicSystemInstruction },
                ...chatHistories[chatId]
            ];
            
            const followupResponse = await generateWithFallback(followupMessages, tools);
            currentMessage = followupResponse.choices[0].message;
            chatHistories[chatId].push(currentMessage);
        }
        
        if (currentMessage.content && currentMessage.content.trim()) {
            let cleanReply = currentMessage.content.replace(/\*\*/g, '').replace(/#/g, '').replace(/^\s*\*\s+/gm, '📅 ').trim();
            if (cleanReply) {
                try { await ctx.reply(cleanReply, { parse_mode: 'HTML' }); } 
                catch (e) { await ctx.reply(cleanReply); }
            }
        } else if (chatHistories[chatId].some(m => m.role === 'tool')) {
            const lastTool = chatHistories[chatId].filter(m => m.role === 'tool').pop();
            try {
                const res = JSON.parse(lastTool.content);
                if (res.success && res.url) {
                    await ctx.reply(`✨ <b>Done!</b>\nHere is your website URL:\n${res.url}`, { parse_mode: 'HTML' });
                } else if (res.success) {
                    await ctx.reply("✅ Action completed successfully.");
                } else {
                    await ctx.reply("⚠️ Action failed: " + res.error);
                }
            } catch (e) {
                await ctx.reply("✅ Process completed.");
            }
        } else {
            await ctx.reply("I processed your request, but I don't have anything to say.").catch(e => console.error("Reply error:", e));
        }
        
    } catch (error) {
        console.error('Error generating content:', error);
        await ctx.reply("Sorry, I encountered an error while processing your request.").catch(e => console.error("Reply error:", e));
    } finally {
        if (loadingInterval) {
            clearInterval(loadingInterval);
        }
        if (loadingMsgId) {
            ctx.telegram.deleteMessage(chatId, loadingMsgId).catch(() => {});
        }
    }
});

bot.telegram.setMyCommands([
    { command: 'reminder', description: 'Show upcoming reminders' },
    { command: 'account', description: 'View your account details and statistics' },
    { command: 'websites', description: 'Show created websites' }
]).catch(console.error);

module.exports = bot;
