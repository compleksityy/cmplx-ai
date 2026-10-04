const $ = id => document.getElementById(id);

const conversation = $("conversation");
const messageInput = $("message");
const composer = $("composer");
const sendButton = $("sendButton");
const chatList = $("chatList");
const settings = $("settings");
const toast = $("toast");

let messages = [];
let chats = JSON.parse(localStorage.getItem("cmplx-chats") || "[]");
let busy = false;
let currentChatId = null;
let uploadedFiles = [];
let activeController = null;
let generationStartedAt = 0;
let lastUserPrompt = "";

const stats = {
  messages: Number(localStorage.getItem("cmplx-stat-messages") || 0),
  chars: Number(localStorage.getItem("cmplx-stat-chars") || 0),
  generations: Number(localStorage.getItem("cmplx-stat-generations") || 0)
};

const prefs = {
  font: localStorage.getItem("cmplx-font") || "Geist Mono",
  size: Number(localStorage.getItem("cmplx-size") || 14),
  compact: localStorage.getItem("cmplx-compact") === "true",
  enterSend: localStorage.getItem("cmplx-enter") !== "false",
  profile: localStorage.getItem("cmplx-profile") || "general",
  theme: localStorage.getItem("cmplx-theme") || "midnight"
};

function applyPrefs() {
  document.documentElement.style.setProperty("font-family", `"${prefs.font}", monospace`);
  document.body.style.fontFamily = `"${prefs.font}", monospace`;
  document.documentElement.style.setProperty("--chat-size", `${prefs.size}px`);
  $("fontSelect").value = prefs.font;
  $("fontSize").value = prefs.size;
  $("fontSizeValue").textContent = `${prefs.size}px`;
  $("compactMode").checked = prefs.compact;
  $("enterSend").checked = prefs.enterSend;
  $("profileSelect").value = prefs.profile;
  $("themeSelect").value = prefs.theme;
  document.documentElement.dataset.theme = prefs.theme;
  $("statMessages").textContent = stats.messages.toLocaleString();
  $("statChars").textContent = stats.chars.toLocaleString();
  $("statGenerations").textContent = stats.generations.toLocaleString();
}

