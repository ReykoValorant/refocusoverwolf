"use strict";

/**
 * Refocus - VALORANT background.js (FOCUS MODE)
 * - Firebase Cloud Sync (100% Cloud Controlled)
 * - 4-Tier Advanced AI Math (Game Changer, Helpful, Boring, Blacklist)
 * - App Open Tracking & Active Player Count
 */

var LAUNCHER_WINDOW = "launcher";
var INGAME_WINDOW = "in_game";
var INGAME_SETTINGS_WINDOW = "in_game_settings";

var SETTINGS_KEY  = "refocus_settings_v2";
var UNRATED_KEY   = "unrated_messages";
var RATINGS_KEY   = "refocus_ratings";
var VALORANT_GAME_ID = 21640;

var REQUIRED_FEATURES = ["match_info", "me", "game_info"];
var STATUS_POLL_MS = 2000;


var cloudSyncStatus = "pending";
var CLOUD_REFRESH_MS = 30 * 60 * 1000; // 30 minutes

var presenceId = "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
var presenceHeartbeatTimer = null;
var PRESENCE_HEARTBEAT_MS = 120000;
var PRESENCE_STALE_MS     = 5 * 60 * 1000; // 5 min — 2.5× heartbeat; anything older is offline
var onlinePlayerCount = null;
var isOnline = (typeof navigator !== "undefined") ? navigator.onLine : true;

// ---------------- Toast pools (Local Backups) ----------------

var TOASTS_ATTACKER = [
  "Use your kit to clear, not your body.",
  "Push together, not one at a time.",
  "If your teammate dies entry, follow up immediately.",
  "Don't autopilot.",
  "Take map control before committing to a site.",
  "Trade immediately if your entry dies.",
  "Don't always commit on the first kill.",
  "Fake a site.",
  "Default first, then see what opens up.",
  "Use utility to make the entry safe.",
  "If mid is open, take it.",
  "Play off your teammate's contact.",
  "Don't dry peek. Set the fight up first."
];

var TOASTS_DEFENDER = [
  "Play crossfire with your teammate.",
  "Tighter angles are harder to clear.",
  "Make them work for every inch, use your utility.",
  "Time is on your side. Use it.",
  "Don't peek an angle, just hold.",
  "Let them come to you.",
  "If you are solo on site, fall back and play retake.",
  "Switch your position, be unpredictable.",
  "Hold your angle. Don't go looking for fights.",
  "Fight for space with your teammate.",
  "Use your utility to delay, not just to kill."
];

var TOASTS_ULT_AWARENESS = [
  "Build your plan around who has ultimate.",
  "Expect an ultimate to be used this round.",
  "Watch out for ultimates.",
  "Check the scoreboard. Who has their ult?",
  "If a game-changing ult is up, play around it.",
  "Read their economy, adjust your pace."
];

// --- APP OPEN TRACKER ---
function trackAppOpen() {
  const trackURL = "https://refocus-ed10f-default-rtdb.europe-west1.firebasedatabase.app/stats/opens.json";
  fetch(trackURL, {
    method: "POST", // POST creates a new unique entry every time
    headers: { "Content-Type": "application/json" }, // Tells Firebase we are sending JSON
    body: JSON.stringify({ 
      timestamp: new Date().toISOString(), 
      version: "0.4.0" 
    })
  })
  .then(response => {
    if(response.ok) diagInfo("App Open Tracked Successfully! 📈");
  })
  .catch(e => {
    // Fails silently if offline
  });
}

// --- PRESENCE / ACTIVE PLAYERS ---
var FIREBASE_BASE = "https://refocus-ed10f-default-rtdb.europe-west1.firebasedatabase.app";

function updatePresence() {
  fetch(FIREBASE_BASE + "/presence/" + presenceId + ".json", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lastSeen: Date.now(), version: "0.4.0" })
  })
  .then(function(r) {
    if (r.ok) { diagInfo("Presence updated ✅"); }
    else { r.text().then(function(t) { diagInfo("Presence PUT failed (" + r.status + "): " + t); }); }
  })
  .catch(function(e) { diagInfo("Presence fetch error: " + e.message); });
}

function removePresence() {
  fetch(FIREBASE_BASE + "/presence/" + presenceId + ".json", {
    method: "DELETE"
  }).catch(function() {});
}

function cleanupStalePresence() {
  fetch(FIREBASE_BASE + "/presence.json")
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || typeof data !== "object") return;
      var cutoff = Date.now() - PRESENCE_STALE_MS;
      Object.keys(data).forEach(function(key) {
        var entry = data[key];
        if (!entry || typeof entry.lastSeen !== "number" || entry.lastSeen < cutoff) {
          fetch(FIREBASE_BASE + "/presence/" + key + ".json", { method: "DELETE" })
            .catch(function() {});
        }
      });
    })
    .catch(function() {});
}

async function fetchPresenceCount() {
  if (!isOnline) return;
  try {
    var r = await fetch(FIREBASE_BASE + "/presence.json");
    if (!r.ok) return;
    var data = await r.json();
    var cutoff = nowMs() - PRESENCE_STALE_MS;
    var count = 0;
    if (data && typeof data === "object") {
      Object.keys(data).forEach(function(k) {
        if (data[k] && data[k].lastSeen >= cutoff) count++;
      });
    }
    onlinePlayerCount = count;
    sendStatusToLauncher(null, true);
  } catch(e) {}
}

function initPresence() {
  updatePresence();
  fetchPresenceCount();
  presenceHeartbeatTimer = setInterval(updatePresence, PRESENCE_HEARTBEAT_MS);
  setInterval(fetchPresenceCount, PRESENCE_HEARTBEAT_MS);
  setInterval(cleanupStalePresence, 10 * 60 * 1000); // re-run every 10 min
  cleanupStalePresence();                             // run once immediately at startup
  overwolf.windows.onStateChanged.addListener(function(state) {
    if (state.window_state === "closed") removePresence();
  });
}

// --- 100% FIREBASE CLOUD SYNC ---
async function syncToastsFromCloud() {
  const cloudURL = "https://refocus-ed10f-default-rtdb.europe-west1.firebasedatabase.app/tips.json";
  
  diagInfo("Syncing with Refocus Cloud...");

  try {
    const response = await fetch(cloudURL);
    if (!response.ok) throw new Error("Sync failed");

    const cloudData = await response.json();

    if (cloudData) {
      if (cloudData.attacker) TOASTS_ATTACKER = cloudData.attacker;
      if (cloudData.defender) TOASTS_DEFENDER = cloudData.defender;
      if (cloudData.ult)      TOASTS_ULT_AWARENESS = cloudData.ult;
      
if (cloudData.halftime)    TOASTS_HALFTIME = cloudData.halftime;
      if (cloudData.match_point) TOASTS_MATCH_POINT = cloudData.match_point;
      if (cloudData.overtime)    TOASTS_OVERTIME = cloudData.overtime;
      if (cloudData.win_streak)  TOASTS_WIN_STREAK = cloudData.win_streak;
      if (cloudData.loss_streak) TOASTS_LOSS_STREAK = cloudData.loss_streak;
      if (cloudData.big_lead)    TOASTS_BIG_LEAD = cloudData.big_lead;
      if (cloudData.comeback)    TOASTS_COMEBACK = cloudData.comeback;
      if (cloudData.close_game)  TOASTS_CLOSE_GAME = cloudData.close_game;
      if (cloudData.comebackd)   TOASTS_COMEBACKD = cloudData.comebackd;
      
      if (cloudData.agents)      AGENT_POOLS = cloudData.agents;
      
      cloudSyncStatus = "success";
      diagInfo("Cloud sync success! 100% of tips are now managed remotely.");
      sendStatusToLauncher(null, true);
    }
  } catch (err) {
    cloudSyncStatus = "failed";
    diagInfo("Cloud sync failed: " + err.message + ". Using local backup tips.");
    sendStatusToLauncher(null, true);
  }
}

// --- GEP SERVICE STATUS CHECK ---
function checkGepServiceStatus() {
  fetch("https://game-events-status.overwolf.com/21640_prod.json")
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || typeof data.state !== "number") return;
      var prev = gepServiceState;
      gepServiceState = data.state;
      diagInfo("GEP service state: " + gepServiceState + " (1=good, 2=partial, 3=down)");
      if (gepServiceState !== prev) sendStatusToLauncher(null, true);
    })
    .catch(function() {});
}

// ---------------- Situational Pools ----------------

var TOASTS_HALFTIME = [
  "New half, reset your mindset.",
  "Forget the last half. Fresh start.",
  "New half. New reads. Stay sharp."
];

var TOASTS_MATCH_POINT = [
  "Match point. Stay calm.",
  "One round. Remember what was working.",
  "Pressure is normal. Everyone feels it. Stay sharp!"
];

var TOASTS_OVERTIME = [
  "Overtime. One round at a time.",
  "It's even for a reason. Stay sharp.",
  "One round. Nothing else matters right now.",
  "Overtime goes to the calmer team. Be that team.",
  "Reset. Breathe. One round."
];

var TOASTS_WIN_STREAK = [
  "If something works, don't change it.",
  "Keep doing what you're doing.",
  "Ride the momentum. Stay consistent."
];

var TOASTS_LOSS_STREAK = [
  "Time to adjust. Try something different.",
  "Change your approach. What you're doing isn't working.",
  "Switch it up - they're reading your patterns."
];

var TOASTS_BIG_LEAD = [
  "Big lead. Don't get sloppy.",
  "Finish strong. No autopilot."
];

var TOASTS_COMEBACK = [
  "They're coming back. Reset your mental.",
  "Try faking a site",
  "Try something completely new."
];

var TOASTS_CLOSE_GAME = [
  "Close game. Every decision matters."
];

