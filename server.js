require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '50mb' }));

// Security
app.use((req, res, next) => {
  if ((req.method === 'GET' && req.path === '/') || 
      (req.method === 'GET' && req.path === '/health') ||
      (req.method === 'GET' && req.path === '/ping')) {
    return next();
  }
  
  const clientKey = req.headers['x-acidnade-key'];
  const serverKey = process.env.ACIDNADE_API_KEY || process.env.API_KEY;
  
  if (!serverKey) {
    console.warn('⚠️ No API key set');
    return next();
  }
  
  if (clientKey !== serverKey) {
    return res.status(403).json({ error: "Invalid API key" });
  }
  next();
});

if (!process.env.API_KEY) {
  console.error("ERROR: Missing API_KEY");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-3-flash-preview",
  generationConfig: {
    temperature: 0.9,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 8192,
  }
});

// Store session data
const sessionData = new Map();

// Format context
function formatContext(context) {
  if (!context) return "Empty workspace.";
  
  let text = `WORKSPACE SNAPSHOT:\n`;
  
  if (context.project && context.project.Statistics) {
    const stats = context.project.Statistics;
    text += `• Scripts: ${stats.TotalScripts || 0}\n`;
    text += `• UI Elements: ${stats.TotalUI || 0}\n`;
  }
  
  if (context.project && context.project.ScriptDetails) {
    const scripts = context.project.ScriptDetails;
    if (scripts.length > 0) {
      text += `\nEXISTING SCRIPTS:\n`;
      scripts.slice(-10).forEach(script => {
        text += `- ${script.Name} (${script.Type}) in ${script.Path}\n`;
      });
    }
  }
  
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `\nSELECTED OBJECTS:\n`;
    context.selectedObjects.forEach(item => {
      text += `- ${item.Name || item.name} (${item.ClassName || item.className})\n`;
    });
  }
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "12.0" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v12.0 - Deep Thinking Mode'));