function savePrefs() {
  localStorage.setItem("cmplx-font", prefs.font);
  localStorage.setItem("cmplx-size", prefs.size);
  localStorage.setItem("cmplx-compact", prefs.compact);
  localStorage.setItem("cmplx-enter", prefs.enterSend);
  localStorage.setItem("cmplx-profile", prefs.profile);
  localStorage.setItem("cmplx-theme", prefs.theme);
  applyPrefs();
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

function renderChats() {
  chatList.innerHTML = "";
  chats.slice().reverse().forEach(chat => {
    const button = document.createElement("button");
    button.className = `chat-item ${chat.id === currentChatId ? "active" : ""}`;
    button.textContent = chat.title || "new chat";
    button.onclick = () => loadChat(chat.id);
    chatList.appendChild(button);
  });
}

function persistChat() {
  if (!messages.length) return;

  const firstUser = messages.find(m => m.role === "user");
  const title = firstUser?.content.slice(0, 42) || "new chat";
  if (!currentChatId) currentChatId = crypto.randomUUID();

  const data = {
    id: currentChatId,
    title,
    messages,
    updated: Date.now()
  };

  const index = chats.findIndex(c => c.id === currentChatId);
  if (index >= 0) chats[index] = data;
  else chats.push(data);

  chats = chats.slice(-30);
  localStorage.setItem("cmplx-chats", JSON.stringify(chats));
  renderChats();
}

function resetChat() {
  messages = [];
  currentChatId = null;
  conversation.innerHTML = `
    <div class="welcome" id="welcome">
      <div class="hero-mark">C</div>
      <h1>CMPLX-AI</h1>
      <p>advanced intelligence for code, systems, and whatever you're building.</p>
      <div class="prompt-grid">
        <button data-prompt="Build me a complete project and explain how to run it."><b>build</b><span>create something from scratch</span></button>
        <button data-prompt="Debug this code and explain exactly what is wrong."><b>debug</b><span>find and fix the problem</span></button>
        <button data-prompt="Give me a secure, production-ready implementation for this idea."><b>secure</b><span>design it with security in mind</span></button>
        <button data-prompt="Explain this technical concept like I already know the basics."><b>explain</b><span>technical answers without the fluff</span></button>
      </div>
    </div>`;
  bindPrompts();
  renderChats();
}

function loadChat(id) {
  const found = chats.find(c => c.id === id);
  if (!found) return;
  currentChatId = id;
  messages = found.messages;
  conversation.innerHTML = "";
  messages.forEach((m, i) => addMessage(m.role, m.content, false, i));
  renderChats();
  conversation.scrollTop = conversation.scrollHeight;
  $("sidebar").classList.remove("open");
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function renderMarkdown(text) {
  const parts = text.split(/(```[\s\S]*?(?:```|$))/g);
  return parts.map(part => {
    if (part.startsWith("```")) {
      const match = part.match(/^```([a-zA-Z0-9_+.#-]*)\n?([\s\S]*?)(?:```)?$/);
      const language = (match?.[1] || "text").toLowerCase();
      const code = match?.[2] ?? part.slice(3);
      const id = `code-${crypto.randomUUID()}`;
      const complete = part.endsWith("```");
      const ext = ({javascript:"js",typescript:"ts",python:"py",json:"json",html:"html",css:"css",bash:"sh",shell:"sh",cpp:"cpp",c:"c",csharp:"cs",java:"java",go:"go",rust:"rs",php:"php",ruby:"rb",kotlin:"kt",swift:"swift",lua:"lua",sql:"sql",markdown:"md",text:"txt"})[language] || language || "txt";
      return `<div class="code-block ${complete ? "" : "generating"}" data-code-id="${id}">
        <div class="code-head">
          <span>${escapeHtml(language)}${complete ? "" : " · generating"}</span>
          <div class="code-actions">
            <button class="code-download" data-code-id="${id}" data-ext="${escapeHtml(ext)}">download</button>
            <button class="code-copy" data-code-id="${id}">copy</button>
          </div>
        </div>
        <pre><code id="${id}">${escapeHtml(code)}</code></pre>
      </div>`;
    }
    return escapeHtml(part)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/^### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^## (.+)$/gm, "<h3>$1</h3>")
      .replace(/^# (.+)$/gm, "<h2>$1</h2>")
      .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      .replace(/\n/g, "<br>");
  }).join("").replace(/(<li>.*?<\/li>)(?:<br>)?/g, "$1");
}
function bindCodeActions(container) {
  container.querySelectorAll(".code-copy").forEach(button => {
    button.onclick = async () => {
      const code = document.querySelector(`#${CSS.escape(button.dataset.codeId)}`)?.textContent || "";
      try { await navigator.clipboard.writeText(code); } catch { showToast("copy failed"); return; }
      button.textContent = "copied";
      setTimeout(() => button.textContent = "copy", 1200);
    };
  });
  container.querySelectorAll(".code-download").forEach(button => {
    button.onclick = () => {
      const code = document.querySelector(`#${CSS.escape(button.dataset.codeId)}`)?.textContent || "";
      const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cmplx-code-${Date.now()}.${button.dataset.ext || "txt"}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("code downloaded");
    };
  });
}
function addMessage(role, content = "", scroll = true, index = -1) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}${prefs.compact ? " compact" : ""}`;
  if (role === "assistant") wrapper.dataset.messageIndex = index >= 0 ? index : messages.length;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "YOU" : "C";
  const body = document.createElement("div");
  body.className = "message-body";
  body.style.fontSize = "var(--chat-size)";
  if (role === "assistant" && content) {
    body.innerHTML = renderMarkdown(content);
    bindCodeActions(body);
  } else body.textContent = content;
  const contentWrap = document.createElement("div");
  contentWrap.className = "message-content";
  contentWrap.appendChild(body);
  wrapper.append(avatar, contentWrap);
  if (content && role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.innerHTML = `<button data-action="copy">copy</button><button data-action="regenerate">regenerate</button><button data-action="continue">continue</button>`;
    actions.querySelector('[data-action="copy"]').onclick = async () => {
      await navigator.clipboard.writeText(content);
      showToast("response copied");
    };
    actions.querySelector('[data-action="regenerate"]').onclick = () => regenerate(index);
    actions.querySelector('[data-action="continue"]').onclick = () => continueGeneration(index);
    contentWrap.append(actions);
  }
  conversation.appendChild(wrapper);
  if (scroll) conversation.scrollTop = conversation.scrollHeight;
  return body;
}
function updateAssistant(body, content) {
  body.innerHTML = renderMarkdown(content);
  bindCodeActions(body);
  conversation.scrollTop = conversation.scrollHeight;
}

function setBusy(state) {
  busy = state;
  sendButton.disabled = false;
  sendButton.textContent = state ? "■" : "↑";
  sendButton.classList.toggle("stop", state);
  messageInput.disabled = false;
}


async function sendMessage(text, options = {}) {
  if (!text.trim() || busy) return;
  const userText = text.trim();
  lastUserPrompt = userText;
  messages.push({ role: "user", content: userText });
  stats.messages++; stats.chars += userText.length; stats.generations++;
  saveStats();
  addMessage("user", userText);
  const body = addMessage("assistant", "", true, messages.length);
  body.innerHTML = '<div class="thinking" aria-label="CMPLX-AI is thinking"><span></span><span></span><span></span><em>thinking</em></div>';
  setBusy(true);
  generationStartedAt = performance.now();
  activeController = new AbortController();
  try {
    const profilePrompts = {
      general: "",
      coding: "Focus on software engineering and production-quality code.",
      debugging: "Focus on diagnosing root causes, reproductions, and precise fixes.",
      cybersecurity: "Focus on defensive cybersecurity, secure design, and authorized testing.",
      linux: "Focus on Linux, shell commands, system administration, and troubleshooting.",
      web: "Focus on modern web development, accessibility, performance, and security."
    };
    const contextMessages = options.messages || messages;
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: activeController.signal,
      body: JSON.stringify({ messages: contextMessages, profile: profilePrompts[prefs.profile] || "", temperature: 0.7, max_tokens: 4096 })
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try { const data = await response.json(); detail = data.detail || data.error || detail; } catch {}
      throw new Error(detail);
    }
    if (!response.body) throw new Error("No response stream received.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", output = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n"); buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const data = JSON.parse(raw);
            if (data.error) throw new Error(data.error);
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) { if (!output) body.innerHTML = ""; output += delta; updateAssistant(body, output); }
          } catch (error) { if (error.message && !error.message.includes("Unexpected")) throw error; }
        }
      }
    }
    if (!output) body.innerHTML = '<div class="thinking error-thinking"><span></span><span></span><span></span><em>no response</em></div>';
    messages.push({ role: "assistant", content: output });
    persistChat();
    if (output) addAssistantActionsToLast(body, messages.length - 1, output);
  } catch (error) {
    if (error.name === "AbortError") {
      body.innerHTML = '<div class="stopped">generation stopped</div>';
    } else {
      body.innerHTML = `<div class="friendly-error"><strong>CMPLX-AI couldn't generate a response.</strong><span>${escapeHtml(error.message || "Something went wrong.")}</span><button id="retryError">try again</button></div>`;
      $("retryError")?.addEventListener("click", () => sendMessage(userText));
    }
  } finally {
    activeController = null;
    setBusy(false); messageInput.focus();
    persistChat();
  }
}

