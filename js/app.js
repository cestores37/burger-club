import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, addDoc, setDoc, deleteDoc,
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
let map = null;
let markers = new Map(); // restaurantId -> leaflet marker
let activeRestaurantId = null;

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
      <button class="btn ghost small" id="logout-btn-2">Log out</button>
    `;
    el('logout-btn-2').addEventListener('click', () => signOut(auth));
    addEntryBtn.classList.toggle('hidden', !isAdmin);
    initMapIfNeeded();
    subscribeData();
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
    if (activeRestaurantId) renderDetailPanel(activeRestaurantId);
  });

  onSnapshot(collection(db, 'reviews'), (snap) => {
    reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEntryList();
    renderMarkers();
    if (activeRestaurantId) renderDetailPanel(activeRestaurantId);
  });
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
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
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
        <span>${escapeHtml(rv.userName || 'Someone')}</span>
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
  renderDetailPanel(restaurantId);
  panelOverlay.classList.add('open');
  renderEntryList();
}

function closePanel() {
  panelOverlay.classList.remove('open');
  activeRestaurantId = null;
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
      <h2>${escapeHtml(r.name)}</h2>
      <div class="sub">${escapeHtml(r.address || '')}</div>
      ${avg !== null ? meterHtml(avg) : '<div class="count-tag">No ratings yet — be the first</div>'}

      <div class="review-list">
        ${rs.map(rv => `
          <div class="review-item">
            <div class="who">
              <span>${escapeHtml(rv.userName || 'Someone')}</span>
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

      <hr style="border:none;border-top:1px dashed var(--line);margin:18px 0;">

      ${sliderField('burger', 'Burger', myReview?.burgerRating)}
      ${sliderField('sides', 'Sides / Drinks', myReview?.sidesRating)}
      ${sliderField('establishment', 'Establishment', myReview?.establishmentRating)}

      <div class="field">
        <label>Notes (optional)</label>
        <textarea id="review-comment" placeholder="What'd you get, how was it...">${escapeHtml(myReview?.comment || '')}</textarea>
      </div>
      <div class="panel-actions">
        <button class="btn" id="save-review-btn">${myReview ? 'Update your review' : 'Save your review'}</button>
        ${myReview ? '<button class="btn red small" id="delete-review-btn">Delete</button>' : ''}
        ${isAdmin ? '<button class="btn ghost small" id="delete-entry-btn" title="Remove this place entirely">Remove place</button>' : ''}
      </div>
      <div class="error-msg" id="review-error"></div>
    </div>
  `;

  const selectedRatings = {
    burger: myReview?.burgerRating ?? 5.0,
    sides: myReview?.sidesRating ?? 5.0,
    establishment: myReview?.establishmentRating ?? 5.0
  };

  el('panel-close').addEventListener('click', closePanel);

  ['burger', 'sides', 'establishment'].forEach(cat => {
    const input = document.querySelector(`input[data-cat="${cat}"]`);
    const readout = document.querySelector(`.slider-num[data-cat="${cat}"]`);
    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      selectedRatings[cat] = val;
      readout.textContent = val.toFixed(1);
    });
  });

  el('save-review-btn').addEventListener('click', async () => {
    const errBox = el('review-error');
    errBox.textContent = '';
    const comment = el('review-comment').value.trim();
    const overall = (selectedRatings.burger + selectedRatings.sides + selectedRatings.establishment) / 3;
    const reviewId = `${restaurantId}_${currentUser.uid}`;
    try {
      await setDoc(doc(db, 'reviews', reviewId), {
        restaurantId,
        userId: currentUser.uid,
        userName: currentUser.email.split('@')[0],
        burgerRating: selectedRatings.burger,
        sidesRating: selectedRatings.sides,
        establishmentRating: selectedRatings.establishment,
        rating: Math.round(overall * 10) / 10,
        comment,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      errBox.textContent = "Couldn't save — check your connection and try again.";
    }
  });

  if (myReview) {
    el('delete-review-btn')?.addEventListener('click', async () => {
      await deleteDoc(doc(db, 'reviews', `${restaurantId}_${currentUser.uid}`));
    });
  }

  if (isAdmin) {
    el('delete-entry-btn')?.addEventListener('click', async () => {
      if (!confirm(`Remove "${r.name}" and all its reviews? This can't be undone.`)) return;
      await Promise.all(rs.map(rv => deleteDoc(doc(db, 'reviews', rv.id))));
      await deleteDoc(doc(db, 'restaurants', restaurantId));
      closePanel();
    });
  }
}

// ---------------- panel: add entry (admin) ----------------
addEntryBtn.addEventListener('click', () => {
  activeRestaurantId = null;
  panelBody.innerHTML = `
    <div class="panel-wrap">
      <button class="close-x" id="panel-close">&times;</button>
      <h2>Add a place</h2>
      <div class="sub">We'll look up the address to place it on the map.</div>
      <div class="field">
        <label>Name</label>
        <input type="text" id="new-name" placeholder="e.g. Big Al's Burgers">
      </div>
      <div class="field">
        <label>Address</label>
        <input type="text" id="new-address" placeholder="123 Main St, Brooklyn, NY">
      </div>
      <div class="panel-actions">
        <button class="btn" id="geocode-save-btn">Find on map &amp; save</button>
      </div>
      <div class="error-msg" id="add-error"></div>
    </div>
  `;
  panelOverlay.classList.add('open');
  el('panel-close').addEventListener('click', closePanel);
  el('geocode-save-btn').addEventListener('click', handleAddEntry);
});

async function handleAddEntry() {
  const name = el('new-name').value.trim();
  const address = el('new-address').value.trim();
  const errBox = el('add-error');
  errBox.textContent = '';
  if (!name || !address) { errBox.textContent = 'Fill in both fields.'; return; }
  const btn = el('geocode-save-btn');
  btn.disabled = true;
  btn.textContent = 'Looking up address...';
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
    const results = await resp.json();
    if (!results.length) {
      errBox.textContent = "Couldn't find that address — try adding city/state, or check spelling.";
      btn.disabled = false; btn.textContent = 'Find on map & save';
      return;
    }
    const { lat, lon } = results[0];
    await addDoc(collection(db, 'restaurants'), {
      name,
      address,
      lat: parseFloat(lat),
      lng: parseFloat(lon),
      addedBy: currentUser.email,
      createdAt: serverTimestamp()
    });
    closePanel();
  } catch (err) {
    errBox.textContent = "Something went wrong looking up that address. Try again.";
    btn.disabled = false; btn.textContent = 'Find on map & save';
  }
}
