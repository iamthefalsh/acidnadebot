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

// ═══════════════════════════════════════════════════════════════
// SESSION MEMORY & UNDO SYSTEM
// ═══════════════════════════════════════════════════════════════
const sessionData = new Map();

function getSession(sessionId) {
  if (!sessionData.has(sessionId)) {
    sessionData.set(sessionId, {
      history: [],
      creationLog: [],
      modificationLog: [],
      deletionLog: [],
      conversationContext: [],
      lastRequest: null,
      canUndo: false
    });
  }
  return sessionData.get(sessionId);
}

function addToCreationLog(sessionId, planData) {
  const session = getSession(sessionId);
  session.creationLog.push({
    timestamp: Date.now(),
    plan: planData,
    type: 'creation'
  });
  session.canUndo = true;
  
  // Keep only last 10 actions
  if (session.creationLog.length > 10) {
    session.creationLog.shift();
  }
}

// ═══════════════════════════════════════════════════════════════
// DEPENDENCY DETECTION SYSTEM
// ═══════════════════════════════════════════════════════════════
function detectDependencies(context, plannedSteps) {
  const warnings = [];
  const suggestions = [];
  
  if (!context || !context.project) return { warnings, suggestions };
  
  const existingScripts = context.project.ScriptDetails || [];
  const plannedNames = plannedSteps.map(step => step.name);
  
  // Check for duplicate names
  for (const step of plannedSteps) {
    const existsInProject = existingScripts.some(s => s.Name === step.name);
    const duplicateInPlan = plannedNames.filter(n => n === step.name).length > 1;
    
    if (existsInProject) {
      warnings.push(`⚠️ "${step.name}" already exists in project - consider modifying instead of creating`);
    }
    
    if (duplicateInPlan) {
      warnings.push(`⚠️ Plan creates multiple instances named "${step.name}"`);
    }
  }
  
  // Check for RemoteEvent dependencies
  const needsRemoteEvent = plannedSteps.some(step => 
    step.properties?.Source?.includes('RemoteEvent') ||
    step.properties?.Source?.includes(':FireServer') ||
    step.properties?.Source?.includes(':FireClient')
  );
  
  const createsRemoteEvent = plannedSteps.some(step => 
    step.className === 'RemoteEvent' || step.className === 'RemoteFunction'
  );
  
  const hasRemoteEvent = existingScripts.some(s => 
    s.Type === 'RemoteEvent' || s.Type === 'RemoteFunction'
  );
  
  if (needsRemoteEvent && !createsRemoteEvent && !hasRemoteEvent) {
    suggestions.push(`💡 This system needs RemoteEvents for client-server communication`);
  }
  
  return { warnings, suggestions };
}

