# Telegram Personal Assistant Bot

A personal assistant Telegram bot powered by **Gemini 2.5 Flash** (via `@google/genai`), built with Node.js and Express.

## Features
- **Conversational AI:** Chats with you like a real assistant using Google's Gemini models.
- **Context Aware:** Remembers the last 20 messages of the conversation.
- **Smart Reminders:** Uses Gemini's Tool Calling capabilities to natively understand when you ask it to remind you about something, and schedules it automatically.
- **Persistent Reminders:** Reminders are saved to a local `reminders.json` file. Even if the bot restarts, pending reminders will be re-scheduled on boot.
- **Express Health Check:** Runs an express server on port 3000 to keep the service alive if deployed on platforms like Render or Heroku.

## Setup

1. The dependencies are already installed. If you move this project, run `npm install`.
2. Ensure your `.env` file contains your credentials:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   TELEGRAM_BOT_TOKEN=your_telegram_token
   PORT=3000
   ```
3. Run the bot:
   ```bash
   npm start
   ```

## Usage
Simply message the bot on Telegram.
- *“Hi, who are you?”*
- *“Remind me to drink water in 10 minutes.”*
- *“Schedule a reminder to buy groceries tomorrow at 5 PM.”*

The bot will parse the date natively and set up a Node schedule to ping you back on Telegram at the right time.