var TOASTS_COMEBACKD = [
  "Don't panic. Play your game.",
  "Reset. Remember what was working earlier."
];

// ---------------- Agent Pools ----------------

var TOASTS_AGENT_JETT_ATK = ["Dash is your exit. Don't entry without it.", "Take one duel, then reposition. Don't farm the same angle.", "Smoke + dash > dry swing.", "Clear close before dashing deep.", "If you died first: next round wait half a second for trade."];
var TOASTS_AGENT_JETT_DEF = ["Op angle + dash escape. Don't overstay.", "Take contact, fall back, re-peek from new spot.", "If they rush: stall, don't hero swing.", "Play off sound, not ego.", "One pick is enough. Live."];
var TOASTS_AGENT_REYNA_ATK = ["Isolate 1v1s. Don't swing into two.", "Kill, dismiss, reset. Don't chain fights blindly.", "Play near trade range.", "If blind missed, don't force the swing.", "Slow your first bullets."];
var TOASTS_AGENT_REYNA_DEF = ["Hold tight angle. Force them into you.", "Take first contact, dismiss out.", "Don't overheat after first kill.", "If they rush: back up and re-fight.", "You don't need to peek twice."];
var TOASTS_AGENT_RAZE_ATK = ["Utility clears space. Use it before swinging.", "Boombot first, body second.", "Satchel with timing, not alone.", "Stop dry clearing tight corners.", "Ult = secure site, not montage."];
var TOASTS_AGENT_RAZE_DEF = ["Nade on contact, not after plant.", "Delay > damage.", "Play off sound cues.", "If overwhelmed: fall back, don't commit.", "You're strongest stalling."];
var TOASTS_AGENT_PHOENIX_ATK = ["Flash and swing immediately.", "Wall to cross, not to hide.", "Ult for entry info.", "Heal only when safe.", "Don't re-peek without flash."];
var TOASTS_AGENT_PHOENIX_DEF = ["Flash through choke on sound.", "Play anti-rush, not hero.", "Use molly to deny plant.", "After first duel, reposition.", "Short fights favor you."];
var TOASTS_AGENT_NEON_ATK = ["Speed with team, not ahead of them.", "Slide after contact.", "Stun before swing.", "Clear close before sprint.", "Pause. Aim. Then shoot."];
var TOASTS_AGENT_NEON_DEF = ["Take info space early, fall back.", "Stun rush lanes.", "Don't over-rotate instantly.", "Play hit-and-run.", "Live after first fight."];
var TOASTS_AGENT_SOVA_ATK = ["Recon before entry.", "Drone for first contact.", "Call what you see.", "Don't peek if arrow missed.", "Shock to clear corners."];
var TOASTS_AGENT_SOVA_DEF = ["Early recon for info.", "Drone on retake.", "Hold until arrow lands.", "Don't ego peek without info.", "Ult for delay."];
var TOASTS_AGENT_SKYE_ATK = ["Flash for team swing.", "Dog clears close.", "Pop flash fast.", "Trade your entry.", "Heal after control."];
var TOASTS_AGENT_SKYE_DEF = ["Flash choke on sound.", "Play second contact.", "Dog before re-peek.", "Retake with flash.", "Enable, don't entry."];
var TOASTS_AGENT_BREACH_ATK = ["Stun then explode.", "Flash through wall, swing instantly.", "Don't solo entry.", "Call your timing.", "Ult to break site hold."];
var TOASTS_AGENT_BREACH_DEF = ["Stun rush instantly.", "Flash for retake.", "Delay, don't duel first.", "Play behind cover.", "Use one piece at a time."];
var TOASTS_AGENT_OMEN_ATK = ["Smoke for entry, not comfort.", "Paranoia = go signal.", "Teleport after pressure.", "Lurk with timing.", "Don't waste last smoke."];
var TOASTS_AGENT_OMEN_DEF = ["Early smoke slows rush.", "Play inside your smoke smartly.", "Reposition after contact.", "Paranoia retake swing.", "Anchor and live."];
var TOASTS_AGENT_BRIMSTONE_ATK = ["Smokes down = move.", "Molly for plant.", "Stim before swing.", "Save one smoke post-plant.", "Don't die before execute."];
var TOASTS_AGENT_BRIMSTONE_DEF = ["Smoke choke on sound.", "Molly stops plant.", "Ult deny spike.", "Delay first.", "Anchor safe."];
var TOASTS_AGENT_VIPER_ATK = ["Wall for cross.", "Turn wall off to punish.", "Orb for plant.", "Don't waste fuel.", "Plan before barrier drops."];
var TOASTS_AGENT_VIPER_DEF = ["Wall stall rush.", "Play decay advantage.", "Orb choke early.", "Ult to anchor.", "Live for retake."];
var TOASTS_AGENT_KILLJOY_ATK = ["Utility holds flank.", "Don't entry first.", "Play off alarmbot.", "Ult for site take.", "Stay near setup."];
var TOASTS_AGENT_KILLJOY_DEF = ["Anchor deeper.", "Let turret make contact.", "Don't peek before trigger.", "Delay, not duel.", "Move setup each round."];
var TOASTS_AGENT_CYPHER_ATK = ["Trip flank.", "Don't lurk too far.", "Cage to isolate.", "Trade entry.", "Info before push."];
var TOASTS_AGENT_CYPHER_DEF = ["Play off trip contact.", "Move one trip every round.", "Cage on rush.", "Delay and call.", "Stay alive."];
var TOASTS_AGENT_SAGE_ATK = ["Wall for plant.", "Heal after control.", "Don't entry.", "Slow for post-plant.", "Play safe with revive."];
var TOASTS_AGENT_SAGE_DEF = ["Wall early delay.", "Slow rush lanes.", "Play deep.", "Don't hero peek.", "Retake calm."];
var TOASTS_AGENT_YORU_ATK = ["Fake once, commit once.", "Flash and swing.", "Teleport with plan.", "Don't over-trick."];
var TOASTS_AGENT_YORU_DEF = ["Unexpected off-angles.", "Fake pressure.", "Reposition often.", "Change pattern."];
var TOASTS_AGENT_ISO_ATK = ["Take clean 1v1.", "Shield before fight.", "Isolate first.", "Trade properly."];
var TOASTS_AGENT_ISO_DEF = ["Hold tight angle.", "Take duel, reset.", "Don't chase.", "Anchor calmly."];
var TOASTS_AGENT_WAYLAY_ATK = ["Hit fast, exit fast.", "Keep escape ready.", "Time with team.", "Don't overstay."];
var TOASTS_AGENT_WAYLAY_DEF = ["Disrupt then fall back.", "Punish overpush.", "Hold crossfire.", "Control tempo."];
var TOASTS_AGENT_ASTRA_ATK = ["Stars first, execute second.", "Smoke down means go.", "Pull must create a swing.", "Don't waste all utility early."];
var TOASTS_AGENT_ASTRA_DEF = ["Stall with one star, not three.", "Delay, then fall back.", "Play off gravity well contact.", "Live to reactivate."];
var TOASTS_AGENT_CLOVE_ATK = ["Smoke to isolate.", "Fight near a teammate.", "Decay before commit.", "Stay useful after death."];
var TOASTS_AGENT_CLOVE_DEF = ["Early smoke slows rush.", "Trade, don't solo hold.", "Anchor one lane.", "Support even after death."];
var TOASTS_AGENT_HARBOR_ATK = ["Wall to cross safely.", "Move with your utility.", "Cove secures plant.", "Cut vision, then clear."];
var TOASTS_AGENT_HARBOR_DEF = ["Wall to stall.", "Delay before fighting.", "Play off slowed contact.", "Retake together."];
var TOASTS_AGENT_CHAMBER_ATK = ["One pick, then reset.", "Trap flank early.", "Don't re-peek.", "Play trade range."];
var TOASTS_AGENT_CHAMBER_DEF = ["Shoot once, reposition.", "Escape plan ready.", "Delay rush.", "Live after first kill."];
var TOASTS_AGENT_DEADLOCK_ATK = ["Split site with wall.", "Isolate one target.", "Don't entry first.", "Force 2v1."];
var TOASTS_AGENT_DEADLOCK_DEF = ["Play behind sensors.", "Let them trigger.", "Delay push.", "Control space."];
var TOASTS_AGENT_VYSE_ATK = ["Trap for isolation.", "Blind with swing.", "Create unfair fights.", "Reset after contact."];
var TOASTS_AGENT_VYSE_DEF = ["Trap common entry.", "Punish first contact.", "Hold tight.", "Delay push."];
var TOASTS_AGENT_FADE_ATK = ["Haunt first, swing second.", "Clear one area fully.", "Don't peek without info.", "Seize must create a fight.", "Trade your entry."];
var TOASTS_AGENT_FADE_DEF = ["Early reveal slows push.", "Play off scan contact.", "Don't re-peek blind.", "Save one piece for retake.", "Info before fight."];
var TOASTS_AGENT_GEKKO_ATK = ["Send Wingman first.", "Plant safely with Cove.", "Use utility to force movement.", "Pick up your buddies.", "Don't entry alone."];
var TOASTS_AGENT_GEKKO_DEF = ["Wingman for retake pressure.", "Play off Dizzy contact.", "Delay with Mosh.", "Stay tradable.", "Utility first, duel second."];
var TOASTS_AGENT_TEJO_ATK = ["Drone before commit.", "Strike to clear ground.", "Don't guess positions.", "Create pressure, then hit.", "Move with info."];
var TOASTS_AGENT_TEJO_DEF = ["Drone early for numbers.", "Disrupt before they plant.", "Play off utility impact.", "Delay with structure.", "Anchor patiently."];
var TOASTS_AGENT_KAYO_ATK = ["Knife before you swing.", "Flash = instant peek.", "Suppress then commit.", "Don't entry without utility.", "Call suppressed targets.", "Trade your duelist.", "Ult with your team, not alone.", "Clear close with molly."];
var TOASTS_AGENT_KAYO_DEF = ["Early knife for info.", "Flash choke on contact.", "Suppress rush, then fall back.", "Delay before fighting.", "Don't ego peek without info.", "Ult to stop execute.", "Play second contact.", "Live after first fight."];
var TOASTS_AGENT_VETO_ATK = ["Deny enemy utility.", "Isolate one lane.", "Don't overextend.", "Play structured."];
var TOASTS_AGENT_VETO_DEF = ["Control choke.", "Utility before duel.", "Anchor site.", "Play for time."];

