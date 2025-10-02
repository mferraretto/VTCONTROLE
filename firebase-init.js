import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getFirestore,
  initializeFirestore,
  collection,
  addDoc,
  setDoc,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  orderBy,
  serverTimestamp,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDWok2hM9-HWITlLuqmYhGgEx8giXRUSTA",
  authDomain: "vtscontrole.firebaseapp.com",
  projectId: "vtscontrole",
  storageBucket: "vtscontrole.firebasestorage.app",
  messagingSenderId: "538434942205",
  appId: "1:538434942205:web:c174a1e336e5b75628fa94",
};

function setupLocalCache() {
  try {
    return ("indexedDB" in window)
      ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      : memoryLocalCache();
  } catch (err) {
    console.warn("Falha ao configurar cache persistente, usando fallback em memória", err);
    return memoryLocalCache();
  }
}

function createFirestore(app, localCache) {
  try {
    return initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      useFetchStreams: false,
      localCache,
    });
  } catch (err) {
    console.warn("Falha ao inicializar Firestore com autodetecção, tentando forçar long polling", err);
  }

  try {
    return initializeFirestore(app, {
      experimentalForceLongPolling: true,
      useFetchStreams: false,
      localCache,
    });
  } catch (err) {
    console.warn("Falha ao forçar long polling, usando getFirestore padrão", err);
    return getFirestore(app);
  }
}

export function initFirebase() {
  if (window.__vts) {
    return window.__vts;
  }

  const app = initializeApp(firebaseConfig);
  const localCache = setupLocalCache();
  const db = createFirestore(app, localCache);

  window.__vts = {
    db,
    collection,
    addDoc,
    setDoc,
    getDocs,
    getDoc,
    doc,
    query,
    where,
    orderBy,
    serverTimestamp,
  };

  return window.__vts;
}
