import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInAnonymously, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  doc, 
  updateDoc, 
  getDoc 
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Inicializar Firestore
const db = getFirestore(window.firebaseApp);

document.addEventListener("DOMContentLoaded", () => {
  const btnLogin = document.getElementById("btn-login-main");
  const btnLogout = document.getElementById("btn-logout");
  const loggedOutDiv = document.getElementById("auth-logged-out");
  const loggedInDiv = document.getElementById("auth-logged-in");
  const userEmailDisplay = document.getElementById("user-email-display");
  const chatHistoryContainer = document.getElementById("chat-history");
  const btnNewChat = document.getElementById("new-chat");

  const form = document.getElementById("form");
  const textarea = document.getElementById("message");
  const welcomeSection = document.getElementById("welcome");
  const mainContainer = document.querySelector("main");

  let currentUser = null;
  let currentChatId = null;
  let unsubscribeHistory = null;

  // --- BOTÓN INICIAR SESIÓN ---
  if (btnLogin) {
    btnLogin.addEventListener("click", async () => {
      try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(window.auth, provider);
      } catch (error) {
        console.warn("OAuth no disponible, intentando acceso anónimo:", error.message);
        try {
          await signInAnonymously(window.auth);
        } catch (anonError) {
          alert("Error de autenticación: " + anonError.message);
        }
      }
    });
  }

  // --- BOTÓN CERRAR SESIÓN ---
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try {
        await signOut(window.auth);
      } catch (error) {
        console.error("Error al salir:", error);
      }
    });
  }

  // --- ESTADO DE AUTENTICACIÓN ---
  onAuthStateChanged(window.auth, (user) => {
    currentUser = user;
    if (user) {
      if (loggedOutDiv) loggedOutDiv.style.display = "none";
      if (loggedInDiv) loggedInDiv.style.display = "block";
      if (userEmailDisplay) {
        userEmailDisplay.textContent = user.email || user.displayName || ("Invitado (" + user.uid.substring(0, 6) + ")");
      }
      loadUserChatHistory(user.uid);
    } else {
      if (loggedOutDiv) loggedOutDiv.style.display = "block";
      if (loggedInDiv) loggedInDiv.style.display = "none";
      if (userEmailDisplay) userEmailDisplay.textContent = "";
      if (chatHistoryContainer) chatHistoryContainer.innerHTML = "";
      if (unsubscribeHistory) unsubscribeHistory();
      resetView();
    }
  });

  // --- HISTORIAL DE CHATS POR USUARIO ---
  function loadUserChatHistory(userId) {
    if (unsubscribeHistory) unsubscribeHistory();

    const q = query(
      collection(db, "chats"),
      where("userId", "==", userId),
      orderBy("createdAt", "desc")
    );

    unsubscribeHistory = onSnapshot(q, (snapshot) => {
      if (!chatHistoryContainer) return;
      chatHistoryContainer.innerHTML = "";

      snapshot.forEach((docSnapshot) => {
        const chatData = docSnapshot.data();
        const chatBtn = document.createElement("button");
        chatBtn.className = `chat-history-item ${docSnapshot.id === currentChatId ? 'active' : ''}`;
        chatBtn.textContent = chatData.title || "Nuevo chat";
        
        chatBtn.addEventListener("click", () => openChat(docSnapshot.id, chatData));
        chatHistoryContainer.appendChild(chatBtn);
      });
    }, (error) => {
      console.warn("Error consultando historial (asegúrate de crear Firestore):", error.message);
    });
  }

  function openChat(chatId, chatData) {
    currentChatId = chatId;
    clearMessages();
    if (welcomeSection) welcomeSection.style.display = "none";

    document.querySelectorAll(".chat-history-item").forEach(btn => btn.classList.remove("active"));

    if (chatData && chatData.messages) {
      chatData.messages.forEach(msg => {
        appendMessage(msg.text, msg.sender);
      });
    }
  }

  if (btnNewChat) {
    btnNewChat.addEventListener("click", () => {
      currentChatId = null;
      document.querySelectorAll(".chat-history-item").forEach(btn => btn.classList.remove("active"));
      resetView();
    });
  }

  function resetView() {
    clearMessages();
    if (welcomeSection) welcomeSection.style.display = "block";
  }

  function clearMessages() {
    const existingMsgs = document.querySelectorAll(".message");
    existingMsgs.forEach(m => m.remove());
  }

  // --- ENVÍO DE MENSAJES A OLLAMA ---
  if (form && textarea) {
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event("submit"));
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const userText = textarea.value.trim();
      if (!userText) return;

      if (welcomeSection) welcomeSection.style.display = "none";

      appendMessage(userText, "user");
      textarea.value = "";

      const aiMessageDiv = appendMessage("Pensando...", "ai");

      try {
        const response = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "2-smr-ai:latest",
            prompt: userText,
            stream: false
          })
        });

        if (!response.ok) throw new Error("Status " + response.status);

        const data = await response.json();
        const aiText = data.response;
        aiMessageDiv.textContent = aiText;

        if (currentUser) {
          await saveToHistory(userText, aiText);
        }

      } catch (error) {
        console.error("Error al conectar con Ollama:", error);
        aiMessageDiv.textContent = "Error: No se pudo conectar con Ollama. Asegúrate de tener Ollama ejecutándose en tu PC.";
      }
    });
  }

  async function saveToHistory(userText, aiText) {
    try {
      const userMsg = { sender: "user", text: userText };
      const aiMsg = { sender: "ai", text: aiText };

      if (!currentChatId) {
        const docRef = await addDoc(collection(db, "chats"), {
          userId: currentUser.uid,
          title: userText.length > 28 ? userText.substring(0, 28) + "..." : userText,
          createdAt: new Date(),
          messages: [userMsg, aiMsg]
        });
        currentChatId = docRef.id;
      } else {
        const chatRef = doc(db, "chats", currentChatId);
        const docSnap = await getDoc(chatRef);
        if (docSnap.exists()) {
          const currentMsgs = docSnap.data().messages || [];
          await updateDoc(chatRef, {
            messages: [...currentMsgs, userMsg, aiMsg]
          });
        }
      }
    } catch (e) {
      console.error("Error al guardar en Firestore:", e);
    }
  }

  function appendMessage(text, sender) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${sender}-message`;
    msgDiv.style.cssText = `
      padding: 12px 16px;
      margin: 10px 0;
      border-radius: 8px;
      max-width: 80%;
      line-height: 1.5;
      background: ${sender === "user" ? "#2563eb" : "#27272a"};
      color: ${sender === "user" ? "#ffffff" : "#f4f4f5"};
      margin-left: ${sender === "user" ? "auto" : "0"};
      margin-right: ${sender === "user" ? "0" : "auto"};
    `;
    msgDiv.textContent = text;

    const composer = document.querySelector(".composer");
    if (composer && mainContainer) {
      mainContainer.insertBefore(msgDiv, composer);
    } else if (mainContainer) {
      mainContainer.appendChild(msgDiv);
    }

    msgDiv.scrollIntoView({ behavior: "smooth" });
    return msgDiv;
  }
// --- HISTORIAL DE CHATS POR USUARIO ---
  function loadUserChatHistory(userId) {
    if (unsubscribeHistory) unsubscribeHistory();

    // Consulta simple sin orderBy para no requerir índice compuesto en Firestore
    const q = query(
      collection(db, "chats"),
      where("userId", "==", userId)
    );

    unsubscribeHistory = onSnapshot(q, (snapshot) => {
      if (!chatHistoryContainer) return;
      chatHistoryContainer.innerHTML = "";

      const chats = [];
      snapshot.forEach((docSnapshot) => {
        chats.push({ id: docSnapshot.id, ...docSnapshot.data() });
      });

      // Ordenar localmente por fecha de creación (de más reciente a más antiguo)
      chats.sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
        return dateB - dateA;
      });

      chats.forEach((chatData) => {
        const chatBtn = document.createElement("button");
        chatBtn.className = `chat-history-item ${chatData.id === currentChatId ? 'active' : ''}`;
        chatBtn.textContent = chatData.title || "Nuevo chat";
        
        chatBtn.addEventListener("click", () => openChat(chatData.id, chatData));
        chatHistoryContainer.appendChild(chatBtn);
      });
    }, (error) => {
      console.error("Error consultando historial en Firestore:", error);
    });
  }
// --- FUNCIÓN DE BÚSQUEDA WEB UNIVERSAL ---
async function searchUniversalWeb(queryText) {
  try {
    // Servicio proxy público de búsqueda que consulta múltiples fuentes web
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryText)}`;
    
    // Usamos un proxy CORS gratuito para obtener el HTML de la web sin restricciones del navegador
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(searchUrl)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) return "";

    const data = await response.json();
    
    // Analizamos el HTML para extraer los fragmentos y resúmenes de internet
    const parser = new DOMParser();
    const doc = parser.parseFromString(data.contents, "text/html");
    
    const snippets = [];
    const results = doc.querySelectorAll(".result__snippet");
    
    results.forEach((el, index) => {
      if (index < 3) { // Extraemos los 3 primeros resultados principales de internet
        snippets.push(el.textContent.trim());
      }
    });

    return snippets.join("\n\n");
  } catch (error) {
    console.warn("No se pudo obtener información en tiempo real de internet:", error);
    return "";
  }
}