var AGENT_POOLS = {
  "Jett":      { atk: TOASTS_AGENT_JETT_ATK,      def: TOASTS_AGENT_JETT_DEF },
  "Reyna":     { atk: TOASTS_AGENT_REYNA_ATK,     def: TOASTS_AGENT_REYNA_DEF },
  "Raze":      { atk: TOASTS_AGENT_RAZE_ATK,      def: TOASTS_AGENT_RAZE_DEF },
  "Phoenix":   { atk: TOASTS_AGENT_PHOENIX_ATK,   def: TOASTS_AGENT_PHOENIX_DEF },
  "Neon":      { atk: TOASTS_AGENT_NEON_ATK,      def: TOASTS_AGENT_NEON_DEF },
  "Sova":      { atk: TOASTS_AGENT_SOVA_ATK,      def: TOASTS_AGENT_SOVA_DEF },
  "Skye":      { atk: TOASTS_AGENT_SKYE_ATK,      def: TOASTS_AGENT_SKYE_DEF },
  "Breach":    { atk: TOASTS_AGENT_BREACH_ATK,    def: TOASTS_AGENT_BREACH_DEF },
  "Omen":      { atk: TOASTS_AGENT_OMEN_ATK,      def: TOASTS_AGENT_OMEN_DEF },
  "Brimstone": { atk: TOASTS_AGENT_BRIMSTONE_ATK, def: TOASTS_AGENT_BRIMSTONE_DEF },
  "Viper":     { atk: TOASTS_AGENT_VIPER_ATK,     def: TOASTS_AGENT_VIPER_DEF },
  "Killjoy":   { atk: TOASTS_AGENT_KILLJOY_ATK,   def: TOASTS_AGENT_KILLJOY_DEF },
  "Cypher":    { atk: TOASTS_AGENT_CYPHER_ATK,    def: TOASTS_AGENT_CYPHER_DEF },
  "Sage":      { atk: TOASTS_AGENT_SAGE_ATK,      def: TOASTS_AGENT_SAGE_DEF },
  "Yoru":      { atk: TOASTS_AGENT_YORU_ATK,      def: TOASTS_AGENT_YORU_DEF },
  "Iso":       { atk: TOASTS_AGENT_ISO_ATK,       def: TOASTS_AGENT_ISO_DEF },
  "Waylay":    { atk: TOASTS_AGENT_WAYLAY_ATK,    def: TOASTS_AGENT_WAYLAY_DEF },
  "Astra":     { atk: TOASTS_AGENT_ASTRA_ATK,     def: TOASTS_AGENT_ASTRA_DEF },
  "Clove":     { atk: TOASTS_AGENT_CLOVE_ATK,     def: TOASTS_AGENT_CLOVE_DEF },
  "Harbor":    { atk: TOASTS_AGENT_HARBOR_ATK,    def: TOASTS_AGENT_HARBOR_DEF },
  "Chamber":   { atk: TOASTS_AGENT_CHAMBER_ATK,   def: TOASTS_AGENT_CHAMBER_DEF },
  "Deadlock":  { atk: TOASTS_AGENT_DEADLOCK_ATK,  def: TOASTS_AGENT_DEADLOCK_DEF },
  "Vyse":      { atk: TOASTS_AGENT_VYSE_ATK,      def: TOASTS_AGENT_VYSE_DEF },
  "Fade":      { atk: TOASTS_AGENT_FADE_ATK,      def: TOASTS_AGENT_FADE_DEF },
  "Gekko":     { atk: TOASTS_AGENT_GEKKO_ATK,     def: TOASTS_AGENT_GEKKO_DEF },
  "Tejo":      { atk: TOASTS_AGENT_TEJO_ATK,      def: TOASTS_AGENT_TEJO_DEF },
  "KAYO":      { atk: TOASTS_AGENT_KAYO_ATK,      def: TOASTS_AGENT_KAYO_DEF },
  "Veto":      { atk: TOASTS_AGENT_VETO_ATK,      def: TOASTS_AGENT_VETO_DEF }
};

var TOASTS_BONUS_ROUND = [
  "Bonus round — save for the full buy if you can.",
  "Keep your gun if it's good enough. Don't over-spend.",
  "Check your credits. Can you full buy next round?",
  "Bonus round. Make sure your team is on the same page.",
  "Don't force if it risks your full buy next round.",
  "Play for the save if you can't full buy next round.",
  "Bonus round — coordinate with your team on the buy.",
];

// --- MESSAGE ROUND CONSTRAINTS ---
var ROUND_CONSTRAINTS = {
  "Don't autopilot.": 4,
  "Take map control before committing to a site.": 4,
  "Fake a site.": 6,
  "Default first, then see what opens up.": 4,
  "If mid is open, take it.": 4,
  "Switch your position, be unpredictable.": 4
};

function filterByRound(list, currentRound) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var msg = list[i];
    var req = ROUND_CONSTRAINTS[msg] || 1;
    if (currentRound >= req) {
      out.push(msg);
    }
  }
  return out;
}

// ---------------- State ----------------
var launcherId = null;
var inGameId = null;
var inGameSettingsId = null;
var inGameSettingsVisible = false;

var SETTINGS_KEY  = "refocus_settings_v2";
var DEFAULT_SETTINGS = { overlayEnabled: true, position: "tr", devMode: false, theme: "default", toastMs: 10000, opacity: 1, soundEnabled: false };
var settings = loadSettings();

var lastToastAt = 0;
var messageLastShown = {};

var eventsOk = false;
var gepRequestedOk = false;
var gepSeenAnyUpdate = false;
var lastGepUpdateAt = 0;
var GEP_STREAMING_MS = 5000;

var valorantRunning = false;
var valorantFocused = false;

var detectedGameId = null;
var detectedInstanceId = null;

var lastStatusSig = "";
var lastRunningSig = "";

var cachedGameResolution = null; 

var hasPolledOnce = false;
var valorantSessionId = 0;
var runningToastShownForSession = false;

var lastKnownIsValo = false;
var lastKnownValoAt = 0;
var VALO_STICKY_MS = 3500;

// Match / round info
var lastRoundNumber = null;
var lastToastRoundNumber = null;
var lastKnownRound = null;
var lastKnownPhase = null;

var lastMatchId = null;
var lastMapId = null;


var meTeam = null;              
var matchTeamSide = null;        
var localTeamId = null;          
var localPlayerAgent = null;     

var halftimeShownForMatch = false;   
var overtimeAnnouncedRound = null;   
var stackedToastShownForRounds = {}; 

var myScore = { won: 0, lost: 0 };         
var enemyScore = { won: 0, lost: 0 };      
var lastScoreWon = 0;                      
var lastScoreLost = 0;                     
var currentStreak = 0;                     
var peakLead = 0;                          
var peakDeficit = 0;                       

var categoryLastShown = {};
var gepRetryTimer = null;
var gepRetryCount = 0;
var gepNoDataRerequestCount = 0;
var gepServiceState = -1; // -1=unknown, 1=good, 2=partial, 3=down
var _gepIsSnapshot = false; // true only during synchronous getInfo snapshot call chain
var valorantRunningSince = 0;              
var lastGepRerequestAt = 0;                
var agentPollTimer = null;                 
var sessionMessages = [];

// ---------------- Utils ----------------
function nowMs() { return Date.now(); }
function safeJsonParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function parseMaybeJson(v) {
  if (typeof v !== "string") return v;
  var t = v.trim();
  if (!t) return v;
  if (
    (t.charAt(0) === "{" && t.charAt(t.length - 1) === "}") ||
    (t.charAt(0) === "[" && t.charAt(t.length - 1) === "]")
  ) {
    var j = safeJsonParse(t);
    return j !== null ? j : v;
  }
  return v;
}

function getSenderWindowId(e) {
  if (!e) return null;
  if (e.source && e.source.id) return e.source.id;
  if (e.sourceWindowId) return e.sourceWindowId;
  if (e.sender && e.sender.id) return e.sender.id;
  return null;
}

function sendMessageSafe(winId, msgId, payload) {
  try {
    if (!winId) return;
    overwolf.windows.sendMessage(winId, msgId, payload || {}, function () {});
  } catch (e) {}
}

function sendToLauncher(targetLauncherId, msgId, payload) {
  var id = targetLauncherId || launcherId;
  if (!id) return;
  sendMessageSafe(id, msgId, payload);
}

function diagInfo(msg, targetLauncherId) {
  try { console.log("[Refocus]", msg); } catch (e) {}
  sendToLauncher(targetLauncherId, "diag", { msg: msg });
}

function diagDebug(msg, targetLauncherId) {
  if (!settings.devMode) return;
  try { console.log("[Refocus]", msg); } catch (e) {}
  sendToLauncher(targetLauncherId, "diag", { msg: msg });
}

