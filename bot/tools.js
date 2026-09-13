const tools = [
    {
        type: 'function',
        function: {
            name: 'flag_general_question',
            description: 'CALL THIS TOOL IMMEDIATELY if the user asks a general question, tries to chat generally, or asks for information unrelated to managing reminders or websites. This will add a strike to their account.',
            parameters: {
                type: 'object',
                properties: {
                    reason: { type: 'string', description: 'Brief reason why this is flagged as a general question.' }
                },
                required: ['reason']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'schedule_reminder',
            description: 'Schedules a reminder message to be sent to the user at a specific future time.',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'The task or message to remind the user about.' },
                    time: { type: 'string', description: 'The precise future time to send the reminder. MUST be an ISO 8601 string WITH the Nepal timezone offset (+05:45).' },
                    recurrence: { type: 'string', description: 'Optional. How often the reminder repeats: "none", "hourly", "daily", "weekly", or "monthly". Defaults to "none".' }
                },
                required: ['task', 'time']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_reminder',
            description: 'Deletes a scheduled reminder by its ID.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'The ID of the reminder to delete.' }
                },
                required: ['id']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'modify_reminder',
            description: 'Modifies an existing reminder task or time.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'The ID of the reminder to modify.' },
                    task: { type: 'string', description: 'The updated task description.' },
                    time: { type: 'string', description: 'The updated ISO 8601 time with +05:45 offset.' },
                    recurrence: { type: 'string', description: 'Optional. How often the reminder repeats: "none", "hourly", "daily", "weekly", or "monthly". Defaults to "none".' }
                },
                required: ['id', 'task', 'time']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_webpage',
            description: 'Creates an HTML webpage and hosts it on the server.',
            parameters: {
                type: 'object',
                properties: {
                    foldername: { type: 'string', description: 'A short, URL-friendly folder name for the project.' },
                    html: { type: 'string', description: 'The complete HTML source code for the page.' }
                },
                required: ['foldername', 'html']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_webpages',
            description: 'Lists all the webpages/sites currently hosted on the server.',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_webpage',
            description: 'Deletes a webpage that the user has created.',
            parameters: {
                type: 'object',
                properties: {
                    foldername: { type: 'string', description: 'The folder name of the site to delete.' }
                },
                required: ['foldername']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'modify_webpage',
            description: 'Modifies an existing webpage that the user created. Can update HTML or rename the URL/folder.',
            parameters: {
                type: 'object',
                properties: {
                    foldername: { type: 'string', description: 'The CURRENT folder name of the site to modify.' },
                    html: { type: 'string', description: 'Optional. The updated HTML source code for the page.' },
                    new_foldername: { type: 'string', description: 'Optional. A new folder name if the user wants to rename the URL of the website. Must be alphanumeric.' }
                },
                required: ['foldername']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_webpage',
            description: 'Reads and returns the current HTML source code of an existing webpage.',
            parameters: {
                type: 'object',
                properties: {
                    foldername: { type: 'string', description: 'The folder name of the site to read.' }
                },
                required: ['foldername']
            }
        }
    }
];

module.exports = tools;