function addAssistantActionsToLast(body, index, content) {
  const contentWrap = body.parentElement;
  contentWrap.querySelectorAll(".message-actions").forEach(x => x.remove());
  const actions = document.createElement("div"); actions.className = "message-actions";
  actions.innerHTML = `<button data-action="copy">copy</button><button data-action="regenerate">regenerate</button><button data-action="continue">continue</button>`;
  actions.children[0].onclick = async () => { await navigator.clipboard.writeText(content); showToast("response copied"); };
  actions.children[1].onclick = () => regenerate(index);
  actions.children[2].onclick = () => continueGeneration(index);
  contentWrap.append(actions);
}

async function regenerate(index) {
  if (busy || index < 0) return;
  const userIndex = index - 1;
  if (messages[userIndex]?.role !== "user") return;
  const prompt = messages[userIndex].content;
  messages = messages.slice(0, userIndex);
  conversation.innerHTML = "";
  messages.forEach((m, i) => addMessage(m.role, m.content, false, i));
  await sendMessage(prompt);
}

async function continueGeneration(index) {
  if (busy || !messages[index]?.content) return;
  const prompt = `Continue the previous response from where it stopped. Do not repeat what has already been written.`;
  await sendMessage(prompt);
}

function saveStats() {
  Object.entries(stats).forEach(([k,v]) => localStorage.setItem(`cmplx-stat-${k}`, v));
  applyPrefs();
}
function bindPrompts() {
  document.querySelectorAll("[data-prompt]").forEach(button => {
    button.onclick = () => {
      messageInput.value = button.dataset.prompt;
      messageInput.focus();
      autoSize();
    };
  });
}