// ---------------- Settings ----------------
function loadSettings() {
  try {
    var raw = localStorage.getItem(SETTINGS_KEY);
    var j = raw ? safeJsonParse(raw) : null;
    var out = {
      overlayEnabled: DEFAULT_SETTINGS.overlayEnabled,
      position: DEFAULT_SETTINGS.position,
      devMode: DEFAULT_SETTINGS.devMode,
      theme: DEFAULT_SETTINGS.theme,
      toastMs: DEFAULT_SETTINGS.toastMs,
      opacity: DEFAULT_SETTINGS.opacity,
      soundEnabled: DEFAULT_SETTINGS.soundEnabled
    };
    if (j) {
      if (typeof j.overlayEnabled === "boolean") out.overlayEnabled = j.overlayEnabled;
      if (j.position) out.position = j.position;
      if (typeof j.devMode === "boolean") out.devMode = j.devMode;
      if (j.theme) out.theme = j.theme;
      if (typeof j.toastMs === "number" && j.toastMs >= 3000) out.toastMs = j.toastMs;
      if (typeof j.opacity === "number" && j.opacity >= 0.3 && j.opacity <= 1) out.opacity = j.opacity;
      if (typeof j.soundEnabled === "boolean") out.soundEnabled = j.soundEnabled;
    }
    return out;
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

function pushSettingsToLauncher(targetLauncherId) {
  sendToLauncher(targetLauncherId, "settings_current", settings);
  // Also keep the in-game settings overlay in sync
  if (inGameSettingsId && inGameSettingsId !== targetLauncherId) {
    sendMessageSafe(inGameSettingsId, "settings_current", settings);
  }
}

// ---------------- Toast selection ----------------
function tuning() {
  return { toastMs: settings.toastMs || 10000,
           globalCooldownMs: 0,
           perMessageCooldownMs: 600000 };
}

// --- NEW ADVANCED MATH SYSTEM ---
function pickRandomMessage(list, perMessageCooldownMs) {
  var now = nowMs();
  var allowed = [];
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if ((now - (messageLastShown[m] || 0)) >= perMessageCooldownMs) allowed.push(m);
  }
  var pool = allowed.length ? allowed : list;

  var ratings = loadRatings();
  var weighted = [];
  
  for (var j = 0; j < pool.length; j++) {
    var msg = pool[j];
    var entry = ratings[msg];
    var score = 0;

    // Backwards compatibility for old users who rated Yes/No
    if (typeof entry === 'object' && entry !== null) {
      score = (entry.up || 0) - (entry.down || 0);
      if (score > 0) score = 1;
      else if (score < 0) score = -1;
    } else if (typeof entry === 'number') {
      score = entry; // New math
    }

    var w = 2; // Baseline weight for unrated
    if (score <= -10) w = 0;      // ❌ Blacklisted (Never show)
    else if (score === -1) w = 1; // 🥱 Boring (Half chance)
    else if (score === 0) w = 2;  // Standard
    else if (score === 1) w = 4;  // 👍 Helpful (Double chance)
    else if (score >= 2) w = 8;   // 🔥 Game Changer (Quadruple chance)

    for (var k = 0; k < w; k++) weighted.push(msg);
  }
  
  if (weighted.length === 0) weighted = pool;
  if (weighted.length === 0) weighted = list;
  return weighted[Math.floor(Math.random() * weighted.length)];
}

function pickFromCategory(list, categoryKey, categoryCooldownMs, perMessageCooldownMs) {
  if (categoryCooldownMs > 0) {
    var now = nowMs();
    var catLast = categoryLastShown[categoryKey] || 0;
    if ((now - catLast) < categoryCooldownMs) return null; 
  }
  return pickRandomMessage(list, perMessageCooldownMs);
}

function markCategoryShown(categoryKey) {
  categoryLastShown[categoryKey] = nowMs();
}

function markMessageShown(msg) {
  var now = nowMs();
  messageLastShown[msg] = now;
  lastToastAt = now;
}

function recordSessionMessage(text, category, roundNumber) {
  var side = getSideForRound(roundNumber);
  var scoreStr = myScore.won + "-" + myScore.lost;
  sessionMessages.push({
    messageText: text,
    messageCategory: category,
    roundNumber: roundNumber,
    currentScore: scoreStr,
    currentStreak: currentStreak,
    userSide: side,
    timestamp: new Date().toISOString(),
    appVersion: "0.4.0"
  });
}

function loadRatings() {
  try {
    var raw = localStorage.getItem(RATINGS_KEY);
    return raw ? (safeJsonParse(raw) || {}) : {};
  } catch (e) { return {}; }
}

function saveRatingLocal(messageText, vote) {
  try {
    var ratings = loadRatings();
    ratings[messageText] = vote; // Absolute overwrite with new Math weights
    localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings));
  } catch (e) {}
}

function getGameSizeFallback() { return { W: 1920, H: 1080 }; }

// ---------------- Toast window positioning ----------------
function positionToastWindow(done) {
  if (!inGameId) { if (done) done(1); return; }

  function _doPosition() {
    var sz = cachedGameResolution || getGameSizeFallback();
    var W = sz.W, H = sz.H;

    // ── Step 1: Detect if VALORANT content is pillarboxed within a wider window ──
    // On ultrawide monitors (e.g. 5120×1440), VALORANT renders at 16:9 centered
    // with black bars. getRunningGameInfo() reports the full window size (5120×1440).
    var gameW = W, gameH = H, offsetX = 0, offsetY = 0;
    var aspect = W / H;
    var targetAspect = 16 / 9; // VALORANT always renders 16:9

    if (aspect > targetAspect * 1.1) {
      // Window is significantly wider than 16:9 (ultrawide/superwide)
      // → game content is 16:9 pillarboxed in the center
      gameW = Math.round(H * targetAspect);
      offsetX = Math.round((W - gameW) / 2);
    } else {
      // Window is ~16:9. But the game window itself may be centered on a
      // larger monitor (e.g. info.width=2560, screen.width=5120).
      var screenW = (typeof screen !== "undefined" && screen.width > 0) ? screen.width : W;
      var screenH = (typeof screen !== "undefined" && screen.height > 0) ? screen.height : H;
      if (W < screenW * 0.9) { offsetX = Math.round((screenW - W) / 2); }
      if (H < screenH * 0.9) { offsetY = Math.round((screenH - H) / 2); }
    }

    // ── Step 2: Scale and size based on actual game content width ──
    var scale   = Math.min(1.5, Math.max(0.5, gameW / 1920));
    var toastW  = Math.round(420 * scale);
    var toastH  = Math.round(160 * scale);
    var marginX = Math.round(18  * scale);
    var marginY = Math.round(18  * scale);

    // ── Step 3: Position within game content area, offset to absolute screen coords ──
    var pos = String(settings.position || "tr").toLowerCase();
    var x, y;
    if      (pos === "tr") { x = offsetX + Math.max(10, gameW - toastW - marginX); y = offsetY + marginY; }
    else if (pos === "tl") { x = offsetX + marginX;                                 y = offsetY + marginY; }
    else if (pos === "br") { x = offsetX + Math.max(10, gameW - toastW - marginX); y = offsetY + Math.max(10, gameH - toastH - marginY); }
    else if (pos === "bl") { x = offsetX + marginX;                                 y = offsetY + Math.max(10, gameH - toastH - marginY); }
    else                   { x = offsetX + Math.max(10, gameW - toastW - marginX); y = offsetY + marginY; }

    try {
      overwolf.windows.changeSize(inGameId, toastW, toastH, function() {
        overwolf.windows.changePosition(inGameId, x, y, function() {
          if (done) done(scale);
        });
      });
    } catch(e) { if (done) done(scale); }
  }

  try {
    overwolf.games.getRunningGameInfo(function(info) {
      if (info && typeof info.width === "number" && info.width > 0 &&
          typeof info.height === "number" && info.height > 0) {
        cachedGameResolution = { W: info.width, H: info.height };
      }
      _doPosition();
    });
  } catch(e) { _doPosition(); }
}

// ---------------- In-game settings overlay ----------------
function positionSettingsOverlay(done) {
  if (!inGameSettingsId) { if (done) done(); return; }

  function _doPosition() {
    var sz = cachedGameResolution || getGameSizeFallback();
    var W = sz.W, H = sz.H;
    // Reuse same pillarbox/offset logic as positionToastWindow
    var gameW = W, gameH = H, offsetX = 0, offsetY = 0;
    var aspect = W / H;
    var targetAspect = 16 / 9;
    
    if (aspect > targetAspect * 1.1) {
      gameW = Math.round(H * targetAspect);
      offsetX = Math.round((W - gameW) / 2);
    } else {
      var screenW = (typeof screen !== "undefined" && screen.width > 0) ? screen.width : W;
      var screenH = (typeof screen !== "undefined" && screen.height > 0) ? screen.height : H;
      if (W < screenW * 0.9) { offsetX = Math.round((screenW - W) / 2); }
      if (H < screenH * 0.9) { offsetY = Math.round((screenH - H) / 2); }
    }
    // Cover the full game content area — CSS flexbox centers the panel inside
    try {
      overwolf.windows.changeSize(inGameSettingsId, gameW, gameH, function() {
        overwolf.windows.changePosition(inGameSettingsId, offsetX, offsetY, function() {
          if (done) done();
        });
      });
    } catch(e) { if (done) done(); }
  }

  try {
    overwolf.games.getRunningGameInfo(function(info) {
      if (info && typeof info.width === "number" && info.width > 0 &&
          typeof info.height === "number" && info.height > 0) {
        cachedGameResolution = { W: info.width, H: info.height };
      }
      _doPosition();
    });
  } catch(e) { _doPosition(); }
}

