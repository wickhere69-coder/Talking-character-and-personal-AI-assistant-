import { IAIProvider } from './IAIProvider';
import { AgentMessage, ToolDefinition, AgentConfig, ProviderResponse } from '../types';

export class FallbackLocalProvider implements IAIProvider {
  getName(): string {
    return 'local_fallback';
  }

  async isAvailable(): Promise<boolean> {
    return true; // Always available out of the box
  }

  async getModelInfo(): Promise<{ name: string; available: boolean; details?: string }> {
    return {
      name: 'Fast Local Engine',
      available: true,
      details: 'Instantaneous response (< 0.1s) with full tool execution'
    };
  }

  async generateResponse(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig
  ): Promise<ProviderResponse> {
    // Find last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const userText = (lastUserMsg?.content || '').trim();
    const lower = userText.toLowerCase();

    // Check if we just received tool execution results
    const lastToolMsg = messages[messages.length - 1];
    if (lastToolMsg && lastToolMsg.role === 'tool' && lastToolMsg.toolResult) {
      const res = lastToolMsg.toolResult;
      if (res.success) {
        if (typeof res.data === 'string' && res.data.length > 0) {
          // Keep response concise for speech synthesis
          const preview = res.data.length > 300 ? res.data.substring(0, 300) + '...' : res.data;
          return {
            content: `${res.message} Here is what I found:\n${preview}`
          };
        }
        return {
          content: `${res.message}`
        };
      } else {
        return {
          content: `I wasn't able to complete that web lookup right now, but I can help you with your workspace files, system resources, or tasks!`
        };
      }
    }

    // ── Intent Matching & Tool Dispatching ──

    // 1. Remember fact / preference
    // e.g. "remember that my favorite language is Python" or "remember that this project uses React"
    const rememberMatch = userText.match(/remember(?:\s+that)?\s+(.+)/i);
    if (rememberMatch) {
      const fact = rememberMatch[1].trim();
      let key = 'user_fact';
      if (fact.includes('favorite')) key = 'favorite';
      else if (fact.includes('name is')) key = 'name';
      else if (fact.includes('project')) key = 'project_info';

      return {
        content: `I'll remember that for you.`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'remember_info',
            arguments: { key, value: fact, category: 'fact' }
          }
        ]
      };
    }

    // 2. Name introduction: "My name is Alex"
    const nameMatch = userText.match(/(?:my name is|i am|i'm called)\s+([a-zA-Z]+)/i);
    if (nameMatch && !lower.includes('what')) {
      const name = nameMatch[1].trim();
      return {
        content: `Nice to meet you, ${name}! I'll remember your name.`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'remember_info',
            arguments: { key: 'user_name', value: name, category: 'preference' }
          }
        ]
      };
    }

    // 3. Asking for remembered info
    // "what is my name", "what is my favorite...", "what did i tell you..."
    if (lower.includes('what is my name') || lower.includes("what's my name")) {
      return {
        content: `Checking my memory for your name...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'recall_info',
            arguments: { query: 'name' }
          }
        ]
      };
    }
    if (lower.includes('favorite') && (lower.includes('what') || lower.includes('which'))) {
      return {
        content: `Checking my memory for your favorites...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'recall_info',
            arguments: { query: 'favorite' }
          }
        ]
      };
    }
    if (lower.includes('what did i tell you') || lower.includes('what do you remember') || lower.includes('check memory')) {
      return {
        content: `Checking my memory storage for what you shared...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'recall_info',
            arguments: { query: userText }
          }
        ]
      };
    }

    // 4. File Operations
    // "list files in my project", "show files", "list directory"
    if (lower.includes('list file') || lower.includes('show files') || lower.includes('view files') || lower.includes('list directory') || lower.includes('what files are')) {
      return {
        content: `I'll inspect the project directory.`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'list_files',
            arguments: { directory: '.', recursive: false }
          }
        ]
      };
    }

    // "search files for [query]" or "find files called [query]"
    const searchFileMatch = userText.match(/(?:search|find)\s+(?:files?|for)\s+(?:called\s+)?["']?([^"'\s]+)["']?/i);
    if (searchFileMatch && !lower.includes('web') && !lower.includes('google')) {
      const query = searchFileMatch[1].trim();
      return {
        content: `Searching project files for "${query}"...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'search_files',
            arguments: { query }
          }
        ]
      };
    }

    // "read file [path]" or "read [file.ext]" or "read my readme" or "explain package.json"
    const readMatch = userText.match(/read(?:\s+file)?\s+([a-zA-Z0-9_\-\.\/\\]+)/i);
    if (readMatch) {
      const filePath = readMatch[1].trim();
      return {
        content: `Reading ${filePath}...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'read_document',
            arguments: { filePath }
          }
        ]
      };
    }
    if (lower.includes('read my readme') || lower.includes('explain readme')) {
      return {
        content: `Reading your README document...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'read_document',
            arguments: { filePath: 'README.md' }
          }
        ]
      };
    }
    if (lower.includes('package.json') && (lower.includes('read') || lower.includes('what dependencies') || lower.includes('explain'))) {
      return {
        content: `Reading package.json dependencies...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'read_document',
            arguments: { filePath: 'package.json' }
          }
        ]
      };
    }

    // "create file [name] with [content]"
    const createFileMatch = userText.match(/create(?:\s+a)?\s+(?:text\s+)?file\s+(?:called\s+|named\s+)?([a-zA-Z0-9_\-\.]+)(?:\s+with\s+(.+))?/i);
    if (createFileMatch) {
      const fileName = createFileMatch[1].trim();
      const content = createFileMatch[2] ? createFileMatch[2].trim() : 'Created by AI Assistant';
      return {
        content: `Creating ${fileName}...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'create_file',
            arguments: { filePath: fileName, content }
          }
        ]
      };
    }

    // "delete file [path]" (Destructive!)
    const deleteMatch = userText.match(/delete(?:\s+file)?\s+([a-zA-Z0-9_\-\.]+)/i);
    if (deleteMatch) {
      const fileName = deleteMatch[1].trim();
      return {
        content: `Requesting deletion for ${fileName}...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'delete_file',
            arguments: { filePath: fileName }
          }
        ]
      };
    }

    // 5. OS & Computer Tools
    // "check system resources", "system info", "cpu ram", "check resources"
    if (lower.includes('system resource') || lower.includes('check resource') || lower.includes('cpu') || lower.includes('ram') || lower.includes('memory usage')) {
      return {
        content: `Checking system resources...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'check_resources',
            arguments: {}
          }
        ]
      };
    }

    if (lower.includes('system info') || lower.includes('about this computer') || lower.includes('os version') || lower.includes('specs')) {
      return {
        content: `Fetching system information...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'get_system_info',
            arguments: {}
          }
        ]
      };
    }

    // "open project folder" or "open folder [path]"
    if (lower.includes('open') && (lower.includes('folder') || lower.includes('directory') || lower.includes('explorer'))) {
      const folderMatch = userText.match(/open(?:\s+(?:my|the))?\s+folder(?:\s+called|\s+named)?\s*(.*)/i);
      const folderPath = folderMatch && folderMatch[1] ? folderMatch[1].trim() : '.';
      return {
        content: `Opening the folder...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'open_folder',
            arguments: { folderPath: folderPath || '.' }
          }
        ]
      };
    }

    // "open application [app]" / "open calculator" / "open notepad"
    if (lower.includes('open calculator') || lower.includes('launch calculator')) {
      return {
        content: `Launching Calculator...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'open_application',
            arguments: { appName: 'calc' }
          }
        ]
      };
    }
    if (lower.includes('open notepad') || lower.includes('launch notepad')) {
      return {
        content: `Opening Notepad...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'open_application',
            arguments: { appName: 'notepad' }
          }
        ]
      };
    }

    // 6. Productivity Tools
    // "add task [task]", "create task", "add to my tasks"
    const addTaskMatch = userText.match(/(?:add|create)\s+(?:a\s+)?task(?:\s+to|\s+called|\s*:)?\s+(.+)/i);
    if (addTaskMatch) {
      const task = addTaskMatch[1].trim();
      return {
        content: `Adding "${task}" to your tasks.`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'add_task',
            arguments: { title: task }
          }
        ]
      };
    }

    if (lower.includes('list task') || lower.includes('show task') || lower.includes('my tasks') || lower.includes('what are my tasks') || lower.includes('to do')) {
      return {
        content: `Here are your current tasks.`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'list_tasks',
            arguments: {}
          }
        ]
      };
    }

    // "add note [title]: [content]" or "create note called [title]"
    const addNoteMatch = userText.match(/(?:add|create)\s+(?:a\s+)?note(?:\s+called|\s+named|\s*:)?\s+([^\s:]+)(?:\s*[:\-]\s*(.+))?/i);
    if (addNoteMatch) {
      const title = addNoteMatch[1].trim();
      const content = addNoteMatch[2] ? addNoteMatch[2].trim() : title;
      return {
        content: `Creating note "${title}"...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'add_note',
            arguments: { title, content }
          }
        ]
      };
    }

    if (lower.includes('list note') || lower.includes('show note') || lower.includes('my notes') || lower.includes('what notes')) {
      return {
        content: `Retrieving your notes...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'list_notes',
            arguments: {}
          }
        ]
      };
    }

    // 7. Free Web Search
    // "search web for [query]" or "search the web for [query]"
    const webMatch = userText.match(/search(?:\s+the)?\s+web\s+(?:for\s+)?(.+)/i);
    if (webMatch) {
      const query = webMatch[1].trim();
      return {
        content: `Searching the web for "${query}"...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'web_search',
            arguments: { query }
          }
        ]
      };
    }

    // ── 8. System Time & Date ──
    if (lower.includes('what time') || lower.includes("what's the time") || lower.includes('current time')) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return { content: `It is currently ${timeStr}.` };
    }

    if (lower.includes('what date') || lower.includes("what's the date") || lower.includes('today date') || lower.includes("today's date") || lower.includes('what day')) {
      const now = new Date();
      const dateStr = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      return { content: `Today is ${dateStr}.` };
    }

    // ── 9. Greetings, Identity & Personality ──
    if (/^(hi|hello|hey|greetings|howdy|good morning|good afternoon|good evening)\b/i.test(lower)) {
      const greetings = [
        "Hello! I am right here and ready to assist you. How can I help you today?",
        "Hey there! Great to see you in the studio. What shall we work on?",
        "Hello! I am listening and ready to manage files, tasks, or answer your questions."
      ];
      return { content: greetings[Math.floor(Math.random() * greetings.length)] };
    }

    if (lower.includes('how are you') || lower.includes("how's it going") || lower.includes('how do you feel')) {
      return {
        content: `I'm doing fantastic, running at full speed and ready to assist! How are your projects going today?`
      };
    }

    if (lower.includes('what can you do') || lower.includes('who are you') || lower.includes('help') || lower.includes('capabilities')) {
      return {
        content: `I am your AI Personal Assistant! I can manage your local files, check CPU and RAM resources, track tasks and notes, remember facts, search the web, and speak with real-time lip sync using your studio voice packs.`
      };
    }

    if (lower.includes('thank') || lower.includes('thanks') || lower.includes('appreciate')) {
      return {
        content: `You're very welcome! Let me know whenever you need anything else.`
      };
    }

    if (lower.includes('joke') || lower.includes('funny')) {
      const jokes = [
        "Why do programmers prefer dark mode? Because light attracts bugs!",
        "There are 10 types of people in the world: those who understand binary, and those who don't.",
        "Why was the JavaScript developer sad? Because they didn't Node how to Express themselves!"
      ];
      return { content: jokes[Math.floor(Math.random() * jokes.length)] };
    }

    // ── 10. Built-in Core Knowledge Base (Instant Answers <0.05s) ──
    const knowledgeBase: Record<string, string> = {
      'photosynthesis': 'Photosynthesis is the process by which green plants and organisms transform light energy into chemical energy in the form of glucose and oxygen.',
      'artificial intelligence': 'Artificial intelligence refers to machines designed to mimic human cognitive functions like learning, reasoning, and problem solving.',
      'machine learning': 'Machine learning is an AI domain where algorithms learn statistical patterns directly from data rather than following hand-coded rules.',
      'deep learning': 'Deep learning uses layered neural networks modeled after the human brain to understand images, audio, and language.',
      'react': 'React is a popular component-based UI library developed by Meta for building responsive modern web applications.',
      'typescript': 'TypeScript adds static type definitions to JavaScript, catching bugs early during development and improving code reliability.',
      'javascript': 'JavaScript is the high-level, dynamic programming language that powers modern interactive websites and server runtimes.',
      'python': 'Python is an interpreted, high-level programming language known for readable syntax and vast data science and AI libraries.',
      'node': 'Node.js is an open-source, cross-platform JavaScript runtime environment that executes JavaScript code outside a web browser.',
      'three.js': 'Three.js is a 3D graphics library for JavaScript that allows rendering interactive 3D WebGL scenes directly in the browser.',
      'quantum computing': 'Quantum computing harnesses quantum physics, using qubits that can exist in multiple states simultaneously to solve complex calculations at incredible speed.',
      'recursion': 'Recursion is a programming technique where a function calls itself to solve smaller sub-problems until reaching a base condition.',
      'database': 'A database is an organized collection of data stored and accessed electronically, enabling rapid querying and secure transactions.',
      'speed of light': 'The speed of light in vacuum is approximately 299,792 kilometers per second, or about 186,282 miles per second.',
      'speed of sound': 'The speed of sound in dry air at room temperature is approximately 343 meters per second.',
      'gravity': 'Gravity is the natural force of attraction between masses, holding planets in orbit and keeping our feet grounded on Earth.',
      'capital of france': 'The capital of France is Paris.',
      'capital of germany': 'The capital of Germany is Berlin.',
      'capital of japan': 'The capital of Japan is Tokyo.',
      'capital of the united states': 'The capital of the United States is Washington, D.C.',
      'capital of united kingdom': 'The capital of the United Kingdom is London.',
      'sky blue': 'The sky appears blue due to Rayleigh scattering, where Earth’s atmosphere scatters shorter blue wavelengths of sunlight more than red wavelengths.',
      'dna': 'DNA, or deoxyribonucleic acid, is the molecule that carries genetic instructions for development and functioning in all living organisms.'
    };

    for (const [topic, explanation] of Object.entries(knowledgeBase)) {
      if (lower.includes(topic)) {
        return { content: explanation };
      }
    }

    // ── 11. Instant Math Evaluation ──
    const mathMatch = userText.match(/^(?:what is|calculate|compute)?\s*([\d\.\s\+\-\*\/\(\)]+)\s*\??$/i);
    if (mathMatch && /[\+\-\*\/]/.test(mathMatch[1])) {
      try {
        const sanitized = mathMatch[1].replace(/[^0-9\+\-\*\/\.\(\)\s]/g, '');
        // Safe evaluation of simple arithmetic
        const result = Function(`'use strict'; return (${sanitized})`)();
        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
          return { content: `The answer is ${Number(result.toFixed(4))}.` };
        }
      } catch {}
    }

    // ── 12. Weather Prediction & Forecast ──
    const weatherTriggers = ['weather in', 'weather for', 'forecast for', 'forecast in', 'predict weather', 'predict the weather', 'temperature in', 'temperature of', 'rain in', 'snow in', 'weather tomorrow', 'weather today', 'weather'];
    if (weatherTriggers.some(t => lower.includes(t)) && (lower.includes('weather') || lower.includes('forecast') || lower.includes('temperature') || lower.includes('rain') || lower.includes('snow') || lower.includes('predict'))) {
      let location = userText
        .replace(/.*(?:weather\s+(?:in|for|of|at)?|forecast\s+(?:in|for|of|at)?|temperature\s+(?:in|for|of|at)?|predict\s+(?:the\s+)?weather\s+(?:in|for|of|at)?)/i, '')
        .replace(/(?:today|tomorrow|this week|next week|\?|\.|\!)/gi, '')
        .trim();

      if (!location) {
        location = 'New York';
      }

      return {
        content: `Checking and predicting the weather forecast for ${location}...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'predict_weather',
            arguments: { location, days: 3 }
          }
        ]
      };
    }

    // ── 13. Real-Time Web Search for Current Information ──
    const searchTriggers = [
      'search web', 'google', 'look up', 'search online', 'browse',
      'who is', "who's", 'what is the latest', 'what is current', 'news about',
      'president of', 'prime minister', 'latest about', 'tell me about',
      'news', 'current events', 'recent events', 'explain how', 'what happened',
      'breakthrough', 'who won'
    ];
    if (searchTriggers.some((trigger) => lower.includes(trigger))) {
      const query = userText
        .replace(/search(?:\s+the)?\s+web\s+(?:for\s+)?/i, '')
        .replace(/google\s+/i, '')
        .replace(/look\s+up\s+/i, '')
        .trim();
      return {
        content: `Searching the live web for "${query || userText}"...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'web_search',
            arguments: { query: query || userText }
          }
        ]
      };
    }

    // ── 13. Smart Direct Conversational Response ──
    return {
      content: `I'm right here! You asked: "${userText}". I'm ready to answer your questions, explore any topic, search the live web, or manage tasks. What would you like to explore next?`
    };
  }
}
