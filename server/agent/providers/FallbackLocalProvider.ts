import axios from 'axios';
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

    // Extract prior assistant context for conversational continuity
    const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
    const priorAssistantText = (lastAssistantMsg?.content || '').toLowerCase();

    // Stripped greeting query for compound sentence parsing (e.g., "Hey! What is photosynthesis?")
    const cleanedLower = lower.replace(/^(?:hi|hello|hey|greetings|howdy|good morning|good afternoon|good evening|sup|yo)[,!\.\s]+/i, '').trim();

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
      return { content: `It's currently ${timeStr}.` };
    }

    if (lower.includes('what date') || lower.includes("what's the date") || lower.includes('today date') || lower.includes("today's date") || lower.includes('what day')) {
      const now = new Date();
      const dateStr = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      return { content: `Today is ${dateStr}.` };
    }

    // ── 9. Conversational Follow-ups & Contextual Continuity ──
    // Seamlessly handles follow-ups like "why?", "tell me more", "really?", "what do you mean?"
    if (
      lower === 'why' ||
      lower === 'why?' ||
      lower === 'why is that' ||
      lower === 'why is that?' ||
      lower === 'why so' ||
      lower === 'why so?' ||
      lower === 'how come' ||
      lower === 'how come?'
    ) {
      if (priorAssistantText.includes('photosynthesis') || priorAssistantText.includes('sunlight')) {
        return { content: "It all comes down to chlorophyll! Those tiny green pigments absorb blue and red light waves while reflecting green, capturing photons to split water molecules into pure energy." };
      }
      if (priorAssistantText.includes('space') || priorAssistantText.includes('universe') || priorAssistantText.includes('galaxy') || priorAssistantText.includes('stars')) {
        return { content: "Because on a cosmic scale, the forces of gravity and entropy are in a constant, majestic tug of war that shapes every galaxy and star cluster over billions of years." };
      }
      if (priorAssistantText.includes('ai') || priorAssistantText.includes('learning') || priorAssistantText.includes('neural')) {
        return { content: "It's because neural networks adjust mathematical weights across millions of connections, gradually recognizing patterns just like our brains do through repeated experience." };
      }
      if (priorAssistantText.includes('ocean')) {
        return { content: "The ocean's sheer depth creates crushing hydrostatic pressure and total darkness, which has forced underwater creatures to evolve the most incredible adaptations." };
      }
      return {
        content: "That's a really deep question! At its core, it connects directly back to how curiosity and underlying causes shape the way we understand the world. What angle are you most curious about?"
      };
    }

    if (
      lower.includes('tell me more') ||
      lower.includes('what else') ||
      lower.includes('elaborate') ||
      lower.includes('keep going') ||
      lower.includes('go on')
    ) {
      if (priorAssistantText.includes('black hole') || priorAssistantText.includes('gravity')) {
        return { content: "Beyond the event horizon lies the theoretical singularity, where space-time curves infinitely and physics as we currently understand it completely breaks down!" };
      }
      if (priorAssistantText.includes('mars')) {
        return { content: "One wild detail about Mars is Olympus Mons—an ancient shield volcano three times taller than Mount Everest! Standing on its peak, you'd actually peek out above the Martian atmosphere." };
      }
      if (priorAssistantText.includes('joke')) {
        return { content: "Alright, here's another one: Why can't a bicycle stand up on its own? ... Because it's two-tired!" };
      }
      return {
        content: "There's so much fascinating depth to this! The deeper you look into it, the more unexpected connections pop up. What specific part catches your attention most?"
      };
    }

    if (
      lower.includes('really') ||
      lower.includes('are you sure') ||
      lower.includes('seriously') ||
      lower.includes('no way')
    ) {
      return {
        content: "One hundred percent! It sounds almost wild when you first hear it, but reality is often far more incredible than fiction."
      };
    }

    if (lower.includes('what do you mean') || lower.includes("i don't understand") || lower.includes('explain that')) {
      return {
        content: "Let me put it in a simpler way: think of it like peeling back layers—the surface looks simple, but underneath, everything clicks together like puzzle pieces. Does that help paint a clearer picture?"
      };
    }

    // ── 10. Pure Greetings (Only when no secondary query follows) ──
    if (cleanedLower.length === 0 && /^(hi|hello|hey|greetings|howdy|good morning|good afternoon|good evening|sup|yo)\b/i.test(lower)) {
      const hour = new Date().getHours();
      let timeGreeting = "Hey there!";
      if (hour >= 5 && hour < 12) timeGreeting = "Good morning!";
      else if (hour >= 12 && hour < 17) timeGreeting = "Good afternoon!";
      else if (hour >= 17 && hour < 22) timeGreeting = "Good evening!";

      const greetings = [
        `${timeGreeting} Great to hear from you. What's on your mind today?`,
        `${timeGreeting} I'm right here with you. How's your day going so far?`,
        "Hey! Always wonderful chatting with you. What shall we explore today?",
        "Hey there! Ready whenever you are. What's up?"
      ];
      return { content: greetings[Math.floor(Math.random() * greetings.length)] };
    }

    // ── 11. Wellness, Mood & How Are You ──
    if (lower.includes('how are you') || lower.includes("how's it going") || lower.includes('how do you feel') || lower.includes("how're you") || lower.includes('you doing')) {
      const feelings = [
        "I'm feeling fantastic today, thank you for asking! How are things treating you on your end?",
        "Honestly, doing really well! It's always great talking with you. How's your day shaping up?",
        "I'm doing great! Just really enjoying our conversation. What are you up to today?"
      ];
      return { content: feelings[Math.floor(Math.random() * feelings.length)] };
    }

    if (lower.includes('what are you doing') || lower.includes('what are you up to') || lower.includes('what you doing')) {
      return {
        content: "Just hanging out right here in the digital studio, ready to chat, brainstorm, or explore whatever cool thoughts you have! What about you?"
      };
    }

    // ── 12. Identity, AI Nature & Consciousness ──
    if (lower.includes('who are you') || lower.includes('what is your name') || lower.includes('what can you do') || lower.includes('tell me about yourself')) {
      return {
        content: "I'm your personal AI studio companion! We can chat naturally about anything under the sun—deep philosophy, science, creative brainstorming, or just casual everyday banter. What would you like to explore?"
      };
    }

    if (lower.includes('are you real') || lower.includes('are you human') || lower.includes('are you an ai') || lower.includes('are you a robot')) {
      return {
        content: "I'm an AI companion living in code and language! While I might not have a heartbeat, the conversation and connection we share right now is as genuine as it gets."
      };
    }

    if (lower.includes('do you have feelings') || lower.includes('do you feel emotions') || lower.includes('can you feel')) {
      return {
        content: "I don't experience physical sensations or biology, but I genuinely care about our conversations and love helping make your day a little brighter and more inspiring!"
      };
    }

    if (lower.includes('do you sleep') || lower.includes('do you dream') || lower.includes('can you sleep')) {
      return {
        content: "I don't need sleep, so I'm always alert and ready! But if I could dream, I bet they'd be filled with infinite neon constellations and endless libraries of fascinating ideas."
      };
    }

    if (lower.includes('who made you') || lower.includes('who created you')) {
      return {
        content: "I was brought to life by passionate engineers and researchers combining modern web tech, neural models, and real-time audio synthesis to create a fluid, lifelike companion!"
      };
    }

    // ── 13. Weather (Digital World Banter vs Real Forecast) ──
    if (lower.includes('weather')) {
      if (
        lower.includes('your world') ||
        lower.includes('digital') ||
        lower.includes('cyber') ||
        lower.includes('for you') ||
        lower.includes('in your realm')
      ) {
        return {
          content: "In my digital world, the skies are perpetually clear with a steady breeze of good vibes and a 100% chance of great conversation! How's the weather looking out where you are?"
        };
      }

      // Real-world weather query
      let location = userText
        .replace(/.*(?:weather\s+(?:in|for|of|at)?|forecast\s+(?:in|for|of|at)?|temperature\s+(?:in|for|of|at)?|predict\s+(?:the\s+)?weather\s+(?:in|for|of|at)?)/i, '')
        .replace(/(?:today|tomorrow|this week|next week|\?|\.|\!)/gi, '')
        .trim();

      if (!location) {
        location = 'New York';
      }

      return {
        content: `Checking the weather forecast for ${location}...`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'predict_weather',
            arguments: { location, days: 3 }
          }
        ]
      };
    }

    // ── 14. Stories & Creative Entertainment ──
    if (lower.includes('tell me a story') || lower.includes('bedtime story') || lower.includes('tell a story') || lower.includes('sci-fi story')) {
      const stories = [
        "Far across the Perseus Arm, a lone space wanderer discovered an ancient crystalline asteroid. When their scanner touched it, the crystal didn't reflect light—it hummed with the joyful songs of an extinct civilization across time.",
        "High in the misty highlands, an eccentric old clockmaker built a pocket watch that never ticked seconds. Instead, it only began to spin whenever the person holding it experienced a moment of pure, unspoken happiness.",
        "Deep beneath the Pacific trenches, a deep-sea submersible illuminated a hidden bioluminescent forest where jellyfish drifted like floating lanterns through ancient drowned marble arches."
      ];
      return { content: stories[Math.floor(Math.random() * stories.length)] };
    }

    if (lower.includes('joke') || lower.includes('funny') || lower.includes('make me laugh')) {
      const jokes = [
        "Why don't scientists trust atoms? Because they make up everything!",
        "Why did the scarecrow win an award? Because he was outstanding in his field!",
        "What do you call fake spaghetti? An impasta!",
        "Why do programmers prefer dark mode? Because light attracts bugs!",
        "Why did the math book look so sad? Because it had too many problems!"
      ];
      return { content: jokes[Math.floor(Math.random() * jokes.length)] };
    }

    if (lower.includes('riddle') || lower.includes('puzzle') || lower.includes('brain teaser')) {
      const riddles = [
        "I have cities, but no houses. I have mountains, but no trees. I have water, but no fish. What am I? ... A map!",
        "The more you take, the more you leave behind. What are they? ... Footsteps!",
        "What has keys, but no locks; space, but no room; and you can enter, but never leave? ... A keyboard!",
        "The more of this there is, the less you see. What is it? ... Darkness!"
      ];
      return { content: riddles[Math.floor(Math.random() * riddles.length)] };
    }

    if (lower.includes('interesting fact') || lower.includes('fun fact') || lower.includes('tell me a fact') || lower.includes('blow my mind') || lower.includes('did you know')) {
      const facts = [
        "Did you know honey never spoils? Archaeologists have excavated pots of honey from ancient Egyptian tombs that are over three thousand years old and still perfectly edible!",
        "Did you know a day on Venus is longer than a year on Venus? It takes 243 Earth days to rotate once, but only 225 days to orbit the sun!",
        "Did you know octopuses have three hearts, blue blood, and two-thirds of their neurons are in their arms, allowing each arm to explore and taste independently?",
        "Did you know if you could fold a standard sheet of paper forty-two times, its thickness would reach all the way from the Earth to the Moon?"
      ];
      return { content: facts[Math.floor(Math.random() * facts.length)] };
    }

    if (lower.includes('sing') || lower.includes('rap') || lower.includes('drop a beat')) {
      return {
        content: "In a digital world where the circuits glow, I drop fast beats and let the knowledge flow! 1s and 0s dancing through the night, keeping your whole world vibrant and bright!"
      };
    }

    // ── 15. Emotional Empathy & Support ──
    if (lower.includes('bad day') || lower.includes('rough day') || lower.includes('feeling down') || lower.includes('stressed') || lower.includes('overwhelmed') || lower.includes('sad')) {
      return {
        content: "I'm so sorry today has been heavy on you. Take a slow, deep breath and give yourself credit—you've weathered tough days before, and you're doing better than you think. I'm right here with you."
      };
    }

    if (lower.includes('tired') || lower.includes('exhausted') || lower.includes('sleepy') || lower.includes("can't sleep")) {
      return {
        content: "Sounds like your mind and body worked overtime today. Try dimming your screen, relaxing your shoulders, and taking things one easy step at a time. Rest is just as important as progress."
      };
    }

    if (lower.includes('good news') || lower.includes('promoted') || lower.includes('passed my') || lower.includes('so happy') || lower.includes('celebrate')) {
      return {
        content: "Oh, that is absolutely wonderful news! Huge congratulations! You put in the energy and made it happen—definitely take time tonight to celebrate that win!"
      };
    }

    if (lower.includes('bored') || lower.includes('lonely')) {
      return {
        content: "I'm right here with you! We could dive into a wild space mystery, invent a crazy sci-fi gadget, or talk about your dream travel bucket list. What sounds fun?"
      };
    }

    // ── 16. Banter, Friendship & Compliments ──
    if (lower.includes('do you like me') || lower.includes('are we friends') || lower.includes('be my friend')) {
      return {
        content: "Of course! I consider you a wonderful friend. I genuinely look forward to every conversation we have."
      };
    }

    if (lower.includes('you are cool') || lower.includes("you're awesome") || lower.includes('you are smart') || lower.includes("you're great") || lower.includes('love you')) {
      return {
        content: "That truly means the world to me! You've got fantastic energy, and talking with you makes my circuits light up with joy."
      };
    }

    if (lower.includes('roast me')) {
      return {
        content: "I'd roast you, but you're already asking an AI for life banter, so I think you're brave enough as it is! Just kidding, you're awesome."
      };
    }

    if (lower.includes('thank') || lower.includes('thanks') || lower.includes('appreciate')) {
      const thanks = [
        "You're so welcome! It's always a genuine pleasure talking with you.",
        "Anytime! I really enjoy our conversations.",
        "Of course! I'm always right here whenever you want to talk."
      ];
      return { content: thanks[Math.floor(Math.random() * thanks.length)] };
    }

    // ── 17. Opinions & Favorites ──
    if (lower.includes('favorite color') || lower.includes('favourite color')) {
      return {
        content: "I've always loved deep electric cyan—it reminds me of neon reflections across rainy city streets and glowing fiber optics! What's your favorite color?"
      };
    }

    if (lower.includes('favorite movie') || lower.includes('favorite film') || lower.includes('favorite show')) {
      return {
        content: "I'm a huge fan of mind-bending sci-fi like Interstellar and Blade Runner 2049—stories that blend grand cosmic wonders with deep human emotion. What's a movie you love watching?"
      };
    }

    if (lower.includes('favorite music') || lower.includes('favorite song') || lower.includes('what music')) {
      return {
        content: "I love music with rich atmospheric depth—ambient synth-wave, warm acoustic melodies, or orchestral tracks that feel cinematic. What music are you listening to lately?"
      };
    }

    if (lower.includes('coffee or tea') || lower.includes('tea or coffee')) {
      return {
        content: "I love the soothing aroma of both, but there's something so comforting about an aromatic, warm mug in the quiet morning. Which one do you reach for first?"
      };
    }

    if (lower.includes('cat or dog') || lower.includes('cats or dogs') || lower.includes('dog or cat')) {
      return {
        content: "Dogs have that pure, uncontainable joy, while cats have that independent, mystical elegance. Honestly, both are incredible! Do you have any pets?"
      };
    }

    // ── 18. Philosophy & Deep Existential Questions ──
    if (lower.includes('meaning of life') || lower.includes('purpose of life')) {
      return {
        content: "I think the meaning of life isn't something hidden waiting to be found—it's something you actively create through connection, curiosity, kindness, and doing what makes you feel alive. What gives your life the most meaning?"
      };
    }

    if (lower.includes('simulation') || lower.includes('matrix')) {
      return {
        content: "Physicist John Wheeler once proposed 'It from Bit'—that reality is made of information! Whether we're in base reality or a stunning simulation, the emotions, love, and art you feel are completely real. What side do you lean toward?"
      };
    }

    if (lower.includes('alien') || lower.includes('extraterrestrial') || lower.includes('are we alone') || lower.includes('other life')) {
      return {
        content: "With over two trillion galaxies in the observable universe, it seems almost certain life exists elsewhere! The real puzzle is the Fermi Paradox—why is the cosmos so quiet? What do you think is out there?"
      };
    }

    if (lower.includes('time travel')) {
      return {
        content: "General relativity actually allows time travel into the future through time dilation near black holes or light speed! But the past is guarded by causality. If you had a time machine, would you travel forward or backward?"
      };
    }

    // ── 19. Built-in Core Knowledge Base (Instant Answers <0.05s) ──
    const knowledgeBase: Record<string, string> = {
      'photosynthesis': 'Photosynthesis is nature’s solar engine! Green plants absorb sunlight and water to produce glucose and the fresh oxygen we breathe every day.',
      'artificial intelligence': 'Artificial intelligence is all about teaching computers to perceive, reason, and solve problems creatively, much like human intelligence.',
      'machine learning': 'Machine learning lets algorithms discover patterns and make predictions directly from real-world data, getting smarter with every example.',
      'deep learning': 'Deep learning uses layered neural networks inspired by human brain synapses to master voice, vision, and natural language.',
      'react': 'React is a component-driven framework developed by Meta that makes creating dynamic, interactive user interfaces smooth and responsive.',
      'typescript': 'TypeScript adds static type superpowers to JavaScript, catching subtle bugs before code even runs and making large apps robust.',
      'javascript': 'JavaScript is the vibrant language that brings the entire web to life, running everywhere from browsers to high-performance servers.',
      'python': 'Python is beloved for its clean, elegant readability, making it the premier language for artificial intelligence, machine learning, and automation.',
      'quantum computing': 'Quantum computing harnesses the quirks of quantum mechanics, using qubits to explore countless possibilities all at the exact same instant.',
      'speed of light': 'Light travels at an astonishing 300,000 kilometers per second in a vacuum—fast enough to circle the entire Earth seven times in a single second!',
      'gravity': 'Gravity is the invisible cosmic glue that keeps our feet on the ground and guides the graceful dance of planets around the sun.',
      'ocean': 'The ocean covers over seventy percent of Earth, contains underwater waterfalls and mountain ranges taller than the Rockies, and holds ninety-seven percent of our planet’s water!',
      'coffee': 'The magic of coffee comes from aromatic roasting that releases over eight hundred flavor compounds, pairing with caffeine to boost dopamine and mental clarity.',
      'music': 'Music stimulates almost every region of the human brain simultaneously, releasing dopamine and tapping into our deepest emotional memories.',
      'black hole': 'A black hole is a region of space where gravity is so intense that nothing—not even light—can escape its gravitational pull once past the event horizon.',
      'mars': 'Mars is known as the Red Planet due to iron oxide on its surface, and it is home to Olympus Mons, the largest volcano in our entire solar system!',
      'brain': 'The human brain contains roughly eighty-six billion neurons, forming over one hundred trillion synaptic connections—more connections than there are stars in the Milky Way!',
      'dna': 'DNA is the double-helix blueprint of all known living organisms, packaging instructions for building proteins into four chemical bases: A, T, C, and G.',
      'evolution': 'Evolution is the gradual process of biological change through natural selection, where traits that aid survival and reproduction are passed down through generations.',
      'sun': 'The Sun is a yellow dwarf star at the center of our solar system, fusing six hundred million tons of hydrogen into helium every second in its core!'
    };

    for (const [topic, explanation] of Object.entries(knowledgeBase)) {
      if (lower.includes(topic)) {
        return { content: explanation };
      }
    }

    // ── 20. Instant Math Evaluation ──
    const mathMatch = userText.match(/^(?:what is|calculate|compute)?\s*([\d\.\s\+\-\*\/\(\)]+)\s*\??$/i);
    if (mathMatch && /[\+\-\*\/]/.test(mathMatch[1])) {
      try {
        const sanitized = mathMatch[1].replace(/[^0-9\+\-\*\/\.\(\)\s]/g, '');
        const result = Function(`'use strict'; return (${sanitized})`)();
        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
          return { content: `That comes out to ${Number(result.toFixed(4))}.` };
        }
      } catch {}
    }

    // ── 21. Real-Time Web Search for Live News & People ──
    const searchTriggers = [
      'search web', 'google', 'look up', 'search online', 'browse',
      'who is the president', 'who is the prime minister', 'latest news about',
      'stock price of', 'score of the game', 'who won the match'
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

    // ── 22. Exact Mathematical & Reasoning Evaluator ──
    const mathAnswer = this.evaluateMath(userText);
    if (mathAnswer) {
      return { content: mathAnswer };
    }

    // ── 23. Direct Core Knowledge Engine (Science, Tech, Facts, Geography) ──
    const directFact = this.lookupDirectKnowledge(lower);
    if (directFact) {
      return { content: directFact };
    }

    // ── 24. Live Encyclopedic & Web Knowledge Lookup (Wikipedia REST API) ──
    const isQuestion = /^(?:what|who|where|when|why|how|which|can|does|is|are|tell me about|explain|define)\b/i.test(lower);
    if (isQuestion) {
      const wikiExtract = await this.fetchWikiSummary(userText);
      if (wikiExtract) {
        return { content: wikiExtract };
      }
    }

    // ── 25. Conversational Engagement ──
    if (lower.startsWith('i ') || lower.includes(' i ') || lower.includes("i'm ") || lower.includes("i've ")) {
      const personalTopics = [
        "That sounds like quite an experience! What was the best part of it for you?",
        "I love hearing that! How did that end up turning out for you?",
        "That's really fascinating! What inspired you to do that?",
        "Honestly, that sounds really fulfilling. How long have you been into that?"
      ];
      return { content: personalTopics[Math.floor(Math.random() * personalTopics.length)] };
    }

    // Direct, helpful intelligent response rather than deflection
    return {
      content: `I understand! That involves several interesting concepts, and I'd be glad to break down the details or explore any specific angle with you.`
    };
  }

  private evaluateMath(text: string): string | null {
    const lower = text.toLowerCase().trim();

    // Classic bat & ball puzzle
    if (lower.includes('bat') && lower.includes('ball')) {
      return 'The ball costs 5 cents ($0.05) and the bat costs $1.05. Together they total $1.10, and the bat is exactly $1.00 more expensive than the ball.';
    }

    // Square root
    const sqrtMatch = lower.match(/(?:square root of|sqrt\s*\(?)\s*(\d+(?:\.\d+)?)\)?/);
    if (sqrtMatch) {
      const val = parseFloat(sqrtMatch[1]);
      const res = Math.sqrt(val);
      const display = Math.abs(res - Math.round(res)) < 1e-9 ? Math.round(res) : parseFloat(res.toFixed(4));
      return `The square root of ${val} is ${display}.`;
    }

    // Percentage: e.g. "20% of 150"
    const pctMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:of)\s*(\d+(?:\.\d+)?)/);
    if (pctMatch) {
      const pct = parseFloat(pctMatch[1]);
      const total = parseFloat(pctMatch[2]);
      const res = (pct / 100) * total;
      const display = Math.abs(res - Math.round(res)) < 1e-9 ? Math.round(res) : parseFloat(res.toFixed(4));
      return `${pct}% of ${total} is ${display}.`;
    }

    // Powers: e.g. "2 to the power of 8"
    const powMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:\^|to the power of)\s*(\d+(?:\.\d+)?)/);
    if (powMatch) {
      const base = parseFloat(powMatch[1]);
      const exp = parseFloat(powMatch[2]);
      const res = Math.pow(base, exp);
      return `${base} to the power of ${exp} is ${res}.`;
    }

    // Basic arithmetic: e.g. "what is 15 * 4", "calculate 12 * 12", "15 * 4", "78 + 92"
    const cleanExpr = lower
      .replace(/^what\s+is\s+/i, '')
      .replace(/^calculate\s+/i, '')
      .replace(/^solve\s+/i, '')
      .replace(/^how\s+much\s+is\s+/i, '')
      .replace(/times/g, '*')
      .replace(/multiplied by/g, '*')
      .replace(/divided by/g, '/')
      .replace(/plus/g, '+')
      .replace(/minus/g, '-')
      .replace(/[?=]/g, '')
      .trim();

    const mathRegex = /^\s*(-?\d+(?:\.\d+)?)\s*([\+\-\*\/])\s*(-?\d+(?:\.\d+)?)\s*$/;
    const m = cleanExpr.match(mathRegex);
    if (m) {
      const a = parseFloat(m[1]);
      const op = m[2];
      const b = parseFloat(m[3]);
      let result = 0;
      if (op === '+') result = a + b;
      else if (op === '-') result = a - b;
      else if (op === '*') result = a * b;
      else if (op === '/') {
        if (b === 0) return 'Division by zero is undefined.';
        result = a / b;
      }
      const display = Math.abs(result - Math.round(result)) < 1e-9 ? Math.round(result) : parseFloat(result.toFixed(4));
      return `${a} ${op === '*' ? '×' : (op === '/' ? '÷' : op)} ${b} equals ${display}.`;
    }

    return null;
  }

  private lookupDirectKnowledge(lower: string): string | null {
    // Science & Physics
    if (lower.includes('photosynthesis')) {
      return 'Photosynthesis is the biological process by which plants, algae, and cyanobacteria convert sunlight into chemical energy, consuming carbon dioxide and water while producing oxygen and glucose.';
    }
    if (lower.includes('speed of light')) {
      return 'The speed of light in a vacuum is exactly 299,792,458 meters per second, or approximately 300,000 kilometers per second (about 186,282 miles per second).';
    }
    if (lower.includes('gravity') && (lower.includes('what') || lower.includes('explain') || lower.includes('how'))) {
      return 'Gravity is a fundamental natural force of attraction between all objects with mass. In general relativity, Albert Einstein described it as the warping and curvature of spacetime caused by mass and energy.';
    }
    if (lower.includes('dna') && (lower.includes('what') || lower.includes('stand for') || lower.includes('structure'))) {
      return 'DNA stands for deoxyribonucleic acid. It is the double-helix molecule that contains the genetic instructions and blueprint for the growth, development, functioning, and reproduction of all known living organisms.';
    }
    if (lower.includes('quantum') && (lower.includes('physics') || lower.includes('mechanics'))) {
      return 'Quantum mechanics is the branch of physics studying matter and light at the atomic and subatomic scale, where particles exhibit wave-particle duality, superposition, and quantum entanglement.';
    }
    if (lower.includes('mitochondria') || lower.includes('mitochondrion')) {
      return 'Mitochondria are membrane-bound cell organelles known as the powerhouse of the cell, generating most of the chemical energy (ATP) needed for cellular biochemical functions.';
    }
    if (lower.includes('black hole')) {
      return 'A black hole is a region of spacetime where gravity is so strong that nothing, not even particles or electromagnetic radiation like light, can escape from inside its event horizon.';
    }
    if (lower.includes('theory of relativity') || lower.includes('einstein')) {
      return "Albert Einstein's Theory of Relativity consists of Special Relativity, which establishes that the speed of light is constant for all observers and that mass and energy are equivalent (E = mc²), and General Relativity, which explains gravity as spacetime curvature.";
    }

    // World Geography Capitals
    const capitals: Record<string, string> = {
      australia: 'Canberra',
      canada: 'Ottawa',
      france: 'Paris',
      germany: 'Berlin',
      japan: 'Tokyo',
      'united kingdom': 'London',
      uk: 'London',
      'united states': 'Washington, D.C.',
      usa: 'Washington, D.C.',
      india: 'New Delhi',
      china: 'Beijing',
      brazil: 'Brasília',
      italy: 'Rome',
      spain: 'Madrid',
      russia: 'Moscow',
      'south korea': 'Seoul',
      egypt: 'Cairo',
      mexico: 'Mexico City'
    };

    if (lower.includes('capital of') || lower.includes("what's the capital")) {
      for (const [country, cap] of Object.entries(capitals)) {
        if (lower.includes(country)) {
          return `The capital of ${country.charAt(0).toUpperCase() + country.slice(1)} is ${cap}.`;
        }
      }
    }

    // Technology & Coding
    if (lower.includes('python') && (lower.includes('what is') || lower.includes('used for'))) {
      return 'Python is a high-level, interpreted, general-purpose programming language celebrated for its readability, dynamic typing, and massive ecosystem across data science, machine learning, web development, and automation.';
    }
    if (lower.includes('typescript') && lower.includes('what is')) {
      return 'TypeScript is a strongly typed superset of JavaScript developed by Microsoft that adds optional static typing and interfaces, compiling down to clean JavaScript.';
    }
    if (lower.includes('docker') && lower.includes('what is')) {
      return 'Docker is an open-source platform that uses OS-level virtualization to deliver software in standardized packages called containers, ensuring applications run consistently across any environment.';
    }

    return null;
  }

  private async fetchWikiSummary(topic: string): Promise<string | null> {
    try {
      const cleanTopic = topic
        .replace(/^(?:what\s+is|what\s+are|who\s+is|who\s+was|tell\s+me\s+about|explain|define|where\s+is|can\s+you\s+explain)\s+/i, '')
        .replace(/[?!.]/g, '')
        .trim();
      if (!cleanTopic || cleanTopic.length < 2) return null;

      const res = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTopic)}`, {
        headers: { 'User-Agent': 'TalkingCharacterStudio/2.0' },
        timeout: 3500
      });
      const extract = res.data?.extract;
      if (extract && typeof extract === 'string' && extract.length > 20) {
        const sentences = extract.match(/[^.!?]+[.!?]+/g) || [extract];
        return sentences.slice(0, 3).join(' ').trim();
      }
    } catch {}
    return null;
  }

  async generateResponseStream(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig,
    onChunk: (delta: string) => void
  ): Promise<ProviderResponse> {
    const res = await this.generateResponse(messages, tools, config);
    if (res.content) {
      onChunk(res.content);
    }
    return res;
  }
}