function toggleSettingsOverlay() {
  // If the window wasn't obtained at boot, try obtaining it right now
  if (!inGameSettingsId) {
    obtainDeclared(INGAME_SETTINGS_WINDOW, function(sg) {
      if (sg && sg.id) {
        inGameSettingsId = sg.id;
        toggleSettingsOverlay(); // Try again now that we have the ID
      }
    });
    return;
  }
  
  if (inGameSettingsVisible) {
    inGameSettingsVisible = false;
    try { overwolf.windows.hide(inGameSettingsId, function() {}); } catch(e) {}
  } else {
    inGameSettingsVisible = true;
    try {
      // Restore the window FIRST so it exists on screen, THEN position it
      overwolf.windows.restore(inGameSettingsId, function() {
        positionSettingsOverlay(function() {
          overwolf.windows.bringToFront(inGameSettingsId, true, function() {
            pushSettingsToLauncher(inGameSettingsId);
          });
        });
      });
    } catch(e) {}
  }
}

function showToast(type, text, durationMs) {
  if (!settings.overlayEnabled) return;
  if (!inGameId) return;

  positionToastWindow(function(scale) {
    try {
      overwolf.windows.restore(inGameId, function () {
        overwolf.windows.bringToFront(inGameId, function () {
          sendMessageSafe(inGameId, "toast", { type: type, text: text, durationMs: durationMs, theme: settings.theme, scale: scale, opacity: settings.opacity, soundEnabled: settings.soundEnabled });
        });
      });
    } catch (e) {}
  });
}

// ---------------- Status ----------------
function sendStatusToLauncher(targetLauncherId, force) {
  var streaming = gepSeenAnyUpdate && (nowMs() - lastGepUpdateAt < GEP_STREAMING_MS);
  var gepAppearsUnresponsive = valorantRunning && gepRequestedOk && !streaming &&
    (nowMs() - valorantRunningSince > 60000) &&
    (lastGepUpdateAt === 0 || nowMs() - lastGepUpdateAt > 180000);

  var st = {
    valorantRunning: valorantRunning,
    valorantFocused: valorantFocused,
    eventsOk: eventsOk,
    gepRequestedOk: gepRequestedOk,
    gepStreaming: streaming,
    gepAppearsUnresponsive: gepAppearsUnresponsive,
    gepServiceState: gepServiceState,
    detectedGameId: detectedGameId,
    detectedInstanceId: detectedInstanceId,
    cloudSync: cloudSyncStatus,
    gepRetryCount: gepRetryCount,
    gepNoDataRerequestCount: gepNoDataRerequestCount,
    isOnline: isOnline,
    onlineCount: onlinePlayerCount
  };

  var sig = JSON.stringify(st);
  if (!force && sig === lastStatusSig) return;
  lastStatusSig = sig;

  sendToLauncher(targetLauncherId, "status_current", st);
}

// ---------------- Resets ----------------
function resetMatchState(reason) {
  lastRoundNumber = null;
  lastToastRoundNumber = null;
  lastKnownRound = null;
  lastKnownPhase = null;

  lastMatchId = null;
  lastMapId = null;

  meTeam = null;
  matchTeamSide = null;
  localTeamId = null;

  diagDebug("Reset match state: " + reason);
}

function resetForNewMatch(reason) {
  saveSessionMessages();

  lastToastRoundNumber = null;
  lastRoundNumber = null;
  lastKnownRound = null;
  lastKnownPhase = null;

  meTeam = null;
  matchTeamSide = null;
  localTeamId = null;
  localPlayerAgent = null;
  stopAgentPoll();

  halftimeShownForMatch = false;
  overtimeAnnouncedRound = null;
  stackedToastShownForRounds = {};

  myScore = { won: 0, lost: 0 };
  enemyScore = { won: 0, lost: 0 };
  lastScoreWon = 0;
  lastScoreLost = 0;
  currentStreak = 0;
  peakLead = 0;
  peakDeficit = 0;

  diagInfo("NEW MATCH reset ✅ (" + reason + ")");
}

function normalizeInstanceToClassId(instanceId) {
  if (!instanceId || typeof instanceId !== "number") return null;
  return Math.floor(instanceId / 10);
}

function isValorantFromInfo(info) {
  var cid = (info && typeof info.classId === "number") ? info.classId : null;
  var iid = (info && typeof info.id === "number") ? info.id : null;

  if (cid === VALORANT_GAME_ID) return true;
  if (cid !== null && cid !== VALORANT_GAME_ID) return false;

  var norm = normalizeInstanceToClassId(iid);
  if (norm === VALORANT_GAME_ID) return true;

  var t = nowMs();
  if (lastKnownIsValo && (t - lastKnownValoAt) < VALO_STICKY_MS) return true;

  return false;
}

function pollGameStatus() {
  try {
    overwolf.games.getRunningGameInfo(function (info) {
      if (!info || !info.isRunning) {
        if (valorantRunning) saveSessionMessages();

        valorantRunning = false;
        valorantFocused = false;
        valorantRunningSince = 0;
        lastGepRerequestAt = 0;
        detectedGameId = null;
        detectedInstanceId = null;

        gepSeenAnyUpdate = false;
        lastGepUpdateAt = 0;

        runningToastShownForSession = false;

        if (gepRetryTimer) { clearTimeout(gepRetryTimer); gepRetryTimer = null; }
        gepRetryCount = 0;
        gepNoDataRerequestCount = 0;

        resetMatchState("game_not_running");
        sendStatusToLauncher();

        hasPolledOnce = true;
        lastKnownIsValo = false;
        return;
      }

      detectedInstanceId = info.id || null;

      if (typeof info.width === "number" && info.width > 0 &&
          typeof info.height === "number" && info.height > 0) {
        cachedGameResolution = { W: info.width, H: info.height };
      }

      var normCid = normalizeInstanceToClassId(info.id);
      detectedGameId = (typeof info.classId === "number") ? info.classId : normCid;

      var isValo = isValorantFromInfo(info);
      var isInFocus = !!info.isInFocus;

      if (isValo) {
        lastKnownIsValo = true;
        lastKnownValoAt = nowMs();
      } else {
        if ((nowMs() - lastKnownValoAt) > VALO_STICKY_MS) lastKnownIsValo = false;
      }

      if (isValo && !valorantRunning) {
        valorantSessionId += 1;
        valorantRunningSince = nowMs();
        runningToastShownForSession = false;
        diagDebug("Valorant launch detected -> session " + valorantSessionId);
        setRequiredFeatures();
      }

      if (isValo && valorantRunningSince === 0) valorantRunningSince = nowMs();

      valorantRunning = isValo;
      valorantFocused = isValo && isInFocus;

      if (valorantRunning && valorantFocused && !runningToastShownForSession) {
        if (hasPolledOnce) {
          runningToastShownForSession = true;
          if (settings.overlayEnabled) showToast("INFO", "Refocus is RUNNING ✅", 6000);
          diagInfo("RUNNING ✅ (toast shown once per launch)");
        }
      }

      var sig = String(detectedGameId || "?") + "|" + String(detectedInstanceId || "?") + "|" +
        (valorantRunning ? "YES" : "NO") + "|" + (valorantFocused ? "FOCUS" : "BG") + "|" + String(valorantSessionId);

      if (sig !== lastRunningSig) {
        lastRunningSig = sig;
        diagDebug("RunningGameInfo: val=" + (valorantRunning ? "YES" : "NO") + " foc=" + (valorantFocused ? "YES" : "NO"));
      }

      if (valorantRunning && !gepSeenAnyUpdate && valorantRunningSince > 0) {
        var now = nowMs();
        if (now - valorantRunningSince >= 12000 && now - lastGepRerequestAt >= 15000) {
          lastGepRerequestAt = now;
          gepNoDataRerequestCount++;
          diagInfo("GEP no data after 12s - re-requesting features (attempt " + gepNoDataRerequestCount + ")");
          setRequiredFeatures();
        }
      }

      sendStatusToLauncher();
      hasPolledOnce = true;
    });
  } catch (e) {
    diagInfo("pollGameStatus ERROR: " + (e && e.message ? e.message : String(e)));
  }
}

// ---------------- GEP ----------------
var GEP_RETRY_MS = 5000;

function setRequiredFeatures() {
  if (gepRetryTimer) { clearTimeout(gepRetryTimer); gepRetryTimer = null; }
  try {
    overwolf.games.events.setRequiredFeatures(REQUIRED_FEATURES, function (res) {
      if (!res || !res.success) {
        gepRequestedOk = false;
        eventsOk = false;
        gepRetryCount++;
        sendStatusToLauncher();
        var errMsg = (res && res.error ? res.error : "unknown");
        diagInfo("setRequiredFeatures FAILED (" + errMsg + ") - retrying in " + (GEP_RETRY_MS / 1000) + "s");
        gepRetryTimer = setTimeout(function () { if (valorantRunning) setRequiredFeatures(); }, GEP_RETRY_MS);
      } else {
        gepRequestedOk = true;
        gepRetryCount = 0;
        sendStatusToLauncher();
        diagInfo("setRequiredFeatures OK ✅");
        fetchCurrentGameInfo();
      }
    });
  } catch (e) {
    gepRequestedOk = false;
    eventsOk = false;
    gepRetryCount++;
    sendStatusToLauncher();
    diagInfo("setRequiredFeatures ERROR - retrying...");
    gepRetryTimer = setTimeout(function () { if (valorantRunning) setRequiredFeatures(); }, GEP_RETRY_MS);
  }
}

function onEventsError(e) {
  eventsOk = false;
  gepRequestedOk = false;
  sendStatusToLauncher();
  var reason = (e && e.reason) ? e.reason : JSON.stringify(e);
  diagInfo("GEP error: " + reason + " - retrying in " + (GEP_RETRY_MS / 1000) + "s");
  gepRetryTimer = setTimeout(function () { if (valorantRunning) setRequiredFeatures(); }, GEP_RETRY_MS);
}