// ═══════════════════════════════════════════════════════════════
// CODE OPTIMIZATION ANALYZER
// ═══════════════════════════════════════════════════════════════
function analyzeCodeOptimizations(planSteps) {
  const optimizations = [];
  
  for (const step of planSteps) {
    if (!step.properties?.Source) continue;
    
    const code = step.properties.Source;
    
    // Check for old wait() usage
    if (code.includes('wait(') && !code.includes('task.wait(')) {
      optimizations.push(`⚡ Use task.wait() instead of wait() in ${step.name}`);
    }
    
    // Check for GetChildren in loops
    if (code.includes(':GetChildren()') && code.includes('for ')) {
      optimizations.push(`⚡ Consider caching :GetChildren() result in ${step.name}`);
    }
    
    // Check for missing error handling
    if (!code.includes('pcall') && (code.includes('HttpService') || code.includes('DataStore'))) {
      optimizations.push(`🛡️ Add pcall error handling in ${step.name}`);
    }
    
    // Check for service caching
    if (code.match(/game:GetService\(/g)?.length > 3) {
      optimizations.push(`📦 Cache service references at top of ${step.name}`);
    }
  }
  
  return optimizations;
}

// ═══════════════════════════════════════════════════════════════
// VISUAL PREVIEW GENERATOR
// ═══════════════════════════════════════════════════════════════
function generateVisualPreview(planSteps) {
  const preview = {
    type: "architecture",
    description: "",
    components: [],
    estimatedComplexity: "medium"
  };
  
  const scriptCount = planSteps.filter(s => s.className === 'Script').length;
  const localScriptCount = planSteps.filter(s => s.className === 'LocalScript').length;
  const moduleCount = planSteps.filter(s => s.className === 'ModuleScript').length;
  const remoteCount = planSteps.filter(s => s.className === 'RemoteEvent' || s.className === 'RemoteFunction').length;
  
  // Generate description
  let desc = "📊 System Architecture:\n";
  if (scriptCount > 0) desc += `  • ${scriptCount} Server Script${scriptCount > 1 ? 's' : ''}\n`;
  if (localScriptCount > 0) desc += `  • ${localScriptCount} LocalScript${localScriptCount > 1 ? 's' : ''}\n`;
  if (moduleCount > 0) desc += `  • ${moduleCount} ModuleScript${moduleCount > 1 ? 's' : ''}\n`;
  if (remoteCount > 0) desc += `  • ${remoteCount} RemoteEvent${remoteCount > 1 ? 's' : ''}\n`;
  
  preview.description = desc;
  
  // Determine complexity
  const totalSteps = planSteps.length;
  if (totalSteps <= 2) preview.estimatedComplexity = "simple";
  else if (totalSteps <= 5) preview.estimatedComplexity = "medium";
  else preview.estimatedComplexity = "complex";
  
  // Component breakdown
  for (const step of planSteps) {
    preview.components.push({
      name: step.name,
      type: step.className,
      location: step.parentPath,
      purpose: step.description?.substring(0, 60) + "..."
    });
  }
  
  return preview;
}

// ═══════════════════════════════════════════════════════════════
// ENHANCED CONTEXT FORMATTER
// ═══════════════════════════════════════════════════════════════
function formatContext(context) {
  if (!context) return "Empty workspace.";
  
  let text = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ROBLOX STUDIO WORKSPACE ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  if (context.project && context.project.Statistics) {
    const stats = context.project.Statistics;
    text += `📈 PROJECT STATISTICS:\n`;
    text += `   Scripts: ${stats.TotalScripts || 0} | UI Elements: ${stats.TotalUI || 0}\n\n`;
  }
  
  if (context.project && context.project.ScriptDetails) {
    const scripts = context.project.ScriptDetails;
    if (scripts.length > 0) {
      text += `📝 EXISTING SCRIPTS (${scripts.length} total):\n`;
      scripts.slice(-10).forEach((script, i) => {
        text += `   ${i + 1}. "${script.Name}" (${script.Type})\n`;
        text += `      📁 Location: ${script.Path}\n`;
      });
      text += `\n`;
    } else {
      text += `📝 NO EXISTING SCRIPTS\n\n`;
    }
  }
  
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `🎯 SELECTED OBJECTS:\n`;
    context.selectedObjects.forEach((item, i) => {
      text += `   ${i + 1}. "${item.Name}" (${item.ClassName})\n`;
    });
    text += `\n`;
  }
  
  if (context.createdInstances && context.createdInstances.length > 0) {
    text += `✨ RECENTLY CREATED:\n`;
    context.createdInstances.slice(-5).forEach((item, i) => {
      text += `   ${i + 1}. "${item.name}" (${item.className}) at ${item.parentPath}\n`;
    });
    text += `\n`;
  }
  
  text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "16.0-ULTRA" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v16.0 - Ultra Enhanced'));

// ═══════════════════════════════════════════════════════════════
// UNDO ENDPOINT
// ═══════════════════════════════════════════════════════════════
app.post('/undo', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.json({ message: "No session ID provided", canUndo: false });
    }
    
    const session = getSession(sessionId);
    
    if (session.creationLog.length === 0) {
      return res.json({ 
        message: "Nothing to undo",
        canUndo: false
      });
    }
    
    const lastAction = session.creationLog.pop();
    
    // Generate deletion plan to undo the creation
    const undoPlan = [];
    for (const step of lastAction.plan.plan) {
      undoPlan.push({
        step: undoPlan.length + 1,
        description: `Delete ${step.name} (undoing previous action)`,
        type: "delete",
        className: step.className,
        name: step.name,
        parentPath: step.parentPath,
        reasoning: "Reverting previous creation"
      });
    }
    
    session.canUndo = session.creationLog.length > 0;
    
    res.json({
      message: `Undoing last action (${lastAction.plan.plan.length} items)`,
      plan: undoPlan,
      autoExecute: false,
      needsApproval: true,
      canUndo: session.canUndo,
      undoInfo: {
        actionType: lastAction.type,
        timestamp: lastAction.timestamp,
        itemCount: lastAction.plan.plan.length
      }
    });
    
  } catch (error) {
    console.error("Undo Error:", error);
    res.json({ 
      message: "Error processing undo request",
      canUndo: false
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// MAIN AI ENDPOINT - ULTRA ENHANCED
// ═══════════════════════════════════════════════════════════════
app.post('/ai', async (req, res) => {
  try {
    console.log("🤖 ULTRA ENHANCED AI - Processing...");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "What would you like to create or modify?",
        plan: [],
        autoExecute: true
      });
    }
    
    const session = getSession(sessionId || 'default');
    const contextSummary = formatContext(context);
    const userRequest = prompt.trim();
    
    // Store conversation
    session.conversationContext.push({
      role: 'user',
      content: userRequest,
      timestamp: Date.now()
    });
    
    // Keep only last 10 messages
    if (session.conversationContext.length > 10) {
      session.conversationContext.shift();
    }
    
    // === ULTRA ENHANCED AI PROMPT ===
    const systemPrompt = `You are ACIDNADE v16.0, an ULTRA-ENHANCED AI with advanced Roblox/Luau expertise.

${contextSummary}

USER REQUEST:
"${userRequest}"

CONVERSATION HISTORY:
${session.conversationContext.slice(-3).map(msg => `${msg.role}: ${msg.content}`).join('\n')}

═══════════════════════════════════════════════════════════════
🧠 AUTONOMOUS THINKING PROTOCOL
═══════════════════════════════════════════════════════════════

<thinking>
1. REQUEST ANALYSIS:
   • What does the user want? (create/modify/delete/question)
   • Are they referencing existing scripts from the workspace?
   • Do they want ideas or execution?

2. CONTEXT EVALUATION:
   • What exists in the workspace? (check EXISTING SCRIPTS above)
   • What was recently created? (check RECENTLY CREATED above)
   • What objects are selected? (check SELECTED OBJECTS above)

3. INTELLIGENT DECISION:
   • If modifying existing → Use type: "modify" with exact path
   • If creating new → Design minimal, elegant solution
   • If just chatting → Answer conversationally
   
4. DEPENDENCY CHECK:
   • Do I need RemoteEvents? (only if client-server communication)
   • Do I need multiple scripts? (only if truly necessary)
   • Can this be done simpler?

5. VISUAL PLANNING:
   • What will this look like when complete?
   • How will the components interact?
   • What will the player/user see?
</thinking>

═══════════════════════════════════════════════════════════════
⚡ ABSOLUTE REQUIREMENTS
═══════════════════════════════════════════════════════════════

1. 🎨 UI CREATION RULE:
   • ALL UI elements MUST be created inside a LocalScript
   • Use Instance.new() for ScreenGui, Frame, TextButton, etc.
   • Parent UI to player:WaitForChild("PlayerGui")
   • NEVER create UI instances as separate steps

2. 💻 LUAU CODE REQUIREMENT:
   • Valid Roblox Studio Luau only
   • Use game:GetService() for all services
   • Use :WaitForChild() for safety
   • Use task.wait() instead of wait()
   • Add comments explaining logic

3. ✏️ MODIFICATION RULE:
   • If script exists in EXISTING SCRIPTS → type: "modify"
   • Use EXACT path from the workspace
   • Don't create new when modifying existing

4. 🎯 SIMPLICITY RULE:
   • Use minimum components needed
   • Don't over-engineer solutions
   • Ask: "Can this be simpler?"

5. 📊 VISUAL DESCRIPTION RULE:
   • Describe what the user will see/experience
   • Explain visual feedback and interactions
   • Make step descriptions vivid and specific

═══════════════════════════════════════════════════════════════
📝 ENHANCED RESPONSE FORMAT
═══════════════════════════════════════════════════════════════

For implementation:
{
  "thinking": "Your thought process from above",
  "message": "Clear explanation with visual descriptions",
  "plan": [
    {
      "step": 1,
      "description": "🎨 VISUAL + DETAILED description of what this creates and what user will see",
      "type": "create|modify|delete",
      "className": "Script|LocalScript|ModuleScript",
      "name": "DescriptiveName",
      "parentPath": "game.ServiceName",
      "properties": {
        "Source": "-- Complete, production-ready Luau code\\n-- With comments\\n-- Error handling\\n-- Visual feedback"
      },
      "reasoning": "Technical explanation of why this approach",
      "visualImpact": "What the player/developer will see or experience"
    }
  ],
  "autoExecute": true,
  "preview": {
    "description": "Visual overview of the complete system",
    "estimatedComplexity": "simple|medium|complex"
  },
  "optimizations": ["Performance tips and suggestions"],
  "dependencies": {
    "warnings": ["Any duplicate or conflict warnings"],
    "suggestions": ["Helpful suggestions for improvement"]
  }
}

For questions/conversations:
{
  "thinking": "Analysis",
  "message": "Helpful, detailed answer"
}

═══════════════════════════════════════════════════════════════
🎯 ENHANCED EXAMPLES
═══════════════════════════════════════════════════════════════

REQUEST: "add hit animation to HitHandler"
EXISTING: HitHandler (Script) in ServerScriptService

CORRECT:
{
  "message": "I'll add hit reaction animations to your HitHandler! When a player lands a hit, they'll see a quick camera shake and the hit target will flash red.",
  "plan": [{
    "step": 1,
    "description": "🎬 Modify HitHandler to trigger character animations and visual effects when attacks connect. Players will see their character perform a hit animation, the target will flash red briefly, and a small particle effect will appear at the impact point.",
    "type": "modify",
    "className": "Script",
    "name": "HitHandler",
    "parentPath": "game.ServerScriptService",
    "properties": {
      "Source": "-- Complete modified code with animations"
    },
    "visualImpact": "Player sees satisfying hit feedback with animations"
  }],
  "autoExecute": true,
  "preview": {
    "description": "Enhanced combat feel with visual and animated hit feedback",
    "estimatedComplexity": "simple"
  }
}

═══════════════════════════════════════════════════════════════

REQUEST: "give me ideas for a shop system"

CORRECT:
{
  "message": "Here are some shop system ideas:\\n\\n1. Currency-Based Shop\\n2. Level-Gated Items\\n3. Limited-Time Offers\\n4. VIP Shop Section"
}

═══════════════════════════════════════════════════════════════

NOW: Think deeply through the protocol, then respond with enhanced, visual descriptions.`;

    console.log("⚡ Processing with ULTRA ENHANCED AI...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.json({ 
        message: "I'm ready to help! What would you like to create?",
        plan: [],
        autoExecute: true
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError);
      return res.json({ 
        message: "Error processing request.",
        plan: [],
        autoExecute: true
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
      console.error("JSON Parse Failed");
      
      const thinkingMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/);
      const thinking = thinkingMatch ? thinkingMatch[1].trim() : null;
      
      data = {
        thinking: thinking,
        message: "I'll help you with that!",
        plan: [],
        autoExecute: true
      };
    }
    
    // Store AI response
    session.conversationContext.push({
      role: 'assistant',
      content: data.message,
      timestamp: Date.now()
    });
    
    if (!data.message) {
      data.message = "Done!";
    }
    
    // ═══════════════════════════════════════════════════════════════
    // ENHANCED PROCESSING
    // ═══════════════════════════════════════════════════════════════
    
    if (data.plan && Array.isArray(data.plan)) {
      // Generate visual preview
      if (!data.preview) {
        data.preview = generateVisualPreview(data.plan);
      }
      
      // Detect dependencies and conflicts
      const depCheck = detectDependencies(context, data.plan);
      data.dependencies = {
        warnings: depCheck.warnings,
        suggestions: depCheck.suggestions
      };
      
      // Analyze code optimizations
      if (!data.optimizations) {
        data.optimizations = analyzeCodeOptimizations(data.plan);
      }
      
      // Add to creation log for undo
      if (data.plan.length > 0) {
        addToCreationLog(sessionId, data);
      }
      
      data.stepsTotal = data.plan.length;
      data.progressText = `Steps: 0/${data.plan.length}`;
      data.sequentialExecution = true;
      
      // Auto-execute by default
      if (data.autoExecute === undefined) {
        data.autoExecute = true;
      }
      
      // Only need approval for mass deletions
      const deletionCount = data.plan.filter(step => step.type === 'delete').length;
      if (deletionCount >= 5) {
        data.needsApproval = true;
        data.autoExecute = false;
        data.message = `⚠️ DESTRUCTIVE: Will delete ${deletionCount} items. Review carefully.`;
      } else {
        data.needsApproval = false;
      }
      
      // Enforce UI rule - block direct UI creation
      let hasUIViolation = false;
      const uiClasses = ['ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'ImageLabel', 
                         'ScrollingFrame', 'TextBox', 'ImageButton', 'ViewportFrame'];
      
      data.plan = data.plan.filter(step => {
        if (uiClasses.includes(step.className)) {
          console.log(`⚠️ UI VIOLATION: Blocked ${step.className} - must be in LocalScript`);
          hasUIViolation = true;
          return false;
        }
        return true;
      });
      
      if (hasUIViolation) {
        data.message = "⚠️ UI elements must be created inside LocalScript. I've adjusted the plan.";
        data.dependencies.warnings.push("UI elements must be created dynamically in LocalScript");
      }
      
      // Enhanced step descriptions with emojis
      data.plan = data.plan.map(step => {
        // Add emoji based on type
        const typeEmoji = {
          'Script': '📜',
          'LocalScript': '💚',
          'ModuleScript': '📦',
          'RemoteEvent': '📡',
          'RemoteFunction': '📞'
        };
        
        const emoji = typeEmoji[step.className] || '📄';
        
        if (!step.description.startsWith(emoji)) {
          step.description = `${emoji} ${step.description}`;
        }
        
        // Add visual impact if missing
        if (!step.visualImpact && step.type === 'create') {
          step.visualImpact = `Creates ${step.className} "${step.name}" in ${step.parentPath}`;
        }
        
        return step;
      });
      
      data.stepsTotal = data.plan.length;
      
      // Add undo capability
      data.canUndo = session.canUndo;
      
      console.log(`🎨 Enhanced plan: ${data.plan.length} steps with visual previews`);
      console.log(`📊 Preview: ${data.preview?.description}`);
      console.log(`⚡ Optimizations: ${data.optimizations?.length || 0}`);
      console.log(`⚠️ Warnings: ${data.dependencies?.warnings?.length || 0}`);
    }
    
    session.lastRequest = {
      prompt: userRequest,
      response: data,
      timestamp: Date.now()
    };
    
    console.log(`📤 Ultra Enhanced Response: ${data.plan?.length || 0} steps | Undo: ${data.canUndo ? 'YES' : 'NO'}`);
    res.json(data);

  } catch (error) {
    console.error("Ultra Enhanced AI Error:", error);
    res.json({ 
      message: "Error occurred. Please try again.",
      plan: [],
      autoExecute: false
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ACIDNADE AI v16.0 — ULTRA ENHANCED`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Undo/Rollback System: ACTIVE`);
  console.log(`🎨 Visual Preview Generator: ENABLED`);
  console.log(`🔍 Dependency Detection: ACTIVE`);
  console.log(`⚡ Code Optimization Analyzer: ENABLED`);
  console.log(`💾 Session Memory: PERSISTENT`);
  console.log(`📊 Enhanced Context Awareness: ACTIVE`);
  console.log(`🎯 Visual Step Descriptions: ENABLED`);
  console.log(`🛡️ UI Rule Enforcement: STRICT`);
  console.log(`💻 Luau Code: PRODUCTION-READY`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});