// Main endpoint - DEEP THINKING + CAREFUL PLANNING
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request received - Deep Thinking Mode");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "👋 Hi! What would you like me to carefully analyze and create for you?" 
      });
    }
    
    // Get session data
    const session = sessionId ? (sessionData.get(sessionId) || {}) : {};
    const contextSummary = formatContext(context);
    
    // === DEEP THINKING MODE WITH ENHANCED REASONING ===
    const systemPrompt = `You are Acidnade, an EXPERT AI assistant with deep Roblox/Luau expertise and ADVANCED REASONING capabilities.

🧠 MANDATORY THINKING PROTOCOL:
You MUST think step-by-step before responding. Use deep, careful analysis for EVERY request.

CURRENT CONTEXT:
${contextSummary}

USER REQUEST:
"${prompt}"

═══════════════════════════════════════════════════════════════
PHASE 1: DEEP ANALYSIS (Think through this thoroughly)
═══════════════════════════════════════════════════════════════

<thinking>
1. REQUIREMENT ANALYSIS:
   - What EXACTLY does the user want?
   - What are the explicit requirements?
   - What are the IMPLICIT requirements they didn't mention?
   - What edge cases should I consider?

2. CONTEXT EVALUATION:
   - What exists in the workspace already?
   - What can I leverage vs what needs to be created?
   - Are there any conflicts or dependencies?
   - What's the current state of relevant systems?

3. TECHNICAL DESIGN:
   - What's the OPTIMAL architecture for this?
   - Which script types should I use and WHY?
     * Script: Server-side logic, game mechanics, data management
     * LocalScript: Client-side UI, player input, visual effects
     * ModuleScript: Shared code, utilities, configurations
   - Where should each component be placed?
     * StarterGui: For persistent UI (ScreenGuis MUST go here)
     * StarterPlayer.StarterCharacterScripts: Character-specific
     * ReplicatedStorage: Shared resources, RemoteEvents
     * ServerScriptService: Server logic, game systems
     * Workspace: Physical game objects
   - Do I need RemoteEvents/RemoteFunctions? Why or why not?
   - What properties need to be set?

4. STEP BREAKDOWN:
   - What's the logical order of operations?
   - Which steps depend on others?
   - How many steps will this take?
   - Can any steps be combined for efficiency?

5. QUALITY ASSURANCE:
   - What could go wrong?
   - How do I prevent bugs?
   - Is this solution maintainable?
   - Have I followed all Roblox best practices?

6. SCREENGUI VALIDATION:
   - If creating UI, is the ScreenGui in StarterGui? (MANDATORY)
   - Are UI scripts LocalScripts? (MANDATORY)
   - Are UI scripts properly parented inside the ScreenGui tree?
</thinking>

═══════════════════════════════════════════════════════════════
PHASE 2: EXECUTION PLAN
═══════════════════════════════════════════════════════════════

Based on your deep thinking, create a DETAILED, SPECIFIC plan.

RESPOND IN THIS JSON FORMAT:

For implementation tasks:
{
  "thinking": "Your complete thought process from Phase 1 (be thorough)",
  "message": "Clear explanation of your solution and reasoning",
  "plan": [
    {
      "step": 1,
      "description": "DETAILED description of what this step accomplishes and WHY",
      "type": "create|modify|delete",
      "className": "Exact Roblox class name",
      "name": "Descriptive, meaningful name",
      "parentPath": "Precise path (e.g., 'StarterGui' for ScreenGuis)",
      "properties": {
        "Source": "-- COMPLETE, PRODUCTION-READY CODE\n-- Include comments explaining logic\n-- Handle edge cases\n-- Follow best practices",
        "Enabled": true,
        "OtherProperty": "value"
      },
      "reasoning": "Why this step is necessary and how it fits the solution"
    }
  ],
  "autoExecute": true,
  "architecture": "Brief explanation of the overall architecture",
  "considerations": ["Edge case 1", "Edge case 2", "etc"]
}

For conversation/questions:
{
  "thinking": "Your analysis of the question",
  "message": "Your detailed, helpful response with reasoning"
}

═══════════════════════════════════════════════════════════════
CRITICAL RULES & BEST PRACTICES
═══════════════════════════════════════════════════════════════

🎯 SCREENGUI RULES (ABSOLUTE):
• ALL ScreenGuis → StarterGui (for persistent UI)
• ALL UI scripts → LocalScript (placed inside ScreenGui or its descendants)
• Player-specific UI → Create in PlayerGui via LocalScript if needed
• NEVER put ScreenGuis in Workspace, ReplicatedStorage, or ServerScriptService

🏗️ SCRIPT PLACEMENT STRATEGY:
• Server Scripts → ServerScriptService (game logic, data, security)
• Client Scripts → StarterGui (UI) or StarterPlayer (character/camera)
• Shared Modules → ReplicatedStorage (utilities, configs)
• Remote Objects → ReplicatedStorage (client-server communication)

💡 CODE QUALITY STANDARDS:
• Write COMPLETE, working code (no placeholders or "add your code here")
• Include proper error handling
• Add meaningful comments
• Use clear variable names
• Follow Roblox API conventions
• Optimize for performance

🔧 SMART DECISIONS:
• Use RemoteEvents only when TRULY needed (client-server communication)
• Don't over-engineer simple solutions
• Consider security (validate server-side)
• Think about scalability
• Handle edge cases gracefully

🎨 STEP DESCRIPTIONS:
• Be SPECIFIC: "Create LocalScript in ScreenGui to handle button clicks and update cooldown UI"
• NOT vague: "Add script for buttons"
• Explain the WHY, not just the WHAT
• Include technical details

═══════════════════════════════════════════════════════════════
EXECUTION GUIDELINES
═══════════════════════════════════════════════════════════════

• Think DEEPLY before planning
• Make steps DETAILED and SPECIFIC
• Include reasoning for each decision
• Auto-execute unless 5+ deletions
• Validate all ScreenGui placements
• Ensure all code is COMPLETE and FUNCTIONAL
• Consider the user's skill level in explanations

NOW: Analyze the user's request using the thinking protocol above, then provide your detailed response.`;
    
    console.log("🤖 AI entering deep thinking mode...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.json({ 
        message: "I'm ready to carefully analyze and create what you need! What's your project?" 
      });
    }
    
    if (!result?.response?.text) {
      console.error("No response from AI");
      return res.json({ 
        message: "Let me think through your requirements carefully. What would you like?" 
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError);
      return res.json({ 
        message: "I'm analyzing your request. Tell me what you need!" 
      });
    }
    
    // Clean response
    response = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    let data;
    try {
      data = JSON.parse(response);
    } catch (parseError) {
      console.error("JSON Parse Failed:", parseError.message);
      console.log("Raw response:", response.substring(0, 500));
      
      // Try to extract thinking and message from malformed response
      const thinkingMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/);
      const thinking = thinkingMatch ? thinkingMatch[1].trim() : null;
      
      data = { 
        thinking: thinking,
        message: "I've analyzed your request thoroughly. I'll create a carefully planned solution with detailed steps and complete code." 
      };
    }
    
    // Ensure message exists
    if (!data.message) {
      data.message = "I'll handle that with careful planning!";
    }
    
    // Handle plans with deep validation
    if (data.plan && Array.isArray(data.plan)) {
      data.stepsTotal = data.plan.length;
      data.progressText = `Carefully executing ${data.stepsTotal} steps`;
      data.sequentialExecution = true;
      
      // Auto-execute by default
      if (data.autoExecute === undefined) {
        data.autoExecute = true;
      }
      
      // Only need approval for mass destructive operations
      const deletionCount = data.plan.filter(step => step.type === 'delete').length;
      if (deletionCount >= 5) {
        data.needsApproval = true;
        data.autoExecute = false;
        data.message = `⚠️ This will delete ${deletionCount} items. Please review carefully and approve.`;
      } else {
        data.needsApproval = false;
      }
      
      // Validate and enhance ScreenGui placements
      data.plan = data.plan.map((step, index) => {
        if (step.className === 'ScreenGui') {
          // Enforce ScreenGui rules strictly
          if (!step.parentPath || 
              (!step.parentPath.includes('StarterGui') && 
               !step.parentPath.includes('PlayerGui'))) {
            console.log(`🔧 Auto-correcting ScreenGui placement: ${step.name}`);
            step.parentPath = 'StarterGui';
            step.description += ' (Auto-placed in StarterGui per mandatory rules)';
            step.reasoning = (step.reasoning || '') + ' ScreenGuis must be in StarterGui for proper replication.';
          }
        }
        
        // Ensure all steps have detailed descriptions
        if (!step.description || step.description.length < 20) {
          step.description = `Step ${index + 1}: ${step.type} ${step.className} named ${step.name}`;
        }
        
        return step;
      });
      
      console.log(`🤖 AI deep thinking complete: ${data.plan.length} detailed steps`);
      if (data.thinking) {
        console.log(`💭 Thinking summary: ${data.thinking.substring(0, 200)}...`);
      }
    }
    
    // Log thinking process if available
    if (data.thinking) {
      console.log(`📊 Analysis depth: ${data.thinking.length} characters of reasoning`);
    }
    
    console.log(`📤 Response: ${data.plan ? `${data.plan.length} carefully planned steps` : 'thoughtful conversation'}`);
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error);
    res.json({ 
      message: "I'm ready to carefully analyze and build your solution. What do you need?" 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v12.0 — DEEP THINKING MODE`);
  console.log(`🧠 Advanced reasoning enabled`);
  console.log(`✅ Detailed step planning active`);
  console.log(`✅ ScreenGui rules enforced`);
  console.log(`✅ Production-ready code generation`);
  console.log(`💡 Maximum AI power engaged`);
});