function inferTeam(meObj) {
  try {
    if (meObj.team !== undefined && meObj.team !== null) return String(meObj.team).toLowerCase();
    if (meObj.team_id !== undefined && meObj.team_id !== null) return String(meObj.team_id).toLowerCase();
    if (meObj.teamId !== undefined && meObj.teamId !== null) return String(meObj.teamId).toLowerCase();
  } catch (e) {}
  return null;
}

function handleMatchInfoUpdate(mi) {
  if (!mi || typeof mi !== "object") return;

  var matchId = null;
  if (mi.match_id !== undefined && mi.match_id !== null) matchId = String(mi.match_id);
  else if (mi.matchId !== undefined && mi.matchId !== null) matchId = String(mi.matchId);

  var mapId = null;
  if (mi.map_id !== undefined && mi.map_id !== null) mapId = String(mi.map_id);
  else if (mi.mapId !== undefined && mi.mapId !== null) mapId = String(mi.mapId);

  if (matchId && matchId !== lastMatchId) {
    lastMatchId = matchId;
    if (mapId) lastMapId = mapId;
    resetForNewMatch("match_id changed");
  } else if (!matchId && mapId && mapId !== lastMapId) {
    lastMapId = mapId;
    resetForNewMatch("map_id changed");
  }

  var roundNumberRaw = (mi.round_number !== undefined) ? mi.round_number : mi.roundNumber;
  var roundPhaseRaw = (mi.round_phase !== undefined) ? mi.round_phase : mi.roundPhase;

  var roundNumber = (roundNumberRaw !== undefined && roundNumberRaw !== null) ? Number(roundNumberRaw) : null;
  var roundPhase = roundPhaseRaw ? String(roundPhaseRaw).toLowerCase() : null;

  if (roundNumber !== null && isFinite(roundNumber)) lastKnownRound = roundNumber;
  if (roundPhase) lastKnownPhase = roundPhase;

  var effectiveRound = (roundNumber !== null && isFinite(roundNumber)) ? roundNumber : lastKnownRound;
  var effectivePhase = roundPhase || lastKnownPhase;

  if (mi.score !== undefined && mi.score !== null) {
    var scoreObj = parseMaybeJson(mi.score);
    if (scoreObj && typeof scoreObj === "object") {
      var newWon = Number(scoreObj.won);
      var newLost = Number(scoreObj.lost);
      
      if (isFinite(newWon) && isFinite(newLost)) {
        if (newWon > lastScoreWon) {
          currentStreak = (currentStreak >= 0) ? currentStreak + 1 : 1;
          if (settings.devMode) diagDebug("🎉 Round WON | Streak: " + currentStreak);
        } else if (newLost > lastScoreLost) {
          currentStreak = (currentStreak <= 0) ? currentStreak - 1 : -1;
          if (settings.devMode) diagDebug("💀 Round LOST | Streak: " + currentStreak);

          var lostRound = (effectiveRound !== null && isFinite(effectiveRound) && effectiveRound > 0) ? effectiveRound - 1 : null;
          if (lostRound === 1 || lostRound === 13) {
            var sideForLostRound = getSideForRound(lostRound);
            if (sideForLostRound === "def" && !stackedToastShownForRounds[lostRound]) {
              stackedToastShownForRounds[lostRound] = "pending";
              diagDebug("First def pistol loss detected — stacking tip queued for round " + (lostRound + 1));
            }
          }
        }
        
        myScore.won = newWon;
        myScore.lost = newLost;
        lastScoreWon = newWon;
        lastScoreLost = newLost;
        
        var currentLead = newWon - newLost;
        if (currentLead > peakLead) peakLead = currentLead;
        var currentDeficit = newLost - newWon;
        if (currentDeficit > peakDeficit) peakDeficit = currentDeficit;
      }
    }
  }
  
  if (mi.match_score !== undefined && mi.match_score !== null) {
    var matchScoreObj = parseMaybeJson(mi.match_score);
    if (matchScoreObj && typeof matchScoreObj === "object") {
      var t0 = Number(matchScoreObj.team_0);
      var t1 = Number(matchScoreObj.team_1);
      if (isFinite(t0) && isFinite(t1)) {
        if (localTeamId === 0) enemyScore.won = t1;
        else if (localTeamId === 1) enemyScore.won = t0;
        else {
          var totalRounds = myScore.won + myScore.lost;
          var theirRounds = t0 + t1 - totalRounds;
          if (theirRounds >= 0) enemyScore.won = theirRounds;
        }
      }
    }
  }

  var sideRaw = (mi.team !== undefined && mi.team !== null) ? mi.team : ((mi.side !== undefined && mi.side !== null) ? mi.side : null);
  var sideNorm = normalizeSide(sideRaw);
  if (sideNorm) {
    if (settings.devMode && matchTeamSide !== sideNorm) {
      diagDebug("Side detected from match_info.team: " + sideNorm);
    }
    matchTeamSide = sideNorm;
  } else if (settings.devMode && sideRaw) {
    diagDebug("Side detection failed: sideRaw=" + sideRaw + " (not normalized)");
  }

  if (mi.roster !== undefined && mi.roster !== null) {
    var rosterData = parseMaybeJson(mi.roster);
    var tid = getLocalTeamIdFromRoster(rosterData);
    if (tid !== null) {
      if (settings.devMode && localTeamId !== tid) {
        diagDebug("LocalTeamId detected from roster: " + tid);
      }
      localTeamId = tid;
    } else if (settings.devMode) {
      diagDebug("LocalTeamId detection failed: roster exists but no local player found");
    }

    var agentFromRoster = getLocalAgentFromRoster(rosterData);
    if (agentFromRoster && agentFromRoster !== localPlayerAgent) {
      if (localPlayerAgent) diagDebug("Agent corrected by roster: " + agentFromRoster + " (was " + localPlayerAgent + ")");
      else diagDebug("Agent detected from roster: " + agentFromRoster);
      localPlayerAgent = agentFromRoster;
    }

    if (!matchTeamSide && effectiveRound !== null) {
      var s3 = sideFromTeamIdAndRound(localTeamId, effectiveRound);
      if (s3) {
        if (settings.devMode) {
          diagDebug("Side inferred from localTeamId fallback: " + s3);
        }
        matchTeamSide = s3;
      }
    }
  }

  if (lastRoundNumber !== null && effectiveRound !== null && effectiveRound < lastRoundNumber) {
    resetForNewMatch("round counter decreased");
  }

  if (lastRoundNumber === null && effectiveRound !== null) {
    lastRoundNumber = effectiveRound;
    diagDebug("VALO init: round=" + effectiveRound + " phase=" + (effectivePhase || "?"));
    if (!localPlayerAgent) startAgentPoll();
  }

  if (effectiveRound !== null && lastRoundNumber !== null && effectiveRound !== lastRoundNumber) {
    lastRoundNumber = effectiveRound;
    lastKnownPhase = null;  // clear stale phase so new round waits for an explicit buy-phase update
    diagDebug("Round changed -> " + effectiveRound);
  }

  var phase = effectivePhase;
  var isBuy =
    (phase === "shopping" || phase === "buy" || phase === "pre_round" || phase === "buy_phase" ||
     phase === "shopping_phase" || phase === "shoppingphase");

  if (effectiveRound !== null && isBuy) {
    if (effectiveRound === 1) {
      if (lastToastRoundNumber !== 1) {
        lastToastRoundNumber = 1;
        diagInfo("Round 1 silent ✅");
      }
    } else {
      if (lastToastRoundNumber !== effectiveRound) {
        lastToastRoundNumber = effectiveRound;

        if (effectiveRound === 13 && !halftimeShownForMatch) {
          halftimeShownForMatch = true;
          var htMsg = pickRandomMessage(TOASTS_HALFTIME, 0);
          showToast("FOCUS", htMsg, tuning().toastMs);
          markMessageShown(htMsg);
          recordSessionMessage(htMsg, "halftime", effectiveRound);
          diagInfo("Halftime toast shown ✅ (round 13)");
        } else {
          var chosen = chooseRoundToast(effectiveRound);
          if (chosen && chosen.msg) {
            showToast("FOCUS", chosen.msg, tuning().toastMs);
            markMessageShown(chosen.msg);
            recordSessionMessage(chosen.msg, chosen.category, effectiveRound);
            var sideDetected = getSideForRound(effectiveRound);
            diagInfo("Round toast shown ✅ (round " + effectiveRound + " | side=" + sideDetected +
              " | matchTeamSide=" + (matchTeamSide || "?") +
              " | localTeamId=" + (localTeamId === null ? "?" : localTeamId) + ")");
          } else {
            diagDebug("Round toast missing (no message chosen) (round " + effectiveRound + ")");
          }
        }
      }
    }
  }

  if (phase === "game_end") {
    resetForNewMatch("game_end");
  }
}

function resolveAgentFromInternalId(id) {
  var map = {
    "Clay_PC_C": "Raze",      "Pandemic_PC_C": "Viper",    "Wraith_PC_C": "Omen",
    "Hunter_PC_C": "Sova",    "Thorne_PC_C": "Sage",       "Phoenix_PC_C": "Phoenix",
    "Wushu_PC_C": "Jett",     "Gumshoe_PC_C": "Cypher",    "Sarge_PC_C": "Brimstone",
    "Breach_PC_C": "Breach",  "Vampire_PC_C": "Reyna",     "Killjoy_PC_C": "Killjoy",
    "Guide_PC_C": "Skye",     "Stealth_PC_C": "Yoru",      "Rift_PC_C": "Astra",
    "Grenadier_PC_C": "KAYO", "Deadeye_PC_C": "Chamber",   "Sprinter_PC_C": "Neon",
    "BountyHunter_PC_C": "Fade", "Mage_PC_C": "Harbor",   "AggroBot_PC_C": "Gekko",
    "Cable_PC_C": "Deadlock", "Sequoia_PC_C": "Iso",       "Smonk_PC_C": "Clove",
    "Nox_PC_C": "Vyse",       "Cashew_PC_C": "Tejo",       "Terra_PC_C": "Waylay"
  };
  return map[id] || null;
}

