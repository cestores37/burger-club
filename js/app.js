import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------------- state ----------------
let currentUser = null;
let isAdmin = false;
let restaurants = [];   // [{id, name, address, lat, lng, ...}]
let reviews = [];        // [{id, restaurantId, userId, userName, rating, comment}]
let users = [];          // [{id (uid), email, displayName}]
let map = null;
let markers = new Map(); // restaurantId -> leaflet marker
let activeRestaurantId = null;
let panelMode = null; // 'detail' | 'add' | 'account'

// ---------------- DOM ----------------
const el = (id) => document.getElementById(id);
const loginScreen = el('login-screen');
const appShell = el('app-shell');
const topbar = el('topbar');
const userChip = el('user-chip');
const entryList = el('entry-list');
const emptyState = el('empty-state');
const addEntryBtn = el('add-entry-btn');
const panelOverlay = el('panel-overlay');
const panelBody = el('panel-body');

// ---------------- auth ----------------
el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el('login-email').value.trim();
  const password = el('login-password').value;
  const errBox = el('login-error');
  errBox.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errBox.textContent = friendlyAuthError(err);
  }
});

function friendlyAuthError(err) {
  const code = err.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return "That email or password doesn't match an account. Ask the admin to double-check your login.";
  }
  if (code.includes('too-many-requests')) return "Too many attempts — wait a bit and try again.";
  return "Couldn't log in. Try again in a moment.";
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  isAdmin = !!user && ADMIN_EMAILS.includes(user.email);
  if (user) {
    loginScreen.classList.add('hidden');
    appShell.classList.remove('hidden');
    topbar.classList.remove('hidden');
    userChip.innerHTML = `
      <span class="email">${escapeHtml(user.email)}${isAdmin ? ' · admin' : ''}</span>
      <button class="btn ghost small" id="account-btn">Account</button>
      <button class="btn ghost small" id="logout-btn-2">Log out</button>
    `;
    el('account-btn').addEventListener('click', openAccountPanel);
    el('logout-btn-2').addEventListener('click', () => signOut(auth));
    addEntryBtn.classList.toggle('hidden', !isAdmin);
    initMapIfNeeded();
    subscribeData();
    // Ensure a profile doc exists (doesn't overwrite an existing displayName)
    setDoc(doc(db, 'users', user.uid), { email: user.email }, { merge: true }).catch(() => {});
  } else {
    loginScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
    topbar.classList.add('hidden');
    closePanel();
  }
});

// ---------------- Firestore subscriptions ----------------
function subscribeData() {
  onSnapshot(query(collection(db, 'restaurants'), orderBy('name')), (snap) => {
    restaurants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEntryList();
    renderMarkers();
    refreshOpenPanel();
  });

  onSnapshot(collection(db, 'reviews'), (snap) => {
    reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEntryList();
    renderMarkers();
    refreshOpenPanel();
  });

  onSnapshot(collection(db, 'users'), (snap) => {
    users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEntryList();
    renderMarkers();
    refreshOpenPanel();
  });
}

function refreshOpenPanel() {
  if (panelMode === 'detail' && activeRestaurantId) renderDetailPanel(activeRestaurantId);
  if (panelMode === 'account') openAccountPanel();
}

function displayNameFor(userId, fallback) {
  const u = users.find(x => x.id === userId);
  return (u && u.displayName) ? u.displayName : (fallback || 'Someone');
}