function autoSize() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 180)}px`;
}

composer.onsubmit = async e => {
  e.preventDefault();
  if (busy) { activeController?.abort(); return; }
  const text = messageInput.value;
  messageInput.value = "";
  autoSize();
  await sendMessage(text);
};

messageInput.onkeydown = e => {
  if (e.key === "Enter" && !e.shiftKey && prefs.enterSend) {
    e.preventDefault();
    composer.requestSubmit();
  }
};

messageInput.oninput = autoSize;

$("newChat").onclick = resetChat;
$("clearButton").onclick = () => {
  if (!messages.length || confirm("Clear this conversation?")) resetChat();
};

$("settingsButton").onclick = () => settings.showModal();
$("closeSettings").onclick = () => settings.close();

$("fontSelect").onchange = e => {
  prefs.font = e.target.value;
  savePrefs();
};

$("fontSize").oninput = e => {
  prefs.size = Number(e.target.value);
  savePrefs();
};

$("compactMode").onchange = e => {
  prefs.compact = e.target.checked;
  savePrefs();
  if (messages.length) loadChat(currentChatId);
};

$("enterSend").onchange = e => {
  prefs.enterSend = e.target.checked;
  savePrefs();
};

$("profileSelect").onchange = e => { prefs.profile = e.target.value; savePrefs(); showToast(`${e.target.options[e.target.selectedIndex].text} profile active`); };
$("themeSelect").onchange = e => { prefs.theme = e.target.value; savePrefs(); };

$("resetSettings").onclick = () => {
  prefs.font = "Geist Mono";
  prefs.size = 14;
  prefs.compact = false;
  prefs.enterSend = true;
  prefs.profile = "general";
  prefs.theme = "midnight";
  savePrefs();
  showToast("settings reset");
};

async function attachFiles(files) {
  const accepted = [...files].slice(0, 8);
  for (const file of accepted) {
    if (file.size > 2 * 1024 * 1024) { showToast(`${file.name} is too large`); continue; }
    const text = await file.text();
    uploadedFiles.push({ name: file.name, content: text.slice(0, 50000) });
  }
  if (accepted.length) {
    messageInput.value += `${messageInput.value ? "\n\n" : ""}${uploadedFiles.slice(-accepted.length).map(f => `[File: ${f.name}]\n${f.content}`).join("\n\n")}`;
    showToast(`${accepted.length} file${accepted.length === 1 ? "" : "s"} attached`); autoSize();
  }
}
$("attachButton").onclick = () => $("fileInput").click();
$("fileInput").onchange = e => { attachFiles(e.target.files); e.target.value = ""; };
const dropZone = document.querySelector(".composer-area");
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragging"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", e => { e.preventDefault(); dropZone.classList.remove("dragging"); attachFiles(e.dataTransfer.files); });

$("exportButton").onclick = () => {
  if (!messages.length) return showToast("nothing to export");

  const text = messages.map(m => `${m.role.toUpperCase()}\n${m.content}`).join("\n\n---\n\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cmplx-ai-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("chat exported");
};

$("mobileMenu").onclick = () => $("sidebar").classList.toggle("open");

document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    messageInput.focus();
  }

  if (e.key === "Escape" && settings.open) settings.close();
  if (e.key === "Escape" && busy) activeController?.abort();
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); resetChat(); }
});

applyPrefs();
renderChats();
bindPrompts();