function resolveAgentFromCharacterField(character) {
  if (!character) return null;
  return resolveAgentFromInternalId(character + "_PC_C");
}

function getLocalAgentFromRoster(roster) {
  if (!roster) return null;
  var arr = Array.isArray(roster) ? roster : Object.values(roster);
  for (var i = 0; i < arr.length; i++) {
    var p = arr[i];
    if (!p || typeof p !== "object") continue;
    var isLocal = (p.is_local === true) || (p.local === true) ||
                  (String(p.is_local).toLowerCase() === "true") ||
                  (String(p.local).toLowerCase() === "true");
    if (!isLocal) continue;
    if (p.character && typeof p.character === "string") {
      return resolveAgentFromCharacterField(p.character);
    }
  }
  return null;
}

function normalizeSide(v) {
  if (v === undefined || v === null) return null;
  var s = String(v).toLowerCase();
  if (s.indexOf("attack") >= 0) return "atk";
  if (s.indexOf("def") >= 0) return "def";
  return null;
}

function getLocalTeamIdFromRoster(roster) {
  if (!roster) return null;
  var arr = Array.isArray(roster) ? roster : Object.values(roster);
  for (var i = 0; i < arr.length; i++) {
    var p = arr[i];
    if (!p || typeof p !== "object") continue;
    var isLocal = (p.is_local === true) || (String(p.is_local).toLowerCase() === "true");
    if (!isLocal) continue;
    var tid = p.team;
    if (tid === 0 || tid === 1) return tid;
    var n = Number(tid);
    if (n === 0 || n === 1) return n;
  }
  return null;
}

function sideFromTeamIdAndRound(teamId, roundNumber) {
  if (!(teamId === 0 || teamId === 1)) return null;
  var r = Number(roundNumber);
  if (!isFinite(r) || r <= 0) return null;

  if (r <= 12) return (teamId === 0) ? "atk" : "def";
  if (r <= 24) return (teamId === 0) ? "def" : "atk";
  var otPairIndex = Math.floor((r - 25) / 2);
  var withinPair  = (r - 25) % 2;
  var otFlipped   = (otPairIndex % 2 === 1) !== (withinPair === 1);
  if (!otFlipped) return (teamId === 0) ? "atk" : "def";
  return (teamId === 0) ? "def" : "atk";
}

function normalizeTeamColor(t) {
  if (!t) return null;
  var s = String(t).toLowerCase();
  if (s.indexOf("blue") >= 0) return "blue";
  if (s.indexOf("red") >= 0) return "red";
  return s;
}

function getSideForRound(roundNumber) {
  // In overtime sides change every round; matchTeamSide can be stale from the previous round
  var r = Number(roundNumber);
  if (isFinite(r) && r >= 25 && (localTeamId === 0 || localTeamId === 1)) {
    var otSide = sideFromTeamIdAndRound(localTeamId, roundNumber);
    if (otSide) return otSide;
  }
  if (matchTeamSide === "atk" || matchTeamSide === "def") return matchTeamSide;
  var s2 = sideFromTeamIdAndRound(localTeamId, roundNumber);
  if (s2) return s2;

  var team = normalizeTeamColor(meTeam);
  if (!team || (team !== "blue" && team !== "red")) return "unknown";

  var r = Number(roundNumber);
  if (!isFinite(r) || r <= 0) r = 1;
  var firstHalf = (r <= 12);
  if (firstHalf) return (team === "blue") ? "def" : "atk";
  else return (team === "blue") ? "atk" : "def";
}

function chooseRoundToast(roundNumber) {
  var t = tuning();
  var r = Number(roundNumber);
  var cd = t.perMessageCooldownMs;

  var CAT_CD = 180000;

  // First-def-pistol-loss tip — highest priority, queued from score handler
  var prevRound = r - 1;
  if (stackedToastShownForRounds[prevRound] === "pending") {
    stackedToastShownForRounds[prevRound] = true;
    return { msg: "Try stacking a site.", category: "first_def_loss" };
  }

  if (r >= 25) {
    var otPair = Math.floor((r - 25) / 2);
    if (overtimeAnnouncedRound !== otPair) {
      overtimeAnnouncedRound = otPair;
      var otMsg = pickRandomMessage(TOASTS_OVERTIME, cd);
      markCategoryShown("overtime");
      return { msg: otMsg, category: "overtime" };
    }
  }

  if (r === 24) {
    var mpMsg = pickFromCategory(TOASTS_MATCH_POINT, "match_point", CAT_CD, cd);
    if (mpMsg) { markCategoryShown("match_point"); return { msg: mpMsg, category: "match_point" }; }
  }

  if (r >= 4 && Math.random() < 0.15) {
    var awaMsg = pickFromCategory(TOASTS_ULT_AWARENESS, "ult_awareness", CAT_CD, cd);
    if (awaMsg) { markCategoryShown("ult_awareness"); return { msg: awaMsg, category: "ult_awareness" }; }
  }

  var isBonusRound = (r === 3 || r === 15) && currentStreak >= 2;
  if (isBonusRound) {
    var bonusMsg = pickFromCategory(TOASTS_BONUS_ROUND, "bonus_round", CAT_CD, cd);
    if (bonusMsg) { markCategoryShown("bonus_round"); return { msg: bonusMsg, category: "bonus_round" }; }
  }

  var roundDiff = myScore.won - myScore.lost;
  var totalRounds = myScore.won + myScore.lost;

  if ((myScore.won === 11 && myScore.lost === 11) || (myScore.won === 12 && myScore.lost === 12)) {
    var closeMsg = pickFromCategory(TOASTS_CLOSE_GAME, "close_game", CAT_CD, cd);
    if (closeMsg) { markCategoryShown("close_game"); return { msg: closeMsg, category: "close_game" }; }
  }

  if (peakLead >= 5 && roundDiff <= 2 && currentStreak <= -3) {
    var cbdMsg = pickFromCategory(TOASTS_COMEBACKD, "comebackd", CAT_CD, cd);
    if (cbdMsg) { markCategoryShown("comebackd"); return { msg: cbdMsg, category: "comebackd" }; }
  }

  if (peakLead >= 4 && roundDiff <= 2 && currentStreak <= -2 && totalRounds >= 8) {
    var comebackMsg = pickFromCategory(TOASTS_COMEBACK, "comeback", CAT_CD, cd);
    if (comebackMsg) { markCategoryShown("comeback"); return { msg: comebackMsg, category: "comeback" }; }
  }

  if (currentStreak >= 3 && r >= 4 && Math.random() < 0.60) {
    var winStreakMsg = pickFromCategory(TOASTS_WIN_STREAK, "win_streak", CAT_CD, cd);
    if (winStreakMsg) { markCategoryShown("win_streak"); return { msg: winStreakMsg, category: "win_streak" }; }
  }

  if (currentStreak <= -3 && r >= 4 && Math.random() < 0.70) {
    var lossStreakMsg = pickFromCategory(TOASTS_LOSS_STREAK, "loss_streak", CAT_CD, cd);
    if (lossStreakMsg) { markCategoryShown("loss_streak"); return { msg: lossStreakMsg, category: "loss_streak" }; }
  }

  if (roundDiff >= 5 && totalRounds >= 7 && Math.random() < 0.40) {
    var leadMsg = pickFromCategory(TOASTS_BIG_LEAD, "big_lead", CAT_CD, cd);
    if (leadMsg) { markCategoryShown("big_lead"); return { msg: leadMsg, category: "big_lead" }; }
  }

  if (localPlayerAgent && Math.random() < 0.65) {
    var agentPools = AGENT_POOLS[localPlayerAgent] || AGENT_POOLS[localPlayerAgent.toLowerCase()];
    if (agentPools) {
      var agentSide = getSideForRound(r);
      var agentPool = (agentSide === "def") ? agentPools.def : agentPools.atk;
      var agentCatKey = "agent_" + localPlayerAgent.toLowerCase() + "_" + (agentSide === "def" ? "def" : "atk");
      var agentMsg = pickRandomMessage(filterByRound(agentPool, r), cd);
      if (agentMsg) {
        if (settings.devMode) diagDebug("Agent tip shown: [" + localPlayerAgent + "/" + agentSide + "] " + agentMsg);
        markCategoryShown(agentCatKey);
        return { msg: agentMsg, category: "agent_" + localPlayerAgent.toLowerCase() };
      }
    } else if (settings.devMode) {
      diagDebug("Agent tip skipped: no pool for agent=" + localPlayerAgent);
    }
  }

  var side = getSideForRound(r);
  if (settings.devMode && side === "unknown") {
    diagDebug("⚠️ SIDE UNKNOWN on round " + r + " (matchTeamSide=" + (matchTeamSide || "?") + ", localTeamId=" + (localTeamId === null ? "?" : localTeamId) + ", meTeam=" + (meTeam || "?") + ")");
  }
  
  if (side === "atk") {
    var atkMsg = pickFromCategory(filterByRound(TOASTS_ATTACKER, r), "atk", CAT_CD, cd);
    if (atkMsg) { markCategoryShown("atk"); return { msg: atkMsg, category: "attack" }; }
  } else if (side === "def") {
    var defMsg = pickFromCategory(filterByRound(TOASTS_DEFENDER, r), "def", CAT_CD, cd);
    if (defMsg) { markCategoryShown("def"); return { msg: defMsg, category: "defense" }; }
  }

  var fallbackPool = (side === "def") ? TOASTS_DEFENDER : TOASTS_ATTACKER;
  var fallbackCat = (side === "def") ? "def" : "atk";
  var fallbackCategory = (side === "def") ? "defense" : "attack";
  var fallbackMsg = pickRandomMessage(filterByRound(fallbackPool, r), cd);
  markCategoryShown(fallbackCat);
  return { msg: fallbackMsg, category: fallbackCategory };
}

