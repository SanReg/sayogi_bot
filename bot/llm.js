const OpenAI = require('openai');

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || ''
});

const MODELS_TO_TRY = ['openrouter/free'];

async function generateWithFallback(messages, toolsList) {
    for (let i = 0; i < MODELS_TO_TRY.length; i++) {
        const modelName = MODELS_TO_TRY[i];
        try {
            const options = {
                model: modelName,
                messages: messages,
                temperature: 0.7,
            };
            if (toolsList && toolsList.length > 0) {
                options.tools = toolsList;
                options.tool_choice = "auto";
            }
            return await openai.chat.completions.create(options);
        } catch (err) {
            console.warn(`Model ${modelName} failed. Error:`, err.message);
            if (i === MODELS_TO_TRY.length - 1) throw err;
        }
    }
}

module.exports = { generateWithFallback };