// --- DENTRO DE TU SCRIPT.JS (EVENTO SUBMIT DEL FORMULARIO) ---
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const userText = textarea.value.trim();
  if (!userText) return;

  if (welcomeSection) welcomeSection.style.display = "none";

  appendMessage(userText, "user");
  textarea.value = "";

  const aiMessageDiv = appendMessage("Buscando en internet y pensando...", "ai");

  try {
    // 1. Realizamos la búsqueda universal en tiempo real
    const webContext = await searchUniversalWeb(userText);

    // 2. Construimos el prompt enriquecido con datos de internet
    let promptFinal = userText;
    if (webContext) {
      promptFinal = `[INFORMACIÓN RECIENTE EXTRAÍDA DE INTERNET]:\n${webContext}\n\n[INSTRUCCIÓN]: Responde a la siguiente consulta utilizando los datos anteriores si son relevantes:\n${userText}`;
    }

    // 3. Enviamos la información enriquecida a Ollama
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "2-smr-ai:latest",
        prompt: promptFinal,
        stream: false
      })
    });

    if (!response.ok) throw new Error("Status " + response.status);

    const data = await response.json();
    const aiText = data.response;
    aiMessageDiv.textContent = aiText;

    if (currentUser) {
      await saveToHistory(userText, aiText);
    }

  } catch (error) {
    console.error("Error al conectar con Ollama:", error);
    aiMessageDiv.textContent = "Error: No se pudo procesar la solicitud con Ollama.";
  }
// 2. Construimos un prompt directo e instructivo
    let promptFinal = userText;
    if (webContext) {
      promptFinal = `
[CONTEXTO EN TIEMPO REAL DESDE INTERNET]:
${webContext}

[INSTRUCCIONES PARA LA IA]:
Tienes acceso a la información de Internet proporcionada arriba. Responde a la pregunta del usuario utilizando este contexto. Si el usuario te pregunta de dónde has sacado la información, indícale que has realizado una búsqueda en la web en tiempo real.

[PREGUNTA DEL USUARIO]:
${userText}`;
    }
});
});