function handleMeInference(meObj) {
  if (!meObj || typeof meObj !== "object") return;

  var team = inferTeam(meObj);
  if (team) meTeam = team;

  if (meObj.agent && typeof meObj.agent === "string" && (!localPlayerAgent || !_gepIsSnapshot)) {
    var resolved = resolveAgentFromCharacterField(meObj.agent)
                || resolveAgentFromInternalId(meObj.agent);
    if (resolved && resolved !== localPlayerAgent) {
      if (localPlayerAgent) diagDebug("Agent corrected via me.agent: " + resolved + " (was " + localPlayerAgent + ")");
      else diagDebug("Agent detected from me.agent: " + resolved + " (" + meObj.agent + ")");
      localPlayerAgent = resolved;
    }
  }
}

function onInfoUpdates2(e) {
  if (!e || !e.info) return;

  gepSeenAnyUpdate = true;
  lastGepUpdateAt = nowMs();

  if (valorantRunning && !eventsOk) {
    eventsOk = true;
    sendStatusToLauncher();
    diagInfo("GEP OK ✅ receiving data");
  }

  var info = e.info;

  if (info.me) {
    var meObj = parseMaybeJson(info.me);
    if (meObj) handleMeInference(meObj);
  }

  if (info.match_info) {
    var matchInfo = parseMaybeJson(info.match_info);
    if (matchInfo) handleMatchInfoUpdate(matchInfo);
  }

  sendStatusToLauncher();
}

function fetchCurrentGameInfo() {
  try {
    overwolf.games.events.getInfo(function (res) {
      if (!res || !res.success || !res.res) return;
      var info = res.res;
      if (Object.keys(info || {}).length === 0) return;
      _gepIsSnapshot = true;
      onInfoUpdates2({ info: info });
      _gepIsSnapshot = false;
    });
  } catch (e) {
    diagDebug("getInfo ERROR: " + (e && e.message ? e.message : String(e)));
  }
}

var AGENT_POLL_INTERVAL_MS = 5000;
var AGENT_POLL_MAX_TRIES = 12;

function startAgentPoll() {
  stopAgentPoll();  
  if (localPlayerAgent) return;  
  var tries = 0;
  diagDebug("Agent poll started (max " + AGENT_POLL_MAX_TRIES + " tries every " + (AGENT_POLL_INTERVAL_MS / 1000) + "s)");
  agentPollTimer = setInterval(function () {
    if (localPlayerAgent) {
      diagDebug("Agent poll resolved: " + localPlayerAgent + " — stopping poll");
      stopAgentPoll();
      return;
    }
    tries++;
    diagDebug("Agent poll try " + tries + "/" + AGENT_POLL_MAX_TRIES + " (agent still unknown)");
    fetchCurrentGameInfo();
    if (tries >= AGENT_POLL_MAX_TRIES) {
      diagDebug("Agent poll giving up after " + tries + " tries — agent not detected");
      stopAgentPoll();
    }
  }, AGENT_POLL_INTERVAL_MS);
}

function stopAgentPoll() {
  if (agentPollTimer) {
    clearInterval(agentPollTimer);
    agentPollTimer = null;
  }
}

function attachEventListeners() {
  try { overwolf.games.events.onInfoUpdates2.removeListener(onInfoUpdates2); } catch (e) {}
  try { overwolf.games.events.onError.removeListener(onEventsError); } catch (e) {}
  try { overwolf.games.events.onInfoUpdates2.addListener(onInfoUpdates2); } catch (e) {}
  try { overwolf.games.events.onError.addListener(onEventsError); } catch (e) {}
}

function obtainDeclared(name, cb) {
  overwolf.windows.obtainDeclaredWindow(name, function (res) {
    if (res && res.success && res.window) cb(res.window);
    else cb(null);
  });
}

var launcherShownOnce = false;

function showLauncherWindowOnce() {
  if (!launcherId) return;
  if (launcherShownOnce) return;
  launcherShownOnce = true;

  try {
    overwolf.windows.restore(launcherId, function () {
      try { overwolf.windows.bringToFront(launcherId, function () {}); } catch (e) {}
    });
  } catch (e) {}
}

function ensureWindows() {
  obtainDeclared(LAUNCHER_WINDOW, function (lw) {
    if (lw && lw.id) launcherId = lw.id;

    obtainDeclared(INGAME_WINDOW, function (ig) {
      if (ig && ig.id) {
        inGameId = ig.id;
        try { overwolf.windows.hide(inGameId, function () {}); } catch (e) {}
      }

      obtainDeclared(INGAME_SETTINGS_WINDOW, function(sg) {
        if (sg && sg.id) {
          inGameSettingsId = sg.id;
          try { overwolf.windows.hide(inGameSettingsId, function() {}); } catch(e) {}
        }
      });

      diagInfo("BOOT OK ✅ (background alive)");

      showLauncherWindowOnce();
      setTimeout(function () { showLauncherWindowOnce(); }, 400);

      pushSettingsToLauncher();
      sendStatusToLauncher();
    });
  });
}

overwolf.windows.onMessageReceived.addListener(function (e) {
  if (!e || !e.id) return;

  var senderId = getSenderWindowId(e);
  if (!launcherId && senderId) launcherId = senderId;

  if (e.id === "status_get" || e.id === "request_status") {
    sendStatusToLauncher(senderId, true);
    return;
  }

  if (e.id === "settings_get" || e.id === "request_settings") {
    pushSettingsToLauncher(senderId);
    return;
  }

  if (e.id === "settings_update") {
    var s = e.content || {};

    if (typeof s.overlayEnabled === "boolean") settings.overlayEnabled = s.overlayEnabled;
    if (s.position) settings.position = s.position;
    if (typeof s.devMode === "boolean") settings.devMode = s.devMode;
    if (s.theme) settings.theme = s.theme;
    if (typeof s.toastMs === "number" && s.toastMs >= 3000) settings.toastMs = s.toastMs;
    if (typeof s.opacity === "number" && s.opacity >= 0.3 && s.opacity <= 1) settings.opacity = s.opacity;
    if (typeof s.soundEnabled === "boolean") settings.soundEnabled = s.soundEnabled;

    saveSettings();
    pushSettingsToLauncher(senderId);

    diagDebug("Settings updated: " + JSON.stringify(settings), senderId);
    return;
  }

  if (e.id === "preview_toast") {
    var previewMessages = [
      "Stay disciplined. Play your role.",
      "New half, reset your mindset.",
      "Play off your teammates.",
      "Time is on your side. Use it.",
      "Your ult is ready. Make it count."
    ];
    var previewMsg = previewMessages[Math.floor(Math.random() * previewMessages.length)];
    showToast("FOCUS", previewMsg, tuning().toastMs);
    diagDebug("Preview toast fired: " + previewMsg, senderId);
    return;
  }

  if (e.id === "rate_message") {
    var rm = e.content || {};
    if (rm.messageText && rm.vote !== undefined) {
      saveRatingLocal(rm.messageText, rm.vote);
    }
    return;
  }

  if (e.id === "settings_hide") {
    inGameSettingsVisible = false;
    try { overwolf.windows.hide(inGameSettingsId, function() {}); } catch(e2) {}
    return;
  }
});

function saveSessionMessages() {
  if (sessionMessages.length === 0) return;
  try {
    var existing = [];
    try {
      var raw = localStorage.getItem(UNRATED_KEY);
      if (raw) existing = JSON.parse(raw) || [];
    } catch (e) {}
    var merged = existing.concat(sessionMessages);
    if (merged.length > 50) merged = merged.slice(merged.length - 50);
    localStorage.setItem(UNRATED_KEY, JSON.stringify(merged));
    diagInfo("Session messages saved for rating (" + sessionMessages.length + " new, " + merged.length + " total)");
    sessionMessages = [];
    sendToLauncher(null, "messages_saved", { count: merged.length });
  } catch (e) {}
}

window.onerror = function (message, source, lineno, colno, error) {
  var msg =
    "JS ERROR: " + String(message) +
    " @ " + String(source || "?") + ":" + String(lineno || "?") + ":" + String(colno || "?") +
    (error && error.stack ? "\n" + error.stack : "");
  diagInfo(msg);
  return false;
};

(function main() {
  ensureWindows();
  attachEventListeners();
  setRequiredFeatures();

  // 1. PING FIREBASE TO TRACK OPEN
  trackAppOpen();

  // 2. START PRESENCE TRACKING
  initPresence();

  // 3. START CLOUD SYNC + GEP SERVICE STATUS CHECK
  syncToastsFromCloud();
  setInterval(syncToastsFromCloud, CLOUD_REFRESH_MS);
  checkGepServiceStatus();
  setInterval(checkGepServiceStatus, 5 * 60 * 1000);

  // 4. ONLINE / OFFLINE DETECTION
  if (typeof window !== "undefined") {
    window.addEventListener("online", function() {
      isOnline = true;
      sendStatusToLauncher(null, true);
      if (cloudSyncStatus !== "success") { cloudSyncStatus = "pending"; syncToastsFromCloud(); }
      checkGepServiceStatus();
    });
    window.addEventListener("offline", function() {
      isOnline = false;
      cloudSyncStatus = "failed";
      sendStatusToLauncher(null, true);
    });
  }

  // 5. HOTKEY — Alt+X toggles the in-game settings overlay
  try {
    overwolf.settings.hotkeys.onPressed.addListener(function(result) {
      if (result && result.name === "toggle_settings") toggleSettingsOverlay();
    });
  } catch(e) {}

  setInterval(pollGameStatus, STATUS_POLL_MS);
  pollGameStatus();
})();