// ---------------- helpers ----------------
function reviewsFor(restaurantId) {
  return reviews.filter(r => r.restaurantId === restaurantId);
}
function avgRating(restaurantId) {
  const rs = reviewsFor(restaurantId);
  if (!rs.length) return null;
  return rs.reduce((s, r) => s + r.rating, 0) / rs.length;
}
function meterHtml(rating, max = 10) {
  const pct = Math.max(0, Math.min(100, (rating / max) * 100));
  return `<div class="meter-row">
    <div class="burger-meter" style="--pct:${pct}%"></div>
    <div class="meter-num">${rating.toFixed(1)}<span class="meter-max">/10</span></div>
  </div>`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function sliderField(cat, label, value) {
  const v = (value ?? 5.0);
  return `
    <div class="field">
      <label>${label}</label>
      <div class="slider-row">
        <input type="range" min="1" max="10" step="0.1" value="${v}" data-cat="${cat}" class="burger-slider">
        <span class="slider-num" data-cat="${cat}">${Number(v).toFixed(1)}</span>
      </div>
    </div>
  `;
}

// ---------------- sidebar list ----------------
function renderEntryList() {
  entryList.innerHTML = '';
  if (!restaurants.length) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');
  restaurants.forEach(r => {
    const avg = avgRating(r.id);
    const count = reviewsFor(r.id).length;
    const card = document.createElement('div');
    card.className = 'entry-card' + (r.id === activeRestaurantId ? ' active' : '');
    card.innerHTML = `
      <h3>${escapeHtml(r.name)}</h3>
      <div class="addr">${escapeHtml(r.address || '')}</div>
      ${avg !== null ? meterHtml(avg) : '<div class="count-tag">No ratings yet</div>'}
      <div class="entry-meta-row">
        <span class="count-tag">${count} review${count === 1 ? '' : 's'}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      openDetailPanel(r.id);
      if (markers.has(r.id)) {
        map.flyTo(markers.get(r.id).getLatLng(), 15, { duration: 0.6 });
        markers.get(r.id).openPopup();
      }
    });
    entryList.appendChild(card);
  });
}

// ---------------- map ----------------
function initMapIfNeeded() {
  if (map) return;
  map = L.map('map', { zoomControl: true }).setView([40.7128, -74.0060], 12);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);
}

function burgerDivIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="burger-pin"><span>🍔</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    popupAnchor: [0, -26]
  });
}

function renderMarkers() {
  if (!map) return;
  const seen = new Set();
  restaurants.forEach(r => {
    if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return;
    seen.add(r.id);
    const popupHtml = buildPopupHtml(r);
    if (markers.has(r.id)) {
      const m = markers.get(r.id);
      m.setLatLng([r.lat, r.lng]);
      m.setPopupContent(popupHtml);
    } else {
      const m = L.marker([r.lat, r.lng], { icon: burgerDivIcon() }).addTo(map);
      m.bindPopup(popupHtml);
      m.on('click', () => openDetailPanel(r.id));
      markers.set(r.id, m);
    }
  });
  // remove stale markers
  for (const [id, m] of markers.entries()) {
    if (!seen.has(id)) { map.removeLayer(m); markers.delete(id); }
  }
}

function buildPopupHtml(r) {
  const rs = reviewsFor(r.id);
  const avg = avgRating(r.id);
  const rowsHtml = rs.length
    ? rs.map(rv => `<div class="popup-review-row">
        <span>${escapeHtml(displayNameFor(rv.userId, rv.userName))}</span>
        <span>${rv.rating.toFixed(1)}/10</span>
      </div>`).join('')
    : `<div class="popup-review-row"><span>No reviews yet</span></div>`;
  return `
    <div class="popup-title">${escapeHtml(r.name)}</div>
    <div class="popup-addr">${escapeHtml(r.address || '')}</div>
    ${avg !== null ? meterHtml(avg) : ''}
    <div class="popup-reviews">${rowsHtml}</div>
  `;
}

// ---------------- panel: detail + review form ----------------
function openDetailPanel(restaurantId) {
  activeRestaurantId = restaurantId;
  panelMode = 'detail';
  renderDetailPanel(restaurantId);
  panelOverlay.classList.add('open');
  renderEntryList();
}

function closePanel() {
  panelOverlay.classList.remove('open');
  activeRestaurantId = null;
  panelMode = null;
}
el('panel-overlay').addEventListener('click', (e) => {
  if (e.target === panelOverlay) closePanel();
});

function renderDetailPanel(restaurantId) {
  const r = restaurants.find(x => x.id === restaurantId);
  if (!r) { closePanel(); return; }
  const rs = reviewsFor(restaurantId);
  const myReview = rs.find(rv => rv.userId === currentUser?.uid);
  const avg = avgRating(restaurantId);

  panelBody.innerHTML = `
    <div class="panel-wrap">
      <button class="close-x" id="panel-close">&times;</button>
      <h2 id="name-display">${escapeHtml(r.name)}${isAdmin ? ' <button class="edit-name-btn" id="edit-name-btn" title="Edit name">✏️</button>' : ''}</h2>
      <div class="sub">${escapeHtml(r.address || '')}</div>
      ${avg !== null ? meterHtml(avg) : '<div class="count-tag">No ratings yet — be the first</div>'}

      <div class="review-list">
        ${rs.map(rv => `
          <div class="review-item">
            <div class="who">
              <span>${escapeHtml(displayNameFor(rv.userId, rv.userName))}</span>
              <span>${rv.rating.toFixed(1)}/10</span>
            </div>
            <div class="breakdown">
              Burger ${Number(rv.burgerRating ?? rv.rating).toFixed(1)} ·
              Sides/Drinks ${Number(rv.sidesRating ?? rv.rating).toFixed(1)} ·
              Establishment ${Number(rv.establishmentRating ?? rv.rating).toFixed(1)}
            </div>
            ${rv.comment ? `<div class="comment">${escapeHtml(rv.comment)}</div>` : ''}
          </div>
        `).join('') || ''}
      </div>
